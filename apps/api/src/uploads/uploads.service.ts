import type {ApiEnvironment} from "@createcanyon/config";
import type {CreateUploadSessionInput} from "@createcanyon/contracts";
import {enqueue,type DatabaseConnection} from "@createcanyon/database";
import {BadRequestException,ConflictException,Inject,Injectable,NotFoundException} from "@nestjs/common";
import type {Principal} from "../auth/auth.types.js";
import {API_ENV,DB_CONNECTION} from "../common/tokens.js";
import {SellersService} from "../sellers/sellers.service.js";
import {StorageService} from "../storage/storage.service.js";
const PART_SIZE=64*1024*1024;
const MIME=new Set(['application/zip','application/x-zip-compressed','application/x-tar','application/gzip','application/x-gzip','image/jpeg','image/png','image/webp','image/avif','application/pdf','audio/mpeg','audio/wav','audio/x-wav','audio/flac','audio/ogg','audio/mp4','font/ttf','font/otf','font/woff','font/woff2','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','text/markdown','text/csv']);
const cleanName=(s:string)=>{const value=s.replaceAll("\\","/").split("/").pop()?.replace(/[\x00-\x1f\x7f]/g,"_").trim();if(!value||value==='.'||value==='..')throw new BadRequestException("Invalid filename");return value.slice(0,255);};
@Injectable()
export class UploadsService {
 constructor(@Inject(DB_CONNECTION) private readonly connection:DatabaseConnection,@Inject(API_ENV) private readonly env:ApiEnvironment,private readonly sellers:SellersService,private readonly storage:StorageService){}
 async create(p:Principal,input:CreateUploadSessionInput){
   const {user}=await this.sellers.assertMembership(p,input.sellerOrganisationId,["OWNER","MANAGER","UPLOADER"]);
   if(new Set(input.files.map(f=>f.clientFileId)).size!==input.files.length||!input.files.some(f=>f.role==='ORIGINAL'))throw new BadRequestException("Declare unique file IDs and at least one original");
   if(input.files.reduce((n,f)=>n+f.byteSize,0)>this.env.MAX_UPLOAD_BYTES)throw new BadRequestException("Upload exceeds the configured byte limit");
   for(const f of input.files){if(!MIME.has(f.contentType)||['PREVIEW','MANIFEST'].includes(f.role))throw new BadRequestException("Unsupported declared MIME type or generated-file role");}
   const id=crypto.randomUUID();
   await this.connection.client.begin(async tx=>{
     const [v]=await tx`SELECT v.* FROM item_version v JOIN catalog_item i ON i.id=v.item_id WHERE v.id=${input.itemVersionId} AND i.seller_organisation_id=${input.sellerOrganisationId} FOR UPDATE OF v`;
     if(!v)throw new NotFoundException("Item version not found");if(v.status!=="DRAFT")throw new ConflictException("Create a new draft version before uploading changed files");
     if((await tx`SELECT 1 FROM upload_session WHERE item_version_id=${input.itemVersionId} AND status IN('UPLOADING','FINALIZED')`).length)throw new ConflictException("Resume or cancel the existing upload session");
     await tx`INSERT INTO upload_session(id,seller_organisation_id,item_version_id,created_by_user_id,status,expires_at) VALUES(${id},${input.sellerOrganisationId},${input.itemVersionId},${user.id},'UPLOADING',now()+interval '24 hours')`;
     for(const f of input.files)await tx`INSERT INTO file_object(item_version_id,upload_session_id,client_file_id,role,bucket,object_key,original_filename,declared_mime_type,byte_size,sha256)
       VALUES(${input.itemVersionId},${id},${f.clientFileId},${f.role},${this.env.S3_QUARANTINE_BUCKET},${`quarantine/${input.sellerOrganisationId}/${input.itemVersionId}/${id}/${f.clientFileId}`},${cleanName(f.filename)},${f.contentType},${String(f.byteSize)},${f.sha256.toLowerCase()})`;
   });return this.session(p,id);
 }
 private async access(p:Principal,id:string,uploading=true){
   const [s]=await this.connection.client`SELECT * FROM upload_session WHERE id=${id}`;if(!s)throw new NotFoundException("Upload session not found");
   await this.sellers.assertMembership(p,s.seller_organisation_id,["OWNER","MANAGER","UPLOADER"]);
   if(uploading&&(s.status!=="UPLOADING"||new Date(s.expires_at)<=new Date()))throw new ConflictException("Upload session is finalized, cancelled, or expired");return s;
 }
 async session(p:Principal,id:string){
   const session=await this.access(p,id,false);const rows=await this.connection.client`SELECT * FROM file_object WHERE upload_session_id=${id} ORDER BY created_at,id`;
   const files=[];
   for(const file of rows){
     const base={id:file.id,clientFileId:file.client_file_id,filename:file.original_filename,byteSize:Number(file.byte_size),sha256:file.sha256,state:file.state};
     if(session.status!=="UPLOADING"||new Date(session.expires_at)<=new Date()){files.push(base);continue;}
     if(Number(file.byte_size)<=PART_SIZE){files.push({...base,mode:"single",...await this.storage.createUploadUrl({key:file.object_key,contentType:file.declared_mime_type,byteSize:Number(file.byte_size),sha256Hex:file.sha256})});continue;}
     const uploadId=await this.connection.client.begin(async tx=>{
       const [f]=await tx`SELECT f.* FROM file_object f JOIN upload_session s ON s.id=f.upload_session_id WHERE f.id=${file.id} AND s.status='UPLOADING' FOR UPDATE OF f`;
       if(!f)throw new ConflictException("Upload session no longer accepts changes");if(f.metadata.multipartId)return f.metadata.multipartId as string;
       const remote=await this.storage.beginMultipart(f.object_key,f.declared_mime_type,f.sha256);
       await tx`UPDATE file_object SET metadata=metadata||${JSON.stringify({multipartId:remote,partSize:PART_SIZE})}::jsonb WHERE id=${f.id}`;return remote;
     });
     let parts:{partNumber:number;etag:string;size:number}[]=[];
     if(!file.metadata.multipartCompleted)parts=await this.storage.listParts(file.object_key,uploadId).catch(async error=>{const head=await this.storage.headQuarantined(file.object_key).catch(()=>null);if(head?.ContentLength===Number(file.byte_size))return [];throw error;});
     files.push({...base,mode:"multipart",partSize:PART_SIZE,partCount:Math.ceil(Number(file.byte_size)/PART_SIZE),parts,completed:!!file.metadata.multipartCompleted});
   }
   return {uploadSessionId:id,status:session.status,expiresAt:session.expires_at,files};
 }
 async signParts(p:Principal,sessionId:string,fileId:string,numbers:number[]){
   await this.access(p,sessionId);const [f]=await this.connection.client`SELECT * FROM file_object WHERE id=${fileId} AND upload_session_id=${sessionId}`;
   if(!f?.metadata.multipartId||f.metadata.multipartCompleted)throw new ConflictException("No active multipart upload for this file");const count=Math.ceil(Number(f.byte_size)/PART_SIZE);
   if(numbers.some(n=>n<1||n>count)||new Set(numbers).size!==numbers.length)throw new BadRequestException("Invalid multipart part numbers");
   return {parts:await Promise.all(numbers.map(async partNumber=>({partNumber,url:await this.storage.signPart(f.object_key,f.metadata.multipartId,partNumber)})))};
 }
 async complete(p:Principal,sessionId:string,fileId:string){
   await this.access(p,sessionId);return this.connection.client.begin(async tx=>{
     const [f]=await tx`SELECT * FROM file_object WHERE id=${fileId} AND upload_session_id=${sessionId} FOR UPDATE`;
     if(!f?.metadata.multipartId)throw new NotFoundException("Multipart upload not found");if(f.metadata.multipartCompleted)return {completed:true};
     const existing=await this.storage.headQuarantined(f.object_key).catch(()=>null);
     if(!existing){const parts=await this.storage.listParts(f.object_key,f.metadata.multipartId);const count=Math.ceil(Number(f.byte_size)/PART_SIZE);
       if(parts.length!==count||parts.some((part,index)=>part.partNumber!==index+1||part.size!==(index===count-1?Number(f.byte_size)-index*PART_SIZE:PART_SIZE)))throw new BadRequestException("Multipart sizes or parts do not match the declared file");
       await this.storage.completeMultipart(f.object_key,f.metadata.multipartId,parts);
     }else if(existing.ContentLength!==Number(f.byte_size))throw new BadRequestException("Completed file size does not match");
     await tx`UPDATE file_object SET metadata=metadata||'{"multipartCompleted":true}'::jsonb WHERE id=${fileId}`;return {completed:true};
   });
 }
 async cancel(p:Principal,id:string){
   await this.access(p,id,false);const files=await this.connection.client`SELECT * FROM file_object WHERE upload_session_id=${id}`;
   for(const f of files)if(f.metadata.multipartId&&!f.metadata.multipartCompleted)await this.storage.abortMultipart(f.object_key,f.metadata.multipartId);
   await this.connection.client.begin(async tx=>{const [s]=await tx`SELECT status FROM upload_session WHERE id=${id} FOR UPDATE`;if(s?.status!=="UPLOADING")throw new ConflictException("Upload no longer cancellable");
     await tx`DELETE FROM file_object WHERE upload_session_id=${id} AND state='PENDING'`;
     await tx`UPDATE upload_session SET status='CANCELLED' WHERE id=${id}`;});return {cancelled:true};
 }
 async finalize(p:Principal,id:string,clientIds:readonly string[]){
   const s=await this.access(p,id,false);if(s.status==='FINALIZED')return {uploadSessionId:id,status:'FINALIZED'};await this.access(p,id);
   return this.connection.client.begin(async tx=>{
     const [session]=await tx`SELECT * FROM upload_session WHERE id=${id} FOR UPDATE`;if(session?.status==='FINALIZED')return {uploadSessionId:id,status:'FINALIZED'};
     if(session?.status!=="UPLOADING")throw new ConflictException("Upload no longer finalizable");
     const files=await tx`SELECT * FROM file_object WHERE upload_session_id=${id} ORDER BY id FOR UPDATE`;
     if(files.length!==clientIds.length||new Set(clientIds).size!==files.length||files.some(f=>!clientIds.includes(f.client_file_id)))throw new BadRequestException("Finalization must contain the exact declared manifest");
     const [version]=await tx`SELECT * FROM item_version WHERE id=${s.item_version_id} FOR UPDATE`;if(version?.status!=="DRAFT")throw new ConflictException("Version already submitted");
     for(const f of files){const head=await this.storage.headQuarantined(f.object_key).catch(()=>null);if(!head||head.ContentLength!==Number(f.byte_size))throw new BadRequestException("An uploaded file is missing or has the wrong size");
       // Pin the immutable quarantine version; the worker re-hashes actual bytes, not user metadata.
       await tx`UPDATE file_object SET state='QUARANTINED',storage_version_id=${head.VersionId??null},etag=${head.ETag??null},updated_at=now() WHERE id=${f.id}`;
     }
     await tx`UPDATE upload_session SET status='FINALIZED',finalized_at=now() WHERE id=${id}`;
     await tx`UPDATE item_version SET status='SCANNING',submitted_at=now(),updated_at=now() WHERE id=${s.item_version_id}`;
     await tx`UPDATE catalog_item SET status='SCANNING',updated_at=now() WHERE id=${version.item_id} AND status IN('DRAFT','UPLOADED','CHANGES_REQUESTED')`;
     await enqueue(tx,"ASSET_PROCESS_REQUESTED","item_version",s.item_version_id,{uploadSessionId:id,itemVersionId:s.item_version_id},`asset-process:${s.item_version_id}`);
     return {uploadSessionId:id,status:"FINALIZED",itemVersionStatus:"SCANNING"};
   });
 }
}
