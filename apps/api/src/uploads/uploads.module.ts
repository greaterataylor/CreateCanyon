import { Module } from "@nestjs/common";
import { SellersModule } from "../sellers/sellers.module.js";
import { UploadsController } from "./uploads.controller.js";
import { UploadsService } from "./uploads.service.js";

@Module({ imports: [SellersModule], controllers: [UploadsController], providers: [UploadsService] })
export class UploadsModule {}
