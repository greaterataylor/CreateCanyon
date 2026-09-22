import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentPrincipal, Public } from "../auth/auth.decorators.js";
import type { Principal } from "../auth/auth.types.js";
import { CommunityService } from "./community.service.js";
const uuid=(value:string)=>z.string().uuid().parse(value);
@Controller()
export class CommunityController {
  constructor(private readonly service:CommunityService){}
  @Get("me") me(@CurrentPrincipal() p:Principal){return this.service.profile(p);}
  @Get("library") library(@CurrentPrincipal() p:Principal){return this.service.library(p);}
  @Post("library/:id/download/:fileId") download(@CurrentPrincipal() p:Principal,@Param("id") id:string,@Param("fileId") fileId:string){return this.service.download(p,uuid(id),uuid(fileId));}
  @Get("library/:id/license") license(@CurrentPrincipal() p:Principal,@Param("id") id:string){return this.service.certificate(p,uuid(id));}
  @Get("orders") orders(@CurrentPrincipal() p:Principal){return this.service.orders(p);}
  @Get("orders/:id") order(@CurrentPrincipal() p:Principal,@Param("id") id:string){return this.service.orders(p,uuid(id));}
  @Post("reviews") review(@CurrentPrincipal() p:Principal,@Body() body:unknown){return this.service.review(p,z.object({orderLineId:z.string().uuid(),rating:z.number().int().min(1).max(5),title:z.string().trim().min(3).max(120),body:z.string().trim().min(10).max(5000)}).strict().parse(body));}
  @Get("support") support(@CurrentPrincipal() p:Principal){return this.service.support(p);}
  @Post("support") create(@CurrentPrincipal() p:Principal,@Body() body:unknown){return this.service.createSupport(p,z.object({subject:z.string().trim().min(5).max(200),body:z.string().trim().min(10).max(10000),orderLineId:z.string().uuid().optional()}).strict().parse(body));}
  @Get("support/:id") conversation(@CurrentPrincipal() p:Principal,@Param("id") id:string){return this.service.conversation(p,uuid(id));}
  @Post("support/:id/messages") message(@CurrentPrincipal() p:Principal,@Param("id") id:string,@Body() body:unknown){return this.service.message(p,uuid(id),z.object({body:z.string().trim().min(1).max(10000)}).strict().parse(body).body);}
  @Get("notifications") notifications(@CurrentPrincipal() p:Principal){return this.service.notifications(p);}
  @Post("notifications/:id/read") read(@CurrentPrincipal() p:Principal,@Param("id") id:string){return this.service.readNotification(p,uuid(id));}
  @Get("wishlist") wishlist(@CurrentPrincipal() p:Principal){return this.service.wishlist(p);}
  @Post("wishlist/:id") wish(@CurrentPrincipal() p:Principal,@Param("id") id:string){return this.service.wishlist(p,uuid(id));}
  @Delete("wishlist/:id") unwish(@CurrentPrincipal() p:Principal,@Param("id") id:string){return this.service.wishlist(p,uuid(id),true);}
  @Public() @Post("copyright-reports") report(@Body() body:unknown){return this.service.copyright(z.object({itemId:z.string().uuid(),claimantName:z.string().trim().min(2).max(120),claimantEmail:z.string().email().max(320),allegation:z.string().trim().min(30).max(10000),evidenceUrl:z.string().url().startsWith("https://").max(2000).optional(),goodFaith:z.literal(true)}).strict().parse(body));}
}
