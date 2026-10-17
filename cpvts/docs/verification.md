# Verification

This guide describes the checks implemented in the repository and how to run them. Coverage is not proof that a particular checkout, deployment or database has passed. Record fresh results against the commit and environment tested.

## Local tests and build

Run from `cpvts/` after installing dependencies:

```bash
npm test
npm run build
```

Tests use Node's built-in test runner through `tsx`. The current suite defines 16 top-level tests:

| Source | Count | Coverage |
| --- | --- | --- |
| [parking.test.ts](../tests/parking.test.ts) | 13 | Initialization; first-free allocation; normalization and duplicate rejection; reservation creation, overwrite rejection and release; fee rules; checkout validation; input validation; concurrent arrivals and duplicate operations; IST reporting; database constraints; persistence and migration reapplication; anonymous access restrictions; POST origin rejection and unknown routes |
| [postgres.test.ts](../tests/postgres.test.ts) | 3 | Connection configuration and TLS settings; invalid database URLs; parameterized RPC arguments and identifier restrictions |

Parking tests use isolated PGlite databases and local HTTP handlers. They do not write to hosted Supabase. The PostgreSQL configuration tests inspect settings without establishing a hosted connection. `npm run build` checks TypeScript and builds the Vite frontend.

To run the two test files explicitly:

```bash
npx tsx --test tests/parking.test.ts tests/postgres.test.ts
```

## Hosted Supabase verification

Configure `DATABASE_URL` and the CA certificate as described in [certificate setup](../certs/README.md), and apply the schema before verification:

```bash
npm run db:migrate
npm run db:verify
```

The migration is a persistent schema change; it is separate from the verification transactions. Hosted verification requires an unoccupied, unreserved slot in each vehicle zone and credentials able to assume `service_role`.

[verify-supabase.ts](../server/verify-supabase.ts) checks:

- The pooled adapter reads all 15 spaces over verified TLS.
- RLS is enabled on slots and records; anonymous record reads and check-in execution are denied.
- HTTP health, check-in, duplicate rejection, earlier-exit rejection, vehicle lookup, checkout and all six owner/vehicle fee combinations.
- Two hosted sessions contend on the slot-table allocation lock.
- Verification records are rolled back and no marker records remain.

This command is explicit and is not run automatically at startup. It does not verify every route or reservation-table permission.

## Manual UI checks

Run `npm run dev` and open the server URL. Check desktop and mobile layouts, keyboard navigation, 200% zoom, each navigation screen, reservation creation/release, receipt printing, 15-second dashboard refresh, and connection-error feedback. Optional WebMCP registration requires a supporting browser; its failure must not prevent normal UI use.

## Current coverage gaps and behavior limits

- Reservation tests cover free-slot reservation and overwrite rejection, but not reservation of an occupied slot. The current SQL allows the latter.
- Zone `vacant` totals include unoccupied reserved spaces; count `Available` slots for allocatable capacity.
- The POST Origin check is tested. DELETE reservation requests are not subject to that explicit check.
- Hosted concurrency verification covers check-in allocation, not all combinations of reservation creation, release and checkout.
- Automated tests do not establish visual correctness, public deployment readiness or operator authentication.

See [architecture](architecture.md) and the [API contract](api-contract.md) for the implemented behavior and trust boundary.
