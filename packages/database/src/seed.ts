import {createHash} from 'node:crypto';
import {createDatabaseConnection} from './index.js';
if(process.env.NODE_ENV==='production')throw new Error('Development seeds cannot run in production');
const url=process.env.MIGRATION_DATABASE_URL??process.env.DATABASE_URL;if(!url)throw new Error('Database URL is required');
const connection=createDatabaseConnection(url,{max:2,applicationName:'createcanyon-development-seed'}),sql=connection.client;
const userIds={seller:'11111111-1111-4111-8111-111111111111',buyer:'22222222-2222-4222-8222-222222222222',admin:'33333333-3333-4333-8333-333333333333'};
const sellers=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'];
const channels=[['createcanyon','CreateCanyon'],['graphicgrounds','GraphicGrounds'],['melodymerchant','MelodyMerchant'],['filefoyer','FileFoyer'],['programplaza','ProgramPlaza']] as const;
const eligible:Record<string,string[]>={graphicgrounds:['PHOTO','ILLUSTRATION','VECTOR','DESIGN_TEMPLATE','FONT','THREE_D'],melodymerchant:['MUSIC','SOUND_EFFECT','AUDIO_LOOP'],filefoyer:['DOCUMENT_TEMPLATE','PRESENTATION_TEMPLATE','SPREADSHEET_TEMPLATE','PRINTABLE'],programplaza:['CODE','PLUGIN','THEME','INTEGRATION','DEVELOPER_TOOL']};
eligible.createcanyon=Object.values(eligible).flat();
const licenseKinds=['PERSONAL','STANDARD_COMMERCIAL','EXTENDED_COMMERCIAL','EDITORIAL','TEAM','MUSIC_ONLINE','MUSIC_BROADCAST','FONT_DESKTOP','FONT_WEB','FONT_APP','CODE_SINGLE','CODE_AGENCY','CODE_SAAS'];
const terms='# DEMONSTRATION SELLER TERMS — NOT FOR COMMERCIAL USE\n\nThis local fixture records acceptance of a versioned document. It is not a reviewed seller agreement, does not enable a production launch, and must be replaced with counsel-approved terms before real sales.';
const fixtures=[
 {key:'demo-gradient',title:'Demo — Canyon Gradient Image',type:'PHOTO',channel:'graphicgrounds',license:'STANDARD_COMMERCIAL',seller:sellers[0]!,price:1900},
 {key:'demo-tone',title:'Demo — Synthesized Test Tone',type:'MUSIC',channel:'melodymerchant',license:'MUSIC_ONLINE',seller:sellers[1]!,price:900},
 {key:'demo-budget',title:'Demo — Simple Budget CSV',type:'SPREADSHEET_TEMPLATE',channel:'filefoyer',license:'STANDARD_COMMERCIAL',seller:sellers[0]!,price:1200},
 {key:'demo-code',title:'Demo — Formatting Utility Source',type:'CODE',channel:'programplaza',license:'CODE_SINGLE',seller:sellers[1]!,price:2400},
 {key:'demo-font-draft',title:'Demo — Font Submission Draft (no font bundled)',type:'FONT',channel:'graphicgrounds',license:'FONT_DESKTOP',seller:sellers[0]!,price:1500},
];
try{
 await sql.begin(async tx=>{
  for(const [name,id] of Object.entries(userIds))await tx`INSERT INTO app_user(id,oidc_subject,email,display_name,metadata) VALUES(${id},${id},${name+'@example.test'},${'Local '+name},'{"developmentFixture":true}') ON CONFLICT DO NOTHING`;
  for(const [index,id] of sellers.entries()){
   await tx`INSERT INTO seller_organisation(id,legal_name,display_name,slug,status,country_code,business_type,description,metadata) VALUES(${id},${'Local Example Studio '+(index+1)},${index===0?'Canyon Demo Studio':'Network Demo Audio & Code'},${'demo-studio-'+(index+1)},'ACTIVE','AU','company','A local test seller. No real purchases or commercial licensing.','{"developmentFixture":true}') ON CONFLICT DO NOTHING`;
   await tx`INSERT INTO seller_membership(seller_organisation_id,user_id,role) VALUES(${id},${userIds.seller},'OWNER') ON CONFLICT DO NOTHING`;
   await tx`INSERT INTO payment_account(seller_organisation_id,provider_account_id,charges_enabled,payouts_enabled,details_submitted) VALUES(${id},${'acct_stub_demo_'+index},true,true,true) ON CONFLICT DO NOTHING`;
  }
  for(const [key,name] of channels){
   await tx`INSERT INTO storefront(key,name,hostname,configuration) VALUES(${key},${name},${key+'.com'},'{"developmentFixture":true}') ON CONFLICT DO NOTHING`;
   const [store]=await tx`SELECT id FROM storefront WHERE key=${key}`;
   for(const type of eligible[key]??[]){
    await tx`INSERT INTO channel_eligibility(storefront_id,asset_type) VALUES(${store!.id},${type}) ON CONFLICT DO NOTHING`;
    const category=type.toLowerCase().replaceAll('_','-');
    await tx`INSERT INTO category(storefront_id,slug,name) VALUES(${store!.id},${category},${type.toLowerCase().split('_').map(w=>w[0]!.toUpperCase()+w.slice(1)).join(' ')}) ON CONFLICT DO NOTHING`;
   }
  }
  for(const type of eligible.createcanyon!)await tx`INSERT INTO metadata_schema(asset_type,version,schema) SELECT ${type},1,'{"type":"object","additionalProperties":true}'::jsonb WHERE NOT EXISTS(SELECT 1 FROM metadata_schema WHERE asset_type=${type} AND storefront_id IS NULL AND version=1)`;
  for(const kind of licenseKinds){const name=kind.split('_').map(w=>w[0]!.toUpperCase()+w.slice(1).toLowerCase()).join(' ');await tx`INSERT INTO license_template(kind,name,version,summary,body_markdown) VALUES(${kind},${name+' — demonstration'},1,'DEMONSTRATION ONLY. Not a production legal license.',${'# '+name+' — DEMONSTRATION ONLY\n\nThis fixture demonstrates immutable license snapshots. No commercially approved rights are represented. Replace with professionally reviewed, versioned license terms before enabling real sales.'}) ON CONFLICT DO NOTHING`;}
  const termsHash=createHash('sha256').update(terms).digest('hex');
  await tx`INSERT INTO seller_terms(version,body_markdown,content_hash) VALUES(1,${terms},${termsHash}) ON CONFLICT DO NOTHING`;
  const [t]=await tx`SELECT id,content_hash FROM seller_terms WHERE version=1`;
  for(const seller of sellers)await tx`INSERT INTO seller_terms_acceptance(seller_organisation_id,terms_id,user_id,content_hash) VALUES(${seller},${t!.id},${userIds.seller},${t!.content_hash}) ON CONFLICT DO NOTHING`;
  for(const item of fixtures){
   const [exists]=await tx`SELECT id FROM catalog_item WHERE metadata->>'fixtureKey'=${item.key}`;if(exists)continue;
   const [network]=await tx`SELECT id FROM storefront WHERE key='createcanyon'`,[specialist]=await tx`SELECT id FROM storefront WHERE key=${item.channel}`;
   const [record]=await tx`INSERT INTO catalog_item(seller_organisation_id,asset_type,title,description,origin_storefront_id,primary_storefront_id,metadata) VALUES(${item.seller},${item.type},${item.title},'Local demonstration asset. Not offered for real sale. Load the optional local demo fixtures to exercise checkout and private downloads.',${specialist!.id},${specialist!.id},${JSON.stringify({fixtureKey:item.key,developmentFixture:true,rightsDeclared:true})}::jsonb) RETURNING id`;
   const [version]=await tx`INSERT INTO item_version(item_id,version_number,version_label,changelog,metadata,created_by_user_id) VALUES(${record!.id},1,'1.0.0','Initial local demonstration fixture.','{"developmentFixture":true}',${userIds.seller}) RETURNING id`;
   await tx`UPDATE catalog_item SET current_version_id=${version!.id} WHERE id=${record!.id}`;
   for(const storeId of [network!.id,specialist!.id]){
    const [category]=await tx`SELECT id FROM category WHERE storefront_id=${storeId} AND slug=${item.type.toLowerCase().replaceAll('_','-')}`;
    await tx`INSERT INTO channel_listing(item_id,storefront_id,category_id,slug,title,description,is_primary,tags) VALUES(${record!.id},${storeId},${category?.id??null},${item.key},${item.title},'Local test fixture — not a live commercial product.',${storeId===specialist!.id},ARRAY['demo','local-test'])`;
   }
   const [template]=await tx`SELECT id FROM license_template WHERE kind=${item.license} AND version=1`;
   const [variant]=await tx`INSERT INTO license_variant(item_id,license_template_id,name,parameters) VALUES(${record!.id},${template!.id},'Demonstration license','{"developmentFixture":true,"projects":1}') RETURNING id`;
   await tx`INSERT INTO offer(license_variant_id,amount_minor,currency) VALUES(${variant!.id},${String(item.price)},'USD')`;
  }
  await tx`INSERT INTO notification(user_id,dedupe_key,title,body,href) VALUES(${userIds.seller},'seed:seller-welcome','Welcome to your local seller studio','Five draft fixtures are available. The font draft intentionally has no bundled font files.','/seller') ON CONFLICT DO NOTHING`;
 });
 console.log('Development reference data created: 5 channels, 18 asset types, all 13 license kinds, 3 users, 2 sellers, 5 drafts. No real payment or scan was performed.');
}finally{await connection.close();}
