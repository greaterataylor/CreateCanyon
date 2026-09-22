/** Run only against a migrated, seeded disposable database whose name ends in _test.
 * These are actual database operations, not text assertions. They were not run in
 * the delivery environment because PostgreSQL/dependencies were unavailable. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createDatabaseConnection,postJournal,audit} from "@createcanyon/database";
const url=process.env.INTEGRATION_DATABASE_URL??process.env.MIGRATION_DATABASE_URL??process.env.DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith("_test"))throw new Error("Use a disposable database with a name ending in _test; run migrations and reference seed first.");
const db=createDatabaseConnection(url,{max:4,applicationName:"integration-tests"});
const sql=db.client,run=randomUUID();let passed=0;
async function check(name:string,fn:()=>Promise<void>){await fn();passed++;console.log(`PASS ${name}`);}
try{
 await check("Deferred database constraint rejects an empty journal",async()=>{
  await assert.rejects(sql.begin(async tx=>{await tx`INSERT INTO journal(reference_type,reference_id,description) VALUES('TEST',${run+':empty'},'Expected rejection')`;}));
 });
 await check("Deferred database constraint rejects unequal postings",async()=>{
  await assert.rejects(sql.begin(async tx=>{
   const [a]=await tx`INSERT INTO ledger_account(code,name,type,currency) VALUES(${run+':bad-account'},'Test','ASSET','USD') RETURNING id`;
   const [j]=await tx`INSERT INTO journal(reference_type,reference_id,description) VALUES('TEST',${run+':unbalanced'},'Expected rejection') RETURNING id`;
   await tx`INSERT INTO journal_line(journal_id,ledger_account_id,debit_minor,credit_minor,currency) VALUES(${j!.id},${a!.id},100,0,'USD'),(${j!.id},${a!.id},0,99,'USD')`;
  }));
 });
 let journalId:string|undefined;
 const entries=[{code:run+':cash',name:'Test cash',type:'ASSET' as const,debit:100n,credit:0n},{code:run+':revenue',name:'Test revenue',type:'REVENUE' as const,debit:0n,credit:100n}];
 await check("Balanced journal commits and repeated reference is idempotent",async()=>{
  journalId=await sql.begin(tx=>postJournal(tx,'TEST',run+':balanced','Test journal','USD',entries));
  assert.ok(journalId);const again=await sql.begin(tx=>postJournal(tx,'TEST',run+':balanced','Test journal','USD',entries));assert.equal(again,journalId);
  const [sum]=await sql`SELECT count(*)::int AS n,sum(debit_minor)-sum(credit_minor) AS difference FROM journal_line WHERE journal_id=${journalId!}`;
  assert.equal(sum!.n,2);assert.equal(String(sum!.difference),'0');
 });
 await check("Committed journal cannot acquire additional balanced lines",async()=>{
  const [line]=await sql`SELECT ledger_account_id FROM journal_line WHERE journal_id=${journalId!} LIMIT 1`;
  await assert.rejects(sql.begin(async tx=>{await tx`INSERT INTO journal_line(journal_id,ledger_account_id,debit_minor,credit_minor,currency) VALUES(${journalId!},${line!.ledger_account_id},1,0,'USD'),(${journalId!},${line!.ledger_account_id},0,1,'USD')`;}));
 });
 await check("Posted journals and journal lines cannot be overwritten",async()=>{
  await assert.rejects(sql`UPDATE journal SET description='Tampered' WHERE id=${journalId!}`);
  await assert.rejects(sql`UPDATE journal_line SET debit_minor=101 WHERE journal_id=${journalId!} AND debit_minor=100`);
 });
 await check("Audit hash chain verifies across client time zones and rejects mutation",async()=>{
  await sql.begin(async tx=>{await tx`SET LOCAL TIME ZONE 'Australia/Perth'`;await audit(tx,null,'TEST_AUDIT','integration',run,null,{run},'Generated integration test');});
  const bad=await sql`SELECT * FROM cc_verify_audit() WHERE NOT valid`;assert.equal(bad.length,0);
  await assert.rejects(sql`UPDATE audit_event SET action='TAMPERED' WHERE resource_id=${run}`);
 });
 await check("Database channel eligibility rejects a photo on MelodyMerchant",async()=>{
  const [item]=await sql`SELECT id FROM catalog_item WHERE asset_type='PHOTO' LIMIT 1`;const [channel]=await sql`SELECT id FROM storefront WHERE key='melodymerchant'`;
  assert.ok(item&&channel,'Run db:seed in the disposable test database first');
  await assert.rejects(sql`INSERT INTO channel_listing(item_id,storefront_id,slug,title,description) VALUES(${item.id},${channel.id},${'test-'+run},'Photo','Expected eligibility rejection')`);
 });
 await check("Submitted version content cannot be replaced",async()=>{
  const [item]=await sql`SELECT id FROM catalog_item WHERE asset_type='PHOTO' LIMIT 1`;assert.ok(item);
  await assert.rejects(sql.begin(async tx=>{
   const [version]=await tx`INSERT INTO item_version(item_id,version_number,version_label,submitted_at) SELECT ${item.id},coalesce(max(version_number),0)+1,${run},now() FROM item_version WHERE item_id=${item.id} RETURNING id`;
   await tx`UPDATE item_version SET changelog='Silent replacement' WHERE id=${version!.id}`;
  }));
 });
 console.log(`${passed} database integration checks passed.`);
}finally{await db.close();}
