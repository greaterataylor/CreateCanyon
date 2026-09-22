import { Module } from "@nestjs/common";
import { SellersController } from "./sellers.controller.js";
import { SellersService } from "./sellers.service.js";

@Module({ controllers: [SellersController], providers: [SellersService], exports: [SellersService] })
export class SellersModule {}
