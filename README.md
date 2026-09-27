# PAS Platform — Time Report (Phase 1B)

An internal platform for time reporting, reports, employee administration, and calendar management.

## Stack

| Layer | Tech |
|---|---|
| Web | Next.js 16 (App Router), React 19, Tailwind 4, TanStack Query |
| API | NestJS 11 (modular monolith), zod validation, OpenAPI |
| DB | PostgreSQL 16, Prisma 6 migrations |
| Auth | OIDC (Authorization Code + PKCE) via the org IdP; dev-only e-mail login for seeded test users |

```
apps/api      NestJS API  (src/modules: auth, authorization, time-report, calendar, catalog, employees, reports, audit)
apps/web      Next.js UI  (/time-report, /reports, /admin/{customers,calendar,employees})
packages/db   Prisma schema, migrations, dev seed
```

## Frontend architecture (performance)

| Technique | Where | Effect |
|---|---|---|
| Server Components fetch session + page data in parallel, next to the API | `app/(app)/layout.tsx`, `time-report/page.tsx`, `lib/server-api.ts` | First paint already has data — no spinner, no client request waterfall |
| `proxy.ts` redirects when there is no session cookie | `src/proxy.ts` | Unauthenticated users never download app code |
| View-shaped API: `GET /time-report/week` returns grid + day frame + carried-over rows + recent tasks in **one** request | API `time-report.service.ts` | 1 round trip per screen instead of 4–6 |
| Client-side navigation via `history.pushState` + TanStack Query cache | `_components/timesheet.tsx` | Switching week/month is local; back/forward work |
| Prefetch previous/next week (idle time) + `keepPreviousData` | `_lib/timesheet-data.ts` | Week navigation is instant |
| Optimistic cell saves, serialised per cell, rollback on error, undo for delete | `_lib/timesheet-data.ts` | Typing feels instant; no reload after save; never races versions |
| Streaming skeletons (`loading.tsx`) shaped like the page | `time-report/loading.tsx` | No layout shift |
| gzip on API responses; self-hosted fonts (`next/font`) | `bootstrap.ts`, `layout.tsx` | Smaller payloads, no font request to Google at runtime |

Rate limiting is per session (not per IP) because SSR calls come from the Next.js server; `/api/auth/*` stays per-IP.

## Run locally

Requirements: Node 20+, Docker.

```bash
cp .env.example .env
npm install
npm run db:up        # PostgreSQL in Docker (127.0.0.1:5432)
npm run db:migrate   # apply migrations
npm run db:seed      # fictional test users/customers
npm run dev:api      # http://127.0.0.1:4000/api
npm run dev:web      # http://localhost:3000
```

Test users (dev login, `AUTH_DEV_LOGIN=true`): `employee@pas.test`, `employee2@pas.test`, `manager@pas.test`,
`partner@pas.test`, `admin@pas.test`, `it@pas.test`, `outsider@pas.test` (another team).

```bash
npm test             # unit + integration (creates and drops its own pas_test_<ts> database)
npm run typecheck
npm run build
```

## Policy defaults (pending business confirmation)

Stored in table `time_policy`, editable by ADMIN at `/admin/calendar`. Defaults reproduce legacy behaviour:
target 540 min/day, 30-min increments, ≤ 540 min per entry, over-target **warns** (does not block),
unlimited backdating, ≤ 31 days ahead, no months locked.

Not built yet on purpose (needs confirmation): approval workflow (entries carry `status` for it), cost reporting,
leave balances, legacy data migration tool (planned), SSO wiring for the chosen IdP.


## Repository scope

This public repository contains the application source, migrations, fictional development seed data, tests, and CI configuration. Internal discovery and security reports, production credentials, server files, and database backups are kept outside this repository.
