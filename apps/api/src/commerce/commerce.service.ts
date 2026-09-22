import { createHash, createHmac, randomBytes } from "node:crypto";
import type { ApiEnvironment } from "@createcanyon/config";
import type { z } from "zod";
import { addCartLineSchema, checkoutSchema } from "@createcanyon/contracts";
import {
  cartLines,
  carts,
  catalogItems,
  channelListings,
  entitlements,
  idempotencyKeys,
  itemVersions,
  journalLines,
  journals,
  ledgerAccounts,
  licenseCertificates,
  licenseTemplates,
  licenseVariants,
  offers,
  orderLines,
  orders,
  outboxEvents,
  payments,
  sellerOrganisations,
  storefronts,
  transfers,
  type DatabaseConnection,
} from "@createcanyon/database";
import { assertBalancedJournal, calculateBasisPoints } from "@createcanyon/domain";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Stripe from "stripe";
import type { Principal } from "../auth/auth.types.js";
import { UsersService } from "../auth/users.service.js";
import { API_ENV, DB_CONNECTION } from "../common/tokens.js";

type AddCartLineInput = z.infer<typeof addCartLineSchema>;
type CheckoutInput = z.infer<typeof checkoutSchema>;

interface CheckoutLine {
  readonly cartLineId: string;
  readonly listingId: string;
  readonly licenseVariantId: string;
  readonly quantity: number;
  readonly unitPriceMinor: bigint;
  readonly currency: string;
  readonly itemId: string;
  readonly versionId: string;
  readonly sellerOrganisationId: string;
  readonly title: string;
  readonly sellerName: string;
  readonly licenseTemplateId: string;
  readonly licenseTemplateVersion: number;
  readonly licenseName: string;
  readonly licenseBody: string;
  readonly itemMetadata: Record<string, unknown>;
}

function serializeCart(cart: { id: string; currency: string; status: string }, lines: Array<{ id: string; listingId: string; title: string; quantity: number; unitPriceMinorSnapshot: bigint; currency: string; licenseVariantId: string; licenseName: string }>) {
  const serializedLines = lines.map((line) => ({ ...line, unitPriceMinor: Number(line.unitPriceMinorSnapshot), lineTotalMinor: Number(line.unitPriceMinorSnapshot * BigInt(line.quantity)) }));
  return { ...cart, lines: serializedLines, subtotalMinor: serializedLines.reduce((sum, line) => sum + line.lineTotalMinor, 0) };
}

@Injectable()
export class CommerceService {
  private readonly stripe: Stripe;
  public constructor(
    @Inject(DB_CONNECTION) private readonly connection: DatabaseConnection,
    @Inject(API_ENV) private readonly environment: ApiEnvironment,
    private readonly users: UsersService,
  ) {
    this.stripe = new Stripe(environment.STRIPE_SECRET_KEY);
  }

  public async getCart(principal: Principal, currency = "USD") {
    const user = await this.users.resolveUser(principal);
    const normalizedCurrency = currency.toUpperCase();
    let [cart] = await this.connection.db.select().from(carts).where(and(eq(carts.userId, user.id), eq(carts.status, "ACTIVE"), eq(carts.currency, normalizedCurrency))).orderBy(desc(carts.createdAt)).limit(1);
    if (!cart) {
      [cart] = await this.connection.db.insert(carts).values({ userId: user.id, currency: normalizedCurrency }).returning();
    }
    if (!cart) throw new Error("Cart insert returned no row");
    const lines = await this.cartLines(cart.id);
    return serializeCart(cart, lines);
  }

