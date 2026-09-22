import { Module } from "@nestjs/common";
import { AdministrationController } from "./administration.controller.js";
import { AdministrationService } from "./administration.service.js";
@Module({controllers:[AdministrationController],providers:[AdministrationService]})
export class AdministrationModule {}
