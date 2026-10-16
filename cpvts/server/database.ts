import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export interface Database {
  mode: "local" | "supabase";
  rpc<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}
const functions = new Set([
  "cpvts_check_in",
  "cpvts_check_out",
  "cpvts_snapshot",
  "cpvts_find_vehicle",
  "cpvts_reserve_slot",
  "cpvts_release_slot",
]);
export async function localDatabase(
  path?: string,
): Promise<Database & { db: PGlite }> {
  if (path) await mkdir(resolve(path), { recursive: true });
  const db = new PGlite(path ? resolve(path) : undefined);
  await db.exec(
    await readFile(
      new URL("../migrations/001_parking.sql", import.meta.url),
      "utf8",
    ),
  );
  return {
    mode: "local",
    db,
    async rpc<T>(name: string, params: Record<string, unknown> = {}) {
      if (
        !functions.has(name) ||
        Object.keys(params).some((k) => !/^p_[a-z_]+$/.test(k))
      )
        throw new Error("Invalid database operation");
      const entries = Object.entries(params);
      const result = await db.query<{ data: T }>(
        `SELECT public.${name}(${entries.map(([k], i) => `${k} => $${i + 1}`).join(",")}) AS data`,
        entries.map(([, v]) => v),
      );
      return result.rows[0].data;
    },
    close: () => db.close(),
  };
}
export function supabaseDatabase(): Database {
  const url = process.env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/, "").replace(
    /\/$/,
    "",
  );
  const key = process.env.SUPABASE_SECRET_KEY;
  return {
    mode: "supabase",
    async rpc<T>(name: string, params = {}): Promise<T> {
      if (
        !url ||
        !key ||
        key.startsWith("YOUR_") ||
        key.startsWith("sb_publishable_")
      )
        throw new Error("DATABASE_NOT_CONFIGURED");
      if (!functions.has(name)) throw new Error("Invalid database operation");
      const headers: Record<string, string> = {
        apikey: key,
        "Content-Type": "application/json",
      };
      if (!key.startsWith("sb_secret_"))
        headers.Authorization = `Bearer ${key}`;
      const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(10000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message || "DATABASE_UNAVAILABLE");
      return result as T;
    },
    async close() {},
  };
}
