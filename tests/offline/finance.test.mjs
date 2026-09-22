import test from 'node:test';import assert from 'node:assert/strict';import {sourceModule} from './load-typescript.mjs';
const {allocateProportionally,refundAllocation,minorToSafeNumber}=await sourceModule('packages/domain/src/finance.ts');
const {assertBalancedJournal,calculateBasisPoints}=await sourceModule('packages/domain/src/index.ts');
test('Proportional rounding allocates every minor unit deterministically',()=>{assert.deepEqual(allocateProportionally(10n,[1n,1n,1n]),[4n,3n,3n]);assert.deepEqual(allocateProportionally(0n,[0n,0n]),[0n,0n]);assert.throws(()=>allocateProportionally(1n,[0n]));assert.throws(()=>allocateProportionally(1n,[-1n]));});
test('Thousands of cumulative one-cent refunds never create negative shares and reverse the full original',()=>{
 for(let seller=0n;seller<=17n;seller++)for(let fee=0n;fee<=13n;fee++)for(let tax=0n;tax<=7n;tax++){
  const parts={seller,fee,tax},total=seller+fee+tax,sums={seller:0n,fee:0n,tax:0n};
  for(let prior=0n;prior<total;prior++){const r=refundAllocation(parts,prior,1n);assert.equal(r.seller+r.fee+r.tax,1n);for(const k of Object.keys(sums)){assert.ok(r[k]>=0n);sums[k]+=r[k];}}
  assert.deepEqual(sums,parts);
 }
});
test('Partial refund intervals add exactly to one full refund',()=>{const p={seller:699n,fee:300n,tax:100n};const a=refundAllocation(p,0n,317n),b=refundAllocation(p,317n,782n);for(const k of Object.keys(p))assert.equal(a[k]+b[k],p[k]);assert.throws(()=>refundAllocation(p,1099n,1n));assert.throws(()=>refundAllocation(p,0n,0n));});
test('Money cannot silently exceed JS safe integer range',()=>{assert.equal(minorToSafeNumber('9007199254740991'),Number.MAX_SAFE_INTEGER);assert.throws(()=>minorToSafeNumber('9007199254740992'));assert.throws(()=>minorToSafeNumber('-1'));});
test('Journal application checks reject invalid amounts, imbalance, currencies, and empty journals',()=>{
 const valid=[{accountId:'a',debitMinor:100n,creditMinor:0n,currency:'USD'},{accountId:'b',debitMinor:0n,creditMinor:100n,currency:'USD'}];assert.doesNotThrow(()=>assertBalancedJournal(valid));assert.throws(()=>assertBalancedJournal([]));assert.throws(()=>assertBalancedJournal([valid[0],{...valid[1],creditMinor:99n}]));assert.throws(()=>assertBalancedJournal([valid[0],{...valid[1],currency:'AUD'}]));assert.throws(()=>assertBalancedJournal([valid[0],{...valid[1],debitMinor:1n}]));assert.equal(calculateBasisPoints(999n,3000),300n);
});
