# CPVTS REST API v1

Base URL: `http://127.0.0.1:5173/api/v1` locally. The included React client calls this API on the same origin. Supabase database access (Session pooler or optional Data API) is a server implementation detail. All responses and request bodies are JSON. POST requests and DELETE requests with a JSON body require `Content-Type: application/json`. No authentication protocol is defined for this local/trusted-network version. Do not embed a database password or Supabase server key in any client.

## Conventions

- Success envelope: `{"data": ...}`. Dashboard/summary also return `"meta":{"mode":"local"|"supabase"}`.
- Errors: `{"error":{"code":"CODE","message":"Readable description","details":[{"field":"entryHour","message":"..."}]}}`. `details` is present for field validation errors only.
- Vehicle type: `two_wheeler` or `four_wheeler`. Owner category: `Staff`, `Student`, `Visitor` (case-sensitive).
- Hours: JSON integers 0–23, never strings. No overnight rollover.
- Vehicle numbers: normalized uppercase with spaces/hyphens removed, 2–20 ASCII letters/numbers. Lookups use the same normalization.
- Slot IDs: `T-01`…`T-10` and `F-01`…`F-05`, case-insensitive input. Clients cannot choose a slot at check-in.
- Fees: integer Indian rupees, assessed rather than paid. Timestamps: ISO 8601 with timezone. Dates: valid `YYYY-MM-DD`, interpreted in `Asia/Kolkata`.
- POST and reservation DELETE bodies reject unknown fields. Request body limit: 16 KB. Reads may be safely retried. After an ambiguous mutation timeout, read back state before retrying.

## Endpoints

| Method | Path                       | Result                                                               |
| ------ | -------------------------- | -------------------------------------------------------------------- |
| GET    | `/health`                  | Checks database RPC availability; `{status:"ready",mode:"local"}` or mode `"supabase"`    |
| GET    | `/dashboard`               | Current slot grid, active/day records, date, timezone, daily summary |
| GET    | `/slots`                   | Array of every slot and its active record, if occupied               |
| POST   | `/check-ins`               | Creates a session; HTTP 201 and the parking record                   |
| POST   | `/check-outs`              | Completes a session; HTTP 200 and its receipt/record                 |
| GET    | `/vehicles/:vehicleNumber` | Active record for the encoded vehicle number, or 404                 |
| GET    | `/summary?date=2026-10-09` | Same snapshot shape for selected day; defaults to today in IST       |
| POST   | `/reservations`             | Creates a reservation on an existing slot; see current limitations below     |
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

Successful checkout ends the active session. The slot becomes `Available` unless it also has a reservation, in which case it remains `Reserved`. Same-hour exits have zero duration. Staff: ₹0. Student: first two hours free, then ₹10 (two-wheeler) / ₹20 (four-wheeler). Visitor: ₹20 / ₹40 for every hour. Repeated checkout returns 404; it does not create a second receipt or fee.

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

The snapshot also includes `zones`, omitted from the abbreviated example above: `[{"vehicleType":"two_wheeler","total":10,"occupied":0,"vacant":10},{"vehicleType":"four_wheeler","total":5,"occupied":0,"vacant":5}]`. `occupied` counts active sessions and `vacant` is `total - occupied`; unoccupied reserved slots are included in `vacant`. These counts do not represent allocatable capacity when reservations exist. Count slots with `status: "Available"` for spaces eligible for check-in.

`GET /slots` returns just the `slots` array in the `data` envelope. `GET /vehicles/KA-22-XY-9876` returns the active record in `data`, with slot ID, entry hour and status. It returns 404 after checkout or for an unknown vehicle; it does not search historical records.

### VIP / emergency reservations

Create a reservation with `POST /reservations` and `{ "slotId":"F-01", "vehicleNumber":"KA22VIP01", "note":"Convocation guest" }`. The optional note is limited to 120 characters. A reserved slot is excluded from automatic allocation and appears as `Reserved` in snapshots.

An existing reservation cannot be overwritten: the API returns 409 `RESERVATION_EXISTS`. Release it first with `DELETE /reservations` and `{ "slotId":"F-01" }`. Missing reservations return 404 `RESERVATION_NOT_FOUND`.

**Current limitations:** reservation creation does not check whether the slot has an active parking session. Both can coexist, and `Reserved` takes precedence in snapshot status while `record` still holds the active session. Release returns `{ "slotId":"F-01", "status":"Available" }`, but this response does not check occupancy; fetch the slot snapshot to determine its actual status after release. Reservations do not assign their named vehicle to that slot at check-in; all reserved slots are excluded until released.

No operator role or login is enforced by these routes. The explicit Origin-host check applies to POST requests with an Origin header, not DELETE requests.

## Errors

| HTTP | Code                      | Meaning                                                       |
| ---- | ------------------------- | ------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`        | Invalid enum, date, number, identifier, hour or body shape    |
| 400  | `INVALID_JSON`            | Malformed JSON request body                                   |
| 403  | `ORIGIN_NOT_ALLOWED`      | POST Origin is malformed or its host differs from the request host |
| 404  | `VEHICLE_NOT_FOUND`       | No matching active session                                    |
| 404  | `NOT_FOUND`               | Unknown API route                                             |
| 409  | `DUPLICATE_VEHICLE`       | Vehicle already has an active session                         |
| 404  | `RESERVATION_NOT_FOUND` | No reservation exists for the supplied slot |
| 409  | `RESERVATION_EXISTS` | Release the existing reservation before creating another |
| 409  | `PARKING_FULL`            | Matching vehicle zone is full                                 |
| 413  | `REQUEST_TOO_LARGE`       | Payload exceeds 16 KB                                         |
| 422  | `EXIT_BEFORE_ENTRY`       | Exit precedes entry; record remains occupied                  |
| 503  | `DATABASE_NOT_CONFIGURED` | Database URL or optional Data API server configuration missing/invalid |
| 503  | `DATABASE_UNAVAILABLE`    | Database/network/schema error; refresh before retrying writes |

Example: `{"error":{"code":"EXIT_BEFORE_ENTRY","message":"Exit hour cannot be earlier than entry hour. Overnight parking is not supported."}}`.
