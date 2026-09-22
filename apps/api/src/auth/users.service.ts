import { Inject, Injectable } from "@nestjs/common";
import { users, type DatabaseConnection } from "@createcanyon/database";
import { eq } from "drizzle-orm";
import { DB_CONNECTION } from "../common/tokens.js";
import type { Principal } from "./auth.types.js";

@Injectable()
export class UsersService {
  public constructor(@Inject(DB_CONNECTION) private readonly connection: DatabaseConnection) {}

  public async resolveUser(principal: Principal) {
    const [existing] = await this.connection.db.select().from(users).where(eq(users.oidcSubject, principal.subject)).limit(1);
    if (existing) {
      if (existing.email !== principal.email || existing.displayName !== principal.displayName) {
        const [updated] = await this.connection.db.update(users).set({
          ...(principal.email ? { email: principal.email } : {}),
          ...(principal.displayName ? { displayName: principal.displayName } : {}),
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(users.id, existing.id)).returning();
        return updated ?? existing;
      }
      return existing;
    }
    const [created] = await this.connection.db.insert(users).values({
      oidcSubject: principal.subject,
      ...(principal.email ? { email: principal.email } : {}),
      ...(principal.displayName ? { displayName: principal.displayName } : {}),
      lastLoginAt: new Date(),
    }).returning();
    if (!created) throw new Error("Unable to create user");
    return created;
  }
}
