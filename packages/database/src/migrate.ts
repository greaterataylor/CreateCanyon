import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabaseConnection } from "./index.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const connection = createDatabaseConnection(process.env.DATABASE_URL, { max: 1, applicationName: "createcanyon-migrate" });
try {
  await migrate(connection.db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
  console.log("Database migrations completed");
} finally {
  await connection.close();
}
