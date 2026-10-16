import "dotenv/config";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { postgresConfig } from "./postgres";

const client = new Client({
  ...(await postgresConfig()),
  application_name: "cpvts-migrate",
  statement_timeout: 30_000,
  query_timeout: 35_000,
});
try {
  await client.connect();
  const sql = await readFile(
    new URL("../migrations/001_parking.sql", import.meta.url),
    "utf8",
  );
  await client.query(sql);
  const result = await client.query("SELECT public.cpvts_snapshot() AS data");
  console.log(
    "CPVTS migration applied. Existing parking records were preserved.",
  );
  console.log("Zones:", result.rows[0].data.zones);
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* A connection may not have been established. */
  }
  console.error(
    "Migration failed:",
    (error as { code?: string }).code ?? "DATABASE_UNAVAILABLE",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
