import { z } from "zod";
import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { sellerCreateSchema } from "@createcanyon/contracts";
import { CurrentPrincipal, RequireMfa, Public } from "../auth/auth.decorators.js";
import type { Principal } from "../auth/auth.types.js";
import { parseWith } from "../common/zod.js";
import { SellersService } from "./sellers.service.js";

@Controller("sellers")
export class SellersController {
  public constructor(private readonly sellers: SellersService) {}

  @Public() @Get("terms/current")
  terms(){return this.sellers.terms();}
  @Post(":id/terms/accept")
  accept(@CurrentPrincipal() p:Principal,@Param("id") id:string,@Body() body:unknown){const b=z.object({termsId:z.string().uuid(),contentHash:z.string().regex(/^[a-f0-9]{64}$/)}).parse(body);return this.sellers.acceptTerms(p,z.string().uuid().parse(id),b.termsId,b.contentHash);}
  @Get(":id/earnings")
  earnings(@CurrentPrincipal() p:Principal,@Param("id") id:string){return this.sellers.earnings(p,z.string().uuid().parse(id));}
  @Get("mine")
  public mine(@CurrentPrincipal() principal: Principal) { return this.sellers.mine(principal); }

  @Post()
  public create(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.sellers.create(principal, parseWith(sellerCreateSchema, body));
  }

  @RequireMfa() @Post(":id/payout-onboarding-link")
  link(@CurrentPrincipal() p:Principal,@Param("id") id:string,@Body() body:unknown){return this.sellers.onboardingLink(p,z.string().uuid().parse(id),z.object({returnUrl:z.string().url().max(2000)}).strict().parse(body).returnUrl);}
  @RequireMfa()
  @Post(":id/payout-onboarding-session")
  public onboarding(@CurrentPrincipal() principal: Principal, @Param("id") id: string) {
    return this.sellers.onboardingSession(principal, id);
  }
}
