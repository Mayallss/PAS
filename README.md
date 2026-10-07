# PAS Platform — Employee Portal & Time Report

Rewrite of the legacy PHP Time Report (`pas-acc.com/report`) as the first module of the PAS internal platform.
Background, legacy analysis and open decisions: [`docs/`](docs/README.md).

## Stack

| Layer | Tech |
|---|---|
| Web | Next.js 16 (App Router), React 19, Tailwind 4, TanStack Query |
| API | NestJS 11 (modular monolith), zod validation, OpenAPI |
| DB | PostgreSQL 16, Prisma 6 migrations |
| Auth | OIDC (Authorization Code + PKCE) via the org IdP; dev-only e-mail login for seeded test users |

```
apps/api      NestJS API  (src/modules: auth, authorization, time-report, calendar, catalog, employees, reports, audit)
apps/web      Next.js UI  — internal employee portal (/time-report, /reports, /admin/{customers,calendar,employees})
apps/site     Next.js     — public company website pas-acc.com (/th, /en) — separate app, see below
packages/db   Prisma schema, migrations, dev seed
docs/         Discovery, gap analysis, architecture, open questions
infra/        AWS deployment: Terraform (ECS Fargate, RDS, S3, Cognito, Secrets Manager, CloudWatch) + PowerShell scripts
```

## Modules

