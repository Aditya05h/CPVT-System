# Verification

## Passed locally

- TypeScript checking and Vite production build.
- 12 automated test groups running against actual embedded PostgreSQL and HTTP API handlers, covering initialization, exact fee rules, input validation, normalized duplicates, first-free allocation, full zones, concurrent request outcomes, repeated checkout, database constraints, IST reporting boundaries, migration reapplication, durable database reopening, anonymous access restrictions and cross-origin mutation rejection.
- Three additional tests verify hosted connection configuration, enforced TLS, credential parsing and parameterized SQL boundaries (15 local test groups total).
- API tests create isolated data; no sample vehicles are seeded into the application database.

## Not verified

- Browser visual/layout and click-through QA: the development and production server processes started, but cross-process loopback connections timed out in this environment. No successful browser preview or screenshot is claimed. Test desktop, tablet, mobile, 200% zoom and print output when running on the host.
- Optional WebMCP registration: capability is feature-detected and failure does not affect the standard interface; no supported live browser context was reachable to test it.

No hosted site was published. The local preview process was stopped after verification attempts.

## Passed against hosted Supabase — 9 October 2026

- Connected through the user-supplied Session pooler with certificate and hostname verification using the public Supabase CA. The direct IPv6 connection was unreachable here.
- Applied `migrations/001_parking.sql` successfully. Verified ten two-wheeler and five four-wheeler spaces.
- Verified the real pooled application adapter can read hosted parking status as `service_role`.
- Checked RLS is enabled and `anon` cannot select parking records or invoke check-in.
- Ran actual HTTP API handlers against hosted PostgreSQL for check-in, duplicate prevention, earlier-exit rejection, finder, checkout and all six category/type fee combinations.
- Used two independent hosted sessions to verify that concurrent allocations block on the slot table lock. The queued allocation continued correctly after the first transaction rolled back.
- Rolled back every test write and checked that no verification records remained. All 15 spaces remained available.

Repeat these hosted checks explicitly with `npm run db:verify`; it requires the private database URL and a vacant space in each zone. Standard `npm test` remains isolated from the hosted database.
