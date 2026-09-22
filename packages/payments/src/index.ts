import { createHash, createHmac, randomUUID } from "node:crypto";
import Stripe from "stripe";
import type { ApiEnvironment } from "@createcanyon/config";
import { audit, enqueue, postJournal, type DatabaseConnection, type Posting } from "@createcanyon/database";
import { calculateBasisPoints, DomainError, minorToSafeNumber, refundAllocation } from "@createcanyon/domain";

export interface CheckoutRequest {
  cartId: string;
  billingAddress?: { line1: string; line2?: string; city: string; state?: string; postal_code: string; country: string };
  successUrl: string;
  cancelUrl: string;
}
const money = (value: unknown) => BigInt(String(value ?? 0));
const clearing = (debit: bigint, credit=0n): Posting => ({ code: "STRIPE_CLEARING", name: "Stripe clearing", type: "ASSET", debit, credit });
const revenue = (debit: bigint, credit=0n): Posting => ({ code: "PLATFORM_REVENUE", name: "Platform commission", type: "REVENUE", debit, credit });
const taxPayable = (debit: bigint, credit=0n): Posting => ({ code: "TAX_PAYABLE", name: "Tax payable", type: "LIABILITY", debit, credit });
const payable = (sellerId: string, debit: bigint, credit=0n): Posting => ({ code: `SELLER_PAYABLE_${sellerId}`, name: "Seller payable", type: "LIABILITY", sellerId, debit, credit });
function fail(code: string, message: string): never { throw new DomainError(code,message); }

/** Shared API/worker engine. Ambiguous provider mutations older than 23 hours require
 * manual reconciliation rather than risking expired provider-idempotency guarantees. */