| Route | What | Notes |
|---|---|---|
| `/` | Employee portal: greeting, week progress ring, to-do list, announcements, app launcher | One request: `GET /api/home` |
| `/plan` | **Work plan (To-do) = estimate**: week board per person (drag between days, − / + hours, priority, status, late = derived), team heat map for leads, estimated vs actual cost for `cost.read` | Timesheet has **เติมจากแผน** (user confirms; never overwrites). **Custom items** (free text, hours optional) are personal notes: private, never counted in hours/cost/team views. Leads assign with `todo.assign`; assignees cancel instead of deleting lead-assigned work |
| `/time-report` | Weekly timesheet (type hours in cells), month calendar | Required hours come from **work schedules** |
| `/meetings` | Meeting minutes: certify ✅ or **object** by selecting text; author revises → new version with **green/red highlights**; everyone re-certifies | Replaces legacy `meet` / `meet_agree` (whose "incorrect" option was never saved) |
| `/handoff` | **รับ–ส่งเอกสาร** (ex-DELIPAS): pick a ticket from the monday hand-over board (4 group tabs, search), collect outcome + signer name + signature; evidence PNG is uploaded to the ticket, then status/signer/Thai time are set in one mutation | **monday stays the source of truth** (no DB table). Save token binds to the status seen → refuses if changed in monday; retries with the same `requestId` are recognised (no double upload); draft kept in the browser. **ลิงก์ให้ผู้เซ็น** = one-hour signed link + QR for the signer's own phone → public `/sign` (`/api/public/handoffs`, per-IP limits, audited). Needs `handoff.use`; env `MONDAY_API_TOKEN`, `MONDAY_HANDOFF_BOARD_ID`, `HANDOFF_LINK_SECRET` |
| `/leave` | **การลา (HR)**: file by day range or by the hour (working days only, from each person's schedule and holidays), live balance, team lead approves (nearest lead up the team tree; HR when a team has no lead), team calendar, HR tab (all requests, per-person entitlements, leave types, record on behalf) | Defaults = legal minimum (annual 6 d after 1 yr, personal 3 d, sick 30 d paid / certificate from 3 d). **Approval posts read-only leave rows into the timesheet**; manual leave rows are refused. Colleagues see "ลา", not the type (sick leave = health data). New role **HR** (`leave.manage`). docs/09 |
| `/rooms` | **จองห้องประชุม**: day board (rooms × 08–19), onsite / online (link) / hybrid, invitees + guests, "my meetings" | No double booking (check + DB exclusion constraint). `room.manage` runs rooms. **Google Calendar mirror is built in** (service account + domain-wide delegation, outbox + retry): events on the organizer's calendar, room resource, company calendar, Meet link, phone reminders; approved leave → Out of office. Dormant until `GOOGLE_SA_*` are set |
| `/it-assets?tab=match` | **จับคู่ผู้ใช้**: link surveyed machines to people — suggestions from the survey's user text (full name > first name > nickname, nicknames learned across rows), IT ticks to confirm, each goes through the normal hand-out rules | People come from `scripts/import-legacy-people.mjs` (legacy `member_table` + teams + levels; never reads passwords, no roles beyond EMPLOYEE). docs/07 §13 |
| `/announcements` | Announcements with optional acknowledgement | Plain text only |
| `/reports` | Weekly completeness, monthly timesheet (+Excel), customer effort, leave | Scoped by role assignments |
| `/admin/customers` | Customers (JOB) and **Activities** (legacy `job_table`, grouped) | |
| `/admin/calendar` | Holidays, **work schedules** (company / team / person, effective-dated), period locks, entry rules | |
| `/admin/employees` | Employees, **teams / sub-teams** (create, rename, move, set lead, delete when empty), **role assignments scoped to teams**, role definitions | Can't grant permissions you don't hold; moving a team changes managers' report scope (audited) |

Notifications (bell) are derived on read: missing time, announcements/minutes to certify, objections to answer, team follow-ups.

## Public website (`apps/site`)

The company website for customers, rebuilt from the legacy `pas-frontweb` PHP pages (same TH/EN content, images
re-encoded to WebP). It is a **separate app** from the employee portal: separate build, deploy and domain; no login,
no cookies, no calls to the internal API, and it does not link to the internal portal.

| Route | Content |
|---|---|
| `/` | Redirects to `/th` or `/en` by browser language |
| `/{th,en}` | Hero, stats, services, why PAS (MD + values), client logos, testimonials, certifications, LINE/phone/email CTA |
| `/{th,en}/about` | History + timeline, DBD / ISO 9001 certification, mission, vision, team (6 people) |
| `/{th,en}/testimonials` | 4 client testimonials, client logo wall |
| `/{th,en}/contact` | Address, hours, click-to-load Google Map, all channels, quote / training form |
| `/About-th.php`, `/pas-frontweb/Contact.php`, … | 308 redirects from the old URLs (keeps search ranking and bookmarks) |

- All text lives in `src/content/site.ts` as `{ th, en }` pairs — edit there, both languages stay in the same shape.
- Theme: navy (`brand-*`) + gold (`gold-*`) tokens in `src/app/globals.css`; homepage labels in `landing` (facts only from the old site).
- Every page is prerendered (SSG). Scroll animations are pure CSS (`animation-timeline: view()`); browsers without
  support just show the content. Only the header menu, count-up numbers and map button hydrate.
- Strict CSP (no third-party scripts); Google Maps loads only after the visitor clicks. JSON-LD `AccountingService`,
  `hreflang`, sitemap and robots for SEO. Set `SITE_URL` for the production origin (default `https://pas-acc.com`).
- "Request a quote" / "Register for training" still open the existing Google Form (same link as the old site).

```bash
npm run dev:site     # http://localhost:3001
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

## Database migrations — read before creating one

Generate SQL with `prisma migrate diff` (non-interactive), then **review it**: Prisma does not know about the hand-written
partial/`NULLS NOT DISTINCT` unique indexes and exclusion constraints and will try to `DROP` them
(`time_entry_employee_engagement_date_live_key`, `engagement_customer_category_period_key`, `role_assignment_unique_scope`).
Remove those drops. The `schema guard` integration test fails if any of them goes missing.

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
npm run dev:site     # http://localhost:3001  (public website, needs no API/DB)
```

Test users (dev login, `AUTH_DEV_LOGIN=true`): `employee@pas.test`, `employee2@pas.test`, `manager@pas.test`,
`partner@pas.test`, `admin@pas.test`, `it@pas.test`, `outsider@pas.test` (another team).

```bash
npm test             # unit + integration (creates and drops its own pas_test_<ts> database)
npm run typecheck
npm run build
```

## Deploy to AWS

`Dockerfile` (targets `api`, `web`, `site`) + `infra/terraform` + `infra/scripts/deploy.ps1`.
Step-by-step guide (Thai): [`infra/DEPLOY-AWS.md`](infra/DEPLOY-AWS.md).

## Security model — what changed from the legacy system

| Legacy problem (docs/00) | Now |
|---|---|
| `query_db.php` ran raw SQL from the browser, no login | No SQL from clients; Prisma parameterised queries; every route behind a **deny-by-default** global guard |
| SQL injection in login, MD5 passwords | Google SSO (OIDC, MFA at IdP) **and/or** username + password (decision 2026-10-02, works without Google): scrypt N=2^16 hashes only, set by the employee via a one-time 72 h link (admins never see passwords), 5 wrong → 15 min lock, legacy MD5 never migrated. Sessions are random tokens, DB stores only SHA-256, `HttpOnly` + `SameSite=Lax` (+ `__Host-` & `Secure` on HTTPS) |
| No CSRF protection | Per-session CSRF token required on every non-GET request |
| 15 endpoints without auth checks, menus hidden only in UI | Permissions checked server-side per route (`@RequirePermission`) + data scoping (`AccessService`) |
| Managers/IT saw everyone's data and cost rates | Manager: own org units only. IT: account admin only, no time data. Costs hidden until rate unit is confirmed |
| Validation only in the browser (step 0.5, max 9 h) | Server-side policy (`time-report/policy.ts`) + DB CHECK constraints |
| Duplicate rows, lost updates | Partial unique index per (employee, engagement, day) + idempotent upsert + optimistic `version` |
| Hard delete, no history | Soft delete + append-only `audit_event` (DB trigger blocks UPDATE/DELETE/TRUNCATE) |
| Unauthenticated Excel export | Export requires `report.export`, scoped, audited, `no-store` |
| Resigned staff could still log in | Inactive employees rejected on every request; deactivation/role change revokes sessions immediately |
| No rate limiting | Global 300 req/min; login 30/min per IP (one office NAT) + per-account lock |
| — | helmet headers (API), CSP / frame-deny / HSTS (web), request IDs, JSON access logs, 100 kB body limit |

## Policy defaults (pending business confirmation — docs/06)

Stored in table `time_policy`, editable by ADMIN at `/admin/calendar`. Defaults reproduce legacy behaviour:
target 540 min/day, 30-min increments, ≤ 540 min per entry, over-target **warns** (does not block),
unlimited backdating, ≤ 31 days ahead, no months locked.

Not built yet on purpose (needs confirmation): approval workflow (entries carry `status` for it), cost reporting,
leave balances, legacy data migration tool (`tools/legacy-migration`, see docs/04), SSO wiring for the chosen IdP.
