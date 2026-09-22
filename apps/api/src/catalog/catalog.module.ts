import { Module } from "@nestjs/common";
import { SellersModule } from "../sellers/sellers.module.js";
import { CatalogController } from "./catalog.controller.js";
import { CatalogService } from "./catalog.service.js";

@Module({ imports: [SellersModule], controllers: [CatalogController], providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
