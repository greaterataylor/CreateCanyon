import test from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir,stat} from 'node:fs/promises';import path from 'node:path';
import {root,ts} from './load-typescript.mjs';
async function walk(dir){let result=[];for(const e of await readdir(dir,{withFileTypes:true})){if(['node_modules','.next','dist','.turbo','.git'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())result.push(...await walk(p));else result.push(p);}return result;}
const files=await walk(root);const set=new Set(files);
test('Every relative TypeScript import has a source target',async()=>{
 const missing=[];for(const file of files.filter(f=>/\.(ts|tsx)$/.test(f)&&!f.endsWith('.d.ts'))){const source=await readFile(file,'utf8');for(const m of source.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)){const full=path.resolve(path.dirname(file),m[1]);const base=full.replace(/\.(m?js|jsx)$/,'');if(![full,base+'.ts',base+'.tsx',base+'.mjs',base+'.js',path.join(base,'index.ts'),path.join(base,'index.tsx')].some(p=>set.has(p)))missing.push(path.relative(root,file)+': '+m[1]);}}
 assert.deepEqual(missing,[]);
});
test('All TypeScript/TSX source files transpile syntactically',async()=>{
 const errors=[];for(const file of files.filter(f=>/\.(ts|tsx)$/.test(f)&&!f.endsWith('.d.ts'))){const result=ts.transpileModule(await readFile(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,experimentalDecorators:true}});for(const d of result.diagnostics??[])if(d.category===ts.DiagnosticCategory.Error)errors.push(path.relative(root,file)+': '+ts.flattenDiagnosticMessageText(d.messageText,' '));}assert.deepEqual(errors,[]);
});
test('Five applications and explicit migration files are present',async()=>{
 for(const app of ['storefront','dashboard','admin','api','workers'])assert.ok(set.has(path.join(root,'apps',app,'package.json')));
 for(const app of ['storefront','dashboard','admin'])for(const page of ['app/page.tsx','app/layout.tsx','proxy.ts'])assert.ok(set.has(path.join(root,'apps',app,page)));
 const baseline=await readFile(path.join(root,'packages/database/migrations/0001_initial.sql'),'utf8');assert.equal((baseline.match(/CREATE TABLE /g)??[]).length,48);
 const guards=await readFile(path.join(root,'packages/database/migrations/0002_invariants.sql'),'utf8');for(const term of ['DEFERRABLE INITIALLY DEFERRED','immutable_order_line','immutable_version','cc_verify_audit','validate_listing','pg_current_xact_id'])assert.ok(guards.includes(term));
});
test('Next project deployment never points to API dist as a static site',async()=>{
 const rootConfig=JSON.parse(await readFile(path.join(root,'vercel.json'),'utf8'));
 assert.match(rootConfig.installCommand,/corepack pnpm install/);
 assert.notEqual(rootConfig.outputDirectory,'apps/api/dist');
 for(const app of ['storefront','dashboard','admin']){const config=JSON.parse(await readFile(path.join(root,'apps',app,'vercel.json'),'utf8'));assert.equal(config.framework,'nextjs');assert.notEqual(config.outputDirectory,'apps/api/dist');}
});
