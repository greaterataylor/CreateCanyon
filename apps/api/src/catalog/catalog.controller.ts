import { z } from "zod";
import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { createItemSchema, publicCatalogQuerySchema, storefrontKeySchema, updateListingSchema } from "@createcanyon/contracts";
import { CurrentPrincipal, Public } from "../auth/auth.decorators.js";
import type { Principal } from "../auth/auth.types.js";
import { parseWith } from "../common/zod.js";
import { CatalogService } from "./catalog.service.js";

@Controller()
export class CatalogController {
  public constructor(private readonly catalog: CatalogService) {}

  @Get("seller/items/:itemId")
  sellerItem(@CurrentPrincipal() p:Principal,@Param("itemId") id:string){return this.catalog.sellerItem(p,z.string().uuid().parse(id));}
  @Patch("seller/offers/:id")
  price(@CurrentPrincipal() p:Principal,@Param("id") id:string,@Body() body:unknown){return this.catalog.updatePrice(p,z.string().uuid().parse(id),z.object({amountMinor:z.number().int().min(0).max(100000000),currency:z.string().regex(/^[A-Z]{3}$/)}).strict().parse(body));}
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
  @Public()
  @Get("seller-profile/:slug")
  public seller(@Param("slug") slug:string,@Query("channel") channel:string){return this.catalog.publicSeller(slug,storefrontKeySchema.parse(channel??"createcanyon"));}
  @Post("seller/items/:itemId/versions")
  public version(@CurrentPrincipal() principal:Principal,@Param("itemId") id:string,@Body() body:unknown){
    return this.catalog.createVersion(principal,z.string().uuid().parse(id),parseWith(z.object({versionLabel:z.string().min(1).max(64),changelog:z.string().min(5).max(10000),metadata:z.record(z.string(),z.unknown()).default({})}),body));
  }
  @Get("seller/items/:itemId/versions")
  public versions(@CurrentPrincipal() principal:Principal,@Param("itemId") id:string){return this.catalog.versions(principal,z.string().uuid().parse(id));}
}
