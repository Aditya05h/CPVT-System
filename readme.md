<div align="center">
  <img src="cpvts/public/favicon.svg" alt="CPVTS parking icon" width="80" height="80">

  <h1>CPVT-System</h1>

  <p><strong>A clear view of your campus, one parking space at a time.</strong></p>

  <p>Campus Parking &amp; Vehicle Tracking System</p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-231F20?style=for-the-badge&logo=typescript&logoColor=FFB300" alt="TypeScript">
    <img src="https://img.shields.io/badge/React-231F20?style=for-the-badge&logo=react&logoColor=1E88E5" alt="React">
    <img src="https://img.shields.io/badge/Vite-231F20?style=for-the-badge&logo=vite&logoColor=FFB300" alt="Vite">
    <img src="https://img.shields.io/badge/Node.js-231F20?style=for-the-badge&logo=nodedotjs&logoColor=E8F5E9" alt="Node.js">
    <img src="https://img.shields.io/badge/Supabase_PostgreSQL-2E7D32?style=for-the-badge&logo=postgresql&logoColor=FFFFFF" alt="Supabase PostgreSQL">
    <img src="https://img.shields.io/badge/Tests-node%3Atest-1E88E5?style=for-the-badge&logoColor=FFFFFF&labelColor=231F20" alt="Node test runner">
  </p>

  <p>
    <a href="#quick-start--configuration">Get started</a> ·
    <a href="#system-architecture--project-structure">Architecture</a> ·
    <a href="#documentation-hub">Documentation</a>
  </p>
</div>

## Overview & Key Features

CPVT-System coordinates campus arrivals, departures, parking availability, and daily reporting through a responsive React dashboard. Its warm cream surfaces, amber actions, and clear status indicators keep everyday parking operations easy to scan.

| Capability | What it delivers |
| --- | --- |
| Parking overview | 10 two-wheeler and 5 four-wheeler spaces; Available, Occupied, and Reserved states; 15-second polling and refresh after changes. |
| Vehicle workflows | First-available allocation, duplicate prevention, active vehicle lookup, and checkout by vehicle number or slot. |
| VIP reservations | Reserve and release specific spaces; reserved slots are excluded from automatic allocation. |
| Receipts & reporting | Printable receipts, category-based fees, and daily arrivals, departures, and assessed fees in IST. |
| Persistent storage | Local PGlite or Supabase PostgreSQL; hosted SQL connections verify the CA chain and hostname. |
| Schema automation | Reapplicable SQL initializes slots and functions while preserving existing parking records. |

Fees are assessed, not collected. Parking uses whole hours without overnight rollover. This version targets local or trusted-network operation and does not include operator authentication.

## System Architecture & Project Structure

The browser uses same-origin `/api/v1` JSON endpoints. Express validates input with Zod; database functions own allocation, fees, and transactional consistency.

```mermaid
flowchart TD
    UI["React + Vite frontend · src/"] -->|"JSON requests / responses"| API["TypeScript + Express API · server/"]
    API -->|"pg · Session pooler · verified TLS"| DB[("Supabase PostgreSQL")]
    API -->|"Local mode"| LOCAL[("PGlite · data/parking/")]
    SCHEMA["migrations/001_parking.sql"] -->|"db:migrate"| DB
    SCHEMA -->|"Automatic local initialization"| LOCAL
    CA["certs/supabase-ca.crt"] -.->|"CA trust · rejectUnauthorized: true"| API

    classDef frontend fill:#FFF8E1,stroke:#FFB300,color:#231F20;
    classDef backend fill:#E3F2FD,stroke:#1E88E5,color:#231F20;
    classDef database fill:#E8F5E9,stroke:#2E7D32,color:#231F20;
    classDef support fill:#F9F7F2,stroke:#E6DFD5,color:#736B63;

    class UI frontend;
    class API backend;
    class DB,LOCAL database;
    class SCHEMA,CA support;
```

An optional server-only Supabase Data API adapter is used when hosted mode has no `DATABASE_URL`. Database credentials stay on the server.

```text
cpvts/
├── src/          # React screens, styles, shared types, API client
├── public/       # Amber parking favicon
├── server/       # Express API, adapters, migration and verification scripts
├── migrations/   # PostgreSQL schema, constraints and parking functions
├── certs/        # Public Supabase CA and TLS setup notes
├── docs/         # Architecture, API contract and verification guidance
└── tests/        # Parking workflows and PostgreSQL adapter tests
```

## Quick Start & Configuration

Requires **Node.js 22.12+**, npm, and Git.

```bash
git clone https://github.com/Aditya05h/CPVT-System.git
cd CPVT-System/cpvts
npm install
```

Copy `.env.example` to `.env`:

```bash
# macOS / Linux
cp .env.example .env
```

```powershell
# PowerShell
Copy-Item .env.example .env
```

For hosted PostgreSQL, edit these values:

```dotenv
DATABASE_MODE=supabase
DATABASE_URL=postgresql://USER:PASSWORD@SESSION_POOLER_HOST:5432/postgres
DATABASE_CA_CERT=./certs/supabase-ca.crt
```

Use your Supabase Session pooler credentials. The public CA is bundled; if missing or rotated, place the appropriate certificate at `certs/supabase-ca.crt` and verify it against [certificate setup](cpvts/certs/README.md).

```bash
npm run db:migrate
npm run dev
```

`db:migrate` runs `server/migrate.ts`. Open [localhost:5173](http://127.0.0.1:5173).

<details>
<summary>Local mode and production commands</summary>

Keep `DATABASE_MODE=local` to use persistent PGlite without hosted credentials. Run `npm run dev`; local initialization applies the schema automatically.

For a production build:

```bash
npm run build
npm start
```

</details>

## Verification & Testing

Tests use Node’s built-in runner through `tsx`.

```bash
npm test
npx tsx --test tests/parking.test.ts tests/postgres.test.ts
npm run build
npm run db:verify
```

The first two commands are alternative suite invocations. Hosted verification runs `server/verify-supabase.ts`, requires configured database credentials and a vacant space in each zone, and rolls back verification writes. It checks TLS connectivity, access restrictions, workflows, fee calculations, and concurrent allocation.

## Documentation Hub

| Guide | Coverage |
| --- | --- |
| [Architecture](cpvts/docs/architecture.md) | System design, data flow, transactions, and trust boundaries |
| [API contract](cpvts/docs/api-contract.md) | REST endpoints, payloads, and error responses |
| [Verification](cpvts/docs/verification.md) | QA procedures and recorded validation results |
| [Certificate setup](cpvts/certs/README.md) | SSL/TLS configuration, CA source, and fingerprint |