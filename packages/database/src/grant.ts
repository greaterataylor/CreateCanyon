import {readFile} from 'node:fs/promises';
import {createDatabaseConnection} from './index.js';
if(process.env.NODE_ENV==='production')throw new Error('Local grant script is not a production provisioning tool');
const url=process.env.MIGRATION_DATABASE_URL;if(!url)throw new Error('MIGRATION_DATABASE_URL is required');
const db=createDatabaseConnection(url,{max:1,applicationName:'createcanyon-grants'});
try{await db.client.unsafe(await readFile(new URL('../../../infra/postgres/grants.sql',import.meta.url),'utf8'));console.log('Runtime database grants applied');}finally{await db.close();}
