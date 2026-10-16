import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { createApp } from "./app";
import { postgresConfig, postgresDatabase, rpcQuery } from "./postgres";
import type { Database } from "./database";
import type { Snapshot, ParkingRecord } from "../src/types";

// Explicit opt-in command; never run automatically at application startup.
// All verification writes live in transactions that are rolled back.
const config = await postgresConfig();
const database = await postgresDatabase();
const client = new Client(config),
  waitingClient = new Client(config),
  observer = new Client(config);
const marker = "QA" + randomBytes(6).toString("hex").toUpperCase();
let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
const checks: string[] = [];
try {
  await Promise.all([
    client.connect(),
    waitingClient.connect(),
    observer.connect(),
  ]);
  const baseline = await database.rpc<Snapshot>("cpvts_snapshot");
  assert.equal(baseline.slots.length, 15);
  checks.push(
    "Pooled adapter reads all 15 hosted parking spaces over verified TLS",
  );

  const permissions = await observer.query(
    "SELECT relname, relrowsecurity FROM pg_class WHERE oid IN ('public.cpvts_slots'::regclass,'public.cpvts_records'::regclass)",
  );
  assert.ok(permissions.rows.every((r) => r.relrowsecurity));
  const access = await observer.query(
    "SELECT has_table_privilege('anon','public.cpvts_records','SELECT') AS anonymous_read, has_function_privilege('anon','public.cpvts_check_in(text,text,text,integer)','EXECUTE') AS anonymous_write",
  );
  assert.deepEqual(access.rows[0], {
    anonymous_read: false,
    anonymous_write: false,
  });
  checks.push("RLS enabled; anonymous reads and parking RPC execution denied");

  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE service_role");
  assert.equal(
    (await client.query("SELECT current_user AS role")).rows[0].role,
    "service_role",
  );
  const rollbackDatabase: Database = {
    mode: "supabase",
    async rpc<T>(
      name: string,
      params: Record<string, unknown> = {},
    ): Promise<T> {
      await client.query("SAVEPOINT cpvts_verify");
      try {
        const result = await client.query<{ data: T }>(rpcQuery(name, params));
        await client.query("RELEASE SAVEPOINT cpvts_verify");
        return result.rows[0].data;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT cpvts_verify");
        await client.query("RELEASE SAVEPOINT cpvts_verify");
        throw error;
      }
    },
    async close() {},
  };
  server = createApp(rollbackDatabase).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  async function request(path: string, body?: unknown) {
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, ...(await response.json()) };
  }
  assert.deepEqual((await request("/health")).data, {
    status: "ready",
    mode: "supabase",
  });
  for (const [owner, type, expected] of [
    ["Staff", "two_wheeler", 0],
    ["Staff", "four_wheeler", 0],
    ["Student", "two_wheeler", 20],
    ["Student", "four_wheeler", 40],
    ["Visitor", "two_wheeler", 80],
    ["Visitor", "four_wheeler", 160],
  ] as const) {
    const entry = await request("/check-ins", {
      vehicleNumber: marker,
      vehicleType: type,
      ownerCategory: owner,
      entryHour: 9,
    });
    assert.equal(entry.status, 201);
    const duplicate = await request("/check-ins", {
      vehicleNumber: marker,
      vehicleType: type,
      ownerCategory: owner,
      entryHour: 9,
    });
    assert.equal(duplicate.error.code, "DUPLICATE_VEHICLE");
    const early = await request("/check-outs", {
      vehicleNumber: marker,
      exitHour: 8,
    });
    assert.equal(early.error.code, "EXIT_BEFORE_ENTRY");
    assert.equal(
      (await request(`/vehicles/${marker}`)).data.slotId,
      entry.data.slotId,
    );
    const receipt = await request("/check-outs", {
      slotId: entry.data.slotId,
      exitHour: 13,
    });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.data.fee, expected);
    assert.equal(receipt.data.duration, 4);
    assert.equal((await request(`/vehicles/${marker}`)).status, 404);
  }
  await client.query("ROLLBACK");
  checks.push(
    "Hosted HTTP check-in, duplicate rejection, exit validation, finder, checkout and all six fee combinations",
  );

  // Confirm actual hosted lock contention across two independent sessions.
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE service_role");
  await waitingClient.query("BEGIN");
  await waitingClient.query("SET LOCAL ROLE service_role");
  const pid = (await waitingClient.query("SELECT pg_backend_pid() AS pid"))
    .rows[0].pid;
  const first = await client.query<{ data: ParkingRecord }>(
    rpcQuery("cpvts_check_in", {
      p_vehicle_number: marker,
      p_vehicle_type: "two_wheeler",
      p_owner_category: "Staff",
      p_entry_hour: 9,
    }),
  );
  const secondPromise = waitingClient.query<{ data: ParkingRecord }>(
    rpcQuery("cpvts_check_in", {
      p_vehicle_number: marker + "B",
      p_vehicle_type: "two_wheeler",
      p_owner_category: "Staff",
      p_entry_hour: 9,
    }),
  );
  // Attach rejection handling immediately while the lock check is pending.
  void secondPromise.catch(() => {});
  let blocked = false;
  for (let i = 0; i < 30; i++) {
    const lock = await observer.query(
      "SELECT count(*)::int AS count FROM pg_locks WHERE pid=$1 AND NOT granted AND relation='public.cpvts_slots'::regclass",
      [pid],
    );
    if (lock.rows[0].count > 0) {
      blocked = true;
      break;
    }
    await delay(50);
  }
  assert.ok(
    blocked,
    "Second hosted session must wait for the slot allocation lock",
  );
  await client.query("ROLLBACK");
  const second = await secondPromise;
  assert.equal(second.rows[0].data.slotId, first.rows[0].data.slotId);
  await waitingClient.query("ROLLBACK");
  const remaining = await observer.query(
    "SELECT count(*)::int AS count FROM public.cpvts_records WHERE vehicle_number = ANY($1::text[])",
    [[marker, marker + "B"]],
  );
  assert.equal(remaining.rows[0].count, 0);
  checks.push(
    "Concurrent hosted allocations serialize correctly; every verification record rolled back",
  );
  const current = await database.rpc<Snapshot>("cpvts_snapshot");
  console.log(
    JSON.stringify(
      {
        status: "passed",
        checks,
        zones: current.zones,
        verificationRecordsRemaining: 0,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    "Hosted verification failed:",
    error instanceof assert.AssertionError
      ? error.message
      : ((error as { code?: string }).code ?? "DATABASE_UNAVAILABLE"),
  );
  process.exitCode = 1;
} finally {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  await Promise.allSettled([
    client.query("ROLLBACK"),
    waitingClient.query("ROLLBACK"),
  ]);
  await Promise.allSettled([
    client.end(),
    waitingClient.end(),
    observer.end(),
    database.close(),
  ]);
}