export class PaymentEngine {
  readonly stripe: Stripe;
  constructor(readonly connection: DatabaseConnection, readonly env: ApiEnvironment) {
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY,{ timeout: 15_000, maxNetworkRetries: 2 });
  }
  get sql() { return this.connection.client; }
  async getCart(userId: string, currency="USD") {
    if (!/^[A-Z]{3}$/.test(currency)) fail("INVALID_CURRENCY","Use a three-letter uppercase currency");
    const [cart] = await this.sql`INSERT INTO cart(user_id,currency) VALUES(${userId},${currency})
      ON CONFLICT(user_id,currency) WHERE status='ACTIVE' AND user_id IS NOT NULL
      DO UPDATE SET updated_at=cart.updated_at RETURNING *`;
    return this.cartView(cart!.id);
  }
  async cartView(cartId: string) {
    const [cart] = await this.sql`SELECT id,currency,status FROM cart WHERE id=${cartId}`;
    if (!cart) fail("CART_NOT_FOUND","Cart not found");
    const rows = await this.sql`SELECT cl.id,cl.listing_id,cl.license_variant_id,l.title,v.name AS license_name,
      cl.quantity,cl.unit_price_minor_snapshot,cl.currency FROM cart_line cl JOIN channel_listing l ON l.id=cl.listing_id
      JOIN license_variant v ON v.id=cl.license_variant_id WHERE cl.cart_id=${cartId} ORDER BY cl.created_at`;
    const lines = rows.map(r=>({id:r.id,listingId:r.listing_id,licenseVariantId:r.license_variant_id,title:r.title,licenseName:r.license_name,quantity:r.quantity,currency:r.currency,
      unitPriceMinor:minorToSafeNumber(r.unit_price_minor_snapshot),lineTotalMinor:minorToSafeNumber(money(r.unit_price_minor_snapshot)*BigInt(r.quantity))}));
    return {...cart,lines,subtotalMinor:lines.reduce((sum,l)=>sum+l.lineTotalMinor,0)};
  }
  async addLine(userId:string, input:{listingId:string;licenseVariantId:string;quantity:number}) {
    const [offer] = await this.sql`SELECT p.*,o.amount_minor AS selected_price,o.currency AS selected_currency FROM public_listing p
      JOIN license_variant lv ON lv.id=${input.licenseVariantId} AND lv.item_id=p.item_id AND lv.enabled
      JOIN license_template lt ON lt.id=lv.license_template_id AND lt.active
      JOIN LATERAL (SELECT * FROM offer o WHERE o.license_variant_id=lv.id AND o.active
        AND (o.storefront_id=p.storefront_id OR o.storefront_id IS NULL)
        AND (o.starts_at IS NULL OR o.starts_at<=now()) AND (o.ends_at IS NULL OR o.ends_at>now())
        ORDER BY (o.storefront_id IS NOT NULL) DESC LIMIT 1) o ON true WHERE p.listing_id=${input.listingId}`;
    if (!offer) fail("OFFER_NOT_FOUND","This listing or license is unavailable");
    if ((await this.sql`SELECT 1 FROM seller_membership WHERE seller_organisation_id=${offer.seller_id} AND user_id=${userId}`).length) fail("SELF_PURCHASE","Sellers cannot purchase their own products");
    const cart = await this.getCart(userId,offer.selected_currency);
    await this.sql.begin(async tx=>{
      const [active] = await tx`SELECT id FROM cart WHERE id=${cart.id} AND status='ACTIVE' FOR UPDATE`;
      if (!active) fail("CART_LOCKED","This cart is already checking out");
      const [count] = await tx`SELECT count(*)::int AS n FROM cart_line WHERE cart_id=${cart.id}`;
      if (count!.n >= 100) fail("CART_LIMIT","A checkout supports at most 100 lines");
      await tx`INSERT INTO cart_line(cart_id,listing_id,license_variant_id,added_from_storefront_id,quantity,unit_price_minor_snapshot,currency)
        VALUES(${cart.id},${input.listingId},${input.licenseVariantId},${offer.storefront_id},${input.quantity},${offer.selected_price},${offer.selected_currency})
        ON CONFLICT(cart_id,listing_id,license_variant_id) DO UPDATE SET quantity=least(100,cart_line.quantity+EXCLUDED.quantity),
        unit_price_minor_snapshot=EXCLUDED.unit_price_minor_snapshot,updated_at=now()`;
    });
    return this.cartView(cart.id);
  }
  async removeLine(userId:string,lineId:string) {
    const cartId = await this.sql.begin(async tx=>{
      const [line] = await tx`SELECT c.id FROM cart c JOIN cart_line l ON l.cart_id=c.id WHERE l.id=${lineId} AND c.user_id=${userId} AND c.status='ACTIVE' FOR UPDATE OF c`;
      if (!line) fail("CART_LINE_NOT_FOUND","Active cart line not found");
      await tx`DELETE FROM cart_line WHERE id=${lineId}`; return line.id as string;
    });
    return this.cartView(cartId);
  }
  async checkout(userId:string,input:CheckoutRequest,key:string) {
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) fail("INVALID_IDEMPOTENCY_KEY","A valid Idempotency-Key header is required");
    for (const url of [input.successUrl,input.cancelUrl]) if (!this.env.CORS_ALLOWED_ORIGINS.includes(new URL(url).origin)) fail("RETURN_URL_NOT_ALLOWED","Unapproved return URL");
    const requestHash=createHash("sha256").update(JSON.stringify(input)).digest("hex"),scope=`checkout:${userId}`;
    const orderId=await this.sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${scope+":"+key},0))`;
      const [prior]=await tx`SELECT * FROM idempotency_key WHERE scope=${scope} AND key=${key}`;
      if(prior){if(prior.request_hash!==requestHash)fail("IDEMPOTENCY_KEY_REUSED","Idempotency key was used for a different request");return prior.response_body.orderId as string;}
      const [cart]=await tx`SELECT * FROM cart WHERE id=${input.cartId} AND user_id=${userId} FOR UPDATE`;
      if(!cart)fail("CART_NOT_FOUND","Cart not found");
      const [existingOrder]=await tx`SELECT id FROM customer_order WHERE cart_id=${cart.id}`;
      if(existingOrder){
        await tx`INSERT INTO idempotency_key(scope,key,request_hash,response_status,response_body,expires_at) VALUES(${scope},${key},${requestHash},202,${JSON.stringify({orderId:existingOrder.id})}::jsonb,now()+interval '1 day')`;
        return existingOrder.id as string;
      }
      if(cart.status!=="ACTIVE")fail("CART_LOCKED","Cart is not active");
      const [count]=await tx`SELECT count(*)::int AS n FROM cart_line WHERE cart_id=${cart.id}`;
      const lines=await tx`SELECT cl.id AS cart_line_id,cl.quantity,cl.license_variant_id,p.*,lt.id AS license_template_id,lt.version AS license_template_version,
        lt.body_markdown,lv.name AS license_name,lv.parameters AS license_parameters,o.amount_minor AS selected_price,o.currency AS selected_currency
        FROM cart_line cl JOIN public_listing p ON p.listing_id=cl.listing_id
        JOIN license_variant lv ON lv.id=cl.license_variant_id AND lv.item_id=p.item_id AND lv.enabled
        JOIN license_template lt ON lt.id=lv.license_template_id AND lt.active
        JOIN LATERAL (SELECT * FROM offer o WHERE o.license_variant_id=lv.id AND o.active
          AND (o.storefront_id=p.storefront_id OR o.storefront_id IS NULL)
          AND (o.starts_at IS NULL OR o.starts_at<=now()) AND (o.ends_at IS NULL OR o.ends_at>now())
          ORDER BY (o.storefront_id IS NOT NULL) DESC LIMIT 1) o ON true
        WHERE cl.cart_id=${cart.id} ORDER BY cl.created_at`;
      if(!lines.length || lines.length!==count!.n)fail("UNAVAILABLE_CART_ITEMS","Remove unavailable products before checkout; no items were silently omitted");
      if(lines.length>100 || lines.some(l=>l.selected_currency!==cart.currency))fail("INVALID_CART","Cart line limit or currency mismatch");
      for(const line of lines){if((await tx`SELECT 1 FROM seller_membership WHERE seller_organisation_id=${line.seller_id} AND user_id=${userId}`).length)fail("SELF_PURCHASE","Sellers cannot purchase their own products");}
      const id=randomUUID(),number=`CC-${id.slice(0,8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      let calculationId:string|null=null,totalTax=0n;const taxes=new Map<string,bigint>();
      const subtotal=lines.reduce((sum,l)=>sum+money(l.selected_price)*BigInt(l.quantity),0n);
      if(this.env.TAX_MODE==="stripe" && subtotal>0n){
        if(!input.billingAddress)fail("BILLING_ADDRESS_REQUIRED","A billing address is required to calculate tax");
        const calc=await this.stripe.tax.calculations.create({currency:cart.currency.toLowerCase(),customer_details:{address:input.billingAddress,address_source:"billing"},
          line_items:lines.map(l=>({amount:minorToSafeNumber(money(l.selected_price)*BigInt(l.quantity)),reference:l.cart_line_id,tax_behavior:"exclusive" as const,tax_code:this.env.STRIPE_TAX_CODE})),expand:["line_items"]});
        calculationId=calc.id;
        for(const line of calc.line_items?.data??[])taxes.set(line.reference,BigInt(line.amount_tax));
        if(taxes.size!==lines.length || calc.line_items?.has_more)fail("TAX_LINE_MISMATCH","Tax calculation did not include every line");
        totalTax=BigInt(calc.tax_amount_exclusive);
        if(BigInt(calc.amount_total)!==subtotal+totalTax)fail("TAX_TOTAL_MISMATCH","Tax totals did not match checkout");
      }
      await tx`INSERT INTO customer_order(id,order_number,user_id,cart_id,currency,subtotal_minor,tax_minor,total_minor,billing_snapshot,tax_calculation_id)
        VALUES(${id},${number},${userId},${cart.id},${cart.currency},${subtotal.toString()},${totalTax.toString()},${(subtotal+totalTax).toString()},${JSON.stringify(input.billingAddress??{})}::jsonb,${calculationId})`;
      for(const l of lines){
        const net=money(l.selected_price)*BigInt(l.quantity),fee=calculateBasisPoints(net,this.env.PLATFORM_FEE_BPS);
        const snapshot={itemMetadata:l.item_metadata,licenseTemplateVersion:l.license_template_version,licenseParameters:l.license_parameters??{},taxReference:l.cart_line_id,sourceStorefrontId:l.storefront_id,sourceStorefrontKey:l.storefront_key};
        await tx`INSERT INTO order_line(order_id,canonical_item_id,item_version_id,channel_listing_id,seller_organisation_id,license_variant_id,license_template_id,quantity,unit_price_minor,tax_minor,platform_fee_minor,seller_earnings_minor,currency,title_snapshot,seller_name_snapshot,license_name_snapshot,license_body_snapshot,metadata_snapshot)
          VALUES(${id},${l.item_id},${l.version_id},${l.listing_id},${l.seller_id},${l.license_variant_id},${l.license_template_id},${l.quantity},${l.selected_price},${(taxes.get(l.cart_line_id)??0n).toString()},${fee.toString()},${(net-fee).toString()},${cart.currency},${l.title},${l.seller_display_name},${l.license_name},${l.body_markdown},${JSON.stringify(snapshot)}::jsonb)`;
      }
      await tx`INSERT INTO payment(order_id,provider,provider_payment_intent_id,amount_minor,currency) VALUES(${id},${this.env.PAYMENTS_MODE},${"pending_"+id},${(subtotal+totalTax).toString()},${cart.currency})`;
      await tx`UPDATE cart SET status='CHECKOUT_PENDING',updated_at=now() WHERE id=${cart.id}`;
      await tx`INSERT INTO idempotency_key(scope,key,request_hash,response_status,response_body,expires_at) VALUES(${scope},${key},${requestHash},202,${JSON.stringify({orderId:id})}::jsonb,now()+interval '1 day')`;
      return id;
    });
    return this.ensurePayment(orderId,userId);
  }
  async ensurePayment(orderId:string,userId:string) {
    const [o]=await this.sql`SELECT o.*,p.provider_payment_intent_id FROM customer_order o JOIN payment p ON p.order_id=o.id WHERE o.id=${orderId} AND o.user_id=${userId}`;
    if(!o)fail("ORDER_NOT_FOUND","Order not found");
    const base={orderId,orderNumber:o.order_number,currency:o.currency,totalMinor:minorToSafeNumber(o.total_minor),taxMinor:minorToSafeNumber(o.tax_minor)};
    if(o.status!=="PENDING_PAYMENT")return {...base,state:o.status};
    if(this.env.PAYMENTS_MODE==="stub" || money(o.total_minor)===0n){
      const providerId=`${money(o.total_minor)===0n?"free":"stub"}_${orderId}`;
      await this.sql`UPDATE payment SET provider_payment_intent_id=${providerId} WHERE order_id=${orderId} AND provider_payment_intent_id LIKE 'pending_%'`;
      await this.settle(providerId,money(o.total_minor),o.currency,null);
      return {...base,state:"PAID",mode:money(o.total_minor)===0n?"free":"stub"};
    }
    let intent:Stripe.PaymentIntent;
    if(String(o.provider_payment_intent_id).startsWith("pi_")) intent=await this.stripe.paymentIntents.retrieve(o.provider_payment_intent_id);
    else {
      if(Date.now()-new Date(o.created_at).getTime()>23*3600_000)fail("PAYMENT_RECONCILIATION_REQUIRED","An unresolved checkout is too old for automatic provider retries");
      intent=await this.stripe.paymentIntents.create({amount:minorToSafeNumber(o.total_minor),currency:o.currency.toLowerCase(),automatic_payment_methods:{enabled:true},
        transfer_group:`ORDER_${orderId}`,metadata:{orderId,userId}}, {idempotencyKey:`payment:${orderId}`});
      await this.sql`UPDATE payment SET provider_payment_intent_id=${intent.id},status=CASE WHEN status IN('SUCCEEDED','REFUNDED','DISPUTED') THEN status ELSE 'PROCESSING'::payment_status END,updated_at=now() WHERE order_id=${orderId}`;
    }
    if(intent.status==="succeeded")await this.settle(intent.id,BigInt(intent.amount_received),intent.currency,typeof intent.latest_charge==="string"?intent.latest_charge:null);
    return {...base,state:intent.status==="succeeded"?"PAID":"REQUIRES_PAYMENT",clientSecret:intent.client_secret,paymentIntentId:intent.id};
  }
  async ingestWebhook(body:Buffer,signature:string|undefined) {
    if(this.env.PAYMENTS_MODE!=="stripe") return {received:true,ignored:true};
    if(!signature)fail("STRIPE_SIGNATURE_REQUIRED","Stripe signature is required");
    let event:Stripe.Event;
    try{event=this.stripe.webhooks.constructEvent(body,signature,this.env.STRIPE_WEBHOOK_SECRET);}catch{fail("INVALID_STRIPE_SIGNATURE","Invalid webhook signature");}
    await this.sql.begin(async tx=>{
      const rows=await tx`INSERT INTO webhook_event(provider_event_id,event_type,payload) VALUES(${event.id},${event.type},${JSON.stringify(event)}::jsonb) ON CONFLICT DO NOTHING RETURNING provider_event_id`;
      if(rows.length)await enqueue(tx,"STRIPE_EVENT","webhook",randomUUID(),{eventId:event.id},`webhook:${event.id}`);
    });
    return {received:true};
  }
  async settle(providerId:string,amount:bigint,currency:string,chargeId:string|null) {
    await this.sql.begin(async tx=>{
      const [p]=await tx`SELECT p.*,o.status AS order_status,o.user_id,o.order_number,o.cart_id,o.tax_calculation_id,o.total_minor,o.tax_minor
        FROM payment p JOIN customer_order o ON o.id=p.order_id WHERE p.provider_payment_intent_id=${providerId} FOR UPDATE OF p,o`;
      if(!p)fail("PAYMENT_NOT_FOUND","Payment is not yet linked to an order; retry webhook");
      if(money(p.amount_minor)!==amount || p.currency.toLowerCase()!==currency.toLowerCase())fail("PAYMENT_MISMATCH","Provider amount or currency does not match the immutable order");
      if(p.order_status!=="PENDING_PAYMENT"){
        if(chargeId&&['PAID','PARTIALLY_REFUNDED','REFUNDED','CHARGEBACK'].includes(p.order_status)){
          await tx`UPDATE payment SET provider_charge_id=coalesce(provider_charge_id,${chargeId}) WHERE id=${p.id}`;
          await enqueue(tx,"PROCESSOR_FEE","payment",p.id,{paymentId:p.id,chargeId},`fee:${p.id}`);
        }
        return;
      }
      const lines=await tx`SELECT * FROM order_line WHERE order_id=${p.order_id}`;
      const totals=lines.reduce((sum,l)=>sum+money(l.seller_earnings_minor)+money(l.platform_fee_minor)+money(l.tax_minor),0n);
      if(totals!==amount)fail("ORDER_TOTAL_MISMATCH","Order lines do not balance to the payment");
      await tx`UPDATE customer_order SET status='PAID',paid_at=now(),updated_at=now() WHERE id=${p.order_id}`;
      await tx`UPDATE payment SET status='SUCCEEDED',provider_charge_id=coalesce(${chargeId},provider_charge_id),updated_at=now() WHERE id=${p.id}`;
      if(p.cart_id)await tx`UPDATE cart SET status='CONVERTED',updated_at=now() WHERE id=${p.cart_id}`;
      const postings:Posting[]=[clearing(amount),taxPayable(0n,money(p.tax_minor))];let fee=0n;
      const sellerTotals=new Map<string,bigint>();
      for(const l of lines){
        const [ent]=await tx`INSERT INTO entitlement(user_id,order_line_id,item_id,item_version_id) VALUES(${p.user_id},${l.id},${l.canonical_item_id},${l.item_version_id}) ON CONFLICT DO NOTHING RETURNING id`;
        if(ent){
          const certificateNumber=`CCL-${randomUUID().toUpperCase()}`;
          const snapshot={certificateVersion:1,certificateNumber,orderId:p.order_id,orderNumber:p.order_number,orderLineId:l.id,itemId:l.canonical_item_id,itemVersionId:l.item_version_id,
            buyerUserId:p.user_id,sellerOrganisationId:l.seller_organisation_id,itemTitle:l.title_snapshot,sellerName:l.seller_name_snapshot,licenseName:l.license_name_snapshot,
            licenseBody:l.license_body_snapshot,licenseTemplateVersion:l.metadata_snapshot.licenseTemplateVersion??1,licenseParameters:l.metadata_snapshot.licenseParameters??{},quantity:l.quantity,issuedAt:new Date().toISOString()};
          const signature=createHmac("sha256",this.env.LICENSE_SIGNING_SECRET).update(canonicalJSON(snapshot)).digest("base64url");
          await tx`INSERT INTO license_certificate(certificate_number,entitlement_id,license_template_version,license_snapshot,signature) VALUES(${certificateNumber},${ent.id},${Number(l.metadata_snapshot.licenseTemplateVersion)},${JSON.stringify(snapshot)}::jsonb,${signature})`;
        }
        if(money(l.seller_earnings_minor)>0n)await tx`INSERT INTO seller_transfer(seller_organisation_id,order_line_id,amount_minor,currency,eligible_at) VALUES(${l.seller_organisation_id},${l.id},${l.seller_earnings_minor},${l.currency},now()+${this.env.PAYOUT_RESERVE_DAYS}*interval '1 day') ON CONFLICT DO NOTHING`;
        fee+=money(l.platform_fee_minor);sellerTotals.set(l.seller_organisation_id,(sellerTotals.get(l.seller_organisation_id)??0n)+money(l.seller_earnings_minor));
      }
      postings.push(revenue(0n,fee));for(const [seller,earnings] of sellerTotals)postings.push(payable(seller,0n,earnings));
      await postJournal(tx,"PAYMENT",p.id,`Payment for ${p.order_number}`,p.currency,postings);
      await enqueue(tx,"ORDER_PAID","order",p.order_id,{orderId:p.order_id,userId:p.user_id},`paid:${p.order_id}`);
      if(p.tax_calculation_id)await enqueue(tx,"TAX_FINALIZE","order",p.order_id,{orderId:p.order_id},`tax:${p.order_id}`);
      if(chargeId)await enqueue(tx,"PROCESSOR_FEE","payment",p.id,{paymentId:p.id,chargeId},`fee:${p.id}`);
      for(const l of lines)await enqueue(tx,"SEARCH_ITEM","item",l.canonical_item_id,{itemId:l.canonical_item_id},`sale-search:${l.id}`);
    });
  }
  async requestRefund(userId:string,lineId:string,amount:bigint,key:string,reason:string) {
    if(!/^[A-Za-z0-9._:-]{8,160}$/.test(key))fail("INVALID_IDEMPOTENCY_KEY","Refund key is required");
    return this.sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"line:"+lineId},0))`;
      const [prior]=await tx`SELECT * FROM refund_request WHERE idempotency_key=${key}`;
      if(prior){if(prior.order_line_id!==lineId || money(prior.amount_minor)!==amount)fail("IDEMPOTENCY_KEY_REUSED","Refund key was used for another request");return prior;}
      const [l]=await tx`SELECT l.*,o.status AS order_status FROM order_line l JOIN customer_order o ON o.id=l.order_id WHERE l.id=${lineId} FOR UPDATE OF o`;
      if(!l || !["PAID","PARTIALLY_REFUNDED"].includes(l.order_status))fail("ORDER_NOT_REFUNDABLE","Order line cannot be refunded");
      const [pending]=await tx`SELECT 1 FROM refund_request WHERE order_line_id=${lineId} AND status IN ('REQUESTED','PROCESSING','PENDING') LIMIT 1`;
      if(pending)fail("REFUND_PENDING","Resolve the pending refund for this line first");
      const [sum]=await tx`SELECT coalesce(sum(amount_minor),0)::text AS refunded FROM refund_request WHERE order_line_id=${lineId} AND status='SUCCEEDED'`;
      let shares;try{shares=refundAllocation({seller:money(l.seller_earnings_minor),fee:money(l.platform_fee_minor),tax:money(l.tax_minor)},money(sum!.refunded),amount);}catch{fail("INVALID_REFUND_AMOUNT","Refund exceeds the remaining line amount");}
      const [r]=await tx`INSERT INTO refund_request(order_line_id,requested_by_user_id,idempotency_key,amount_minor,seller_minor,fee_minor,tax_minor,currency,reason)
        VALUES(${lineId},${userId},${key},${amount.toString()},${shares.seller.toString()},${shares.fee.toString()},${shares.tax.toString()},${l.currency},${reason}) RETURNING *`;
      await enqueue(tx,"REFUND_REQUESTED","refund",r!.id,{refundId:r!.id},`refund:${r!.id}`);
      await audit(tx,userId,"REFUND_REQUESTED","order_line",lineId,null,{refundId:r!.id,amount:amount.toString()},reason);
      return r;
    });
  }
  async processRefund(refundId:string) {
    const [initial]=await this.sql`SELECT order_line_id FROM refund_request WHERE id=${refundId}`;if(!initial)fail("REFUND_NOT_FOUND","Refund not found");
    await this.withLineLock(initial.order_line_id,async()=>{
      const [r]=await this.sql`SELECT r.*,l.order_id,l.seller_organisation_id,l.seller_earnings_minor,l.tax_minor AS original_tax,l.platform_fee_minor,
        p.id AS payment_id,p.provider_payment_intent_id,o.user_id FROM refund_request r JOIN order_line l ON l.id=r.order_line_id
        JOIN customer_order o ON o.id=l.order_id JOIN payment p ON p.order_id=o.id WHERE r.id=${refundId}`;
      if(!r || ["SUCCEEDED","FAILED","CANCELLED"].includes(r.status))return;
      await this.sql`UPDATE refund_request SET status='PROCESSING',updated_at=now() WHERE id=${refundId}`;
      let providerRefundId=`stub_${refundId}`;
      if(this.env.PAYMENTS_MODE==="stripe"){
        if(!r.provider_refund_id && Date.now()-new Date(r.created_at).getTime()>23*3600_000)fail("REFUND_RECONCILIATION_REQUIRED","Ambiguous refund requires provider reconciliation");
        const remote=r.provider_refund_id?await this.stripe.refunds.retrieve(r.provider_refund_id):await this.stripe.refunds.create({payment_intent:r.provider_payment_intent_id,amount:minorToSafeNumber(r.amount_minor),metadata:{refundId}}, {idempotencyKey:`refund:${refundId}`});
        providerRefundId=remote.id;
        await this.sql`UPDATE refund_request SET provider_refund_id=${remote.id},status=${remote.status==="succeeded"?"PROCESSING":remote.status==="failed"?"FAILED":remote.status==="canceled"?"CANCELLED":"PENDING"},updated_at=now() WHERE id=${refundId}`;
        if(remote.status==="failed" || remote.status==="canceled")return;
        if(remote.status!=="succeeded")fail("REFUND_PROVIDER_PENDING","Provider refund is pending; retry later");
      }
      await this.sql.begin(async tx=>{
        const [locked]=await tx`SELECT status FROM refund_request WHERE id=${refundId} FOR UPDATE`;if(locked!.status==="SUCCEEDED")return;
        await tx`UPDATE refund_request SET status='SUCCEEDED',provider_refund_id=${providerRefundId},updated_at=now() WHERE id=${refundId}`;
        const [p]=await tx`UPDATE payment SET refunded_minor=refunded_minor+${r.amount_minor},updated_at=now() WHERE id=${r.payment_id} RETURNING *`;
        await tx`UPDATE customer_order SET status=${money(p!.refunded_minor)===money(p!.amount_minor)?"REFUNDED":"PARTIALLY_REFUNDED"},updated_at=now() WHERE id=${r.order_id}`;
        if(money(p!.refunded_minor)===money(p!.amount_minor))await tx`UPDATE payment SET status='REFUNDED' WHERE id=${p!.id}`;
        const [sum]=await tx`SELECT sum(amount_minor)::text AS amount FROM refund_request WHERE order_line_id=${r.order_line_id} AND status='SUCCEEDED'`;
        const original=money(r.seller_earnings_minor)+money(r.platform_fee_minor)+money(r.original_tax);
        if(money(sum!.amount)===original){
          await tx`UPDATE entitlement SET status='REVOKED',revoked_at=now() WHERE order_line_id=${r.order_line_id}`;
          await tx`UPDATE license_certificate SET revoked_at=now(),revocation_reason='Full line refund' WHERE entitlement_id IN(SELECT id FROM entitlement WHERE order_line_id=${r.order_line_id})`;
        }
        await postJournal(tx,"REFUND",refundId,"Customer refund",r.currency,[payable(r.seller_organisation_id,money(r.seller_minor)),revenue(money(r.fee_minor)),taxPayable(money(r.tax_minor)),clearing(0n,money(r.amount_minor))]);
        const [transfer]=await tx`SELECT * FROM seller_transfer WHERE order_line_id=${r.order_line_id}`;
        if(transfer?.provider_transfer_id && money(r.seller_minor)>0n){
          await tx`INSERT INTO transfer_reversal(transfer_id,refund_id,amount_minor) VALUES(${transfer.id},${refundId},${r.seller_minor}) ON CONFLICT DO NOTHING`;
          await enqueue(tx,"TRANSFER_REVERSE","refund",refundId,{refundId},`reverse:${refundId}`);
        } else if(transfer?.status==="SUBMITTED")await enqueue(tx,"TRANSFER_REVERSE","refund",refundId,{refundId},`reverse:${refundId}`);
        await enqueue(tx,"TAX_REVERSE","refund",refundId,{refundId},`tax-reverse:${refundId}`);
        await enqueue(tx,"REFUND_COMPLETED","refund",refundId,{refundId,userId:r.user_id,orderId:r.order_id},`refund-notice:${refundId}`);
      });
    });
  }
  /** Session lock spans durable intent, provider call and final commit. Refund requests
   * acquire the matching transaction advisory lock. No uploads or user code run here. */
  private async withLineLock<T>(lineId:string,fn:()=>Promise<T>):Promise<T> {
    const reserved=await this.sql.reserve();
    try{await reserved`SELECT pg_advisory_lock(hashtextextended(${"line:"+lineId},0))`;return await fn();}
    finally{await reserved`SELECT pg_advisory_unlock(hashtextextended(${"line:"+lineId},0))`;reserved.release();}
  }
  async processTransfer(transferId:string) {
    const [initial]=await this.sql`SELECT order_line_id FROM seller_transfer WHERE id=${transferId}`;if(!initial)return;
    await this.withLineLock(initial.order_line_id,async()=>{
      let [t]=await this.sql`SELECT t.*,s.status AS seller_status,s.payout_hold_until,pa.provider_account_id,pa.payouts_enabled,
        l.order_id,p.provider_charge_id,o.status AS order_status FROM seller_transfer t JOIN seller_organisation s ON s.id=t.seller_organisation_id
        LEFT JOIN payment_account pa ON pa.seller_organisation_id=s.id AND pa.provider='stripe'
        JOIN order_line l ON l.id=t.order_line_id JOIN customer_order o ON o.id=l.order_id JOIN payment p ON p.order_id=o.id WHERE t.id=${transferId}`;
      if(!t || t.provider_transfer_id || ["REVERSED","PAID"].includes(t.status))return;
      if(new Date(t.eligible_at)>new Date() || t.seller_status!=="ACTIVE" || (t.payout_hold_until && new Date(t.payout_hold_until)>new Date()))return;
      const [disputed]=await this.sql`SELECT 1 FROM payment_dispute d JOIN payment p ON p.id=d.payment_id JOIN order_line l ON l.order_id=p.order_id
        WHERE l.seller_organisation_id=${t.seller_organisation_id} AND d.status NOT IN ('won','lost','warning_closed') LIMIT 1`;
      if(disputed || t.order_status==="CHARGEBACK")return;
      if(this.env.PAYMENTS_MODE==="stripe" && (!t.payouts_enabled || !t.provider_account_id))return;
      const [terms]=await this.sql`SELECT 1 FROM seller_terms_acceptance a WHERE a.seller_organisation_id=${t.seller_organisation_id}
        AND a.terms_id=(SELECT id FROM seller_terms WHERE active AND effective_at<=now() ORDER BY version DESC LIMIT 1)`;
      if(!terms)return;
      if(t.status!=="SUBMITTED"){
        const [pending]=await this.sql`SELECT 1 FROM refund_request WHERE order_line_id=${t.order_line_id} AND status IN('REQUESTED','PROCESSING','PENDING') LIMIT 1`;if(pending)return;
        const [refunded]=await this.sql`SELECT coalesce(sum(seller_minor),0)::text AS amount FROM refund_request WHERE order_line_id=${t.order_line_id} AND status='SUCCEEDED'`;
        const [line]=await this.sql`SELECT seller_earnings_minor FROM order_line WHERE id=${t.order_line_id}`;
        const amount=money(line!.seller_earnings_minor)-money(refunded!.amount);
        if(amount<=0n){await this.sql`UPDATE seller_transfer SET status='REVERSED',amount_minor=0,updated_at=now() WHERE id=${transferId}`;return;}
        await this.sql`UPDATE seller_transfer SET status='SUBMITTED',amount_minor=${amount.toString()},submitted_at=now(),updated_at=now() WHERE id=${transferId}`;
        t={...t,amount_minor:amount.toString(),submitted_at:new Date(),status:"SUBMITTED"};
      }
      if(Date.now()-new Date(t.submitted_at).getTime()>23*3600_000)fail("TRANSFER_RECONCILIATION_REQUIRED","Ambiguous transfer requires reconciliation before retry");
      let providerId=`stub_${transferId}`;
      if(this.env.PAYMENTS_MODE==="stripe"){
        const transfer=await this.stripe.transfers.create({amount:minorToSafeNumber(t.amount_minor),currency:t.currency.toLowerCase(),destination:t.provider_account_id,
          ...(t.provider_charge_id?{source_transaction:t.provider_charge_id}:{}),transfer_group:`ORDER_${t.order_id}`,metadata:{transferId,orderLineId:t.order_line_id}}, {idempotencyKey:`transfer:${transferId}`});providerId=transfer.id;
      }
      await this.sql.begin(async tx=>{
        await tx`UPDATE seller_transfer SET provider_transfer_id=${providerId},status='PAID',paid_at=now(),updated_at=now() WHERE id=${transferId}`;
        await postJournal(tx,"TRANSFER",transferId,"Transfer to connected seller account",t!.currency,[payable(t!.seller_organisation_id,money(t!.amount_minor)),clearing(0n,money(t!.amount_minor))]);
      });
    });
  }
  async reverseTransfer(refundId:string) {
    const [r]=await this.sql`SELECT r.*,t.id AS transfer_id,t.status AS transfer_status,t.provider_transfer_id,t.order_line_id AS line_id,t.seller_organisation_id
      FROM refund_request r JOIN seller_transfer t ON t.order_line_id=r.order_line_id WHERE r.id=${refundId} AND r.status='SUCCEEDED'`;
    if(!r || money(r.seller_minor)===0n)return;
    if(r.transfer_status==="SUBMITTED" && !r.provider_transfer_id)await this.processTransfer(r.transfer_id);
    await this.withLineLock(r.line_id,async()=>{
      const [t]=await this.sql`SELECT * FROM seller_transfer WHERE id=${r.transfer_id}`;
      if(!t?.provider_transfer_id){if(t?.status==="SUBMITTED")fail("TRANSFER_PENDING","Original transfer outcome must be reconciled first");return;}
      const [reversal]=await this.sql`INSERT INTO transfer_reversal(transfer_id,refund_id,amount_minor) VALUES(${t.id},${refundId},${r.seller_minor})
        ON CONFLICT(refund_id) DO UPDATE SET updated_at=transfer_reversal.updated_at RETURNING *`;
      if(reversal!.status==="SUCCEEDED")return;
      if(Date.now()-new Date(reversal!.created_at).getTime()>23*3600_000 && !reversal!.provider_reversal_id)fail("REVERSAL_RECONCILIATION_REQUIRED","Ambiguous reversal requires reconciliation");
      let remoteId=`stub_${reversal!.id}`;
      if(this.env.PAYMENTS_MODE==="stripe"){
        const remote=await this.stripe.transfers.createReversal(t.provider_transfer_id,{amount:minorToSafeNumber(r.seller_minor),metadata:{refundId}},{idempotencyKey:`reversal:${reversal!.id}`});remoteId=remote.id;
      }
      await this.sql.begin(async tx=>{
        await tx`UPDATE transfer_reversal SET status='SUCCEEDED',provider_reversal_id=${remoteId},updated_at=now() WHERE id=${reversal!.id}`;
        await tx`UPDATE seller_transfer SET reversed_minor=reversed_minor+${r.seller_minor},status=CASE WHEN reversed_minor+${r.seller_minor}>=amount_minor THEN 'REVERSED'::transfer_status ELSE status END,updated_at=now() WHERE id=${t.id}`;
        await postJournal(tx,"TRANSFER_REVERSAL",reversal!.id,"Reversal after customer refund",r.currency,[clearing(money(r.seller_minor)),payable(t.seller_organisation_id,0n,money(r.seller_minor))]);
      });
    });
  }
  async finalizeTax(orderId:string) {
    const [o]=await this.sql`SELECT * FROM customer_order WHERE id=${orderId}`;
    if(!o?.tax_calculation_id || o.tax_transaction_id)return;
    if(o.status==="PENDING_PAYMENT")fail("PAYMENT_PENDING","Tax cannot be posted before payment");
    const transaction=await this.stripe.tax.transactions.createFromCalculation({calculation:o.tax_calculation_id,reference:`ORDER_${orderId}`},{idempotencyKey:`tax:${orderId}`});
    await this.sql`UPDATE customer_order SET tax_transaction_id=${transaction.id} WHERE id=${orderId}`;
  }
  async reverseTax(refundId:string):Promise<void> {
    const [r]=await this.sql`SELECT r.*,l.order_id,l.metadata_snapshot,o.tax_calculation_id,o.tax_transaction_id FROM refund_request r
      JOIN order_line l ON l.id=r.order_line_id JOIN customer_order o ON o.id=l.order_id WHERE r.id=${refundId}`;
    if(!r || r.tax_reversal_id || !r.tax_calculation_id)return;
    if(!r.tax_transaction_id){await this.finalizeTax(r.order_id);return this.reverseTax(refundId);}
    const taxLines=await this.stripe.tax.transactions.listLineItems(r.tax_transaction_id,{limit:100});
    const taxLine=taxLines.data.find(l=>l.reference===r.metadata_snapshot.taxReference);
    if(!taxLine)fail("TAX_LINE_NOT_FOUND","Original tax line could not be reconciled");
    const reversal=await this.stripe.tax.transactions.createReversal({original_transaction:r.tax_transaction_id,mode:"partial",reference:`REFUND_${refundId}`,
      line_items:[{original_line_item:taxLine.id,reference:refundId,amount:-minorToSafeNumber(money(r.amount_minor)-money(r.tax_minor)),amount_tax:-minorToSafeNumber(r.tax_minor)}]}, {idempotencyKey:`tax-reverse:${refundId}`});
    await this.sql`UPDATE refund_request SET tax_reversal_id=${reversal.id},updated_at=now() WHERE id=${refundId}`;
  }
  async processorFee(paymentId:string,chargeId:string) {
    if(this.env.PAYMENTS_MODE!=="stripe")return;
    const charge=await this.stripe.charges.retrieve(chargeId,{expand:["balance_transaction"]});
    const balance=charge.balance_transaction;
    if(!balance || typeof balance==="string")fail("BALANCE_TRANSACTION_PENDING","Provider fee not available yet");
    const fee=BigInt(balance.fee),currency=balance.currency.toUpperCase();
    await this.sql.begin(async tx=>{await postJournal(tx,"PROCESSOR_FEE",paymentId,"Stripe processing fee",currency,[{code:"PROCESSOR_EXPENSE",name:"Payment processing expense",type:"EXPENSE",debit:fee,credit:0n},clearing(0n,fee)]);});
  }
  async handleEvent(eventId:string) {
    const [stored]=await this.sql`SELECT * FROM webhook_event WHERE provider_event_id=${eventId}`;if(!stored || stored.processed_at)return;
    const event=stored.payload as Stripe.Event;
    if(event.type==="payment_intent.succeeded"){
      const i=event.data.object;await this.settle(i.id,BigInt(i.amount_received),i.currency,typeof i.latest_charge==="string"?i.latest_charge:null);
    } else if(event.type==="payment_intent.payment_failed"){
      const i=event.data.object;await this.sql`UPDATE payment SET status='FAILED',failure_code=${i.last_payment_error?.code??null},updated_at=now() WHERE provider_payment_intent_id=${i.id} AND status NOT IN('SUCCEEDED','REFUNDED','DISPUTED')`;
    } else if(event.type==="account.updated"){
      const a=await this.stripe.accounts.retrieve(event.data.object.id);
      await this.sql`UPDATE payment_account SET charges_enabled=${a.charges_enabled},payouts_enabled=${a.payouts_enabled},details_submitted=${a.details_submitted},requirements=${JSON.stringify(a.requirements??{})}::jsonb,last_synced_at=now(),updated_at=now() WHERE provider_account_id=${a.id}`;
    } else if(event.type.startsWith("charge.dispute.")){
      await this.handleDispute((event.data.object as Stripe.Dispute).id);
    } else if(["refund.updated","refund.created","refund.failed"].includes(event.type)){
      const r=event.data.object as Stripe.Refund;
      const [local]=await this.sql`SELECT id FROM refund_request WHERE provider_refund_id=${r.id} OR id::text=${r.metadata?.refundId??""}`;
      if(local)await this.processRefund(local.id);
      else await audit(this.sql,null,"EXTERNAL_REFUND_RECONCILIATION_REQUIRED","stripe_refund",r.id,null,{amount:r.amount,currency:r.currency},"Refund created outside platform; allocate to order lines before accounting");
    } else if(event.type.startsWith("payout.") && event.account){
      const p=event.data.object as Stripe.Payout;
      const [account]=await this.sql`SELECT seller_organisation_id FROM payment_account WHERE provider_account_id=${event.account}`;
      if(account){
        const remote=await this.stripe.payouts.retrieve(p.id,{stripeAccount:event.account});
        const status=({paid:"PAID",failed:"FAILED",canceled:"CANCELLED",in_transit:"IN_TRANSIT",pending:"PENDING"} as const)[remote.status];
        if(!status)fail("PAYOUT_STATUS_UNSUPPORTED",`Unsupported Stripe payout status: ${remote.status}`);
        await this.sql`INSERT INTO seller_payout(seller_organisation_id,provider_payout_id,amount_minor,currency,status,expected_arrival_at,failure_message)
          VALUES(${account.seller_organisation_id},${remote.id},${remote.amount},${remote.currency.toUpperCase()},${status},to_timestamp(${remote.arrival_date}),${remote.failure_message??null})
          ON CONFLICT(provider_payout_id) DO UPDATE SET status=EXCLUDED.status,expected_arrival_at=EXCLUDED.expected_arrival_at,failure_message=EXCLUDED.failure_message,updated_at=now()`;
      }
    }
    await this.sql`UPDATE webhook_event SET processed_at=now() WHERE provider_event_id=${eventId}`;
  }
  async handleDispute(disputeId:string) {
    const d=await this.stripe.disputes.retrieve(disputeId,{expand:["balance_transactions"]});
    const charge=typeof d.charge==="string"?d.charge:d.charge.id;
    await this.sql.begin(async tx=>{
      const [p]=await tx`SELECT * FROM payment WHERE provider_charge_id=${charge} FOR UPDATE`;if(!p)fail("DISPUTE_PAYMENT_NOT_FOUND","Payment is not linked yet");
      await tx`INSERT INTO payment_dispute(provider_dispute_id,payment_id,amount_minor,currency,status,metadata) VALUES(${d.id},${p.id},${d.amount},${d.currency.toUpperCase()},${d.status},${JSON.stringify({reason:d.reason})}::jsonb)
        ON CONFLICT(provider_dispute_id) DO UPDATE SET status=EXCLUDED.status,updated_at=now()`;
      for(const b of d.balance_transactions){
        const amount=BigInt(b.amount),fee=BigInt(b.fee),currency=b.currency.toUpperCase();
        const suspense:Posting={code:"DISPUTE_SUSPENSE",name:"Dispute receivable",type:"ASSET",debit:amount<0n?-amount:0n,credit:amount>0n?amount:0n};
        const lines:Posting[]=[suspense,clearing(amount>0n?amount:0n,amount<0n?-amount:0n)];
        if(fee!==0n)lines.push({code:"DISPUTE_FEES",name:"Dispute fees",type:"EXPENSE",debit:fee>0n?fee:0n,credit:fee<0n?-fee:0n},clearing(fee<0n?-fee:0n,fee>0n?fee:0n));
        await postJournal(tx,"DISPUTE_MOVEMENT",b.id,"Stripe dispute movement",currency,lines);
      }
      if(d.status==="lost"){
        await postJournal(tx,"DISPUTE_LOSS",d.id,"Platform bears lost dispute principal",d.currency.toUpperCase(),[
          {code:"CHARGEBACK_LOSS",name:"Chargeback loss",type:"EXPENSE",debit:BigInt(d.amount),credit:0n},
          {code:"DISPUTE_SUSPENSE",name:"Dispute receivable",type:"ASSET",debit:0n,credit:BigInt(d.amount)}]);
        await tx`UPDATE customer_order SET status='CHARGEBACK',updated_at=now() WHERE id=${p.order_id}`;
        await tx`UPDATE entitlement SET status='REVOKED',revoked_at=now() WHERE order_line_id IN(SELECT id FROM order_line WHERE order_id=${p.order_id})`;
      } else if(d.status!=="won" && d.status!=="warning_closed"){
        await tx`UPDATE payment SET status='DISPUTED',updated_at=now() WHERE id=${p.id}`;
      } else {
        await tx`UPDATE payment SET status=CASE WHEN refunded_minor=amount_minor THEN 'REFUNDED'::payment_status ELSE 'SUCCEEDED'::payment_status END,updated_at=now() WHERE id=${p.id} AND status='DISPUTED'`;
      }
      await audit(tx,null,"DISPUTE_SYNC","stripe_dispute",d.id,null,{status:d.status,amount:d.amount},"Provider dispute reconciliation");
    });
  }
}
/** Stable JSON encoding is also used to verify stored license certificates. */
export function canonicalJSON(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(v=>v===undefined?"null":canonicalJSON(v)).join(",")}]`;
  if(value!==null&&typeof value==="object")return `{${Object.entries(value as Record<string,unknown>).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+":"+canonicalJSON(v)).join(",")}}`;
  if(value===null||typeof value==="string"||typeof value==="boolean"||(typeof value==="number"&&Number.isFinite(value)))return JSON.stringify(value);
  throw new Error("Unsupported value in canonical JSON");
}
