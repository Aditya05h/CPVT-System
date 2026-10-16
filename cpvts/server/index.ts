import "dotenv/config";
import express from "express";
import { resolve } from "node:path";
import { createApp } from "./app";
import { localDatabase, supabaseDatabase } from "./database";
import { postgresDatabase } from "./postgres";
const mode = process.env.DATABASE_MODE ?? "local";
if (!["local", "supabase"].includes(mode))
  throw new Error("DATABASE_MODE must be local or supabase");
const database =
  mode === "supabase"
    ? process.env.DATABASE_URL
      ? await postgresDatabase()
      : supabaseDatabase()
    : await localDatabase(process.env.LOCAL_DATA_DIR ?? "./data/parking");
const app = createApp(database);
if (process.argv.includes("--production")) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(`CPVTS ready: http://${host}:${port} · ${mode} database`),
);
async function shutdown() {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await database.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
