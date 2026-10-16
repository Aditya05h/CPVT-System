# CPVTS — Campus Parking & Vehicle Tracking System

A React + TypeScript interface, Node.js + TypeScript REST API, and PostgreSQL database for campus parking. The UI uses the supplied warm neutral, amber, blue and forest-green palette. There is no payment gateway.

## Run locally

Requires Node.js 22.12+ and npm. From this directory:

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Open http://127.0.0.1:5173. The current workspace's private `.env` is configured for Supabase. The downloadable source excludes credentials and defaults to local mode when configured from `.env.example`. Local mode works without credentials, using **PGlite, a persistent embedded PostgreSQL database**, at `data/parking`, and applies the migration on startup. The first initialization has 10 two-wheeler spaces and 5 four-wheeler spaces, all available. Restarting or reapplying the migration preserves parking records. Only run one process against a local database directory.

```sh
npm test
npm run build
npm start
```

`npm start` serves the production frontend with the API. Runtime TypeScript uses `tsx`; keep the installed development dependencies available. The server defaults to loopback (`127.0.0.1`) for this local, unauthenticated campus application. No user accounts or roles have been invented. Before exposing it to the internet, choose an operator access model. For a trusted LAN, set `HOST=0.0.0.0` and restrict network access; Android and CLI clients use the host machine's LAN address.

## Connect Supabase

The supplied Data API URL selects Supabase PostgreSQL in place of the pasted brief's MySQL default. Local and Supabase modes use the same schema and stored functions. There is **no silent fallback** when a configured Supabase database is unavailable.

The current workspace is connected through the supplied **Session pooler**. The migration has been applied and hosted verification passed. All 15 spaces are initially available; verification records were rolled back. No website has been published.

For a fresh installation, put these values in your private `.env`, copying the exact Session pooler URL from Supabase → Connect:

```dotenv
DATABASE_MODE=supabase
DATABASE_URL=postgresql://postgres.YOUR_PROJECT:YOUR_PASSWORD@YOUR_SESSION_POOLER_HOST:5432/postgres
DATABASE_CA_CERT=./certs/supabase-ca.crt
```

Percent-encode reserved characters in the password. The Session pooler works on IPv4 networks; the supplied direct host was IPv6-only and unreachable in this environment. The bundled public Supabase CA enables certificate and hostname verification; TLS verification is never disabled.

```sh
npm run db:migrate
npm run db:verify
npm run dev
```

`db:migrate` applies the existing idempotent SQL migration using the configured database account; occupancy is preserved. `db:verify` explicitly runs hosted checks with transient writes inside rolled-back transactions. Run it when there is at least one vacant space in each zone; it briefly acquires allocation locks. Application startup does not automatically migrate or create verification records. `/api/v1/health` returns `{"data":{"status":"ready","mode":"supabase"}}` when ready.

The Node API uses a small pool of four connections, parameterized RPC calls and the existing `service_role` database role for application queries. Migration commands use the database owner. Passwords stay in the ignored `.env`, outside the frontend and downloadable ZIP. Never place credentials in a `VITE_` variable.

**Optional HTTP adapter:** If `DATABASE_URL` is empty, set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` to use the Data API. Accepts `sb_secret_...` or a legacy `service_role` key. A publishable key alone cannot access this project's private parking operations. Tables have RLS enabled, with anonymous table and function access revoked.

## Features and rules

- Dashboard: zone counts, slot grid, active vehicles, daily arrivals and fees assessed; polls every 15 seconds.
- Check-in: vehicle number/type/category and integer entry hour; first available matching slot, duplicates and full zones handled by the database.
- Check-out: exactly one vehicle number or slot ID; exit hour cannot precede entry hour; atomic receipt creation and slot release.
- Vehicle finder: exact normalized registration lookup for active vehicles.
- Daily summary: configurable reporting date, arrivals, completed departures and assessed fees, with India Standard Time boundaries.
- Printable receipt: vehicle, category, slot, entry/exit hours, duration, free/billable hours, rate and amount due. It does not claim payment.
- Responsive layout, keyboard controls, inline validation/error messages, explicit empty and offline states.

## Assumptions

- Supabase's PostgreSQL supersedes MySQL because it was explicitly supplied. PGlite is an optional local PostgreSQL execution mode, not a MySQL substitute hidden from the user.
- Campus reporting timezone is `Asia/Kolkata`, matching the supplied campus context. Hour inputs do not advance into a later day; an earlier exit is always rejected, including for a record left active overnight.
- Vehicle identifiers are uppercased and stripped of spaces/hyphens, then must contain 2–20 ASCII letters/numbers. No regional registration format is invented.
- A daily arrival count counts parking sessions, including repeat arrivals by the same vehicle. Fees use the actual checkout timestamp, independent of entered whole-hour values.
- The arrays of slots/records in React and API responses support searching/filtering; PostgreSQL is the persistent system of record.

## Project map

- `src/`: React interface and palette tokens in `styles.css`.
- `server/`: REST API, validation, local/Supabase adapters, migration and hosted verification commands.
- `certs/`: public Supabase CA certificate and provenance.
- `migrations/001_parking.sql`: schema, seed slots, constraints, transactional functions and access grants.
- `docs/api-contract.md`: shared contract for separate Android and CLI projects.
- `docs/architecture.md`: data flow, concurrency, storage and access model.
- `tests/parking.test.ts`: executable database/API tests.

The PDF and pasted brief are reference requirements, not runtime instructions. The app does not build the separate Android or CLI projects; they consume the documented API.
