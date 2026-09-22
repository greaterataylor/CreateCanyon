import {GetObjectCommand,PutObjectCommand,S3Client} from "@aws-sdk/client-s3";
import {Upload} from "@aws-sdk/lib-storage";
import {audit,enqueue,type DatabaseConnection} from "@createcanyon/database";
import type {ApiEnvironment} from "@createcanyon/config";
import {createHash,randomUUID} from "node:crypto";
import {createReadStream,createWriteStream} from "node:fs";
import {mkdtemp,mkdir,readFile,rm,stat,writeFile,chmod} from "node:fs/promises";
import {pipeline} from "node:stream/promises";
import {Transform,type Readable} from "node:stream";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {scanWithClamAV} from "./clamav.js";
import type {WorkerEnv} from "./environment.js";
interface ProcessorReport {detectedMime:string;inputSha256:string;technical:Record<string,unknown>;archive:{entries:number;expandedBytes:number;files:unknown[]};scans:{scanner:string;status:string;report:unknown}[];previews:{filename:string;mime:string;sha256:string;bytes:number}[];previewStatus:string;codeScannersComplete:boolean;}
class RejectedFile extends Error{}
async function hash(file:string){const digest=createHash("sha256");for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest("hex");}
export class FileProcessor {
 private readonly storage:S3Client;
 constructor(private readonly connection:DatabaseConnection,private readonly env:ApiEnvironment,private readonly worker:WorkerEnv){this.storage=new S3Client({region:env.S3_REGION,...(env.S3_ENDPOINT?{endpoint:env.S3_ENDPOINT}:{}),forcePathStyle:env.S3_FORCE_PATH_STYLE,...(env.S3_ACCESS_KEY_ID&&env.S3_SECRET_ACCESS_KEY?{credentials:{accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY}}:{})});}
 async process(versionId:string){
   const sql=this.connection.client;
   const [v]=await sql`SELECT v.*,i.asset_type,i.seller_organisation_id FROM item_version v JOIN catalog_item i ON i.id=v.item_id WHERE v.id=${versionId}`;
   if(!v)throw new Error("Processing version not found");if(['AWAITING_REVIEW','PUBLISHED','CHANGES_REQUESTED','SUSPENDED'].includes(v.status))return;
   if(!['SCANNING','PROCESSING'].includes(v.status))throw new Error("Version is not ready for processing");
   const files=await sql`SELECT * FROM file_object WHERE item_version_id=${versionId} AND role NOT IN('PREVIEW','MANIFEST') ORDER BY id`;
   if(!files.length)throw new RejectedFile("Submission has no files");
   for(const f of files){
     if(f.state==='READY')continue;
     if(['REJECTED','INFECTED'].includes(f.state))throw new RejectedFile("Submission includes a rejected file");
     const root=await mkdtemp(path.join(this.worker.PROCESSOR_TEMP_DIR,'cc-process-')),source=path.join(root,'source'),output=path.join(root,'output');
     await mkdir(output,{mode:0o700});
     try{
       const object=await this.storage.send(new GetObjectCommand({Bucket:this.env.S3_QUARANTINE_BUCKET,Key:f.object_key,...(f.storage_version_id?{VersionId:f.storage_version_id}:{})}));
       if(!object.Body)throw new Error("Quarantined object is missing");
       let bytes=0;const digest=createHash("sha256");
       await pipeline(object.Body as Readable,new Transform({transform:(chunk:Buffer,_encoding,callback)=>{
         bytes+=chunk.length;if(bytes>Number(f.byte_size)||bytes>this.env.MAX_UPLOAD_BYTES){callback(new RejectedFile("Actual upload exceeds declared size"));return;}digest.update(chunk);callback(null,chunk);
       }}),createWriteStream(source,{flags:'wx',mode:0o600}));
       if(bytes!==Number(f.byte_size)||digest.digest('hex')!==f.sha256)throw new RejectedFile("Actual file size or SHA-256 does not match the submission");
       let antivirusStatus='PASSED';
       if(this.worker.ALLOW_UNSCANNED_DEV_FIXTURES==='true'){antivirusStatus='DEVELOPMENT_BYPASS';}
       else{
         try{await scanWithClamAV(source,this.worker.CLAMAV_HOST,this.worker.CLAMAV_PORT,this.worker.CLAMAV_MAX_STREAM_BYTES);}
         catch(e){if(e instanceof Error&&e.message==='MALWARE_DETECTED')throw new RejectedFile('MALWARE_DETECTED');throw e;}
       }
       await sql`INSERT INTO scan_result(file_object_id,scanner,status,report) VALUES(${f.id},'clamav',${antivirusStatus},${JSON.stringify({mode:antivirusStatus})}::jsonb) ON CONFLICT(file_object_id,scanner) DO UPDATE SET status=EXCLUDED.status,report=EXCLUDED.report`;
       await this.run(source,output,v.asset_type,f.declared_mime_type);
       const reportPath=path.join(output,'report.json');if((await stat(reportPath)).size>16*1024*1024)throw new RejectedFile('Processor report exceeded limit');
       const report=JSON.parse(await readFile(reportPath,'utf8')) as ProcessorReport;
       if(report.inputSha256!==f.sha256||await hash(source)!==f.sha256)throw new RejectedFile('Processor input changed unexpectedly');
       if(this.env.NODE_ENV==='production'&&!report.codeScannersComplete)throw new RejectedFile('Required code scanners did not complete');
       for(const scan of report.scans)await sql`INSERT INTO scan_result(file_object_id,scanner,status,report) VALUES(${f.id},${scan.scanner},${scan.status},${JSON.stringify(scan.report)}::jsonb) ON CONFLICT(file_object_id,scanner) DO UPDATE SET status=EXCLUDED.status,report=EXCLUDED.report`;
       const originalKey=`originals/${v.item_id}/${versionId}/${f.id}/${randomUUID()}`;
       // Copy precisely the bytes that were scanned, never a subsequently overwritten quarantine key.
       const saved=await new Upload({client:this.storage,params:{Bucket:this.env.S3_ORIGINALS_BUCKET,Key:originalKey,Body:createReadStream(source),ContentType:report.detectedMime,ContentLength:bytes,Metadata:{sha256:f.sha256},...(this.env.S3_ENDPOINT?{}:{ServerSideEncryption:'aws:kms'})},queueSize:2,partSize:16*1024*1024,leavePartsOnError:false}).done();
       const previews:(ProcessorReport["previews"][number]&{id:string;key:string})[]=[];
       for(const preview of report.previews){
         if(!/^[a-zA-Z0-9_-]+\.(webp|png|mp3)$/.test(preview.filename)||!['image/webp','image/png','audio/mpeg'].includes(preview.mime))throw new RejectedFile('Invalid generated preview');
         const filename=path.join(output,preview.filename),info=await stat(filename);if(!info.isFile()||info.size>20*1024*1024||info.size!==preview.bytes||await hash(filename)!==preview.sha256)throw new RejectedFile('Generated preview checksum or size mismatch');
         // Generated preview paths and MIME types are allowlisted; originals and HTML/SVG/PDF are never copied to public storage.
         const previewId=randomUUID(),key=`previews/${v.item_id}/${versionId}/${previewId}.${preview.filename.split('.').pop()}`;
         await this.storage.send(new PutObjectCommand({Bucket:this.env.S3_PREVIEWS_BUCKET,Key:key,Body:createReadStream(filename),ContentLength:info.size,ContentType:preview.mime,CacheControl:'public, max-age=31536000, immutable',ChecksumSHA256:Buffer.from(preview.sha256,'hex').toString('base64')}));
         previews.push({...preview,id:previewId,key});
       }
       await sql.begin(async tx=>{
         const [state]=await tx`SELECT state FROM file_object WHERE id=${f.id} FOR UPDATE`;if(state?.state==='READY')return;
         for(const p of previews)await tx`INSERT INTO file_object(id,item_version_id,role,state,bucket,object_key,original_filename,declared_mime_type,detected_mime_type,byte_size,sha256,metadata,scan_result)
           VALUES(${p.id},${versionId},'PREVIEW','READY',${this.env.S3_PREVIEWS_BUCKET},${p.key},${p.filename},${p.mime},${p.mime},${String(p.bytes)},${p.sha256},'{"generated":true}'::jsonb,'{"generatedFromScannedSource":true}'::jsonb)`;
         await tx`UPDATE file_object SET bucket=${this.env.S3_ORIGINALS_BUCKET},object_key=${originalKey},storage_version_id=${saved.VersionId??null},detected_mime_type=${report.detectedMime},state='READY',
           metadata=metadata||${JSON.stringify({technical:report.technical,archive:report.archive,previewStatus:report.previewStatus,codeScannersComplete:report.codeScannersComplete})}::jsonb,
           scan_result=${JSON.stringify({antivirus:antivirusStatus,processed:true,codeScannersComplete:report.codeScannersComplete})}::jsonb,updated_at=now() WHERE id=${f.id}`;
       });
     }catch(error){
       if(error instanceof RejectedFile){
         await sql.begin(async tx=>{
           await tx`UPDATE file_object SET state=${error.message==='MALWARE_DETECTED'?'INFECTED':'REJECTED'},scan_result=${JSON.stringify({rejected:true,reason:error.message.slice(0,500)})}::jsonb,updated_at=now() WHERE id=${f.id} AND state<>'READY'`;
           await tx`UPDATE item_version SET status='CHANGES_REQUESTED',updated_at=now() WHERE id=${versionId}`;
           await tx`INSERT INTO moderation_case(item_version_id,status,risk_signals) VALUES(${versionId},'CHANGES_REQUESTED',${JSON.stringify({securityRejection:error.message.slice(0,500)})}::jsonb) ON CONFLICT DO NOTHING`;
           await audit(tx,null,'FILE_SECURITY_REJECTION','file_object',f.id,null,{state:'REJECTED'},error.message.slice(0,500));
           await enqueue(tx,'MODERATION_DECIDED','item',v.item_id,{itemId:v.item_id,sellerId:v.seller_organisation_id,decision:'REQUEST_CHANGES',reason:'A file failed security processing. Create a new version to correct it.'},`file-rejected:${f.id}`);
         });return;
       }
       throw error;
     }finally{await rm(root,{recursive:true,force:true});}
   }
   await sql.begin(async tx=>{
     const [version]=await tx`SELECT status FROM item_version WHERE id=${versionId} FOR UPDATE`;if(!['SCANNING','PROCESSING'].includes(version?.status))return;
     const [bad]=await tx`SELECT count(*)::int AS n FROM file_object WHERE item_version_id=${versionId} AND state<>'READY'`;if(bad!.n)throw new Error('Not every file completed processing');
     await tx`UPDATE item_version SET status='AWAITING_REVIEW',updated_at=now() WHERE id=${versionId}`;
     await tx`UPDATE catalog_item SET status='AWAITING_REVIEW',updated_at=now() WHERE id=${v.item_id} AND status IN('SCANNING','PROCESSING')`;
     await tx`INSERT INTO moderation_case(item_version_id,risk_signals) VALUES(${versionId},${JSON.stringify({manualReviewRequired:true,developmentBypass:this.worker.ALLOW_UNSCANNED_DEV_FIXTURES==='true'})}::jsonb) ON CONFLICT DO NOTHING`;
     await enqueue(tx,'MODERATION_DECIDED','item',v.item_id,{itemId:v.item_id,sellerId:v.seller_organisation_id,decision:'AWAITING_REVIEW',reason:'Processing completed. A reviewer must approve publication.'},`awaiting-review:${versionId}`);
   });
 }
 private async run(source:string,output:string,assetType:string,mime:string){
   const runner=fileURLToPath(new URL('../../../processors/safe-runner.mjs',import.meta.url));
   // dist/ and src/ are both three levels below the repository root.
   const env={PATH:process.env.PATH??'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',TMPDIR:'/tmp',LANG:'C.UTF-8',CODE_SCANNERS:this.worker.CODE_SCANNERS,REQUIRE_CODE_SCANNERS:String(this.env.NODE_ENV==='production'),ENABLE_AUDIO_PROCESSOR:this.worker.ENABLE_AUDIO_PROCESSOR,ENABLE_DOCUMENT_PROCESSOR:this.worker.ENABLE_DOCUMENT_PROCESSOR};
   const container=this.worker.PROCESSOR_MODE==='container';
   const containerName='cc-processor-'+randomUUID();
   if(container){await chmod(source,0o444);await chmod(output,0o777);}
   const args=container?['run','--name',containerName,'--rm','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--memory=2g','--cpus=1','--user=1000:1000','--tmpfs=/tmp:rw,noexec,nosuid,size=512m',
     '--mount',`type=bind,source=${source},target=/input/payload,readonly`,'--mount',`type=bind,source=${output},target=/output`,
     ...Object.entries(env).filter(([k])=>['CODE_SCANNERS','REQUIRE_CODE_SCANNERS','ENABLE_AUDIO_PROCESSOR','ENABLE_DOCUMENT_PROCESSOR'].includes(k)).flatMap(([k,v])=>['--env',`${k}=${v}`]),this.worker.PROCESSOR_IMAGE,'/input/payload','/output',assetType,mime]:[runner,source,output,assetType,mime];
   return new Promise<void>((resolve,reject)=>{
     const child=spawn(container?'docker':process.execPath,args,{shell:false,env,stdio:['ignore','ignore','pipe'],detached:process.platform!=='win32'});let errorOutput='',settled=false;
     const kill=()=>{if(container){const cleanup=spawn('docker',['rm','-f',containerName],{shell:false,env,stdio:'ignore'});cleanup.on('error',()=>{});}
       try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
     const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
     const timer=setTimeout(()=>{kill();finish(new Error('Processor timed out; upload remains quarantined'));},600000);
     child.stderr.on('data',chunk=>{errorOutput=(errorOutput+chunk.toString()).slice(-3000);});child.on('error',error=>finish(error));
     child.on('close',code=>{if(code===0)finish();else if(code===2||errorOutput.includes('UnsafeArchive')||errorOutput.includes('Actual MIME')||errorOutput.includes('not supported')||errorOutput.includes('not match')||errorOutput.includes('MALWARE')||errorOutput.includes('exited with 2')||errorOutput.includes('exited with 1'))finish(new RejectedFile('File validation failed: '+errorOutput.replace(/\s+/g,' ').slice(-450)));else finish(new Error('Processor unavailable or failed; inspect the isolated execution logs before retrying'));});
   });
 }
}
