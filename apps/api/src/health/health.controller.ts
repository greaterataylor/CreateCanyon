import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { DatabaseConnection } from "@createcanyon/database";
import { sql } from "drizzle-orm";
import { Public } from "../auth/auth.decorators.js";
import { DB_CONNECTION } from "../common/tokens.js";

@Controller("health")
export class HealthController {
  public constructor(@Inject(DB_CONNECTION) private readonly connection: DatabaseConnection) {}

  @Public()
  @Get("live")
  public live() {
    return { status: "ok", service: "createcanyon-api", time: new Date().toISOString() };
  }

  @Public()
  @Get("ready")
  public async ready() {
    try {
      await this.connection.db.execute(sql`select 1`);
      return { status: "ready", database: "ok", time: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ code: "NOT_READY", message: "A required dependency is unavailable" });
    }
  }
}
