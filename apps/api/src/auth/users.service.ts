import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { users, type DatabaseConnection } from "@createcanyon/database";
import { DB_CONNECTION } from "../common/tokens.js";
import type { Principal } from "./auth.types.js";
@Injectable()
export class UsersService {
  constructor(@Inject(DB_CONNECTION) private readonly connection: DatabaseConnection) {}
  async resolveUser(principal: Principal) {
    const [user] = await this.connection.db.insert(users).values({
      oidcSubject: principal.subject, email: principal.email ?? null, displayName: principal.displayName ?? null, lastLoginAt: new Date(),
    }).onConflictDoUpdate({ target: users.oidcSubject, set: {
      ...(principal.email ? {email: principal.email} : {}), ...(principal.displayName ? {displayName: principal.displayName} : {}),
      lastLoginAt: new Date(), updatedAt: new Date(),
    }}).returning();
    if (!user || user.status !== "ACTIVE") throw new ForbiddenException({ code: "ACCOUNT_UNAVAILABLE", message: "This account is not active" });
    return user;
  }
}
