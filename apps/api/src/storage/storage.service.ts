import type {ApiEnvironment} from "@createcanyon/config";
import {AbortMultipartUploadCommand,CompleteMultipartUploadCommand,CreateMultipartUploadCommand,GetObjectCommand,HeadObjectCommand,ListPartsCommand,PutObjectCommand,S3Client,UploadPartCommand} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {Inject,Injectable} from "@nestjs/common";
import {API_ENV} from "../common/tokens.js";
@Injectable()
export class StorageService {
 readonly client:S3Client;
 constructor(@Inject(API_ENV) public readonly environment:ApiEnvironment){this.client=new S3Client({region:environment.S3_REGION,...(environment.S3_ENDPOINT?{endpoint:environment.S3_ENDPOINT}:{}),forcePathStyle:environment.S3_FORCE_PATH_STYLE,
   ...(environment.S3_ACCESS_KEY_ID&&environment.S3_SECRET_ACCESS_KEY?{credentials:{accessKeyId:environment.S3_ACCESS_KEY_ID,secretAccessKey:environment.S3_SECRET_ACCESS_KEY}}:{})});}
 private get bucket(){return this.environment.S3_QUARANTINE_BUCKET;}
 async createUploadUrl(input:{key:string;contentType:string;byteSize:number;sha256Hex:string}){
   const checksum=Buffer.from(input.sha256Hex,"hex").toString("base64");
   const command=new PutObjectCommand({Bucket:this.bucket,Key:input.key,ContentType:input.contentType,ContentLength:input.byteSize,ChecksumSHA256:checksum,Metadata:{declaredsha256:input.sha256Hex},...(this.environment.S3_ENDPOINT?{}:{ServerSideEncryption:"aws:kms" as const})});
   return {url:await getSignedUrl(this.client,command,{expiresIn:this.environment.UPLOAD_URL_TTL_SECONDS}),headers:{"content-type":input.contentType,"x-amz-checksum-sha256":checksum,"x-amz-meta-declaredsha256":input.sha256Hex},expiresInSeconds:this.environment.UPLOAD_URL_TTL_SECONDS};
 }
 async beginMultipart(key:string,contentType:string,sha256:string){const result=await this.client.send(new CreateMultipartUploadCommand({Bucket:this.bucket,Key:key,ContentType:contentType,Metadata:{declaredsha256:sha256},...(this.environment.S3_ENDPOINT?{}:{ServerSideEncryption:"aws:kms" as const})}));if(!result.UploadId)throw new Error("Storage did not create a multipart upload");return result.UploadId;}
 async signPart(key:string,uploadId:string,number:number){return getSignedUrl(this.client,new UploadPartCommand({Bucket:this.bucket,Key:key,UploadId:uploadId,PartNumber:number}),{expiresIn:this.environment.UPLOAD_URL_TTL_SECONDS});}
 async listParts(key:string,uploadId:string){
   const parts:{partNumber:number;etag:string;size:number}[]=[];let marker:string|undefined;
   do{const result=await this.client.send(new ListPartsCommand({Bucket:this.bucket,Key:key,UploadId:uploadId,...(marker?{PartNumberMarker:marker}:{})}));
     for(const p of result.Parts??[])if(p.PartNumber&&p.ETag&&p.Size!==undefined)parts.push({partNumber:p.PartNumber,etag:p.ETag,size:p.Size});
     marker=result.IsTruncated?result.NextPartNumberMarker:undefined;
   }while(marker);return parts;
 }
 async completeMultipart(key:string,uploadId:string,parts:{partNumber:number;etag:string}[]){return this.client.send(new CompleteMultipartUploadCommand({Bucket:this.bucket,Key:key,UploadId:uploadId,MultipartUpload:{Parts:parts.map(p=>({PartNumber:p.partNumber,ETag:p.etag}))}}));}
 async abortMultipart(key:string,uploadId:string){await this.client.send(new AbortMultipartUploadCommand({Bucket:this.bucket,Key:key,UploadId:uploadId}));}
 async headQuarantined(key:string){return this.client.send(new HeadObjectCommand({Bucket:this.bucket,Key:key}));}
 async createDownloadUrl(input:{bucket:string;key:string;filename:string;versionId?:string}){
   const safe=input.filename.replace(/[\"\\\r\n\x00-\x1f]/g,"_").slice(0,180),ascii=safe.replace(/[^\x20-\x7e]/g,"_");
   return getSignedUrl(this.client,new GetObjectCommand({Bucket:input.bucket,Key:input.key,...(input.versionId?{VersionId:input.versionId}:{}),ResponseContentDisposition:`attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`,ResponseCacheControl:"private, no-store"}),{expiresIn:this.environment.DOWNLOAD_URL_TTL_SECONDS});
 }
}
