import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { ApiEnvironment } from "@createcanyon/config";
import { createDatabaseConnection, type DatabaseConnection } from "@createcanyon/database";
import { API_ENV, DB_CONNECTION } from "../common/tokens.js";

class DatabaseLifecycle implements OnApplicationShutdown {
  public constructor(@Inject(DB_CONNECTION) private readonly connection: DatabaseConnection) {}
  public async onApplicationShutdown(): Promise<void> { await this.connection.close(); }
}

@Global()
@Module({
  providers: [
    { provide: DB_CONNECTION, inject: [API_ENV], useFactory: (environment: ApiEnvironment) => createDatabaseConnection(environment.DATABASE_URL, { applicationName: "createcanyon-api" }) },
    DatabaseLifecycle,
  ],
  exports: [DB_CONNECTION],
})
export class DatabaseModule {}
