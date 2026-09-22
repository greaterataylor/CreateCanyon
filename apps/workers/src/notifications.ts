import {SESv2Client,SendEmailCommand} from "@aws-sdk/client-sesv2";
import nodemailer from "nodemailer";
import {enqueue,type DatabaseConnection} from "@createcanyon/database";
import type {WorkerEnv} from "./environment.js";
export class NotificationWorker {
 private readonly ses:SESv2Client;
 constructor(private readonly connection:DatabaseConnection,private readonly env:WorkerEnv){this.ses=new SESv2Client({region:env.SES_REGION});}
 private async notify(userId:string,key:string,title:string,body:string,href:string){
   await this.connection.client.begin(async tx=>{
     const [n]=await tx`INSERT INTO notification(user_id,dedupe_key,title,body,href) VALUES(${userId},${key},${title},${body},${href}) ON CONFLICT(dedupe_key) DO UPDATE SET dedupe_key=notification.dedupe_key RETURNING id`;
     if(this.env.EMAIL_PROVIDER!=='none')await enqueue(tx,'NOTIFICATION_EMAIL','notification',n!.id,{notificationId:n!.id},`email:${n!.id}`);
   });
 }
 async handle(eventId:string,type:string,p:Record<string,string>){
   const sql=this.connection.client;
   if(type==='NOTIFICATION_EMAIL'){await this.send(p.notificationId!);return;}
   if(type==='ORDER_PAID'){await this.notify(p.userId!,`paid:${p.orderId}`,'Your purchase is ready','Your files and license certificates are available in your purchase library.','/library');return;}
   if(type==='REFUND_COMPLETED'){await this.notify(p.userId!,`refund:${p.refundId}`,'Refund processed','Your order has been updated. Bank processing times depend on your payment method.',`/orders/${p.orderId}`);return;}
   if(type==='SUPPORT_UPDATED'){
     const [c]=await sql`SELECT * FROM support_case WHERE id=${p.caseId!}`;if(!c)return;
     const members=c.seller_organisation_id?await sql`SELECT user_id FROM seller_membership WHERE seller_organisation_id=${c.seller_organisation_id} AND role IN('OWNER','MANAGER','SUPPORT')`:[];
     const recipients=new Set<string>([...(c.user_id?[c.user_id]:[]),...members.map(m=>m.user_id)]);
     for(const userId of recipients)if(userId!==p.actorId)await this.notify(userId,`${eventId}:${userId}`,'Support conversation updated','A support conversation has a new response.',`/support/${c.id}`);return;
   }
   if(type==='MODERATION_DECIDED'){
     const members=await sql`SELECT user_id FROM seller_membership WHERE seller_organisation_id=${p.sellerId!} AND role IN('OWNER','MANAGER','UPLOADER')`;
     for(const m of members)await this.notify(m.user_id,`${eventId}:${m.user_id}`,'Submission status updated',`${p.decision}: ${p.reason}`,`/sell/items/${p.itemId}`);
     if(p.decision==='APPROVE'){
       const buyers=await sql`SELECT DISTINCT user_id FROM entitlement WHERE item_id=${p.itemId!} AND status='ACTIVE' AND update_access_until>=now()`;
       for(const b of buyers)await this.notify(b.user_id,`${eventId}:buyer:${b.user_id}`,'Product update available','An item in your library has a new published version.','/library');
     }return;
   }
   if(type==='COPYRIGHT_UPDATED'){
     const recipients=await sql`SELECT DISTINCT e.user_id FROM entitlement e WHERE e.item_id=${p.itemId!} AND e.status='ACTIVE'
       UNION SELECT m.user_id FROM seller_membership m JOIN catalog_item i ON i.seller_organisation_id=m.seller_organisation_id WHERE i.id=${p.itemId!} AND m.role IN('OWNER','MANAGER')`;
     for(const r of recipients)await this.notify(r.user_id,`${eventId}:${r.user_id}`,'Item rights status updated',`An item linked to your account has a rights-review update: ${p.status}. Contact support for help.`, '/support');return;
   }
   throw new Error('Unsupported notification event');
 }
 private async send(id:string){
   const [n]=await this.connection.client`SELECT n.*,u.email FROM notification n JOIN app_user u ON u.id=n.user_id WHERE n.id=${id} AND u.status='ACTIVE'`;
   if(!n||n.email_sent_at||!n.email||this.env.EMAIL_PROVIDER==='none')return;
   const text=`${n.title}\n\n${n.body}\n\nSign in to your CreateCanyon Network account to view details. We never include private download links in email.`;
   if(this.env.EMAIL_PROVIDER==='ses')await this.ses.send(new SendEmailCommand({FromEmailAddress:this.env.MAIL_FROM,Destination:{ToAddresses:[n.email]},Content:{Simple:{Subject:{Data:n.title,Charset:'UTF-8'},Body:{Text:{Data:text,Charset:'UTF-8'}}}},EmailTags:[{Name:'notification_id',Value:n.id}]}));
   else {const transport=nodemailer.createTransport({host:this.env.SMTP_HOST,port:this.env.SMTP_PORT,secure:false,connectionTimeout:10000});try{await transport.sendMail({from:this.env.MAIL_FROM,to:n.email,subject:n.title,text,messageId:`<${n.id}@notifications.createcanyon.com>`});}finally{transport.close();}}
   await this.connection.client`UPDATE notification SET email_sent_at=now() WHERE id=${id}`;
 }
}
