import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { once } from "node:events";
import { localDatabase } from "../server/database";
import { createApp } from "../server/app";
import type { ParkingRecord, Snapshot } from "../src/types";
let db: Awaited<ReturnType<typeof localDatabase>>;
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let base: string;
before(async () => {
  db = await localDatabase();
  server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.close();
});
beforeEach(async () => {
  await db.db.exec("TRUNCATE public.cpvts_records");
  await db.db.exec("TRUNCATE public.cpvts_reservations");
});
async function request(path: string, body?: unknown) {
  const res = await fetch(base + "/api/v1" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json()) };
}
const entry = (
  number = "KA22AB1234",
  type = "two_wheeler",
  owner = "Student",
  hour = 9,
) =>
  request("/check-ins", {
    vehicleNumber: number,
    vehicleType: type,
    ownerCategory: owner,
    entryHour: hour,
  });
test("initialization creates exactly 10 two-wheeler and 5 four-wheeler available slots", async () => {
  const { data } = await request("/dashboard");
  assert.equal(data.slots.length, 15);
  assert.deepEqual(data.zones, [
    { vehicleType: 'two_wheeler', total: 10, occupied: 0, vacant: 10 },
    { vehicleType: 'four_wheeler', total: 5, occupied: 0, vacant: 5 },
  ]);
  assert.equal(
    data.slots.filter(
      (s: { vehicleType: string }) => s.vehicleType === "two_wheeler",
    ).length,
    10,
  );
  assert.ok(
    data.slots.every((s: { status: string }) => s.status === "Available"),
  );
});
test("allocates first slot, normalizes number, rejects duplicate and finds active record", async () => {
  const first = await entry("ka-22 ab-1234");
  assert.equal(first.status, 201);
  assert.equal(first.data.slotId, "T-01");
  assert.equal(first.data.vehicleNumber, "KA22AB1234");
  const duplicate = await entry();
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.error.code, "DUPLICATE_VEHICLE");
  const found = await request("/vehicles/ka-22-ab-1234");
  assert.equal(found.data.slotId, "T-01");
  assert.equal(found.data.entryHour, 9);
});
test("VIP reservation locks a specific slot out of automatic allocation and releases cleanly", async () => {
  const reserve = await request("/reservations", { slotId: "F-01", vehicleNumber: "KA22VIP01", note: "Convocation guest" });
  assert.equal(reserve.status, 201);
  const dashboard = await request("/dashboard");
  const locked = dashboard.data.slots.find((s: { id: string }) => s.id === "F-01");
  assert.equal(locked.status, "Reserved");
  assert.equal(locked.reservation.vehicleNumber, "KA22VIP01");
  const overwrite = await request("/reservations", { slotId: "F-01", vehicleNumber: "KA22OTHER", note: "Should be rejected" });
  assert.equal(overwrite.status, 409);
  assert.equal(overwrite.error.code, "RESERVATION_EXISTS");
  const checkIn = await entry("KA22REGULAR", "four_wheeler");
  assert.equal(checkIn.data.slotId, "F-02");
  const release = await fetch(base + "/api/v1/reservations", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slotId: "F-01" }) });
  assert.equal(release.status, 200);
  const next = await entry("KA22NEXT", "four_wheeler");
  assert.equal(next.data.slotId, "F-01");
});
test("all category and vehicle fee combinations, free boundary and zero duration", async () => {
  const cases: [string, string, number, number][] = [
    ["Staff", "two_wheeler", 23, 0],
    ["Staff", "four_wheeler", 23, 0],
    ["Student", "two_wheeler", 2, 0],
    ["Student", "four_wheeler", 2, 0],
    ["Student", "two_wheeler", 4, 20],
    ["Student", "four_wheeler", 4, 40],
    ["Visitor", "two_wheeler", 4, 80],
    ["Visitor", "four_wheeler", 4, 160],
    ["Visitor", "four_wheeler", 0, 0],
  ];
  for (const [owner, type, duration, fee] of cases) {
    await entry("TEST123", type, owner, 0);
    const out = await request("/check-outs", {
      vehicleNumber: "TEST123",
      exitHour: duration,
    });
    assert.equal(out.status, 200);
    assert.equal(out.data.duration, duration);
    assert.equal(out.data.fee, fee);
    assert.equal(out.data.status, "Completed");
    assert.equal(
      out.data.calculation.billableHours * out.data.calculation.ratePerHour,
      fee,
    );
  }
});
test("earlier exit rejected without freeing slot; valid exit releases and reuses first slot", async () => {
  await entry();
  let out = await request("/check-outs", { slotId: "T-01", exitHour: 8 });
  assert.equal(out.status, 422);
  assert.equal(out.error.code, "EXIT_BEFORE_ENTRY");
  assert.equal((await request("/dashboard")).data.slots[0].status, "Occupied");
  out = await request("/check-outs", { slotId: "t-01", exitHour: 13 });
  assert.equal(out.data.fee, 20);
  assert.equal((await request("/vehicles/KA22AB1234")).status, 404);
  assert.equal((await entry("KA22CD5678")).data.slotId, "T-01");
});
test("both and neither checkout identifiers, invalid hours, category and malformed identifiers rejected", async () => {
  for (const body of [
    { exitHour: 12 },
    { exitHour: 12, slotId: "T-01", vehicleNumber: "AA123" },
    { exitHour: -1, slotId: "T-01" },
    { exitHour: 24, slotId: "T-01" },
    { exitHour: 1.5, slotId: "T-01" },
    { exitHour: "12", slotId: "T-01" },
  ])
    assert.equal((await request("/check-outs", body)).status, 400);
  for (const [num, type, owner, h] of [
    ["<script>", "two_wheeler", "Student", 9],
    ["AA123", "bus", "Student", 9],
    ["AA123", "two_wheeler", "Other", 9],
    ["AA123", "two_wheeler", "Student", -1],
    ["AA123", "two_wheeler", "Student", 24],
    ["AA123", "two_wheeler", "Student", 1.5],
  ] as [string, string, string, number][])
    assert.equal((await entry(num, type, owner, h)).status, 400);
  assert.equal((await request("/summary?date=2026-02-30")).status, 400);
});
test("concurrent arrivals never double-allocate; full zone leaves other zone available", async () => {
  const results = await Promise.all(
    Array.from({ length: 14 }, (_, n) => entry(`TEST${n}`)),
  );
  const success = results.filter((r) => r.status === 201);
  assert.equal(success.length, 10);
  assert.equal(new Set(success.map((r) => r.data.slotId)).size, 10);
  assert.ok(
    results
      .filter((r) => r.status !== 201)
      .every((r) => r.error.code === "PARKING_FULL"),
  );
  assert.equal((await entry("CAR001", "four_wheeler")).data.slotId, "F-01");
});
test("concurrent duplicate check-ins and check-outs produce one successful change", async () => {
  const inputs = await Promise.all(Array.from({ length: 6 }, () => entry()));
  assert.equal(inputs.filter((r) => r.status === 201).length, 1);
  assert.ok(
    inputs
      .filter((r) => r.status !== 201)
      .every((r) => r.error.code === "DUPLICATE_VEHICLE"),
  );
  const exits = await Promise.all(
    Array.from({ length: 6 }, () =>
      request("/check-outs", { slotId: "T-01", exitHour: 13 }),
    ),
  );
  assert.equal(exits.filter((r) => r.status === 200).length, 1);
  assert.ok(
    exits
      .filter((r) => r.status !== 200)
      .every((r) => r.error.code === "VEHICLE_NOT_FOUND"),
  );
  assert.equal((await request("/dashboard")).data.summary.feesAssessed, 20);
});
test("daily summary uses IST calendar boundaries and checkout date for fees", async () => {
  const e = await entry();
  await request("/check-outs", {
    vehicleNumber: e.data.vehicleNumber,
    exitHour: 13,
  });
  await db.db.query(
    "UPDATE public.cpvts_records SET checked_in_at=$1,checked_out_at=$2",
    ["2026-10-08T18:31:00Z", "2026-10-09T18:29:00Z"],
  );
  const summary = await db.rpc<Snapshot>("cpvts_snapshot", {
    p_date: "2026-10-09",
  });
  assert.deepEqual(summary.summary, {
    vehiclesParked: 1,
    completedCheckouts: 1,
    feesAssessed: 20,
  });
  assert.equal(
    (await request("/summary?date=2026-10-08")).data.summary.vehiclesParked,
    0,
  );
});
test("database constraints reject conflicting occupancy even outside RPC", async () => {
  await entry();
  await assert.rejects(
    db.db.exec(
      "INSERT INTO public.cpvts_records(vehicle_number,vehicle_type,owner_category,slot_id,entry_hour) VALUES ('TEST2','two_wheeler','Staff','T-01',0)",
    ),
    /cpvts_active_slot/,
  );
  await assert.rejects(
    db.db.exec(
      "INSERT INTO public.cpvts_records(vehicle_number,vehicle_type,owner_category,slot_id,entry_hour) VALUES ('KA22AB1234','two_wheeler','Staff','T-02',0)",
    ),
    /cpvts_active_vehicle/,
  );
});
test("migration reapplication and process restart preserve occupancy", async () => {
  await mkdir("data", { recursive: true });
  const path = await mkdtemp(resolve("data", "test-"));
  let persistent = await localDatabase(path);
  try {
    await persistent.rpc("cpvts_check_in", {
      p_vehicle_number: "PERSIST1",
      p_vehicle_type: "four_wheeler",
      p_owner_category: "Staff",
      p_entry_hour: 23,
    });
    await persistent.close();
    persistent = await localDatabase(path);
    const found = await persistent.rpc<ParkingRecord>("cpvts_find_vehicle", {
      p_vehicle_number: "PERSIST1",
    });
    assert.equal(found.slotId, "F-01");
    const s = await persistent.rpc<Snapshot>("cpvts_snapshot");
    assert.equal(s.slots.length, 15);
    assert.equal(s.slots.filter((s) => s.status === "Occupied").length, 1);
  } finally {
    await persistent.close();
    if (
      path.startsWith(resolve("data") + String.fromCharCode(92)) ||
      path.startsWith(resolve("data") + "/")
    )
      await rm(path, { recursive: true, force: true });
  }
});
test("anonymous role cannot read tables or execute parking RPCs", async () => {
  await db.db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.db.exec(
    await readFile(
      new URL("../migrations/001_parking.sql", import.meta.url),
      "utf8",
    ),
  );
  try {
    await db.db.exec("SET ROLE anon");
    await assert.rejects(
      db.db.exec("SELECT * FROM public.cpvts_records"),
      /permission denied/,
    );
    await assert.rejects(
      db.db.exec(
        "SELECT public.cpvts_check_in('UNSAFE','two_wheeler','Staff',1)",
      ),
      /permission denied/,
    );
  } finally {
    await db.db.exec("RESET ROLE");
  }
});
test("cross-origin mutation blocked; unknown API routes return structured JSON", async () => {
  const response = await fetch(base + "/api/v1/check-ins", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://other.example",
    },
    body: "{}",
  });
  assert.equal(response.status, 403);
  assert.equal((await request("/missing")).error.code, "NOT_FOUND");
});
