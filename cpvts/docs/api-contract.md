# CPVTS REST API v1

Base URL: `http://127.0.0.1:5173/api/v1` locally. Android devices must use the Node server's reachable LAN address, not the device's loopback. Supabase database access (Session pooler or optional Data API) is a private implementation detail; mobile and CLI clients consume this Node API. All responses and request bodies are JSON. POST requests require `Content-Type: application/json`. No authentication protocol is defined for this local/trusted-network version. Do not embed a database password or Supabase server key in any client.

## Conventions

- Success envelope: `{"data": ...}`. Dashboard/summary also return `"meta":{"mode":"local"|"supabase"}`.
- Errors: `{"error":{"code":"CODE","message":"Readable description","details":[{"field":"entryHour","message":"..."}]}}`. `details` is present for field validation errors only.
- Vehicle type: `two_wheeler` or `four_wheeler`. Owner category: `Staff`, `Student`, `Visitor` (case-sensitive).
- Hours: JSON integers 0–23, never strings. No overnight rollover.
- Vehicle numbers: normalized uppercase with spaces/hyphens removed, 2–20 ASCII letters/numbers. Lookups use the same normalization.
- Slot IDs: `T-01`…`T-10` and `F-01`…`F-05`, case-insensitive input. Clients cannot choose a slot at check-in.
- Fees: integer Indian rupees, assessed rather than paid. Timestamps: ISO 8601 with timezone. Dates: valid `YYYY-MM-DD`, interpreted in `Asia/Kolkata`.
- POST bodies reject unknown fields. Request body limit: 16 KB. Reads may be safely retried. After an ambiguous mutation timeout, read back state before retrying.

## Endpoints

| Method | Path                       | Result                                                               |
| ------ | -------------------------- | -------------------------------------------------------------------- |
| GET    | `/health`                  | Checks database RPC availability; `{status:"ready",mode:"local"}`    |
| GET    | `/dashboard`               | Current slot grid, active/day records, date, timezone, daily summary |
| GET    | `/slots`                   | Array of every slot and its active record, if occupied               |
| POST   | `/check-ins`               | Creates a session; HTTP 201 and the parking record                   |
| POST   | `/check-outs`              | Completes a session; HTTP 200 and its receipt/record                 |
| GET    | `/vehicles/:vehicleNumber` | Active record for the encoded vehicle number, or 404                 |
| GET    | `/summary?date=2026-10-09` | Same snapshot shape for selected day; defaults to today in IST       |
| POST   | `/reservations`             | Locks one available slot for an official VIP/emergency vehicle     |
| DELETE | `/reservations`             | Releases one VIP reservation so automatic allocation can use it    |

### Check-in

```json
{
  "vehicleNumber": "KA-22-XY-9876",
  "vehicleType": "two_wheeler",
  "ownerCategory": "Student",
  "entryHour": 9
}
```

HTTP 201:

```json
{
  "data": {
    "id": "00000000-0000-4000-8000-000000000001",
    "vehicleNumber": "KA22XY9876",
    "vehicleType": "two_wheeler",
    "ownerCategory": "Student",
    "slotId": "T-01",
    "entryHour": 9,
    "exitHour": null,
    "checkedInAt": "2026-10-09T03:30:00+00:00",
    "checkedOutAt": null,
    "status": "Parked",
    "duration": null,
    "fee": null,
    "calculation": null
  }
}
```

The first available slot in the matching zone is assigned transactionally. Duplicate active vehicles return 409 `DUPLICATE_VEHICLE`; a full matching zone returns 409 `PARKING_FULL`. Completed vehicles may enter again.

### Check-out

Provide **exactly one** identifier:

```json
{ "slotId": "T-01", "exitHour": 13 }
```

or `{"vehicleNumber":"KA-22-XY-9876","exitHour":13}`. Both/neither is a 400 error, even if they identify the same vehicle.

HTTP 200:

