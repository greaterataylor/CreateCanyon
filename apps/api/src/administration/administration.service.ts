import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { audit,enqueue,type DatabaseConnection } from "@createcanyon/database";
import type { ApiEnvironment } from "@createcanyon/config";
import { PaymentEngine } from "@createcanyon/payments";
import { DB_CONNECTION,API_ENV } from "../common/tokens.js";
import { UsersService } from "../auth/users.service.js";
import type { Principal } from "../auth/auth.types.js";
@Injectable()
export class AdministrationService {
  private readonly payments:PaymentEngine;
  constructor(@Inject(DB_CONNECTION) private readonly connection:DatabaseConnection,@Inject(API_ENV) private readonly env:ApiEnvironment,private readonly users:UsersService){this.payments=new PaymentEngine(connection,env);}
  async overview(){
    const sql=this.connection.client;const [counts]=await sql`SELECT (SELECT count(*) FROM moderation_case WHERE status IN('OPEN','IN_REVIEW')) AS moderation,
      (SELECT count(*) FROM copyright_claim WHERE status IN('OPEN','VALIDATING','COUNTER_NOTICE')) AS copyright,
      (SELECT count(*) FROM support_case WHERE status NOT IN('RESOLVED','CLOSED')) AS support,
      (SELECT count(*) FROM outbox_event WHERE failed_at IS NOT NULL) AS failed_jobs,
      (SELECT count(*) FROM payment_dispute WHERE status NOT IN('won','lost','warning_closed')) AS disputes`;
    return counts;
  }
  async list(kind:string){const sql=this.connection.client;
    switch(kind){
      case "moderation":return sql`SELECT m.*,v.item_id,v.version_label,i.title AS item_title,s.display_name AS seller_name FROM moderation_case m JOIN item_version v ON v.id=m.item_version_id JOIN catalog_item i ON i.id=v.item_id JOIN seller_organisation s ON s.id=i.seller_organisation_id ORDER BY m.opened_at DESC LIMIT 200`;
      case "sellers":return sql`SELECT s.*,p.provider_account_id,p.charges_enabled,p.payouts_enabled,p.details_submitted FROM seller_organisation s LEFT JOIN payment_account p ON p.seller_organisation_id=s.id ORDER BY s.created_at DESC LIMIT 200`;
      case "copyright":return sql`SELECT cc.*,i.title FROM copyright_claim cc JOIN catalog_item i ON i.id=cc.item_id ORDER BY cc.created_at DESC LIMIT 200`;
      case "payments":return sql`SELECT o.id,o.order_number,o.status,o.total_minor::text,o.currency,o.created_at,p.provider_payment_intent_id,p.refunded_minor::text,
        (SELECT jsonb_agg(jsonb_build_object('id',ol.id,'title',ol.title_snapshot,'totalMinor',(ol.unit_price_minor*ol.quantity-ol.discount_minor+ol.tax_minor)::text)) FROM order_line ol WHERE ol.order_id=o.id) AS lines
        FROM customer_order o JOIN payment p ON p.order_id=o.id ORDER BY o.created_at DESC LIMIT 200`;
      case "refunds":return sql`SELECT * FROM refund_request ORDER BY created_at DESC LIMIT 200`;
      case "disputes":return sql`SELECT * FROM payment_dispute ORDER BY created_at DESC LIMIT 200`;
      case "support":return sql`SELECT * FROM support_case ORDER BY updated_at DESC LIMIT 200`;
      case "reviews":return sql`SELECT r.*,i.title AS item_title FROM review r JOIN catalog_item i ON i.id=r.item_id ORDER BY r.created_at DESC LIMIT 200`;
      case "jobs":return sql`SELECT id,event_type,aggregate_type,aggregate_id,attempts,max_attempts,available_at,locked_at,processed_at,failed_at,last_error FROM outbox_event ORDER BY failed_at DESC NULLS LAST,created_at DESC LIMIT 200`;
      case "ledger":return sql`SELECT a.id,a.code,a.name,a.type,a.currency,coalesce(sum(l.debit_minor),0)::text AS debit_minor,coalesce(sum(l.credit_minor),0)::text AS credit_minor FROM ledger_account a LEFT JOIN journal_line l ON l.ledger_account_id=a.id GROUP BY a.id ORDER BY a.currency,a.code`;
      case "audit":return sql`SELECT sequence,actor_type,actor_user_id,action,resource_type,resource_id,"before","after",metadata,previous_hash,record_hash,created_at FROM audit_event ORDER BY sequence DESC LIMIT 200`;
      default:throw new NotFoundException("Unknown administration collection");
    }
  }
  async moderation(id:string){
    const sql=this.connection.client;const [record]=await sql`SELECT m.*,v.item_id,v.version_label,v.metadata AS version_metadata,v.changelog,i.title,i.description,i.asset_type,i.ai_disclosure FROM moderation_case m JOIN item_version v ON v.id=m.item_version_id JOIN catalog_item i ON i.id=v.item_id WHERE m.id=${id}`;
    if(!record)throw new NotFoundException("Moderation case not found");
    const files=await sql`SELECT f.id,f.original_filename,f.byte_size::text,f.sha256,f.role,f.state,f.detected_mime_type,f.scan_result,
      (SELECT jsonb_agg(jsonb_build_object('scanner',s.scanner,'status',s.status,'report',s.report)) FROM scan_result s WHERE s.file_object_id=f.id) AS scans FROM file_object f WHERE item_version_id=${record.item_version_id} ORDER BY created_at`;
    const events=await sql`SELECT * FROM moderation_event WHERE moderation_case_id=${id} ORDER BY created_at`;
    return {...record,files,events};
  }
  async decide(p:Principal,id:string,input:{decision:"APPROVE"|"REQUEST_CHANGES"|"SUSPEND"|"REOPEN";reason:string}){
    const user=await this.users.resolveUser(p);
    return this.connection.client.begin(async tx=>{
      const [m]=await tx`SELECT m.*,v.item_id,v.status AS version_status,i.seller_organisation_id FROM moderation_case m JOIN item_version v ON v.id=m.item_version_id JOIN catalog_item i ON i.id=v.item_id WHERE m.id=${id} FOR UPDATE OF m,v,i`;
      if(!m)throw new NotFoundException("Moderation case not found");
      if(input.decision==="APPROVE"){
        if(!["OPEN","IN_REVIEW"].includes(m.status)||m.version_status!=="AWAITING_REVIEW")throw new ConflictException("Only a processed submission awaiting review may be published");
        const [check]=await tx`SELECT count(*)::int AS n,count(*) FILTER(WHERE role='ORIGINAL')::int AS originals,count(*) FILTER(WHERE state<>'READY')::int AS blocked FROM file_object WHERE item_version_id=${m.item_version_id}`;
        if(!check?.originals||check.blocked)throw new ConflictException("All files must pass processing before publication");
        if(this.env.NODE_ENV==='production'){
          const [unsafe]=await tx`SELECT 1 FROM file_object WHERE item_version_id=${m.item_version_id} AND role NOT IN('PREVIEW','MANIFEST') AND
            (scan_result->>'antivirus' IS DISTINCT FROM 'PASSED' OR scan_result->>'processed' IS DISTINCT FROM 'true' OR scan_result->>'codeScannersComplete' IS DISTINCT FROM 'true') LIMIT 1`;
          if(unsafe)throw new ConflictException('Production requires successful antivirus and complete processing; development fixtures cannot be approved');
        }
        const [seller]=await tx`SELECT status FROM seller_organisation WHERE id=${m.seller_organisation_id}`;
        if(seller?.status!=="ACTIVE")throw new ConflictException("Seller must be active before publication");
        const [terms]=await tx`SELECT t.id FROM seller_terms t WHERE t.id=(SELECT id FROM seller_terms WHERE active AND effective_at<=now() ORDER BY version DESC LIMIT 1) AND EXISTS(SELECT 1 FROM seller_terms_acceptance a WHERE a.terms_id=t.id AND a.seller_organisation_id=${m.seller_organisation_id})`;
        if(!terms)throw new ConflictException("Seller must accept the active seller terms");
        if((await tx`SELECT 1 FROM copyright_claim WHERE item_id=${m.item_id} AND status IN('CONTENT_DISABLED','UPHELD') LIMIT 1`).length)throw new ConflictException("Resolve the legal suspension before publishing");
        await tx`UPDATE item_version SET status='PUBLISHED',approved_at=now(),published_at=now(),updated_at=now() WHERE id=${m.item_version_id}`;
        await tx`UPDATE catalog_item SET current_version_id=${m.item_version_id},status='PUBLISHED',updated_at=now() WHERE id=${m.item_id}`;
        await tx`UPDATE channel_listing SET status='PUBLISHED',published_at=COALESCE(published_at,now()),updated_at=now() WHERE item_id=${m.item_id} AND enabled`;
        await tx`UPDATE moderation_case SET status='APPROVED',closed_at=now(),updated_at=now() WHERE id=${id}`;
      } else if(input.decision==="REQUEST_CHANGES"){
        if(!["OPEN","IN_REVIEW"].includes(m.status))throw new ConflictException("This moderation case is not open");
        await tx`UPDATE item_version SET status='CHANGES_REQUESTED',updated_at=now() WHERE id=${m.item_version_id}`;
        await tx`UPDATE moderation_case SET status='CHANGES_REQUESTED',closed_at=now(),updated_at=now() WHERE id=${id}`;
      } else if(input.decision==="SUSPEND"){
        await tx`UPDATE item_version SET status='SUSPENDED',updated_at=now() WHERE id=${m.item_version_id}`;
        await tx`UPDATE catalog_item SET status='SUSPENDED',updated_at=now() WHERE id=${m.item_id} AND current_version_id=${m.item_version_id}`;
        await tx`UPDATE moderation_case SET status='SUSPENDED',closed_at=now(),updated_at=now() WHERE id=${id}`;
      } else {
        if(!["SUSPENDED","CHANGES_REQUESTED"].includes(m.status))throw new ConflictException("This case cannot be reopened");
        await tx`UPDATE item_version SET status='AWAITING_REVIEW',updated_at=now() WHERE id=${m.item_version_id}`;
        await tx`UPDATE moderation_case SET status='OPEN',closed_at=NULL,updated_at=now() WHERE id=${id}`;
      }
      const [event]=await tx`INSERT INTO moderation_event(moderation_case_id,actor_user_id,decision,reason_code,notes) VALUES(${id},${user.id},${input.decision},'REVIEWER_DECISION',${input.reason}) RETURNING id`;
      await audit(tx,user.id,"MODERATION_"+input.decision,"moderation_case",id,m,{decision:input.decision},input.reason);
      await enqueue(tx,"SEARCH_ITEM","item",m.item_id,{itemId:m.item_id},`moderation-search:${event!.id}`);
      await enqueue(tx,"MODERATION_DECIDED","item",m.item_id,{itemId:m.item_id,sellerId:m.seller_organisation_id,decision:input.decision,reason:input.reason},`moderation-notice:${event!.id}`);
      return {id,decision:input.decision};
    });
  }
  async seller(p:Principal,id:string,input:{status?:string;payoutHoldUntil?:string|null;reason:string}){
    const user=await this.users.resolveUser(p);
    return this.connection.client.begin(async tx=>{
      const [s]=await tx`SELECT * FROM seller_organisation WHERE id=${id} FOR UPDATE`;if(!s)throw new NotFoundException("Seller not found");
      const [next]=await tx`UPDATE seller_organisation SET status=${input.status??s.status},payout_hold_until=${input.payoutHoldUntil===undefined?s.payout_hold_until:input.payoutHoldUntil},updated_at=now() WHERE id=${id} RETURNING *`;
      await audit(tx,user.id,"SELLER_RESTRICTION_CHANGED","seller",id,s,next,input.reason);
      const items=await tx`SELECT id FROM catalog_item WHERE seller_organisation_id=${id}`;
      for(const item of items)await enqueue(tx,"SEARCH_ITEM","item",item.id,{itemId:item.id},`seller-search:${id}:${item.id}:${next!.updated_at.toISOString()}`);
      return next;
    });
  }
  async copyright(p:Principal,id:string,input:{status:string;reason:string}){
    const user=await this.users.resolveUser(p);return this.connection.client.begin(async tx=>{
      const [c]=await tx`SELECT * FROM copyright_claim WHERE id=${id} FOR UPDATE`;if(!c)throw new NotFoundException("Copyright claim not found");
      if(input.status==="RESTORED"&&!['CONTENT_DISABLED','COUNTER_NOTICE','UPHELD'].includes(c.status))throw new ConflictException("Only a disabled claim can be marked restored");
      await tx`UPDATE copyright_claim SET status=${input.status},decided_by_user_id=${user.id},closed_at=${['UPHELD','CLOSED','RESTORED'].includes(input.status)?new Date():null},updated_at=now() WHERE id=${id}`;
      if(['CONTENT_DISABLED','UPHELD'].includes(input.status)){
        await tx`UPDATE catalog_item SET status='SUSPENDED',updated_at=now() WHERE id=${c.item_id}`;
        await tx`UPDATE channel_listing SET status='SUSPENDED',updated_at=now() WHERE item_id=${c.item_id}`;
        await tx`UPDATE moderation_case SET status='SUSPENDED',updated_at=now() WHERE item_version_id=(SELECT current_version_id FROM catalog_item WHERE id=${c.item_id}) AND status='APPROVED'`;
      }
      // RESTORED clears the legal claim, not a separate security suspension. A reviewer must reopen/approve publication.
      await audit(tx,user.id,"COPYRIGHT_STATUS_CHANGED","copyright_claim",id,{status:c.status},{status:input.status},input.reason);
      const eventKey=`copyright:${id}:${crypto.randomUUID()}`;
      await enqueue(tx,"SEARCH_ITEM","item",c.item_id,{itemId:c.item_id},eventKey+":search");
      await enqueue(tx,"COPYRIGHT_UPDATED","item",c.item_id,{itemId:c.item_id,claimId:id,status:input.status},eventKey+":notify");
      return {id,status:input.status,publicationRequiresReview:input.status==="RESTORED"};
    });
  }
  async refund(p:Principal,input:{orderLineId:string;amountMinor:string;reason:string},key:string){const u=await this.users.resolveUser(p);return this.payments.requestRefund(u.id,input.orderLineId,BigInt(input.amountMinor),key,input.reason);}
  async support(id:string){const sql=this.connection.client;const [c]=await sql`SELECT * FROM support_case WHERE id=${id}`;if(!c)throw new NotFoundException("Support case not found");return {...c,messages:await sql`SELECT m.*,u.display_name AS author FROM support_message m JOIN app_user u ON u.id=m.author_user_id WHERE case_id=${id} ORDER BY m.created_at,m.id`};}
  async supportReply(p:Principal,id:string,input:{body:string;internal:boolean;status:string}){
    const u=await this.users.resolveUser(p);return this.connection.client.begin(async tx=>{
      const [c]=await tx`SELECT * FROM support_case WHERE id=${id} FOR UPDATE`;if(!c)throw new NotFoundException("Support case not found");
      const [m]=await tx`INSERT INTO support_message(case_id,author_user_id,body,internal) VALUES(${id},${u.id},${input.body},${input.internal}) RETURNING *`;
      await tx`UPDATE support_case SET status=${input.status},updated_at=now() WHERE id=${id}`;
      await audit(tx,u.id,"SUPPORT_RESPONSE","support_case",id,{status:c.status},{messageId:m!.id,internal:input.internal,status:input.status},"Support response");
      if(!input.internal)await enqueue(tx,"SUPPORT_UPDATED","support",id,{caseId:id,actorId:u.id},`support-message:${m!.id}`);return m;
    });
  }
  async review(p:Principal,id:string,status:string,reason:string){const u=await this.users.resolveUser(p);return this.connection.client.begin(async tx=>{
    const [r]=await tx`SELECT * FROM review WHERE id=${id} FOR UPDATE`;if(!r)throw new NotFoundException("Review not found");await tx`UPDATE review SET status=${status},updated_at=now() WHERE id=${id}`;
    await audit(tx,u.id,"REVIEW_STATUS_CHANGED","review",id,{status:r.status},{status},reason);await enqueue(tx,"SEARCH_ITEM","item",r.item_id,{itemId:r.item_id},`review-admin:${crypto.randomUUID()}`);return {id,status};});}
  async auditIntegrity(){const sql=this.connection.client;const [result]=await sql`SELECT count(*)::int AS checked,coalesce(bool_and(valid),true) AS valid FROM cc_verify_audit()`;const [head]=await sql`SELECT sequence,record_hash FROM audit_event ORDER BY sequence DESC LIMIT 1`;return {...result,head:head??null,notice:"Export the head hash to an independent immutable log to detect privileged history rewrites."};}
  async requeue(p:Principal,id:string,reason:string){const u=await this.users.resolveUser(p);return this.connection.client.begin(async tx=>{
    const [job]=await tx`SELECT * FROM outbox_event WHERE id=${id} FOR UPDATE`;if(!job?.failed_at)throw new BadRequestException("Only dead-letter jobs may be requeued");
    // Provider idempotency age gates remain in force; requeue never resets financial operation timestamps.
    await tx`UPDATE outbox_event SET failed_at=NULL,attempts=0,locked_at=NULL,locked_by=NULL,available_at=now(),last_error=NULL WHERE id=${id}`;
    await audit(tx,u.id,"JOB_REQUEUED","outbox_event",id,{attempts:job.attempts},{attempts:0},reason);return {id,requeued:true};});}
}
