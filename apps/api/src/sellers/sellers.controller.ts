import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { sellerCreateSchema } from "@createcanyon/contracts";
import { CurrentPrincipal, RequireMfa } from "../auth/auth.decorators.js";
import type { Principal } from "../auth/auth.types.js";
import { parseWith } from "../common/zod.js";
import { SellersService } from "./sellers.service.js";

@Controller("sellers")
export class SellersController {
  public constructor(private readonly sellers: SellersService) {}

  @Get("mine")
  public mine(@CurrentPrincipal() principal: Principal) { return this.sellers.mine(principal); }

  @Post()
  public create(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.sellers.create(principal, parseWith(sellerCreateSchema, body));
  }

  @RequireMfa()
  @Post(":id/payout-onboarding-session")
  public onboarding(@CurrentPrincipal() principal: Principal, @Param("id") id: string) {
    return this.sellers.onboardingSession(principal, id);
  }
}
