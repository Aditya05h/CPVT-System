import { Pool, type PoolConfig } from "pg";
import { readFile } from "node:fs/promises";
import type { Database } from "./database";

const allowedFunctions = new Set([
  "cpvts_check_in",
  "cpvts_check_out",
  "cpvts_snapshot",
  "cpvts_find_vehicle",
  "cpvts_reserve_slot",
  "cpvts_release_slot",
]);

export function rpcQuery(name: string, params: Record<string, unknown> = {}) {
  if (
    !allowedFunctions.has(name) ||
    Object.keys(params).some((k) => !/^p_[a-z_]+$/.test(k))
  )
    throw new Error("Invalid database operation");
  const entries = Object.entries(params);
  return {
    text: `SELECT public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(",")}) AS data`,
    values: entries.map(([, value]) => value),
  };
}

export async function postgresConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PoolConfig> {
  if (!env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_NOT_CONFIGURED");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password
  )
    throw new Error("DATABASE_NOT_CONFIGURED");
  // Parse fields explicitly: URI sslmode parameters must never override verified TLS.
  const ca = await readFile(
    env.DATABASE_CA_CERT ||
      new URL("../certs/supabase-ca.crt", import.meta.url),
    "utf8",
  );
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1) || "postgres"),
    ssl: { ca, rejectUnauthorized: true },
    application_name: "cpvts-api",
    max: 4,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
  };
}

export async function postgresDatabase(): Promise<Database> {
  const pool = new Pool(await postgresConfig());
  // Idle connection loss must not crash the server or expose credentials.
  pool.on("error", () =>
    console.error("CPVTS database connection interrupted."),
  );
  return {
    mode: "supabase",
    async rpc<T>(
      name: string,
      params: Record<string, unknown> = {},
    ): Promise<T> {
      const query = rpcQuery(name, params);
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query("BEGIN");
        // Use the same database role as the existing server-only Data API adapter.
        // SET LOCAL is reset by COMMIT / ROLLBACK before this connection is reused.
        await client.query("SET LOCAL ROLE service_role");
        const result = await client.query<{ data: T }>(query);
        await client.query("COMMIT");
        return result.rows[0].data;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          broken = true;
        }
        throw error;
      } finally {
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