```json
{
  "data": {
    "id": "00000000-0000-4000-8000-000000000001",
    "vehicleNumber": "KA22XY9876",
    "vehicleType": "two_wheeler",
    "ownerCategory": "Student",
    "slotId": "T-01",
    "entryHour": 9,
    "exitHour": 13,
    "checkedInAt": "2026-10-09T03:30:00+00:00",
    "checkedOutAt": "2026-10-09T07:30:00+00:00",
    "status": "Completed",
    "duration": 4,
    "fee": 20,
    "calculation": { "freeHours": 2, "billableHours": 2, "ratePerHour": 10 }
  }
}
```

The slot becomes available only on successful completion. Same-hour exits have zero duration. Staff: ₹0. Student: first two hours free, then ₹10 (two-wheeler) / ₹20 (four-wheeler). Visitor: ₹20 / ₹40 for every hour. Repeated checkout returns 404; it does not create a second receipt or fee.

### Dashboard, slots and summary

Example abbreviated snapshot (the real response contains all 15 slots):

```json
{
  "data": {
    "date": "2026-10-09",
    "timezone": "Asia/Kolkata",
    "slots": [
      {
        "id": "T-01",
        "vehicleType": "two_wheeler",
        "ordinal": 1,
        "status": "Available",
        "record": null
      }
    ],
    "records": [],
    "summary": {
      "vehiclesParked": 0,
      "completedCheckouts": 0,
      "feesAssessed": 0
    }
  },
  "meta": { "mode": "local" }
}
```

For an occupied slot, `record` is the active parking record. A record has all fields shown above, with checkout/fee/calculation fields null while active. `slots` always reflects **current** occupancy, including for historical summaries. `records` includes all active records and records whose entry or exit date matches the reporting day. Filter records by the desired timestamp for day-specific tables. Summary counts already have the correct date filtering.

The snapshot also includes `zones`, omitted from the abbreviated example above: `[{"vehicleType":"two_wheeler","total":10,"occupied":0,"vacant":10},{"vehicleType":"four_wheeler","total":5,"occupied":0,"vacant":5}]`. These authoritative current zone counts match the slot grid.

`GET /slots` returns just the `slots` array in the `data` envelope. `GET /vehicles/KA-22-XY-9876` returns the active record in `data`, with slot ID, entry hour and status. It returns 404 after checkout or for an unknown vehicle; it does not search historical records.

## Errors

### VIP / emergency reservations

Security users can reserve a specific available slot with `POST /reservations` and `{ "slotId":"F-01", "vehicleNumber":"KA22VIP01", "note":"Convocation guest" }`. A reserved slot is excluded from first-available check-in allocation and appears as `Reserved` in dashboard snapshots. A slot cannot be reserved while occupied; replacing an existing reservation is allowed for the security workflow. Release it with `DELETE /reservations` and `{ "slotId":"F-01" }`; this returns the slot to `Available`. These endpoints use the same server-side access boundary as existing trusted operations; no client credentials are embedded in the web bundle.

| HTTP | Code                      | Meaning                                                       |
| ---- | ------------------------- | ------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`        | Invalid enum, date, number, identifier, hour or body shape    |
| 400  | `INVALID_JSON`            | Malformed JSON request body                                   |
| 403  | `ORIGIN_NOT_ALLOWED`      | Browser mutation originated outside this app                  |
| 404  | `VEHICLE_NOT_FOUND`       | No matching active session                                    |
| 404  | `NOT_FOUND`               | Unknown API route                                             |
| 409  | `DUPLICATE_VEHICLE`       | Vehicle already has an active session                         |
| 409  | `PARKING_FULL`            | Matching vehicle zone is full                                 |
| 413  | `REQUEST_TOO_LARGE`       | Payload exceeds 16 KB                                         |
| 422  | `EXIT_BEFORE_ENTRY`       | Exit precedes entry; record remains occupied                  |
| 503  | `DATABASE_NOT_CONFIGURED` | Database URL or optional Data API server configuration missing/invalid |
| 503  | `DATABASE_UNAVAILABLE`    | Database/network/schema error; refresh before retrying writes |

Example: `{"error":{"code":"EXIT_BEFORE_ENTRY","message":"Exit hour cannot be earlier than entry hour. Overnight parking is not supported."}}`.
