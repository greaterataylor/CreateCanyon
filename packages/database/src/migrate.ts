import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabaseConnection } from "./index.js";
const migrationUrl=process.env.MIGRATION_DATABASE_URL??process.env.DATABASE_URL;
if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");
const connection = createDatabaseConnection(migrationUrl, { max: 1, applicationName: "createcanyon-migrate" });
try {
  const reserved = await connection.client.reserve();
  try {
    await reserved`SELECT pg_advisory_lock(728041933)`;
    await reserved`CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
    const dir = new URL("../migrations/", import.meta.url);
    const names = (await readdir(dir)).filter(n => /^\d+.*\.sql$/.test(n)).sort();
    if (!names.length) throw new Error("No SQL migrations found");
    for (const name of names) {
      const source = await readFile(new URL(name, dir), "utf8");
      const hash = createHash("sha256").update(source).digest("hex");
      const [applied] = await reserved`SELECT sha256 FROM schema_migration WHERE name=${name}`;
      if (applied) { if (applied.sha256 !== hash) throw new Error(`Applied migration changed: ${name}`); continue; }
      await reserved`BEGIN`;
      try { await reserved.unsafe(source); await reserved`INSERT INTO schema_migration (name,sha256) VALUES (${name},${hash})`; await reserved`COMMIT`; }
      catch (error) { await reserved`ROLLBACK`; throw error; }
      console.log(`Applied ${name}`);
    }
  } finally { await reserved`SELECT pg_advisory_unlock(728041933)`; reserved.release(); }
} finally { await connection.close(); }
