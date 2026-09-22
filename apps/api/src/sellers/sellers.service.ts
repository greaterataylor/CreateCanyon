import type { ApiEnvironment } from "@createcanyon/config";
import type { SellerCreateInput } from "./sellers.types.js";
import {
  paymentAccounts,
  sellerMemberships,
  sellerOrganisations,
  audit, type DatabaseConnection,
} from "@createcanyon/database";
import { slugify } from "@createcanyon/domain";
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
    const base = slugify(input.displayName);
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
    if (roles?.some(role => ["UPLOADER", "MANAGER"].includes(role))) {
      const [seller] = await this.connection.client`SELECT status FROM seller_organisation WHERE id=${sellerOrganisationId}`;
      if (!seller || ["SUSPENDED", "CLOSED", "RESTRICTED"].includes(seller.status)) throw new ForbiddenException("Seller uploads are restricted");
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
    await this.connection.client`UPDATE seller_organisation SET payout_hold_until=GREATEST(COALESCE(payout_hold_until,now()),now()+interval '48 hours'), updated_at=now() WHERE id=${sellerOrganisationId}`;
    await audit(this.connection.client, {actorType:"USER",actorUserId:user.id, action:"SELLER_PAYOUT_ONBOARDING", resourceType:"seller",resourceId:sellerOrganisationId, reason:"Payout onboarding opened; 48-hour transfer hold applied"});
    const session = await this.stripe.accountSessions.create({
      account: paymentAccount.providerAccountId,
      components: { account_onboarding: { enabled: true } },
    });
    return { mode: "stripe", clientSecret: session.client_secret };
  }
  async terms() {
    const [terms] = await this.connection.client`SELECT id,version,body_markdown,content_hash,effective_at FROM seller_terms WHERE active AND effective_at<=now() ORDER BY version DESC LIMIT 1`;
    if (!terms) throw new NotFoundException("Seller terms have not been configured");
    return terms;
  }
  async acceptTerms(principal: Principal, sellerId: string, termsId: string, contentHash: string) {
    const {user}=await this.assertMembership(principal,sellerId,["OWNER"]);
    return this.connection.client.begin(async tx=>{
      const [terms]=await tx`SELECT * FROM seller_terms WHERE id=${termsId} AND content_hash=${contentHash} AND active AND effective_at<=now() AND id=(SELECT id FROM seller_terms WHERE active AND effective_at<=now() ORDER BY version DESC LIMIT 1)`;
      if(!terms) throw new ConflictException("The seller terms changed. Read the current version before accepting.");
      await tx`INSERT INTO seller_terms_acceptance(seller_organisation_id,terms_id,user_id,content_hash) VALUES(${sellerId},${termsId},${user.id},${contentHash}) ON CONFLICT DO NOTHING`;
      await audit(tx,{actorType:"USER",actorUserId:user.id,action:"SELLER_TERMS_ACCEPTED",resourceType:"seller",resourceId:sellerId,after:{termsId,contentHash},reason:"Explicit seller acceptance"});
      return {accepted:true,termsId};
    });
  }
  async earnings(principal: Principal, sellerId: string) {
    await this.assertMembership(principal,sellerId,["OWNER","FINANCE","MANAGER"]);
    const balances=await this.connection.client`SELECT a.code,a.currency,a.type,COALESCE(sum(l.credit_minor-l.debit_minor),0)::text AS balance_minor
      FROM ledger_account a LEFT JOIN journal_line l ON l.ledger_account_id=a.id WHERE a.seller_organisation_id=${sellerId} GROUP BY a.id ORDER BY a.currency,a.code`;
    const transfers=await this.connection.client`SELECT id,order_line_id,amount_minor::text,reversed_minor::text,currency,status,eligible_at,submitted_at,paid_at FROM seller_transfer WHERE seller_organisation_id=${sellerId} ORDER BY created_at DESC LIMIT 200`;
    const sales=await this.connection.client`SELECT ol.id,ol.title_snapshot,ol.quantity,ol.seller_earnings_minor::text,ol.currency,o.order_number,o.status,o.paid_at,s.key AS channel
      FROM order_line ol JOIN customer_order o ON o.id=ol.order_id JOIN channel_listing cl ON cl.id=ol.channel_listing_id JOIN storefront s ON s.id=cl.storefront_id
      WHERE ol.seller_organisation_id=${sellerId} AND o.status<>'PENDING_PAYMENT' ORDER BY o.created_at DESC LIMIT 200`;
    return {balances,transfers,sales};
  }

  async onboardingLink(principal:Principal,sellerId:string,returnUrl:string){
    if(!this.environment.CORS_ALLOWED_ORIGINS.includes(new URL(returnUrl).origin))throw new ForbiddenException("Unapproved onboarding return origin");
    const response=await this.onboardingSession(principal,sellerId);
    if(response.mode==="stub")return response;
    const [account]=await this.connection.client`SELECT provider_account_id FROM payment_account WHERE seller_organisation_id=${sellerId} AND provider='stripe'`;
    if(!account)throw new NotFoundException("Connected account not found");
    const link=await this.stripe.accountLinks.create({account:account.provider_account_id,type:"account_onboarding",return_url:returnUrl,refresh_url:returnUrl});
    return {mode:"stripe",url:link.url,expiresAt:link.expires_at};
  }

}
