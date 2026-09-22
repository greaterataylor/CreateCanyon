import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { createItemSchema, publicCatalogQuerySchema, storefrontKeySchema, updateListingSchema } from "@createcanyon/contracts";
import { CurrentPrincipal, Public } from "../auth/auth.decorators.js";
import type { Principal } from "../auth/auth.types.js";
import { parseWith } from "../common/zod.js";
import { CatalogService } from "./catalog.service.js";

@Controller()
export class CatalogController {
  public constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get("catalog")
  public list(@Query() query: unknown) { return this.catalog.publicList(parseWith(publicCatalogQuerySchema, query)); }

  @Public()
  @Get("catalog/:channel/:slug")
  public get(@Param("channel") channel: string, @Param("slug") slug: string) {
    return this.catalog.publicGet(storefrontKeySchema.parse(channel), slug);
  }

  @Post("seller/items")
  public create(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.catalog.create(principal, parseWith(createItemSchema, body));
  }

  @Get("seller/:sellerId/items")
  public sellerItems(@CurrentPrincipal() principal: Principal, @Param("sellerId") sellerId: string) {
    return this.catalog.sellerItems(principal, sellerId);
  }

  @Patch("seller/listings/:listingId")
  public updateListing(@CurrentPrincipal() principal: Principal, @Param("listingId") listingId: string, @Body() body: unknown) {
    return this.catalog.updateListing(principal, listingId, parseWith(updateListingSchema, body));
  }
}
