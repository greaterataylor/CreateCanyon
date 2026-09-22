/** Optional local fixtures. This is not the production upload or moderation path. */
import {readFile} from 'node:fs/promises';import {createHash,randomUUID} from 'node:crypto';
import {S3Client,PutObjectCommand} from '@aws-sdk/client-s3';
import {createDatabaseConnection,audit,enqueue} from '@createcanyon/database';
import {parseApiEnvironment} from '@createcanyon/config';import {PaymentEngine} from '@createcanyon/payments';
const env=parseApiEnvironment(process.env);
if(env.NODE_ENV!=='development'||env.PAYMENTS_MODE!=='stub'||env.TAX_MODE!=='disabled'||!env.S3_ENDPOINT||!['127.0.0.1','localhost'].includes(new URL(env.S3_ENDPOINT).hostname))throw new Error('Demo loader requires development, stub payments, disabled tax and loopback MinIO. It cannot seed production.');
const connection=createDatabaseConnection(process.env.MIGRATION_DATABASE_URL??env.DATABASE_URL,{max:5,applicationName:'createcanyon-local-demo'}),sql=connection.client;
const engine=new PaymentEngine(connection,{...env,PAYOUT_RESERVE_DAYS:0});
const storage=new S3Client({region:env.S3_REGION,endpoint:env.S3_ENDPOINT,forcePathStyle:true,credentials:{accessKeyId:env.S3_ACCESS_KEY_ID!,secretAccessKey:env.S3_SECRET_ACCESS_KEY!}});
const buyer='22222222-2222-4222-8222-222222222222',sellerUser='11111111-1111-4111-8111-111111111111',admin='33333333-3333-4333-8333-333333333333';
const samples=[['demo-gradient','gradient.png','image/png'],['demo-tone','tone.wav','audio/wav'],['demo-budget','budget.csv','text/csv'],['demo-code','formatting-utility.zip','application/zip']];
try{
 for(const [fixtureKey,filename,mime] of samples){
  const [item]=await sql`SELECT i.*,v.status AS version_status FROM catalog_item i JOIN item_version v ON v.id=i.current_version_id WHERE i.metadata->>'fixtureKey'=${fixtureKey!}`;
  if(!item)throw new Error('Run db:seed first');if(item.version_status!=='DRAFT')continue;
  const body=await readFile(new URL('../../../tests/fixtures/demo/'+filename,import.meta.url)),hash=createHash('sha256').update(body).digest('hex'),fileId=randomUUID(),key=`originals/local-fixtures/${item.id}/${fileId}`;
  const stored=await storage.send(new PutObjectCommand({Bucket:env.S3_ORIGINALS_BUCKET,Key:key,Body:body,ContentType:mime!,ChecksumSHA256:Buffer.from(hash,'hex').toString('base64')}));
  let preview:{id:string;key:string;body:Buffer;hash:string}|undefined;
  if(fixtureKey==='demo-gradient'){
   const bytes=await readFile(new URL('../../../tests/fixtures/demo/gradient-preview.png',import.meta.url));preview={id:randomUUID(),key:`previews/local-fixtures/${randomUUID()}.png`,body:bytes,hash:createHash('sha256').update(bytes).digest('hex')};
   await storage.send(new PutObjectCommand({Bucket:env.S3_PREVIEWS_BUCKET,Key:preview.key,Body:bytes,ContentType:'image/png'}));
  }
  await sql.begin(async tx=>{
   const [v]=await tx`SELECT status FROM item_version WHERE id=${item.current_version_id} FOR UPDATE`;if(v?.status!=='DRAFT')return;
   await tx`INSERT INTO file_object(id,item_version_id,role,state,bucket,object_key,original_filename,declared_mime_type,detected_mime_type,byte_size,sha256,storage_version_id,scan_result,metadata) VALUES(${fileId},${item.current_version_id},'ORIGINAL','READY',${env.S3_ORIGINALS_BUCKET},${key},${filename!},${mime!},${mime!},${String(body.length)},${hash},${stored.VersionId??null},'{"antivirus":"DEVELOPMENT_FIXTURE_NOT_SCANNED","processed":false,"codeScannersComplete":false}','{"developmentFixture":true}')`;
   if(preview)await tx`INSERT INTO file_object(id,item_version_id,role,state,bucket,object_key,original_filename,declared_mime_type,detected_mime_type,byte_size,sha256,metadata) VALUES(${preview.id},${item.current_version_id},'PREVIEW','READY',${env.S3_PREVIEWS_BUCKET},${preview.key},'gradient-preview.png','image/png','image/png',${String(preview.body.length)},${preview.hash},'{"developmentFixture":true,"generated":true}')`;
   await tx`UPDATE item_version SET status='PUBLISHED',submitted_at=now(),approved_at=now(),published_at=now() WHERE id=${item.current_version_id}`;
   await tx`UPDATE catalog_item SET status='PUBLISHED',published_at=now() WHERE id=${item.id}`;
   await tx`UPDATE channel_listing SET status='PUBLISHED',published_at=now() WHERE item_id=${item.id}`;
   await tx`INSERT INTO moderation_case(item_version_id,status,risk_signals,closed_at) VALUES(${item.current_version_id},'APPROVED','{"developmentFixture":true,"reviewBypassedForLocalDemo":true}',now()) ON CONFLICT DO NOTHING`;
   await audit(tx,null,'LOCAL_FIXTURE_IMPORTED','item',item.id,null,{developmentFixture:true},'Explicit development-only seed: no real antivirus or human moderation is claimed');
   await enqueue(tx,'SEARCH_ITEM','item',item.id,{itemId:item.id},`seed-search:${item.id}`);
  });
 }
 const [already]=await sql`SELECT 1 FROM notification WHERE dedupe_key='seed:commerce-complete'`;
 if(!already){
  const listings=await sql`SELECT p.listing_id,lv.id AS license_id FROM public_listing p JOIN catalog_item i ON i.id=p.item_id JOIN license_variant lv ON lv.item_id=i.id WHERE i.metadata->>'fixtureKey' IN('demo-gradient','demo-tone') AND p.storefront_key='createcanyon' ORDER BY p.title`;
  if(listings.length!==2)throw new Error('Published demo listing lookup did not return two different-seller assets');
  const [prior]=await sql`SELECT response_body FROM idempotency_key WHERE scope=${'checkout:'+buyer} AND key='local-demo-checkout-v1'`;
  let checkout:{orderId:string};
  if(prior)checkout=await engine.ensurePayment(prior.response_body.orderId,buyer);
  else{for(const l of listings)await engine.addLine(buyer,{listingId:l.listing_id,licenseVariantId:l.license_id,quantity:1});const cart=await engine.getCart(buyer,'USD');checkout=await engine.checkout(buyer,{cartId:cart.id,successUrl:'http://localhost:3001/orders',cancelUrl:'http://localhost:3001/cart'},'local-demo-checkout-v1');}
  const lines=await sql`SELECT * FROM order_line WHERE order_id=${checkout.orderId} ORDER BY title_snapshot`;
  for(const line of lines){const [transfer]=await sql`SELECT id FROM seller_transfer WHERE order_line_id=${line.id}`;if(transfer)await engine.processTransfer(transfer.id);}
  if(lines[0]){const refund=await engine.requestRefund(admin,lines[0].id,100n,'local-demo-partial-refund-v1','Local fixture: demonstrate partial refund and reversal');await engine.processRefund(refund!.id);await engine.reverseTransfer(refund!.id);}
  await sql.begin(async tx=>{
   for(const l of lines)await tx`INSERT INTO review(user_id,order_line_id,item_id,rating,title,body,status) VALUES(${buyer},${l.id},${l.canonical_item_id},5,'Local verified-purchase example','This review is development seed data, not a real customer endorsement.','PUBLISHED') ON CONFLICT DO NOTHING`;
   const line=lines[0]!;
   const [support]=await tx`INSERT INTO support_case(user_id,seller_organisation_id,order_id,order_line_id,subject,body,status) VALUES(${buyer},${line.seller_organisation_id},${line.order_id},${line.id},'Local support conversation','How do I find the download?','RESOLVED') RETURNING id`;
   await tx`INSERT INTO support_message(case_id,author_user_id,body) VALUES(${support!.id},${buyer},'How do I find the download?'),(${support!.id},${sellerUser},'Open your purchase library. Each download checks your entitlement before a temporary URL is issued.')`;
   await tx`INSERT INTO copyright_claim(item_id,claimant_name,claimant_email,status,allegation,evidence) VALUES(${line.canonical_item_id},'Local example claimant','claimant@example.test','CLOSED','Demonstration of a closed rights-report case. No real infringement is alleged.','{"developmentFixture":true}')`;
   await tx`INSERT INTO notification(user_id,dedupe_key,title,body,href) VALUES(${buyer},'seed:commerce-complete','Local demo order is available','Stub checkout created two purchase entitlements, a partial refund and a transfer reversal. No real money moved.','/library')`;
  });
 }
 console.log('Local demo loaded. Original files are private; only the generated image preview is public. Stub order/refund/transfer examples are not real transactions.');
}finally{await connection.close();storage.destroy();}
