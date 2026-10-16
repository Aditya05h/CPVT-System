import { test } from "node:test";
import assert from "node:assert/strict";
import { postgresConfig, rpcQuery } from "../server/postgres";

test("hosted config decodes credentials, bounds connection count and always verifies TLS", async () => {
  const config = await postgresConfig({
    DATABASE_URL:
      "postgresql://postgres.example:test%40password@pooler.example.com:5432/postgres?sslmode=disable",
  });
  assert.equal(config.user, "postgres.example");
  assert.equal(config.password, "test@password");
  assert.equal(config.max, 4);
  assert.equal(config.connectionTimeoutMillis, 10000);
  assert.equal(typeof config.ssl, "object");
  assert.equal(
    (config.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized,
    true,
  );
  assert.match((config.ssl as { ca: string }).ca, /BEGIN CERTIFICATE/);
});

test("missing, malformed and non-PostgreSQL database URLs are rejected", async () => {
  for (const value of [
    undefined,
    "invalid",
    "https://user:pass@example.com/db",
    "postgresql://example.com/db",
  ])
    await assert.rejects(
      postgresConfig({ DATABASE_URL: value }),
      /DATABASE_NOT_CONFIGURED/,
    );
});

test("RPC arguments remain parameters and SQL identifiers cannot be supplied by clients", () => {
  const malicious = "'); DELETE FROM public.cpvts_records; --";
  const query = rpcQuery("cpvts_find_vehicle", { p_vehicle_number: malicious });
  assert.ok(!query.text.includes(malicious));
  assert.deepEqual(query.values, [malicious]);
  assert.throws(
    () => rpcQuery("cpvts_snapshot(); DROP TABLE public.cpvts_records"),
    /Invalid database operation/,
  );
  assert.throws(
    () => rpcQuery("cpvts_snapshot", { "p_date); --": "2026-10-09" }),
    /Invalid database operation/,
  );
});
