import { Module } from "@nestjs/common";
import { CommunityController } from "./community.controller.js";
import { CommunityService } from "./community.service.js";
import { SellersModule } from "../sellers/sellers.module.js";
@Module({imports:[SellersModule],controllers:[CommunityController],providers:[CommunityService],exports:[CommunityService]})
export class CommunityModule {}
