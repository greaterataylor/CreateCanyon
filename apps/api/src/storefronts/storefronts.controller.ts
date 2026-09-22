import { Controller, Get, Param } from "@nestjs/common";
import { storefrontKeySchema } from "@createcanyon/contracts";
import { Public } from "../auth/auth.decorators.js";
import { StorefrontsService } from "./storefronts.service.js";

@Controller("storefronts")
export class StorefrontsController {
  public constructor(private readonly storefronts: StorefrontsService) {}

  @Public()
  @Get()
  public list() { return this.storefronts.list(); }

  @Public()
  @Get(":key")
  public get(@Param("key") key: string) { return this.storefronts.get(storefrontKeySchema.parse(key)); }
}
