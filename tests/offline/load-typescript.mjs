import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url);
let ts;
try{ts=require(process.env.TYPESCRIPT_PATH||'typescript');}catch{throw new Error('Install the root TypeScript devDependency, or set TYPESCRIPT_PATH to a local compiler package.');}
export const root=fileURLToPath(new URL('../../',import.meta.url));
const cache=new Map();
export async function sourceModule(relative){
 const filename=path.resolve(root,relative);if(cache.has(filename))return cache.get(filename);
 const source=await readFile(filename,'utf8');
 let output=ts.transpileModule(source,{fileName:filename,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,verbatimModuleSyntax:false}}).outputText;
 // Offline-tested modules deliberately have no third-party runtime imports.
 const imports=[...output.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)];
 for(const m of imports){const target=path.resolve(path.dirname(filename),m[1].replace(/\.js$/,'.ts'));const url=await moduleUrl(target);output=output.replaceAll(`"${m[1]}"`,`"${url}"`).replaceAll(`'${m[1]}'`,`'${url}'`);}
 const result=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));cache.set(filename,result);return result;
}
async function moduleUrl(filename){const source=await readFile(filename,'utf8');const output=ts.transpileModule(source,{fileName:filename,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;return 'data:text/javascript;base64,'+Buffer.from(output).toString('base64');}
export {ts};
