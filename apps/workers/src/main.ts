import {createDatabaseConnection,enqueue} from "@createcanyon/database";
import {PaymentEngine} from "@createcanyon/payments";
import {TypesenseIndex} from "@createcanyon/search";
import {apiEnv,workerEnv} from "./environment.js";
import {FileProcessor} from "./files.js";
import {NotificationWorker} from "./notifications.js";
import {randomUUID} from "node:crypto";
const connection=createDatabaseConnection(apiEnv.DATABASE_URL,{max:6,applicationName:`worker-${workerEnv.WORKER_KIND}`});
const sql=connection.client,owner=randomUUID(),payments=new PaymentEngine(connection,apiEnv),files=new FileProcessor(connection,apiEnv,workerEnv),search=new TypesenseIndex(apiEnv.TYPESENSE_URL,apiEnv.TYPESENSE_API_KEY),notifications=new NotificationWorker(connection,workerEnv);
const groups={files:['ASSET_PROCESS_REQUESTED'],search:['SEARCH_ITEM'],payments:['STRIPE_EVENT','REFUND_REQUESTED','PROCESSOR_FEE'],tax:['TAX_FINALIZE','TAX_REVERSE'],transfers:['TRANSFER_ELIGIBLE','TRANSFER_REVERSE'],notifications:['ORDER_PAID','REFUND_COMPLETED','SUPPORT_UPDATED','MODERATION_DECIDED','COPYRIGHT_UPDATED','NOTIFICATION_EMAIL']} as const;
const accepted=workerEnv.WORKER_KIND==='all'?Object.values(groups).flat():[...groups[workerEnv.WORKER_KIND]];
let stopping=false;const stop=()=>{stopping=true;};process.on('SIGTERM',stop);process.on('SIGINT',stop);
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function searchItem(itemId:string){
 await search.ensureCollection();const rows=await sql`SELECT * FROM public_listing WHERE item_id=${itemId}`;
 await search.removeItem(itemId);
 for(const r of rows)await search.upsert({id:r.listing_id,item_id:r.item_id,channel:r.storefront_key,title:r.title,description:r.description,tags:r.tags??[],asset_type:r.asset_type,category:r.category_slug??'',price:Number(r.amount_minor),rating:Number(r.rating),sales:Number(r.sales),published_at:Math.floor(new Date(r.published_at??0).getTime()/1000)});
}
async function dispatch(job:Record<string,any>){
 const p=job.payload as Record<string,string>;
 switch(job.event_type){
  case 'ASSET_PROCESS_REQUESTED':await files.process(p.itemVersionId!);break;
  case 'SEARCH_ITEM':await searchItem(p.itemId!);break;
  case 'STRIPE_EVENT':await payments.handleEvent(p.eventId!);break;
  case 'REFUND_REQUESTED':await payments.processRefund(p.refundId!);break;
  case 'PROCESSOR_FEE':if(p.chargeId)await payments.processorFee(p.paymentId!,p.chargeId);break;
  case 'TAX_FINALIZE':await payments.finalizeTax(p.orderId!);break;
  case 'TAX_REVERSE':await payments.reverseTax(p.refundId!);break;
  case 'TRANSFER_ELIGIBLE':await payments.processTransfer(p.transferId!);break;
  case 'TRANSFER_REVERSE':await payments.reverseTransfer(p.refundId!);break;
  default:await notifications.handle(job.id,job.event_type,p);
 }
}
async function sweep(){
 if(workerEnv.WORKER_KIND==='all'||workerEnv.WORKER_KIND==='transfers'){
  const rows=await sql`SELECT t.id FROM seller_transfer t JOIN seller_organisation s ON s.id=t.seller_organisation_id WHERE t.provider_transfer_id IS NULL AND t.status IN('PENDING_RESERVE','ELIGIBLE','SUBMITTED','HELD') AND t.eligible_at<=now() AND s.status='ACTIVE' AND (s.payout_hold_until IS NULL OR s.payout_hold_until<=now()) ORDER BY t.eligible_at LIMIT 100`;
  // A time-bucket key permits held transfers to be reconsidered after restrictions change.
  const bucket=Math.floor(Date.now()/300000);
  for(const t of rows)await enqueue(sql,'TRANSFER_ELIGIBLE','transfer',t.id,{transferId:t.id},`transfer-sweep:${t.id}:${bucket}`);
 }
 if((workerEnv.WORKER_KIND==='all'||workerEnv.WORKER_KIND==='payments')&&apiEnv.PAYMENTS_MODE==='stripe'){
  const rows=await sql`SELECT o.id,o.user_id FROM customer_order o JOIN payment p ON p.order_id=o.id WHERE o.status='PENDING_PAYMENT' AND p.provider_payment_intent_id LIKE 'pi_%' AND o.created_at<now()-interval '1 minute' ORDER BY o.created_at DESC LIMIT 20`;
  for(const o of rows){try{await payments.ensurePayment(o.id,o.user_id);}catch{/* Durable webhook jobs and operator reconciliation retain the unresolved state. */}}
 }
}
async function main(){
 let lastSweep=0;
 console.info(JSON.stringify({event:'worker_started',kind:workerEnv.WORKER_KIND,owner}));
 while(!stopping){
  try{
   if(Date.now()-lastSweep>60000){await sweep();lastSweep=Date.now();}
   const [job]=await sql`WITH candidate AS(SELECT id FROM outbox_event WHERE event_type IN ${sql(accepted)} AND processed_at IS NULL AND failed_at IS NULL AND available_at<=now() AND (locked_at IS NULL OR locked_at<now()-interval '2 minutes') ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE outbox_event e SET locked_at=now(),locked_by=${owner},attempts=e.attempts+1 FROM candidate c WHERE e.id=c.id RETURNING e.*`;
   if(!job){await pause(workerEnv.WORKER_POLL_INTERVAL_MS);continue;}
   let leaseLost=false;
   const heartbeat=setInterval(()=>{void sql`UPDATE outbox_event SET locked_at=now() WHERE id=${job.id} AND locked_by=${owner} AND processed_at IS NULL RETURNING id`.then(rows=>{if(!rows.length)leaseLost=true;}).catch(()=>{leaseLost=true;});},30000);
   try{
    if(job.attempts>job.max_attempts)throw new Error('Retry limit exhausted after an interrupted worker');
    await dispatch(job);
    if(!leaseLost)await sql`UPDATE outbox_event SET processed_at=now(),locked_at=NULL,locked_by=NULL,last_error=NULL WHERE id=${job.id} AND locked_by=${owner}`;
   }catch(error){
    const code=error instanceof Error?('code' in error?String(error.code):error.name):'JOB_FAILED';
    // Never persist provider responses, uploaded text, access tokens, or buyer addresses in job errors.
    const message=error instanceof Error?error.message.replace(/(?:sk_|whsec_|Bearer )[A-Za-z0-9._-]+/g,'[REDACTED]').slice(0,300):'Worker job failed';
    const delay=Math.min(3600,2**Math.min(job.attempts,11))+Math.floor(Math.random()*10);
    await sql`UPDATE outbox_event SET failed_at=CASE WHEN attempts>=max_attempts THEN now() ELSE NULL END,available_at=now()+${delay}*interval '1 second',locked_at=NULL,locked_by=NULL,last_error=${code+': '+message} WHERE id=${job.id} AND locked_by=${owner}`;
    console.error(JSON.stringify({event:'job_failed',id:job.id,type:job.event_type,attempt:job.attempts,code}));
   }finally{clearInterval(heartbeat);}
  }catch(error){console.error(JSON.stringify({event:'worker_loop_error',type:error instanceof Error?error.name:'Error'}));await pause(2000);}
 }
 await connection.close();
}
main().catch(async()=>{console.error('Worker failed to start');await connection.close();process.exitCode=1;});