  public async addLine(principal: Principal, input: AddCartLineInput) {
    const user = await this.users.resolveUser(principal);
    const [selection] = await this.connection.db
      .select({
        listing: channelListings,
        item: catalogItems,
        storefront: storefronts,
        offer: offers,
        variant: licenseVariants,
      })
      .from(channelListings)
      .innerJoin(storefronts, eq(channelListings.storefrontId, storefronts.id))
      .innerJoin(catalogItems, eq(channelListings.itemId, catalogItems.id))
      .innerJoin(licenseVariants, and(eq(licenseVariants.id, input.licenseVariantId), eq(licenseVariants.itemId, catalogItems.id), eq(licenseVariants.enabled, true)))
      .innerJoin(offers, and(eq(offers.licenseVariantId, licenseVariants.id), eq(offers.storefrontId, storefronts.id), eq(offers.active, true)))
      .where(and(eq(channelListings.id, input.listingId), eq(channelListings.status, "PUBLISHED"), eq(channelListings.enabled, true), eq(catalogItems.status, "PUBLISHED")))
      .limit(1);
    if (!selection) throw new NotFoundException({ code: "OFFER_NOT_FOUND", message: "The selected item or license is unavailable" });
    let [cart] = await this.connection.db.select().from(carts).where(and(eq(carts.userId, user.id), eq(carts.status, "ACTIVE"), eq(carts.currency, selection.offer.currency))).limit(1);
    if (!cart) {
      [cart] = await this.connection.db.insert(carts).values({ userId: user.id, currency: selection.offer.currency, sourceStorefrontId: selection.storefront.id }).returning();
    }
    if (!cart) throw new Error("Cart insert returned no row");
    const [existing] = await this.connection.db.select().from(cartLines).where(and(eq(cartLines.cartId, cart.id), eq(cartLines.listingId, input.listingId), eq(cartLines.licenseVariantId, input.licenseVariantId))).limit(1);
    if (existing) {
      await this.connection.db.update(cartLines).set({ quantity: Math.min(100, existing.quantity + input.quantity), updatedAt: new Date() }).where(eq(cartLines.id, existing.id));
    } else {
      await this.connection.db.insert(cartLines).values({
        cartId: cart.id,
        listingId: input.listingId,
        licenseVariantId: input.licenseVariantId,
        addedFromStorefrontId: selection.storefront.id,
        quantity: input.quantity,
        unitPriceMinorSnapshot: selection.offer.amountMinor,
        currency: selection.offer.currency,
      });
    }
    return serializeCart(cart, await this.cartLines(cart.id));
  }

  public async removeLine(principal: Principal, lineId: string) {
    const user = await this.users.resolveUser(principal);
    const [line] = await this.connection.db.select({ line: cartLines, cart: carts }).from(cartLines).innerJoin(carts, eq(cartLines.cartId, carts.id)).where(and(eq(cartLines.id, lineId), eq(carts.userId, user.id), eq(carts.status, "ACTIVE"))).limit(1);
    if (!line) throw new NotFoundException({ code: "CART_LINE_NOT_FOUND", message: "Cart line was not found" });
    await this.connection.db.delete(cartLines).where(eq(cartLines.id, lineId));
    return serializeCart(line.cart, await this.cartLines(line.cart.id));
  }

