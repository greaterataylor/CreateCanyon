import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { audit, enqueue, type DatabaseConnection } from "@createcanyon/database";
import type { ApiEnvironment } from "@createcanyon/config";
import { canonicalJSON } from "@createcanyon/payments";
import { createHmac, timingSafeEqual } from "node:crypto";
import { DB_CONNECTION, API_ENV } from "../common/tokens.js";
import { UsersService } from "../auth/users.service.js";
import type { Principal } from "../auth/auth.types.js";
import { StorageService } from "../storage/storage.service.js";
@Injectable()
export class CommunityService {
  constructor(@Inject(DB_CONNECTION) private readonly connection:DatabaseConnection,@Inject(API_ENV) private readonly env:ApiEnvironment,private readonly users:UsersService,private readonly storage:StorageService){}
  async profile(p:Principal){const user=await this.users.resolveUser(p);return {id:user.id,displayName:user.displayName,email:user.email,roles:p.roles,authenticationMethods:p.authenticationMethods};}
  async library(p:Principal){
    const u=await this.users.resolveUser(p);
    return this.connection.client`SELECT e.id,e.order_line_id,e.item_id,e.item_version_id,e.status,e.update_access_until,e.created_at,ol.title_snapshot,ol.seller_name_snapshot,ol.license_name_snapshot,iv.version_label,iv.changelog,lc.certificate_number,
      (SELECT jsonb_agg(jsonb_build_object('id',f.id,'filename',f.original_filename,'byteSize',f.byte_size::text,'mimeType',f.detected_mime_type)) FROM file_object f WHERE f.item_version_id=e.item_version_id AND f.state='READY' AND f.role IN('ORIGINAL','DOCUMENTATION','LICENSE') AND f.bucket=${this.env.S3_ORIGINALS_BUCKET}) AS files
      FROM entitlement e JOIN order_line ol ON ol.id=e.order_line_id JOIN item_version iv ON iv.id=e.item_version_id LEFT JOIN license_certificate lc ON lc.entitlement_id=e.id WHERE e.user_id=${u.id} ORDER BY e.created_at DESC LIMIT 500`;
  }
  async download(p:Principal,entitlementId:string,fileId:string){
    const u=await this.users.resolveUser(p);
    const file=await this.connection.client.begin(async tx=>{
      // Serialize velocity accounting per buyer. Signed URLs expire quickly and are never stored in notifications.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'download:'+u.id},0))`;
      const [row]=await tx`SELECT f.* FROM entitlement e JOIN catalog_item i ON i.id=e.item_id JOIN item_version v ON v.id=e.item_version_id
        JOIN file_object f ON f.item_version_id=e.item_version_id JOIN license_certificate c ON c.entitlement_id=e.id
        JOIN customer_order o ON o.id=(SELECT order_id FROM order_line WHERE id=e.order_line_id)
        WHERE e.id=${entitlementId} AND e.user_id=${u.id} AND e.status='ACTIVE' AND c.revoked_at IS NULL AND f.id=${fileId}
        AND f.state='READY' AND f.role IN('ORIGINAL','DOCUMENTATION','LICENSE') AND f.bucket=${this.env.S3_ORIGINALS_BUCKET}
        AND i.status<>'SUSPENDED' AND v.status<>'SUSPENDED' AND o.status IN('PAID','PARTIALLY_REFUNDED')
        AND NOT EXISTS(SELECT 1 FROM copyright_claim cc WHERE cc.item_id=i.id AND cc.status IN('CONTENT_DISABLED','UPHELD'))`;
      if(!row)throw new NotFoundException("An active purchase for this downloadable file was not found");
      const [count]=await tx`SELECT count(*)::int AS value FROM download_event WHERE user_id=${u.id} AND created_at>now()-interval '1 hour'`;
      if(count!.value>=60)throw new ForbiddenException("Download rate limit reached. Try again later.");
      await tx`INSERT INTO download_event(entitlement_id,file_object_id,user_id) VALUES(${entitlementId},${fileId},${u.id})`;
      return row;
    });
    return {url:await this.storage.createDownloadUrl({bucket:file.bucket,key:file.object_key,filename:file.original_filename,...(file.storage_version_id?{versionId:file.storage_version_id}:{})}),expiresInSeconds:this.env.DOWNLOAD_URL_TTL_SECONDS};
  }
  async certificate(p:Principal,entitlementId:string){
    const u=await this.users.resolveUser(p);
    const [c]=await this.connection.client`SELECT c.* FROM license_certificate c JOIN entitlement e ON e.id=c.entitlement_id WHERE e.id=${entitlementId} AND e.user_id=${u.id}`;
    if(!c)throw new NotFoundException("License certificate not found");
    const expected=createHmac("sha256",this.env.LICENSE_SIGNING_SECRET).update(canonicalJSON(c.license_snapshot)).digest("base64url");
    const supplied=Buffer.from(c.signature);const valid=supplied.length===expected.length&&timingSafeEqual(supplied,Buffer.from(expected));
    return {...c,signatureValid:valid};
  }
  async orders(p:Principal,id?:string){
    const u=await this.users.resolveUser(p);
    if(!id)return this.connection.client`SELECT id,order_number,status,subtotal_minor::text,tax_minor::text,total_minor::text,currency,created_at,paid_at FROM customer_order WHERE user_id=${u.id} ORDER BY created_at DESC LIMIT 200`;
    const [order]=await this.connection.client`SELECT id,order_number,status,subtotal_minor::text,tax_minor::text,total_minor::text,currency,created_at,paid_at FROM customer_order WHERE id=${id} AND user_id=${u.id}`;
    if(!order)throw new NotFoundException("Order not found");
    const lines=await this.connection.client`SELECT id,title_snapshot,seller_name_snapshot,license_name_snapshot,license_body_snapshot,quantity,unit_price_minor::text,tax_minor::text,currency FROM order_line WHERE order_id=${id}`;
    const refunds=await this.connection.client`SELECT r.id,r.order_line_id,r.amount_minor::text,r.currency,r.status,r.reason,r.created_at FROM refund_request r JOIN order_line ol ON ol.id=r.order_line_id WHERE ol.order_id=${id} ORDER BY r.created_at`;
    return {...order,lines,refunds,documentType:"PAYMENT_RECEIPT",notice:"A tax invoice requires the operator's configured legal and tax-registration details."};
  }
  async review(p:Principal,input:{orderLineId:string;rating:number;title:string;body:string}){
    const u=await this.users.resolveUser(p);
    return this.connection.client.begin(async tx=>{
      const [line]=await tx`SELECT ol.canonical_item_id FROM order_line ol JOIN customer_order o ON o.id=ol.order_id JOIN entitlement e ON e.order_line_id=ol.id
        WHERE ol.id=${input.orderLineId} AND o.user_id=${u.id} AND o.status IN('PAID','PARTIALLY_REFUNDED') AND e.status='ACTIVE'
        AND NOT EXISTS(SELECT 1 FROM seller_membership m WHERE m.user_id=${u.id} AND m.seller_organisation_id=ol.seller_organisation_id)`;
      if(!line)throw new ForbiddenException("Only an active, verified purchase can be reviewed");
      const [row]=await tx`INSERT INTO review(user_id,order_line_id,item_id,rating,title,body,status) VALUES(${u.id},${input.orderLineId},${line.canonical_item_id},${input.rating},${input.title},${input.body},'PUBLISHED')
        ON CONFLICT(user_id,order_line_id) DO UPDATE SET rating=EXCLUDED.rating,title=EXCLUDED.title,body=EXCLUDED.body,updated_at=now() WHERE review.status IN('PUBLISHED','PENDING') RETURNING *`;
      if(!row)throw new ForbiddenException("This review is under moderation");
      await enqueue(tx,"SEARCH_ITEM","item",line.canonical_item_id,{itemId:line.canonical_item_id},`review:${row.id}:${row.updated_at.toISOString()}`);return row;
    });
  }
  async support(p:Principal){const u=await this.users.resolveUser(p);return this.connection.client`SELECT c.id,c.subject,c.status,c.order_id,c.seller_organisation_id,c.created_at,c.updated_at FROM support_case c WHERE c.user_id=${u.id}
    OR EXISTS(SELECT 1 FROM seller_membership m WHERE m.user_id=${u.id} AND m.seller_organisation_id=c.seller_organisation_id AND m.role IN('OWNER','MANAGER','SUPPORT')) ORDER BY c.updated_at DESC LIMIT 200`;}
  async createSupport(p:Principal,input:{subject:string;body:string;orderLineId?:string|undefined}){
    const u=await this.users.resolveUser(p);return this.connection.client.begin(async tx=>{
      let orderId:string|null=null,sellerId:string|null=null;
      if(input.orderLineId){const [line]=await tx`SELECT ol.order_id,ol.seller_organisation_id FROM order_line ol JOIN customer_order o ON o.id=ol.order_id WHERE ol.id=${input.orderLineId} AND o.user_id=${u.id}`;if(!line)throw new NotFoundException("Your order line was not found");orderId=line.order_id;sellerId=line.seller_organisation_id;}
      const [c]=await tx`INSERT INTO support_case(user_id,subject,body,order_line_id,order_id,seller_organisation_id) VALUES(${u.id},${input.subject},${input.body},${input.orderLineId??null},${orderId},${sellerId}) RETURNING *`;
      await tx`INSERT INTO support_message(case_id,author_user_id,body) VALUES(${c!.id},${u.id},${input.body})`;
      await enqueue(tx,"SUPPORT_UPDATED","support",c!.id,{caseId:c!.id,actorId:u.id},`support-created:${c!.id}`);return c;
    });
  }
  private async supportAccess(p:Principal,id:string){
    const u=await this.users.resolveUser(p);const [c]=await this.connection.client`SELECT * FROM support_case c WHERE c.id=${id} AND (c.user_id=${u.id} OR EXISTS(SELECT 1 FROM seller_membership m WHERE m.user_id=${u.id} AND m.seller_organisation_id=c.seller_organisation_id AND m.role IN('OWNER','MANAGER','SUPPORT')))`;
    if(!c)throw new NotFoundException("Support case not found");return {user:u,case:c};
  }
  async conversation(p:Principal,id:string){const c=await this.supportAccess(p,id);const messages=await this.connection.client`SELECT m.id,m.body,m.created_at,u.display_name AS author FROM support_message m JOIN app_user u ON u.id=m.author_user_id WHERE case_id=${id} AND NOT internal ORDER BY m.created_at,m.id`;return {...c.case,messages};}
  async message(p:Principal,id:string,body:string){
    const c=await this.supportAccess(p,id);if(c.case.status==="CLOSED")throw new BadRequestException("This support case is closed");
    return this.connection.client.begin(async tx=>{const [m]=await tx`INSERT INTO support_message(case_id,author_user_id,body) VALUES(${id},${c.user.id},${body}) RETURNING *`;
      await tx`UPDATE support_case SET status='IN_PROGRESS',updated_at=now() WHERE id=${id}`;
      await enqueue(tx,"SUPPORT_UPDATED","support",id,{caseId:id,actorId:c.user.id},`support-message:${m!.id}`);return m;});
  }
  async notifications(p:Principal){const u=await this.users.resolveUser(p);return this.connection.client`SELECT id,title,body,href,read_at,created_at FROM notification WHERE user_id=${u.id} ORDER BY created_at DESC LIMIT 100`;}
  async readNotification(p:Principal,id:string){const u=await this.users.resolveUser(p);await this.connection.client`UPDATE notification SET read_at=COALESCE(read_at,now()) WHERE id=${id} AND user_id=${u.id}`;return {ok:true};}
  async wishlist(p:Principal,itemId?:string,remove=false){
    const u=await this.users.resolveUser(p);if(itemId){
      if(remove)await this.connection.client`DELETE FROM wishlist_item WHERE user_id=${u.id} AND item_id=${itemId}`;
      else {const [item]=await this.connection.client`SELECT item_id FROM public_listing WHERE item_id=${itemId} LIMIT 1`;if(!item)throw new NotFoundException("Item not available");await this.connection.client`INSERT INTO wishlist_item(user_id,item_id) VALUES(${u.id},${itemId}) ON CONFLICT DO NOTHING`;}
    }
    return this.connection.client`SELECT DISTINCT ON(p.item_id) p.item_id,p.title,p.seller_display_name,p.amount_minor::text,p.currency,p.canonical_url FROM wishlist_item w JOIN public_listing p ON p.item_id=w.item_id WHERE w.user_id=${u.id} ORDER BY p.item_id,p.is_primary DESC`;
  }
  async copyright(input:{itemId:string;claimantName:string;claimantEmail:string;allegation:string;evidenceUrl?:string|undefined;goodFaith:true}){
    return this.connection.client.begin(async tx=>{
      const [item]=await tx`SELECT id FROM catalog_item WHERE id=${input.itemId}`;if(!item)throw new NotFoundException("Item not found");
      const [claim]=await tx`INSERT INTO copyright_claim(item_id,claimant_name,claimant_email,allegation,evidence) VALUES(${input.itemId},${input.claimantName},${input.claimantEmail},${input.allegation},${JSON.stringify({url:input.evidenceUrl??null,goodFaith:true})}::jsonb) RETURNING id,created_at`;
      await audit(tx,{action:"COPYRIGHT_CLAIM_RECEIVED",resourceType:"copyright_claim",resourceId:claim!.id,reason:"Public item-level report"});
      return {id:claim!.id,status:"OPEN",message:"Your report has been recorded for review. This does not automatically remove the item."};
    });
  }
}
