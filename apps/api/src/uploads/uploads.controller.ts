import {Body,Controller,Get,Param,Post} from "@nestjs/common";
import {createUploadSessionSchema,finalizeUploadSchema} from "@createcanyon/contracts";
import {z} from "zod";
import {CurrentPrincipal} from "../auth/auth.decorators.js";
import type {Principal} from "../auth/auth.types.js";
import {UploadsService} from "./uploads.service.js";
const uuid=(v:string)=>z.string().uuid().parse(v);
@Controller("uploads")
export class UploadsController {
 constructor(private readonly service:UploadsService){}
 @Post("sessions") create(@CurrentPrincipal() p:Principal,@Body() body:unknown){return this.service.create(p,createUploadSessionSchema.parse(body));}
 @Get("sessions/:id") session(@CurrentPrincipal() p:Principal,@Param("id") id:string){return this.service.session(p,uuid(id));}
 @Post("sessions/:id/cancel") cancel(@CurrentPrincipal() p:Principal,@Param("id") id:string){return this.service.cancel(p,uuid(id));}
 @Post("sessions/:id/files/:fileId/parts") parts(@CurrentPrincipal() p:Principal,@Param("id") id:string,@Param("fileId") fileId:string,@Body() body:unknown){return this.service.signParts(p,uuid(id),uuid(fileId),z.object({partNumbers:z.array(z.number().int().min(1).max(10000)).min(1).max(100)}).strict().parse(body).partNumbers);}
 @Post("sessions/:id/files/:fileId/complete") complete(@CurrentPrincipal() p:Principal,@Param("id") id:string,@Param("fileId") fileId:string){return this.service.complete(p,uuid(id),uuid(fileId));}
 @Post("sessions/:id/finalize") finalize(@CurrentPrincipal() p:Principal,@Param("id") id:string,@Body() body:unknown){return this.service.finalize(p,uuid(id),finalizeUploadSchema.parse(body).files.map(f=>f.clientFileId));}
}
