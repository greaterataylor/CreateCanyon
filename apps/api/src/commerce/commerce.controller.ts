import { Body, Controller, Delete, Get, Headers, Param, Post, Query, RawBodyRequest, Req } from "@nestjs/common";
import { addCartLineSchema, checkoutSchema } from "@createcanyon/contracts";
import type { FastifyRequest } from "fastify";
import { CurrentPrincipal, Public } from "../auth/auth.decorators.js";
import type { Principal } from "../auth/auth.types.js";
import { parseWith } from "../common/zod.js";
import { CommerceService } from "./commerce.service.js";

@Controller()
export class CommerceController {
  public constructor(private readonly commerce: CommerceService) {}

  @Get("cart")
  public cart(@CurrentPrincipal() principal: Principal, @Query("currency") currency?: string) {
    return this.commerce.getCart(principal, currency);
  }

  @Post("cart/lines")
  public add(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.commerce.addLine(principal, parseWith(addCartLineSchema, body));
  }

  @Delete("cart/lines/:lineId")
  public remove(@CurrentPrincipal() principal: Principal, @Param("lineId") lineId: string) {
    return this.commerce.removeLine(principal, lineId);
  }

  @Post("checkout")
  public checkout(@CurrentPrincipal() principal: Principal, @Headers("idempotency-key") idempotencyKey: string | undefined, @Body() body: unknown) {
    return this.commerce.checkout(principal, parseWith(checkoutSchema, body), idempotencyKey ?? "");
  }

  @Public()
  @Post("webhooks/stripe")
  public webhook(@Req() request: RawBodyRequest<FastifyRequest>, @Headers("stripe-signature") signature?: string) {
    return this.commerce.handleStripeWebhook(request.rawBody ?? Buffer.alloc(0), signature);
  }
}
