import type { ApiEnvironment } from "@createcanyon/config";
import type { SellerCreateInput } from "./sellers.types.js";
import {
  paymentAccounts,
  sellerMemberships,
  sellerOrganisations,
  type DatabaseConnection,
} from "@createcanyon/database";
import { normalizeSlug } from "@createcanyon/domain";
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
import { UsersService } from "../auth/users.service.js";
import type { Principal } from "../auth/auth.types.js";
import { API_ENV, DB_CONNECTION } from "../common/tokens.js";

@Injectable()
export class SellersService {
  private readonly stripe: Stripe;
  public constructor(
    @Inject(DB_CONNECTION) private readonly connection: DatabaseConnection,
    @Inject(API_ENV) private readonly environment: ApiEnvironment,
    private readonly users: UsersService,
  ) {
    this.stripe = new Stripe(environment.STRIPE_SECRET_KEY);
  }

  public async mine(principal: Principal) {
    const user = await this.users.resolveUser(principal);
    return this.connection.db
      .select({ organisation: sellerOrganisations, role: sellerMemberships.role, paymentAccount: paymentAccounts })
      .from(sellerMemberships)
      .innerJoin(sellerOrganisations, eq(sellerMemberships.sellerOrganisationId, sellerOrganisations.id))
      .leftJoin(paymentAccounts, eq(paymentAccounts.sellerOrganisationId, sellerOrganisations.id))
      .where(eq(sellerMemberships.userId, user.id));
  }

  public async create(principal: Principal, input: SellerCreateInput) {
    const user = await this.users.resolveUser(principal);
    const base = normalizeSlug(input.displayName);
    const slug = `${base}-${crypto.randomUUID().slice(0, 8)}`;
    try {
      return await this.connection.db.transaction(async (tx) => {
        const [seller] = await tx.insert(sellerOrganisations).values({
          legalName: input.legalName,
          displayName: input.displayName,
          slug,
          countryCode: input.countryCode,
          businessType: input.businessType,
          ...(input.description ? { description: input.description } : {}),
          ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
          status: "PENDING_VERIFICATION",
        }).returning();
        if (!seller) throw new Error("Seller insert returned no row");
        await tx.insert(sellerMemberships).values({ sellerOrganisationId: seller.id, userId: user.id, role: "OWNER" });
        return seller;
      });
    } catch (error) {
      if (String(error).includes("unique")) throw new ConflictException({ code: "SELLER_CONFLICT", message: "A seller with these details already exists" });
      throw error;
    }
  }

  public async assertMembership(principal: Principal, sellerOrganisationId: string, roles?: readonly string[]) {
    const user = await this.users.resolveUser(principal);
    const [membership] = await this.connection.db.select().from(sellerMemberships).where(and(
      eq(sellerMemberships.userId, user.id),
      eq(sellerMemberships.sellerOrganisationId, sellerOrganisationId),
    )).limit(1);
    if (!membership) throw new ForbiddenException({ code: "SELLER_ACCESS_DENIED", message: "You do not belong to this seller organisation" });
    if (roles?.length && !roles.includes(membership.role)) {
      throw new ForbiddenException({ code: "SELLER_ROLE_REQUIRED", message: "Your seller role cannot perform this action" });
    }
    return { user, membership };
  }

  public async onboardingSession(principal: Principal, sellerOrganisationId: string) {
    const { user } = await this.assertMembership(principal, sellerOrganisationId, ["OWNER", "FINANCE"]);
    if (this.environment.PAYMENTS_MODE === "stub") {
      return { mode: "stub", clientSecret: null, message: "Local stub mode does not collect payout details" };
    }
    const [seller] = await this.connection.db.select().from(sellerOrganisations).where(eq(sellerOrganisations.id, sellerOrganisationId)).limit(1);
    if (!seller) throw new NotFoundException({ code: "SELLER_NOT_FOUND", message: "Seller was not found" });
    let [paymentAccount] = await this.connection.db.select().from(paymentAccounts).where(eq(paymentAccounts.sellerOrganisationId, sellerOrganisationId)).limit(1);
    if (!paymentAccount) {
      const account = await this.stripe.accounts.create({
        country: seller.countryCode,
        controller: {
          fees: { payer: "application" },
          losses: { payments: "application" },
          stripe_dashboard: { type: "express" },
        },
        metadata: { sellerOrganisationId, createdByUserId: user.id },
      }, { idempotencyKey: `seller-account-${sellerOrganisationId}` });
      [paymentAccount] = await this.connection.db.insert(paymentAccounts).values({
        sellerOrganisationId,
        providerAccountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        requirements: account.requirements as unknown as Record<string, unknown>,
        lastSyncedAt: new Date(),
      }).returning();
    }
    if (!paymentAccount) throw new Error("Payment account insert returned no row");
    const session = await this.stripe.accountSessions.create({
      account: paymentAccount.providerAccountId,
      components: { account_onboarding: { enabled: true } },
    });
    return { mode: "stripe", clientSecret: session.client_secret };
  }
}
