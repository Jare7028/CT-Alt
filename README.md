# CT Alt

An independently implemented workforce application. Client rotas and scheduling come first, followed by team communication. The long-term scope is a complete workforce platform, delivered and verified module by module.

## Current state

This repository contains an original Next.js/TypeScript foundation and a static development landing page. Authentication, tenant memberships and scheduling are not implemented yet. No database, hosting integration, external service or production data is connected.

## Run locally

Use Node.js 24 and npm:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5180. No environment variables or provider accounts are needed for this scaffold.

```sh
npm run check
npm run build
npm start
```

`check` runs strict linting and TypeScript validation. The initial CI repeats these checks and builds the application. Feature acceptance tests will be added with the corresponding implementation; a successful scaffold build is not evidence of workforce functionality.

## Delivery sequence

1. Verify independent repository, database/Auth and hosting resources with no paid upgrades or usage-billed provisioning.
2. Add company memberships, role enforcement and the minimum employee records needed for scheduling. One person may belong to multiple companies.
3. Deliver client rotas end to end: manager planning, employee assignment, draft/publish, employee views, conflict detection and concurrent-edit protection. Test tenant isolation, time zones, DST and overnight shifts.
4. Add chat and group communication, then company updates, directory management and time-off workflows.
5. Expand the remaining workforce modules, including time tracking and knowledge management, and later training integration. These remain in scope even when lower priority.

## Isolation and public-source rules

- This project has its own release lifecycle. Do not connect it to another application's database, Auth, storage, deployment or service credentials.
- Use synthetic test data. Keep credentials, session files, real people/company records and database exports out of source, logs and CI artifacts.
- `.env.example` contains documentation only. Actual local environment files and provider bindings are ignored.
- No existing application source, branding, proprietary documents or migration history has been imported.
- Hosted deployment and database connection remain separate setup steps. Do not provision paid resources or enable billing automatically.

CI uses a standard Ubuntu runner for this public repository, with no uploaded artifacts or persistent cache. It has read-only repository permissions and no deployment steps or provider secrets.

Public visibility does not choose an open-source license. No license grant is added by this scaffold; dependency licenses remain their respective authors'.