  public async checkout(principal: Principal, input: CheckoutInput, idempotencyKey: string) {
    if (!/^[A-Za-z0-9._:-]{8,255}$/.test(idempotencyKey)) throw new BadRequestException({ code: "INVALID_IDEMPOTENCY_KEY", message: "A valid Idempotency-Key header is required" });
    this.assertReturnUrl(input.successUrl);
    this.assertReturnUrl(input.cancelUrl);
    const user = await this.users.resolveUser(principal);
    const scope = `checkout:${user.id}`;
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const [existing] = await this.connection.db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, idempotencyKey))).limit(1);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "This idempotency key was used with a different request" });
      if (existing.responseBody && existing.responseStatus && existing.responseStatus !== 202) return existing.responseBody;
      const orderId = typeof existing.responseBody?.orderId === "string" ? existing.responseBody.orderId : undefined;
      if (orderId) return this.resumePayment(existing.id, orderId, user.id);
      throw new ConflictException({ code: "CHECKOUT_IN_PROGRESS", message: "A checkout with this idempotency key is already in progress" });
    }
    const [keyRow] = await this.connection.db.insert(idempotencyKeys).values({
      scope,
      key: idempotencyKey,
      requestHash,
      lockedUntil: new Date(Date.now() + 5 * 60_000),
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    }).onConflictDoNothing().returning();
    if (!keyRow) return this.checkout(principal, input, idempotencyKey);

    try {
      const { orderId } = await this.createPendingOrder(user.id, input.cartId);
      await this.connection.db.update(idempotencyKeys).set({ responseStatus: 202, responseBody: { state: "PAYMENT_PENDING", orderId }, updatedAt: new Date() }).where(eq(idempotencyKeys.id, keyRow.id));
      const response = await this.resumePayment(keyRow.id, orderId, user.id);
      await this.connection.db.update(idempotencyKeys).set({ responseStatus: 200, responseBody: response, lockedUntil: null, updatedAt: new Date() }).where(eq(idempotencyKeys.id, keyRow.id));
      return response;
    } catch (error) {
      await this.connection.db.update(idempotencyKeys).set({ lockedUntil: new Date(0), updatedAt: new Date() }).where(eq(idempotencyKeys.id, keyRow.id));
      throw error;
    }
  }

  public async handleStripeWebhook(rawBody: Buffer, signature: string | undefined) {
    if (this.environment.PAYMENTS_MODE !== "stripe") return { received: true, ignored: true };
    if (!signature) throw new BadRequestException({ code: "STRIPE_SIGNATURE_REQUIRED", message: "Missing Stripe signature" });
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.environment.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new BadRequestException({ code: "INVALID_STRIPE_SIGNATURE", message: "Stripe webhook signature validation failed" });
    }
    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object;
      await this.settlePayment(intent.id, intent.latest_charge ? String(intent.latest_charge) : undefined);
    } else if (event.type === "payment_intent.payment_failed") {
      await this.connection.db.update(payments).set({ status: "FAILED", failureMessage: event.data.object.last_payment_error?.message ?? "Payment failed", updatedAt: new Date() }).where(eq(payments.providerPaymentIntentId, event.data.object.id));
    }
    return { received: true };
  }

  private async cartLines(cartId: string) {
    return this.connection.db.select({
      id: cartLines.id,
      listingId: cartLines.listingId,
      title: channelListings.title,
      quantity: cartLines.quantity,
      unitPriceMinorSnapshot: cartLines.unitPriceMinorSnapshot,
      currency: cartLines.currency,
      licenseVariantId: cartLines.licenseVariantId,
      licenseName: licenseVariants.name,
    }).from(cartLines)
      .innerJoin(channelListings, eq(cartLines.listingId, channelListings.id))
      .innerJoin(licenseVariants, eq(cartLines.licenseVariantId, licenseVariants.id))
      .where(eq(cartLines.cartId, cartId))
      .orderBy(desc(cartLines.createdAt));
  }

  private assertReturnUrl(value: string) {
    const origin = new URL(value).origin;
    if (!this.environment.CORS_ALLOWED_ORIGINS.includes(origin)) {
      throw new BadRequestException({ code: "RETURN_URL_NOT_ALLOWED", message: "Checkout return URL is not an approved application origin" });
    }
  }

  private async loadCheckoutLines(cartId: string): Promise<CheckoutLine[]> {
    const rows = await this.connection.db.select({
      cartLineId: cartLines.id,
      listingId: channelListings.id,
      licenseVariantId: licenseVariants.id,
      quantity: cartLines.quantity,
      unitPriceMinor: cartLines.unitPriceMinorSnapshot,
      currency: cartLines.currency,
      itemId: catalogItems.id,
      versionId: itemVersions.id,
      sellerOrganisationId: sellerOrganisations.id,
      title: channelListings.title,
      sellerName: sellerOrganisations.displayName,
      licenseTemplateId: licenseTemplates.id,
      licenseTemplateVersion: licenseTemplates.version,
      licenseName: licenseVariants.name,
      licenseBody: licenseTemplates.bodyMarkdown,
      itemMetadata: catalogItems.metadata,
    }).from(cartLines)
      .innerJoin(channelListings, eq(cartLines.listingId, channelListings.id))
      .innerJoin(catalogItems, eq(channelListings.itemId, catalogItems.id))
      .innerJoin(itemVersions, eq(catalogItems.currentVersionId, itemVersions.id))
      .innerJoin(sellerOrganisations, eq(catalogItems.sellerOrganisationId, sellerOrganisations.id))
      .innerJoin(licenseVariants, eq(cartLines.licenseVariantId, licenseVariants.id))
      .innerJoin(licenseTemplates, eq(licenseVariants.licenseTemplateId, licenseTemplates.id))
      .where(and(eq(cartLines.cartId, cartId), eq(channelListings.status, "PUBLISHED"), eq(catalogItems.status, "PUBLISHED"), eq(itemVersions.status, "PUBLISHED")));
    return rows;
  }

  private async createPendingOrder(userId: string, cartId: string) {
    const [cart] = await this.connection.db.select().from(carts).where(and(eq(carts.id, cartId), eq(carts.userId, userId), eq(carts.status, "ACTIVE"))).limit(1);
    if (!cart) throw new NotFoundException({ code: "CART_NOT_FOUND", message: "Active cart was not found" });
    const lines = await this.loadCheckoutLines(cartId);
    if (!lines.length) throw new BadRequestException({ code: "EMPTY_OR_UNAVAILABLE_CART", message: "The cart is empty or contains unavailable products" });
    if (lines.some((line) => line.currency !== cart.currency)) throw new BadRequestException({ code: "MIXED_CURRENCY_CART", message: "All cart items must use one currency" });
    const subtotal = lines.reduce((sum, line) => sum + line.unitPriceMinor * BigInt(line.quantity), 0n);
    const orderId = crypto.randomUUID();
    const orderNumber = `CC-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(5).toString("hex").toUpperCase()}`;
    await this.connection.db.transaction(async (tx) => {
      await tx.insert(orders).values({ id: orderId, orderNumber, userId, cartId, currency: cart.currency, subtotalMinor: subtotal, totalMinor: subtotal });
      await tx.insert(orderLines).values(lines.map((line) => {
        const lineTotal = line.unitPriceMinor * BigInt(line.quantity);
        const platformFee = calculateBasisPoints(lineTotal, this.environment.PLATFORM_FEE_BPS);
        return {
          orderId,
          canonicalItemId: line.itemId,
          itemVersionId: line.versionId,
          channelListingId: line.listingId,
          sellerOrganisationId: line.sellerOrganisationId,
          licenseVariantId: line.licenseVariantId,
          licenseTemplateId: line.licenseTemplateId,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          platformFeeMinor: platformFee,
          sellerEarningsMinor: lineTotal - platformFee,
          currency: line.currency,
          titleSnapshot: line.title,
          sellerNameSnapshot: line.sellerName,
          licenseNameSnapshot: line.licenseName,
          licenseBodySnapshot: line.licenseBody,
          metadataSnapshot: { itemMetadata: line.itemMetadata, licenseTemplateVersion: line.licenseTemplateVersion },
        };
      }));
      await tx.insert(payments).values({
        orderId,
        provider: this.environment.PAYMENTS_MODE === "stripe" ? "stripe" : "stub",
        providerPaymentIntentId: `pending_${orderId}`,
        status: "CREATED",
        amountMinor: subtotal,
        currency: cart.currency,
      });
      await tx.update(carts).set({ status: "CHECKOUT_PENDING", updatedAt: new Date() }).where(eq(carts.id, cartId));
    });
    return { orderId };
  }

  private async resumePayment(idempotencyRecordId: string, orderId: string, userId: string) {
    const [payment] = await this.connection.db.select({ payment: payments, order: orders }).from(payments).innerJoin(orders, eq(payments.orderId, orders.id)).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).limit(1);
    if (!payment) throw new NotFoundException({ code: "PAYMENT_NOT_FOUND", message: "Checkout payment was not found" });
    if (payment.order.status === "PAID") return { state: "PAID", orderId, orderNumber: payment.order.orderNumber };
    if (this.environment.PAYMENTS_MODE === "stub") {
      const providerId = `stub_${orderId}`;
      await this.connection.db.update(payments).set({ providerPaymentIntentId: providerId, status: "SUCCEEDED", updatedAt: new Date() }).where(eq(payments.id, payment.payment.id));
      await this.settlePayment(providerId);
      return { state: "PAID", orderId, orderNumber: payment.order.orderNumber, mode: "stub" };
    }
    let intent: Stripe.PaymentIntent;
    if (payment.payment.providerPaymentIntentId.startsWith("pi_")) {
      intent = await this.stripe.paymentIntents.retrieve(payment.payment.providerPaymentIntentId);
    } else {
      intent = await this.stripe.paymentIntents.create({
        amount: Number(payment.order.totalMinor),
        currency: payment.order.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        metadata: { orderId, orderNumber: payment.order.orderNumber, userId },
      }, { idempotencyKey: `checkout-${idempotencyRecordId}` });
      await this.connection.db.update(payments).set({ providerPaymentIntentId: intent.id, status: intent.status === "requires_action" ? "REQUIRES_ACTION" : "PROCESSING", metadata: { stripeStatus: intent.status }, updatedAt: new Date() }).where(eq(payments.id, payment.payment.id));
    }
    return { state: "REQUIRES_PAYMENT", orderId, orderNumber: payment.order.orderNumber, paymentIntentId: intent.id, clientSecret: intent.client_secret };
  }

  public async settlePayment(providerPaymentIntentId: string, providerChargeId?: string) {
    const [record] = await this.connection.db.select({ payment: payments, order: orders }).from(payments).innerJoin(orders, eq(payments.orderId, orders.id)).where(eq(payments.providerPaymentIntentId, providerPaymentIntentId)).limit(1);
    if (!record) throw new NotFoundException({ code: "PAYMENT_NOT_FOUND", message: "Payment was not found" });
    if (record.order.status === "PAID") return;
    const lines = await this.connection.db.select().from(orderLines).where(eq(orderLines.orderId, record.order.id));
    const licenseIds = [...new Set(lines.map((line) => line.licenseTemplateId))];
    const templates = licenseIds.length ? await this.connection.db.select().from(licenseTemplates).where(inArray(licenseTemplates.id, licenseIds)) : [];
    const templateVersions = new Map(templates.map((template) => [template.id, template.version]));
    const total = record.order.totalMinor;
    const totalPlatformFee = lines.reduce((sum, line) => sum + line.platformFeeMinor, 0n);
    const sellerTotals = new Map<string, bigint>();
    for (const line of lines) sellerTotals.set(line.sellerOrganisationId, (sellerTotals.get(line.sellerOrganisationId) ?? 0n) + line.sellerEarningsMinor);
    assertBalancedJournal([
      { accountCode: "STRIPE_CLEARING", debitMinor: total, creditMinor: 0n },
      { accountCode: "PLATFORM_REVENUE", debitMinor: 0n, creditMinor: totalPlatformFee },
      ...[...sellerTotals].map(([sellerId, amount]) => ({ accountCode: `SELLER_PAYABLE_${sellerId}`, debitMinor: 0n, creditMinor: amount })),
    ]);

    await this.connection.db.transaction(async (tx) => {
      const [claimed] = await tx.update(orders).set({ status: "PAID", paidAt: new Date(), updatedAt: new Date() }).where(and(eq(orders.id, record.order.id), eq(orders.status, "PENDING_PAYMENT"))).returning({ id: orders.id });
      if (!claimed) return;
      await tx.update(payments).set({ status: "SUCCEEDED", ...(providerChargeId ? { providerChargeId } : {}), updatedAt: new Date() }).where(eq(payments.id, record.payment.id));
      if (record.order.cartId) await tx.update(carts).set({ status: "CONVERTED", updatedAt: new Date() }).where(eq(carts.id, record.order.cartId));

      for (const line of lines) {
        const [entitlement] = await tx.insert(entitlements).values({
          userId: record.order.userId,
          orderLineId: line.id,
          itemId: line.canonicalItemId,
          itemVersionId: line.itemVersionId,
        }).onConflictDoNothing().returning();
        if (entitlement) {
          const snapshot = {
            certificateVersion: 1,
            orderId: record.order.id,
            orderNumber: record.order.orderNumber,
            orderLineId: line.id,
            itemId: line.canonicalItemId,
            itemVersionId: line.itemVersionId,
            buyerUserId: record.order.userId,
            sellerOrganisationId: line.sellerOrganisationId,
            itemTitle: line.titleSnapshot,
            sellerName: line.sellerNameSnapshot,
            licenseName: line.licenseNameSnapshot,
            licenseBody: line.licenseBodySnapshot,
            issuedAt: new Date().toISOString(),
          };
          const signature = createHmac("sha256", this.environment.LICENSE_SIGNING_SECRET).update(JSON.stringify(snapshot)).digest("base64url");
          await tx.insert(licenseCertificates).values({
            certificateNumber: `CCL-${randomBytes(12).toString("hex").toUpperCase()}`,
            entitlementId: entitlement.id,
            licenseTemplateVersion: templateVersions.get(line.licenseTemplateId) ?? 1,
            licenseSnapshot: snapshot,
            signature,
          });
        }
        await tx.insert(transfers).values({
          sellerOrganisationId: line.sellerOrganisationId,
          orderLineId: line.id,
          amountMinor: line.sellerEarningsMinor,
          currency: line.currency,
          eligibleAt: new Date(Date.now() + this.environment.PAYOUT_RESERVE_DAYS * 86_400_000),
        }).onConflictDoNothing();
      }

      const clearing = await this.ensureLedgerAccount(tx, "STRIPE_CLEARING", "Stripe clearing", "ASSET", record.order.currency);
      const revenue = await this.ensureLedgerAccount(tx, "PLATFORM_REVENUE", "Platform commission revenue", "REVENUE", record.order.currency);
      const [journal] = await tx.insert(journals).values({ referenceType: "PAYMENT", referenceId: record.payment.id, description: `Payment for ${record.order.orderNumber}` }).returning();
      if (!journal) throw new Error("Journal insert returned no row");
      const entries: Array<typeof journalLines.$inferInsert> = [
        { journalId: journal.id, ledgerAccountId: clearing.id, debitMinor: total, creditMinor: 0n, currency: record.order.currency, memo: "Customer payment" },
        { journalId: journal.id, ledgerAccountId: revenue.id, debitMinor: 0n, creditMinor: totalPlatformFee, currency: record.order.currency, memo: "Marketplace commission" },
      ];
      for (const [sellerId, amount] of sellerTotals) {
        const payable = await this.ensureLedgerAccount(tx, `SELLER_PAYABLE_${sellerId}`, `Seller payable ${sellerId}`, "LIABILITY", record.order.currency, sellerId);
        entries.push({ journalId: journal.id, ledgerAccountId: payable.id, debitMinor: 0n, creditMinor: amount, currency: record.order.currency, memo: "Seller earnings" });
      }
      await tx.insert(journalLines).values(entries);
      await tx.insert(outboxEvents).values({ eventType: "ORDER_PAID", aggregateType: "order", aggregateId: record.order.id, payload: { orderId: record.order.id, userId: record.order.userId } });
    });
  }

  private async ensureLedgerAccount(
    tx: Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0],
    code: string,
    name: string,
    type: "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE" | "EQUITY",
    currency: string,
    sellerOrganisationId?: string,
  ) {
    const [existing] = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.code, code)).limit(1);
    if (existing) return existing;
    const [created] = await tx.insert(ledgerAccounts).values({ code, name, type, currency, ...(sellerOrganisationId ? { sellerOrganisationId } : {}) }).onConflictDoNothing().returning();
    if (created) return created;
    const [raced] = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.code, code)).limit(1);
    if (!raced) throw new Error(`Unable to create ledger account ${code}`);
    return raced;
  }
}
