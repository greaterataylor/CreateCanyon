import {Body,Controller,Get,Headers,Param,Post} from "@nestjs/common";
import {z} from "zod";
import {CurrentPrincipal,RequireMfa,RequirePhishingResistantMfa,Roles} from "../auth/auth.decorators.js";
import type {Principal} from "../auth/auth.types.js";
import {AdministrationService} from "./administration.service.js";
const id=(s:string)=>z.string().uuid().parse(s);const reason=z.string().trim().min(10).max(3000);
@Controller("admin") @Roles("admin","content_reviewer","payments_operator","support_agent","trust_safety") @RequireMfa() @RequirePhishingResistantMfa()
export class AdministrationController {
 constructor(private readonly service:AdministrationService){}
 @Get("overview") overview(){return this.service.overview();}
 @Roles("admin","content_reviewer","trust_safety") @Get("moderation") moderation(){return this.service.list("moderation");}
 @Roles("admin","content_reviewer","trust_safety") @Get("moderation/:id") case(@Param("id") value:string){return this.service.moderation(id(value));}
 @Roles("admin","content_reviewer","trust_safety") @Post("moderation/:id/decision") decide(@CurrentPrincipal() p:Principal,@Param("id") value:string,@Body() body:unknown){return this.service.decide(p,id(value),z.object({decision:z.enum(["APPROVE","REQUEST_CHANGES","SUSPEND","REOPEN"]),reason}).strict().parse(body));}
 @Roles("admin","trust_safety","payments_operator") @Get("sellers") sellers(){return this.service.list("sellers");}
 @Roles("admin","trust_safety") @Post("sellers/:id/restrictions") seller(@CurrentPrincipal() p:Principal,@Param("id") value:string,@Body() body:unknown){return this.service.seller(p,id(value),z.object({status:z.enum(["PENDING_VERIFICATION","ACTIVE","RESTRICTED","SUSPENDED","CLOSED"]).optional(),payoutHoldUntil:z.string().datetime().nullable().optional(),reason}).strict().parse(body));}
 @Roles("admin","trust_safety") @Get("copyright") claims(){return this.service.list("copyright");}
 @Roles("admin","trust_safety") @Post("copyright/:id/status") claim(@CurrentPrincipal() p:Principal,@Param("id") value:string,@Body() body:unknown){return this.service.copyright(p,id(value),z.object({status:z.enum(["OPEN","VALIDATING","CONTENT_DISABLED","SELLER_RESPONSE","COUNTER_NOTICE","RESTORED","UPHELD","CLOSED"]),reason}).strict().parse(body));}
 @Roles("admin","payments_operator") @Get("payments") payments(){return this.service.list("payments");}
 @Roles("admin","payments_operator") @Get("refunds") refunds(){return this.service.list("refunds");}
 @Roles("admin","payments_operator") @Get("disputes") disputes(){return this.service.list("disputes");}
 @Roles("admin","payments_operator") @Post("refunds") refund(@CurrentPrincipal() p:Principal,@Headers("idempotency-key") key:string,@Body() body:unknown){return this.service.refund(p,z.object({orderLineId:z.string().uuid(),amountMinor:z.string().regex(/^[1-9][0-9]{0,14}$/),reason}).strict().parse(body),z.string().min(8).max(200).parse(key));}
 @Roles("admin","support_agent") @Get("support") support(){return this.service.list("support");}
 @Roles("admin","support_agent") @Get("support/:id") conversation(@Param("id") value:string){return this.service.support(id(value));}
 @Roles("admin","support_agent") @Post("support/:id/messages") message(@CurrentPrincipal() p:Principal,@Param("id") value:string,@Body() body:unknown){return this.service.supportReply(p,id(value),z.object({body:z.string().trim().min(1).max(10000),internal:z.boolean().default(false),status:z.enum(["OPEN","WAITING_CUSTOMER","WAITING_SELLER","IN_PROGRESS","RESOLVED","CLOSED"])}).strict().parse(body));}
 @Roles("admin","content_reviewer","trust_safety") @Get("reviews") reviews(){return this.service.list("reviews");}
 @Roles("admin","content_reviewer","trust_safety") @Post("reviews/:id/status") review(@CurrentPrincipal() p:Principal,@Param("id") value:string,@Body() body:unknown){const b=z.object({status:z.enum(["PUBLISHED","HIDDEN","REMOVED"]),reason}).strict().parse(body);return this.service.review(p,id(value),b.status,b.reason);}
 @Roles("admin","payments_operator") @Get("ledger") ledger(){return this.service.list("ledger");}
 @Roles("admin") @Get("audit") audit(){return this.service.list("audit");}
 @Roles("admin") @Get("audit/integrity") integrity(){return this.service.auditIntegrity();}
 @Roles("admin") @Get("jobs") jobs(){return this.service.list("jobs");}
 @Roles("admin") @Post("jobs/:id/requeue") requeue(@CurrentPrincipal() p:Principal,@Param("id") value:string,@Body() body:unknown){return this.service.requeue(p,id(value),z.object({reason}).strict().parse(body).reason);}
}
