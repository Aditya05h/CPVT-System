import express from "express";
import { z } from "zod";
import type { Database } from "./database";
const vehicle = z
  .string()
  .trim()
  .max(40)
  .transform((s) => s.toUpperCase().replace(/[ -]/g, ""))
  .pipe(z.string().regex(/^[A-Z0-9]{2,20}$/, "Use 2–20 letters and numbers."));
const hour = z.number().int().min(0).max(23);
const checkIn = z
  .object({
    vehicleNumber: vehicle,
    vehicleType: z.enum(["two_wheeler", "four_wheeler"]),
    ownerCategory: z.enum(["Staff", "Student", "Visitor"]),
    entryHour: hour,
  })
  .strict();
const checkOut = z
  .object({
    vehicleNumber: vehicle.optional(),
    slotId: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[TF]-\d{2,}$/)
      .optional(),
    exitHour: hour,
  })
  .strict()
  .refine(
    (v) =>
      Number(v.vehicleNumber !== undefined) + Number(v.slotId !== undefined) ===
      1,
    "Provide exactly one of vehicleNumber or slotId.",
  );
const reserveSlot = z.object({
  slotId: z.string().trim().toUpperCase().regex(/^[TF]-\d{2,}$/),
  vehicleNumber: vehicle,
  note: z.string().trim().max(120).optional(),
}).strict();
const releaseSlot = z.object({ slotId: z.string().trim().toUpperCase().regex(/^[TF]-\d{2,}$/) }).strict();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Use a valid YYYY-MM-DD date.");
const errors: Record<string, [number, string]> = {
  DUPLICATE_VEHICLE: [
    409,
    "This vehicle is already parked. Find its current slot before checking it in again.",
  ],
  PARKING_FULL: [409, "Parking full in the selected vehicle zone."],
  SLOT_OCCUPIED: [409, "That space is occupied. Release it after the vehicle checks out."],
  RESERVATION_NOT_FOUND: [404, "No VIP reservation exists for that space."],
  RESERVATION_EXISTS: [409, "That space already has a VIP reservation. Release it before creating another."],
  VEHICLE_NOT_FOUND: [404, "No parked vehicle matches this number or slot."],
  EXIT_BEFORE_ENTRY: [
    422,
    "Exit hour cannot be earlier than entry hour. Overnight parking is not supported.",
  ],
  VALIDATION_ERROR: [400, "Check the supplied fields and try again."],
  DATABASE_NOT_CONFIGURED: [
    503,
    "Supabase setup is incomplete. Apply the migration and configure DATABASE_URL or the server secret key.",
  ],
};
export function createApp(database: Database) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "POST" && req.get("origin")) {
      try {
        if (new URL(req.get("origin")!).host !== req.get("host")) {
          res.status(403).json({
            error: {
              code: "ORIGIN_NOT_ALLOWED",
              message: "Use this application to submit parking changes.",
            },
          });
          return;
        }
      } catch {
        res.status(403).json({
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: "Invalid request origin.",
          },
        });
        return;
      }
    }
    next();
  });
  app.get("/api/v1/health", async (_req, res, next) => {
    try {
      await database.rpc("cpvts_snapshot");
      res.json({ data: { status: "ready", mode: database.mode } });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/v1/dashboard", async (_req, res, next) => {
    try {
      res.json({
        data: await database.rpc("cpvts_snapshot"),
        meta: { mode: database.mode },
      });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/v1/slots", async (_req, res, next) => {
    try {
      const data = await database.rpc<{ slots: unknown[] }>("cpvts_snapshot");
      res.json({ data: data.slots });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/v1/check-ins", async (req, res, next) => {
    try {
      const b = checkIn.parse(req.body);
      res.status(201).json({
        data: await database.rpc("cpvts_check_in", {
          p_vehicle_number: b.vehicleNumber,
          p_vehicle_type: b.vehicleType,
          p_owner_category: b.ownerCategory,
          p_entry_hour: b.entryHour,
        }),
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/v1/check-outs", async (req, res, next) => {
    try {
      const b = checkOut.parse(req.body);
      res.json({
        data: await database.rpc("cpvts_check_out", {
          p_exit_hour: b.exitHour,
          p_vehicle_number: b.vehicleNumber ?? null,
          p_slot_id: b.slotId ?? null,
        }),
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/v1/reservations", async (req, res, next) => {
    try {
      const b = reserveSlot.parse(req.body);
      res.status(201).json({ data: await database.rpc("cpvts_reserve_slot", {
        p_slot_id: b.slotId, p_vehicle_number: b.vehicleNumber, p_note: b.note ?? null,
      }) });
    } catch (e) { next(e); }
  });
  app.delete("/api/v1/reservations", async (req, res, next) => {
    try {
      const b = releaseSlot.parse(req.body);
      res.json({ data: await database.rpc("cpvts_release_slot", { p_slot_id: b.slotId }) });
    } catch (e) { next(e); }
  });
  app.get("/api/v1/vehicles/:vehicleNumber", async (req, res, next) => {
    try {
      const value = vehicle.parse(req.params.vehicleNumber);
      const data = await database.rpc("cpvts_find_vehicle", {
        p_vehicle_number: value,
      });
      if (!data) throw new Error("VEHICLE_NOT_FOUND");
      res.json({ data });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/v1/summary", async (req, res, next) => {
    try {
      const params =
        req.query.date === undefined
          ? {}
          : { p_date: date.parse(req.query.date) };
      res.json({
        data: await database.rpc("cpvts_snapshot", params),
        meta: { mode: database.mode },
      });
    } catch (e) {
      next(e);
    }
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "API endpoint not found." },
    }),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Check the supplied fields and try again.",
            details: error.issues.map((i) => ({
              field: i.path.join("."),
              message: i.message,
            })),
          },
        });
        return;
      }
      if (error instanceof SyntaxError && "body" in error) {
        res.status(400).json({
          error: {
            code: "INVALID_JSON",
            message: "Request body must be valid JSON.",
          },
        });
        return;
      }
      if ((error as { type?: string })?.type === "entity.too.large") {
        res.status(413).json({
          error: {
            code: "REQUEST_TOO_LARGE",
            message: "Request body is too large.",
          },
        });
        return;
      }
      const message = error instanceof Error ? error.message : "";
      const code =
        Object.keys(errors).find((c) => message === c) ??
        "DATABASE_UNAVAILABLE";
      const [status, description] = errors[code] ?? [
        503,
        "The parking database is unavailable. Refresh to check the result before retrying a change.",
      ];
      res.status(status).json({ error: { code, message: description } });
    },
  );
  return app;
}
