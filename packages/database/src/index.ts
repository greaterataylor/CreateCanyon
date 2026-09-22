import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema.js";

export interface DatabaseConnection {
  readonly client: Sql;
  readonly db: PostgresJsDatabase<typeof schema>;
  close(): Promise<void>;
}

export function createDatabaseConnection(databaseUrl: string, options: { readonly max?: number; readonly applicationName?: string } = {}): DatabaseConnection {
  const client = postgres(databaseUrl, {
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
    connection: { application_name: options.applicationName ?? "createcanyon" },
  });
  return {
    client,
    db: drizzle(client, { schema }),
    close: async () => client.end({ timeout: 5 }),
  };
}

export * from "./schema.js";
