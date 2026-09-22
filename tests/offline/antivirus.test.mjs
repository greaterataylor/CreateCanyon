import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sourceModule} from './load-typescript.mjs';
const {scanWithClamAV}=await sourceModule('apps/workers/src/clamav.ts');
async function fixture(t,handler){
 const dir=await mkdtemp(path.join(tmpdir(),'cc-av-test-'));
 const file=path.join(dir,'safe.txt');await writeFile(file,'Harmless generated scanner test input.');
 const clients=new Set();
 const server=createServer(socket=>{clients.add(socket);socket.on('error',()=>{});socket.on('close',()=>clients.delete(socket));handler(socket);});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{for(const socket of clients)socket.destroy();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 return {file,port:server.address().port};
}
function afterStream(socket,reply){
 let data=Buffer.alloc(0),header=false,remaining=null;
 socket.on('data',chunk=>{
  data=Buffer.concat([data,chunk]);
  if(!header){if(data.length<10)return;assert.equal(data.subarray(0,10).toString(),'zINSTREAM\0');data=data.subarray(10);header=true;}
  for(;;){if(remaining===null){if(data.length<4)return;remaining=data.readUInt32BE(0);data=data.subarray(4);if(remaining===0){socket.end(reply);return;}}
   if(data.length<remaining)return;data=data.subarray(remaining);remaining=null;
  }
 });
}
test('ClamAV clean verdict follows a complete framed upload',async t=>{const f=await fixture(t,s=>afterStream(s,'stream: OK\0'));await scanWithClamAV(f.file,'127.0.0.1',f.port,1000,1000);});
test('ClamAV FOUND and limit/error responses fail closed',async t=>{for(const reply of ['stream: Eicar-Test-Signature FOUND\0','stream: size limit exceeded ERROR\0']){const f=await fixture(t,s=>afterStream(s,reply));await assert.rejects(scanWithClamAV(f.file,'127.0.0.1',f.port,1000,1000));}});
test('ClamAV truncated reply or silent close never counts as clean',async t=>{for(const reply of ['stream: OK','']){const f=await fixture(t,s=>afterStream(s,reply));await assert.rejects(scanWithClamAV(f.file,'127.0.0.1',f.port,1000,1000),/complete verdict/);}});
test('ClamAV timeout and oversize streams fail closed',async t=>{const f=await fixture(t,s=>s.on('data',()=>{}));await assert.rejects(scanWithClamAV(f.file,'127.0.0.1',f.port,1000,100),/timed out/);await assert.rejects(scanWithClamAV(f.file,'127.0.0.1',f.port,1,100),/stream limit/);});
