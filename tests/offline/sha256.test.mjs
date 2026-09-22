import test from 'node:test';import assert from 'node:assert/strict';import {createHash,randomBytes} from 'node:crypto';
import {sourceModule} from './load-typescript.mjs';
const {Sha256,hashFile}=await sourceModule('packages/web/src/sha256.ts');
const expected=b=>createHash('sha256').update(b).digest('hex');
test('SHA-256 published empty, abc, and million-a vectors',()=>{
 for(const value of ['', 'abc', 'a'.repeat(1000000)]){const bytes=Buffer.from(value);assert.equal(new Sha256().update(bytes).digestHex(),expected(bytes));}
});
test('SHA-256 padding boundaries and arbitrary incremental chunks match node:crypto',()=>{
 for(const length of [1,3,55,56,57,63,64,65,111,112,119,120,127,128,129,1000,65536,1048591]){
  const bytes=randomBytes(length);
  for(const stride of [1,7,31,64,113,4096]){const hash=new Sha256();for(let i=0;i<length;i+=stride)hash.update(bytes.subarray(i,i+stride));assert.equal(hash.digestHex(),expected(bytes),`length ${length}, stride ${stride}`);}
 }
});
test('SHA-256 forbids update or digest after finalization',()=>{const hash=new Sha256();hash.digestHex();assert.throws(()=>hash.update(new Uint8Array([1])));assert.throws(()=>hash.digestHex());});
test('Browser-sized Blob hashing streams bounded slices and reports monotone progress',async()=>{
 const bytes=randomBytes(4*1024*1024+137),events=[];const result=await hashFile(new Blob([bytes]),value=>events.push(value));assert.equal(result,expected(bytes));assert.equal(events.at(-1),1);assert.ok(events.every((n,i)=>i===0||n>=events[i-1]));
});
test('File hashing observes cancellation',async()=>{const controller=new AbortController();controller.abort();await assert.rejects(()=>hashFile(new Blob(['not read']),undefined,controller.signal));});
