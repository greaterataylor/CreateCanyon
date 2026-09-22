import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { categories, storefronts, type DatabaseConnection } from "@createcanyon/database";
import { and, asc, eq } from "drizzle-orm";
import type { StorefrontKey } from "@createcanyon/contracts";
import { DB_CONNECTION } from "../common/tokens.js";

@Injectable()
export class StorefrontsService {
  public constructor(@Inject(DB_CONNECTION) private readonly connection: DatabaseConnection) {}

  public async list() {
    return this.connection.db.select().from(storefronts).where(eq(storefronts.enabled, true)).orderBy(asc(storefronts.name));
  }

  public async get(key: StorefrontKey) {
    const [storefront] = await this.connection.db.select().from(storefronts).where(and(eq(storefronts.key, key), eq(storefronts.enabled, true))).limit(1);
    if (!storefront) throw new NotFoundException({ code: "STOREFRONT_NOT_FOUND", message: "Storefront was not found" });
    const categoryRows = await this.connection.db.select().from(categories).where(and(eq(categories.storefrontId, storefront.id), eq(categories.enabled, true))).orderBy(asc(categories.sortOrder), asc(categories.name));
    return { ...storefront, categories: categoryRows };
  }
}
