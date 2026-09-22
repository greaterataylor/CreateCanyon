import test from 'node:test';import assert from 'node:assert/strict';import {sourceModule} from './load-typescript.mjs';
const {normalizeHostname,resolveStorefrontFromHost,safeSameOriginPath}=await sourceModule('packages/security/src/index.ts');
test('All five allowlisted channel hosts resolve without trusting forwarded input',()=>{
 const names=['createcanyon','graphicgrounds','melodymerchant','filefoyer','programplaza'];
 for(const name of names){assert.equal(resolveStorefrontFromHost(name+'.com',[name+'.com']).key,name);assert.equal(resolveStorefrontFromHost(name+'.localhost:3000',[name+'.localhost']).key,name);}
 assert.equal(resolveStorefrontFromHost('localhost:3000',['localhost']).key,'createcanyon');
});
test('Host allowlist rejects spoofed, combined, URL-form, and unexpected hosts',()=>{
 for(const host of ['evil.test','createcanyon.com.evil.test','createcanyon.com,evil.test','createcanyon.com@evil.test','https://createcanyon.com','createcanyon.com/path','createcanyon.com\\evil',''])assert.throws(()=>resolveStorefrontFromHost(host,['createcanyon.com']));
 assert.equal(normalizeHostname('CREATECANYON.COM.:443'),'createcanyon.com');
});
test('Login return paths cannot become external redirects',()=>{
 for(const value of ['//evil.test','https://evil.test','/\\evil.test','javascript:alert(1)',''])assert.equal(safeSameOriginPath(value),'/');
 assert.equal(safeSameOriginPath('/library?item=1#license'),'/library?item=1#license');
});
