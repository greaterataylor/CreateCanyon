import { Module } from "@nestjs/common";
import { EnvironmentModule } from "./common/environment.module.js";
import { DatabaseModule } from "./db/db.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { HealthModule } from "./health/health.module.js";
import { StorefrontsModule } from "./storefronts/storefronts.module.js";
import { SellersModule } from "./sellers/sellers.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { UploadsModule } from "./uploads/uploads.module.js";
import { CommerceModule } from "./commerce/commerce.module.js";
import { CommunityModule } from "./community/community.module.js";
import { AdministrationModule } from "./administration/administration.module.js";
@Module({ imports: [EnvironmentModule, DatabaseModule, AuthModule, AuditModule, HealthModule, StorefrontsModule, SellersModule, CatalogModule, StorageModule, UploadsModule, CommerceModule, CommunityModule, AdministrationModule] })
export class AppModule {}
