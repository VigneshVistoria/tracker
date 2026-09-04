# Tracker — End-to-End Project Reference

Single consolidated reference for this project: what it is, how it's built,
how to run it, how it's deployed, and how to recover if something breaks.
This supersedes `ARCHITECTURE.md`, `BACKUP_AND_ROLLBACK.md`, `SETUP.md`, and
`TEAMS_INTEGRATION.md` as separate files — those still exist on disk today
but their content now lives here; ask to have them removed once you've
confirmed this file covers what you need.

## Table of contents

1. [Overview](#1-overview)
2. [Tech stack](#2-tech-stack)
3. [New machine / dev setup](#3-new-machine--dev-setup)
4. [Production deployment (this server)](#4-production-deployment-this-server)
5. [System architecture](#5-system-architecture)
6. [Multi-tenancy](#6-multi-tenancy)
7. [Backend module reference](#7-backend-module-reference)
8. [Module dependency graph](#8-module-dependency-graph)
9. [Frontend routes](#9-frontend-routes)
10. [Mobile app](#10-mobile-app)
11. [Microsoft Teams integration](#11-microsoft-teams-integration)
12. [Backup & rollback safety net](#12-backup--rollback-safety-net)
13. [Known limitations / production hardening](#13-known-limitations--production-hardening)

---

## 1. Overview

Tracker is a multi-tenant project/issue-tracking app: ticket tracking with
an approval workflow (submit → review → QA), a Project → Module → Phase →
Sprint → Task planning hierarchy, SLA/performance scoring, daily updates,
regression test runs, time sheets, and integrations (Microsoft Teams,
Claude for AI-assisted issue analysis/user stories). It runs as a single
production environment on one EC2 box — no staging server, no CI/CD
pipeline; code is edited and deployed in place (see §4).

## 2. Tech stack

**Frontend** (`/frontend`)
- Next.js 14 + React 18 (TypeScript)
- `socket.io-client` for realtime updates
- `lucide-react` for icons
- Runs on port 3000, calls the backend at `http://localhost:3001` (dev) /
  `https://tracker.vistoriasystems.com/api` (prod, via nginx)
- Auth: JWT stored in `localStorage`, sent as `Authorization: Bearer <token>`

**Backend** (`/backend`)
- NestJS 10 (TypeScript, Express platform)
- PostgreSQL via TypeORM 0.3, hosted on **Supabase** (session pooler
  connection) — Free tier, no managed backups (see §12)
- Auth: `@nestjs/jwt` + bcryptjs
- Realtime: Socket.IO (`@nestjs/platform-socket.io`, `@nestjs/websockets`)
- `@anthropic-ai/sdk` — Claude API integration (issue analysis, user story
  generation)
- `pdfkit` — PDF report generation; `nodemailer` — email
- `class-validator` / `class-transformer`, `zod` — validation
- `helmet`, `@nestjs/throttler` — security
- `@nestjs/schedule` — cron jobs (weekly/performance reports)
- Runs on port 3001

**Mobile** (`/mobile`) — see §10 for detail
- Expo 52 + React Native 0.76 (TypeScript), built via EAS

## 3. New machine / dev setup

1. Install Node.js (LTS) and Git.
2. `git clone https://github.com/VigneshVistoria/tracker.git && cd tracker`
3. Backend:
   ```
   cd backend
   npm install
   cp .env.example .env    # fill in real values, see below
   ```
4. Frontend:
   ```
   cd ../frontend
   npm install
   cp .env.local.example .env.local   # defaults point at localhost:3001
   ```
5. Run both (Windows: double-click `start-all.bat` from the project root),
   then open `http://localhost:3000`.

**Backend `.env` keys:**
```
DB_HOST=aws-0-eu-north-1.pooler.supabase.com   # Session pooler host, not db.xxxx.supabase.co
DB_PORT=5432
DB_USERNAME=postgres.xsvdwugaxuvzswpztxzb
DB_PASSWORD=<Supabase db password>
DB_NAME=postgres

JWT_SECRET=<long random string — reuse the same value across machines>
JWT_EXPIRES_IN=1d

PORT=3001
FRONTEND_URL=http://localhost:3000

BASE_DOMAIN=tracker.vistoriasystems.com   # multi-tenant, only matters once wildcard DNS (§6) is live

# Optional integrations
MS_TENANT_ID= / MS_CLIENT_ID= / MS_CLIENT_SECRET= / MS_TEAMS_WEBHOOK_URL=   # see §11
ANTHROPIC_API_KEY= / ANTHROPIC_MODEL=claude-haiku-4-5                       # AI-assisted user stories

# Post-deploy smoke check (see §12)
SMOKE_TEST_EMAIL= / SMOKE_TEST_PASSWORD=

# DB backups (see §12)
SUPABASE_URL= / SUPABASE_SERVICE_ROLE_KEY=
```

Since the DB is a shared Supabase instance, a second machine pointed at the
same credentials shares the same data automatically — no separate DB setup
needed, unless pointing at a brand-new empty database (then tenant
bootstrapping applies, see §6).

**Where to find Supabase values:** project dashboard → **Connect** →
**Session pooler** tab for host/port/username/database; **Reset database
password** on the same screen if the password is lost.

**Common setup errors:**

| Error | Fix |
|---|---|
| `'npm'`/`'git' not recognized` | Not installed, or terminal wasn't restarted after install |
| `Could not read package.json` (ENOENT) | Wrong folder — `cd` into `backend` or `frontend` first |
| `getaddrinfo ENOTFOUND db.xxxx.supabase.co` | Using the direct host — switch to the Session pooler host |
| `error establishing an SSL connection` | Wrong password or host in `.env` |
| Browser says "refused to connect" | Backend or frontend process isn't running |

## 4. Production deployment (this server)

This box runs the live app directly — `tracker-backend`/`tracker-frontend`
under **pm2**, proxied by **nginx** at `tracker.vistoriasystems.com` — there
is no separate CI/deploy pipeline. Code is edited in place here.

**Always deploy with:**
```
cd /home/ec2-user/tracker
./deploy.sh
```

`deploy.sh` captures a release snapshot (§12), builds both apps, restarts
both pm2 processes, waits for each to actually finish booting (not a fixed
timer — see §12), and runs the post-deploy smoke check. **Never** run
`npm run build` on its own and stop there — a build with no matching `pm2
restart` leaves the running process serving stale chunk/route manifests
while the new build's files are already on disk, which 404s the frontend
into a blank page (this happened on 2026-09-02). `deploy.sh` guarantees a
build can never land without its restart.

nginx routes (`/etc/nginx/conf.d/`): `/api/*` and `/socket.io/*` →
`localhost:3001` (backend), `/integrations/*` → backend, everything else →
`localhost:3000` (frontend). TLS via Certbot/Let's Encrypt.

## 5. System architecture

```
┌─────────────────┐        REST (JWT Bearer)         ┌───────────────────────┐        ┌──────────────────────┐
│   Next.js 14     │ ────────────────────────────────▶│    NestJS 10 API       │───────▶│  Postgres (Supabase)  │
│  (frontend:3000) │◀──────────────────────────────── │   (backend:3001)       │ TypeORM│  cloud-hosted DB       │
│                  │        WebSocket (Socket.IO)       │                         │        └──────────────────────┘
└─────────────────┘◀════════════════════════════════▶└───────────────────────┘
                                                           │
                                                           ├─▶ Anthropic Claude API (AI issue analysis/assist)
                                                           ├─▶ Nodemailer (email/SMTP)
                                                           ├─▶ Microsoft Graph (Teams integration webhook)
                                                           └─▶ PDFKit (report generation)
```

Backend is a **NestJS modular monolith** — one process, many self-contained
feature modules (controller + service + entities + DTOs per folder under
`backend/src`), not separate microservices.

**Realtime caveat:** Socket.IO events broadcast to every connected client
regardless of role or tenant. REST endpoints still enforce real permission
checks (nobody can *act* on data they shouldn't see), but the live event
itself isn't filtered. Fine for a small team; flagged as a scaling gap once
multiple tenants are onboarded for real.

## 6. Multi-tenancy

```
Browser Host header (e.g. acme.tracker.vistoriasystems.com, or bare localhost)
        │
        ▼
TenantsService.resolveFromHost(host)   [runs on every auth request]
   - strips subdomain from Host header
   - looks up matching `tenants` row
   - no match / no subdomain → fallbackTenant() = first tenant ever created (id ASC)
   - table empty → throws 500 ("Phase A migration must run before auth can work")
        │
        ▼
Every downstream query (users, issues, projects, ...) scoped `WHERE tenantId = :tenantId`
```

- Tenant resolution is per-request, driven by the `Host` header only — no
  config/env var picks "the current tenant."
- `tenants` table: `id`, `name`, `subdomain` (unique), `createdAt`.
- New tenants are **staff-provisioned only** (no self-serve signup): admin
  hits `POST /platform/tenants` (guarded by `PlatformSuperadminGuard`),
  which creates the tenant row and its first admin user together, with a
  random one-time temporary password (never logged/stored).
- First registrant for a tenant becomes that tenant's admin automatically.
- **Known incomplete pieces:** wildcard DNS/nginx isn't live yet, so real
  subdomain routing doesn't work in production — every request currently
  falls through to the single fallback tenant. No self-serve tenant
  signup, by design. Socket.IO broadcasts aren't tenant-scoped (§5).

## 7. Backend module reference

Each module = one folder under `backend/src`, self-contained (controller +
service + entities + DTOs).

### Cross-cutting / infrastructure

**`common` (GuardsModule)** — `JwtAuthGuard`, `AdminGuard`,
`PlatformSuperadminGuard`, configured `JwtModule`, re-exports the `User`
repository. Depended on by almost every module.

**`events` (EventsModule)** — `EventsGateway` (Socket.IO server).

**`audit` (AuditModule)** — `audit_logs` table; `AuditLogService.record(...)`
callable from any module (fire-and-forget, never throws).

**`ops` (OpsModule)** — backend half of the rollback safety net (§12):
`GET /ops/releases`, `POST /ops/rollback`, `GET /ops/rollback/status`, all
Admin-only.

**`mail` (MailModule)** — wraps Nodemailer.

### Identity & tenancy

**`tenants`** — `tenants` table; `GET/POST /platform/tenants`
(PlatformSuperadminGuard).

**`auth`** — issues JWTs; `POST /auth/register`, `POST /auth/login`,
`GET /auth/registration-status` (throttled). JWT payload:
`{ sub: userId, email, tenantId }`.

**`users`** — `users` table (email, password hash, fullName, role,
tenantId, projects relation); `GET /users/me`, `GET /users/assignable`,
`GET/POST/PATCH /users` (admin-only writes). Role enum: `admin`,
`developer`, `qa`, `executive`, `program_manager`, `client`, plus a separate
`isPlatformSuperadmin` boolean orthogonal to `role`.

### Core domain (issue tracking)

**`projects`** — `projects` table; `GET /projects(/:id)`,
`POST/PATCH /projects` (admin-only).

**`modules`** — sub-division of a project (`ProjectModule`); `GET /modules`,
project/module overview endpoints, `POST/PATCH/DELETE /modules`
(admin-only).

**`sprints`** — `sprints` table linked to issues; `GET/POST/PATCH/DELETE
/sprints`, `POST/DELETE /sprints/:id/issues` (admin-only writes).

**`issues`** — central module. `issues` table (status, assignee, project,
mode Auto/Manual, showstopper flag + review workflow, QA approve/reject,
SLA timestamps, category, priority). `POST /issues/analyze`,
`GET/POST/PATCH /issues`, workflow actions: `submit-for-review`,
`approve`, `reject`, `qa-approve`, `qa-reject`, `showstopper-review`.

**`dependencies`** — cross-team blocking-issue links ("ReleaseBot"):
`dependencies` table, `GET /dependencies`, `GET /dependencies/received`,
`GET /dependencies/sent`, `PATCH /dependencies/:id/status`.

**`evidence`** — foundation only (entity registered, no controller/service
yet — future mandatory-evidence-gate feature).

### Lookup / catalog tables (Admin/PM-managed)

Three separate "teams"-named modules, unrelated to each other:
- **`teams`** — standalone tenant-wide catalog, no FK references yet.
- **`project-teams`** — a team scoped to one Project (Project Planning's
  Team field).
- **`teams-integration`** — the Microsoft Teams webhook feature (§11) —
  shares only the English word.

**`issue-categories`** — `issue_categories` table; `Critical`/`Showstopper`
names are hardcoded-protected (risk scoring/reports/showstopper validation
match on those literal strings).

**`labels`** — `labels` table, same view/manage pattern as issue-categories.

### Project planning & task tracking

**`project-teams`** — `project_teams` table (projectId, name,
Active/Inactive). View = Admin/Executive/PM; manage = **PM only**. No hard
delete.

**`phases`** — sub-division of a Module (Project → Module → Phase).
`phases` table with computed `%Complete`. View = Admin/Executive/PM;
manage = **Program Manager only**.

**`project-planning`** — PM-owned timeline/status tracker.
`project_plan_entries` table (Project/Module/Phase/Team, dates, status,
computed `%Complete`). View = Admin/Executive/PM (QA/Developer get 403);
manage = **PM only**.

**`task-status-config`** — admin-editable % complete per task status
(7 fixed statuses); entire controller behind `AdminGuard`.

**`tasks`** — leaf of Project → Module → Phase → Sprint. `project_tasks`
table: full chain, description, assignee, `estimatedHours` (locked after
first entry), dueDate, optional dependency + dependency-owner (must be a
Developer), status (locked until estimatedHours+dueDate set), feedbackLink.
No soft-delete. Leadership sees all tasks; others see only their own.

**`task-dependency-tickets`** / **`task-qa-reviews`** — task-lifecycle
extensions: cross-task dependency tickets, and a QA submit/approve/reject
review workflow layered onto tasks (`qa-submit`, `qa-approve`,
`qa-reject`).

### QA / testing

**`test-cases`** — `test_cases`/`test_executions` tables;
`POST /test-cases/bulk-import`.

**`regression-testing`** — `regression_test_runs` table; admin-only run
history.

### Reporting / scoring

**`sla`** — `sla_configs` table; target hours per priority/showstopper,
admin-only.

**`performance-scoring`** — scoring config + overdue penalty tiers,
admin-only.

**`performance-dashboard`** — reads `issues` + sla + performance-scoring
directly; `GET /performance-dashboard`.

**`daily-updates`** — completed/pending/blockers text, AI-analyzed
productivity score; `POST /daily-updates`, `GET /daily-updates/me`,
admin team-summary.

**`reports`** — `weekly_reports` table; scheduled weekly/performance report
generation + PDF export, per-tenant cron scheduling.

**`time-sheets`** — `time_entries` table; Admin/Developer only can log
time; Admin/Executive/PM-only aggregate report.

### AI / integrations

**`ai-assist`** — wraps `@anthropic-ai/sdk`; `POST
/issues/ai/generate-user-story`.

**`notifications`** — `IssueNotificationsService`, no controller (called
internally).

**`teams-integration`** — see §11.

## 8. Module dependency graph

```
common ──▶ (guards used everywhere)
events ──▶ issues, users, projects, sprints, modules, daily-updates, regression-testing
audit  ──▶ dependencies, issues, sla, performance-scoring, issue-categories,
           labels, teams, project-teams, phases, project-planning,
           task-status-config, tasks
tenants ──▶ auth, reports
users  ──▶ auth, tenants, issues, projects, dependencies, ai-assist,
           notifications, teams-integration, regression-testing, test-cases,
           issue-categories, labels, teams, project-teams, phases,
           project-planning, tasks, time-sheets
projects ──▶ modules, sprints, issues, test-cases, project-teams,
             project-planning, tasks, time-sheets
modules ──▶ phases
phases ──▶ tasks
sprints ──▶ tasks
task-status-config ──▶ tasks
issues ──▶ dependencies, modules, regression-testing, teams-integration,
           performance-dashboard, time-sheets
sla, performance-scoring ──▶ performance-dashboard
mail ──▶ notifications, reports
```

No module accesses another module's table directly outside its own TypeORM
entities — cross-module data access goes through the owning module's
exported `*Service`, except a few read-heavy aggregation modules
(`regression-testing`, `performance-dashboard`, `reports`,
`issue-categories`, `phases`, `project-planning`) that register `Issue`/
`Project`/etc. entities directly for specific reads (existence checks,
live `%Complete` calculation) bypassing the owning service.

Authorization is inconsistent across the newer planning modules: most do
an inline `UsersService.findById(...)` + manual role check in the
controller; `task-status-config` and `ops` are the outliers, using the
shared `AdminGuard` directly. View/manage role tiers vary per module — see
each module's entry in §7.

## 9. Frontend routes

All routes are guarded client-side (redirect if not logged in / wrong
role, reading the cached `user` object from `localStorage`) and
server-side by the corresponding backend guard — the frontend check is a
UX convenience, not the real enforcement.

| Area | Routes |
|---|---|
| Auth | `/` (login), `/register` |
| Core | `/dashboard` (per-role: Developer gets its own dashboard component, everyone else gets the default) |
| Issues | `/issues`, `/issues/new`, `/issues/[id]` |
| Dependencies | `/dependencies`, `/dependencies/[id]`, `/dependency-clearance` |
| Tasks | `/tasks`, `/tasks/[id]`, `/tasks/backlog`, `/tasks/mine`, `/tasks/qa-review` |
| Project planning | `/project-modules`, `/project-phases`, `/project-planning`, `/project-teams` |
| QA | `/qa/test-cases`, `/qa/test-cases/new`, `/qa/test-cases/[id]`, `/qa/test-cases/bulk-import` |
| Time / updates | `/time-sheets`, `/daily-update` |
| Performance | `/performance-dashboard` |
| Admin — people & projects | `/admin/users`, `/admin/users/new`, `/admin/users/[id]`, `/admin/projects`, `/admin/projects/[id]`, `/admin/sprints`, `/admin/sprints/[id]` |
| Admin — catalogs | `/admin/issue-categories`, `/admin/labels`, `/admin/teams` |
| Admin — config | `/admin/sla-config`, `/admin/performance-scoring-config`, `/admin/task-status-config` |
| Admin — workflows | `/admin/showstopper-review`, `/admin/regression-testing`, `/admin/issues-bulk` |
| Admin — reporting | `/admin/reports`, `/admin/team-updates` |
| Admin — integrations | `/admin/teams-integration` |
| Admin — ops | `/admin/rollback` (§12) |
| Platform | `/platform/tenants` (platform-superadmin only) |
| Misc | `/design-preview` (internal style reference) |

## 10. Mobile app

Native app (Expo + React Native + TypeScript), single-purpose V1: sign in,
take/choose a photo, on-device OCR pre-fills the ticket description, pick
an assignee, submit. Talks directly to the production API
(`https://tracker.vistoriasystems.com/api`) — no backend changes needed.

- Auth: same `POST /auth/login` as web, token in `expo-secure-store`
  (Keychain/Keystore) instead of `localStorage`; a global 401 handler
  clears the session and bounces to the login screen from anywhere.
- OCR via `@react-native-ml-kit/text-recognition` (native module — this
  app cannot run in plain Expo Go; needs a custom dev client or full
  build via EAS).
- Only roles allowed to create tickets can log in usefully (Admin, PM, QA,
  Executive, Client) — Developer gets a 403 on ticket creation, by design.
- Build: `cd mobile && npx eas-cli build --platform android --profile
  preview` (build runs on Expo's servers, no local Android SDK needed).
- **Known V1 limits:** OCR text is editable, not final; no refresh-token
  (re-login after 1 day); Android only; the photo itself isn't stored,
  only the OCR'd text reaches the ticket.

## 11. Microsoft Teams integration

Auto-creates tickets from messages posted in a connected Teams channel,
and posts assignment notifications back into it. Requires two things that
can't be set up from inside the app: an **Azure AD app registration**
(your org's identity admin) and a **public HTTPS URL** for the backend
(Microsoft can't reach `localhost`).

**Setup:** request an Azure AD app registration with Application-type
Graph permissions `ChannelMessage.Read.All`, `ChannelMessage.Send`,
`Channel.ReadBasic.All`, `Team.ReadBasic.All`, `User.Read.All` (admin
consent required), then fill `MS_TENANT_ID`/`MS_CLIENT_ID`/
`MS_CLIENT_SECRET`/`MS_TEAMS_WEBHOOK_URL` into `backend/.env` and restart.
Find Team ID/Channel ID via "Get link to channel" in Teams. Connect in the
app at **Admin → Teams Integration**.

**How it works:** a ticket is only created if someone **@mentioned** in
the message is a real user in the app (matched by work email) — ordinary
chatter with no recognized teammate tagged is ignored. The tagged person
becomes the assignee automatically, Mode: Auto. Subscriptions auto-renew
every 15 minutes (well before the ~55 minute expiry). Reassigning a ticket
notifies the channel (@mention) unless it's reassigned to the same
person. Auto-created tickets record the message poster as a fixed system
identity, not the real sender (only the tagged/assigned person is
resolved to a real account) — a known, accepted limitation.

## 12. Backup & rollback safety net

Single production environment, no staging — this is the safety net:
automated DB backups, a tested restore process, code rollback that can go
back any number of releases, an Admin-only UI for it, and an automated
post-deploy/rollback smoke check.

| Concern | Tool | Destructive? |
|---|---|---|
| Take a DB backup | `db-backup.sh` | No (read-only against prod) |
| Restore a DB backup (test) | `db-restore.sh` (default mode) | No — throwaway sandbox only |
| Restore a DB backup (real) | `db-restore.sh --production` | **Yes** — replaces the live DB |
| Revert code to an older release | `rollback.sh` (or Admin UI) | **Yes** — replaces the live source tree, restarts the app |
| Verify a deploy/rollback didn't break anything | `scripts/smoke-check.sh` | No |

Code rollback and DB restore are **deliberately separate scripts** with
separate confirmation flows — different risk levels, must never share a
trigger.

### Database backups (`db-backup.sh`)

Supabase is on the **Free tier** (no managed daily backups/PITR), so this
is a custom mechanism: `pg_dump -Fc` production, verify the dump is
structurally valid (`pg_restore --list`) before trusting it, upload to a
private Supabase Storage bucket (`db-backups` — not local disk, which is
~90% full on this box), delete the local copy, then delete backups older
than the retention window (default: newest 14 kept). Runs daily via real
OS **cron** (`cronie`), not the app's own scheduler, so backups keep
happening even if `tracker-backend` crashes. Requires `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` in `backend/.env` (Supabase dashboard →
Settings → API — guard the service-role key like a root password).

Run manually: `./db-backup.sh`. Logs to `logs/backup.log`. Schedule:
`crontab -l`.

### Testing a restore (`db-restore.sh`, default/test mode)

Restores into a throwaway, disposable local Postgres (`postgresql17-server`,
data dir under `/tmp`, port 5433, destroyed on exit) — **never touches
production**. Run periodically (e.g. monthly) to prove backups stay
genuinely restorable, not just created:
```
./db-restore.sh
```

### Restoring to production for real (`db-restore.sh --production`)

Replaces the live database. Always takes a fresh safety backup of current
production first, then requires typing the exact phrase
`RESTORE PRODUCTION`:
```
./db-restore.sh --production
```

### Code rollback (`rollback.sh`)

**Not git-based, on purpose.** Some past releases were deployed via a
"checksummed-diff" method (a patch `git apply`'d directly onto the live
checkout, MD5-verified, git history reconciled afterward) rather than a
clean commit — a rollback tool that only understood `git checkout`
couldn't be trusted for those. Instead, every `deploy.sh` run captures a
full filesystem snapshot of the source tree under
`/home/ec2-user/tracker-releases/<release-id>/` — this captures exactly
what's on disk regardless of how it got there.

```
./rollback.sh
```

Prints every available release (not just the last one) — number,
timestamp, git commit (if any)/dirty-flag, description — pick any number,
not just "undo last deploy."

**Migration safety check:** compares migration files present now against
the target release; if any migration since then has no paired
`backend/migrations/<name>.down.sql`, it **refuses** and names exactly
which one(s) block it, rather than attempting a rollback the database
can't support. Today none of the 25 existing migrations have down-scripts
— pair new ones with a `.down.sql` going forward if reasonably reversible.
Override (only if manually verified safe): `--force-across-migration`.

**Safety net for the rollback itself:** snapshots the *current* state
first (even if dirty/uncommitted) before touching anything, so a rollback
is itself always undoable.

Confirm by typing the release id or the word `ROLLBACK`. On confirm:
snapshot current state → replace source tree with target snapshot →
`npm install` (deps may have changed) → rebuild both apps → restart both
pm2 processes → smoke check → log to `logs/rollback.log`.

Non-interactive (used by the Admin UI): `./rollback.sh --release 2
--confirm ROLLBACK --actor you@example.com`.

### Post-deploy/rollback smoke check (`scripts/smoke-check.sh`)

Runs automatically at the end of every `deploy.sh`/`rollback.sh` and every
Admin UI rollback:
1. `POST /api/auth/login` with a dedicated low-privilege test account
   (`SMOKE_TEST_EMAIL`/`SMOKE_TEST_PASSWORD`) — HTTP 200, valid JSON, an
   access token.
2. `GET /dashboard` — HTTP 200, and the actual `/_next/static/...` asset
   URLs it references are HEAD-checked to confirm they resolve (targets
   the 2026-09-02 stale-chunk incident class directly).

Prints a loud `SMOKE CHECK FAILED: <reason>` and exits non-zero on any
failure — never reports success while the app is actually broken.
Standalone: `./scripts/smoke-check.sh`.

**Readiness, not a fixed timer:** `scripts/build-and-restart.sh` waits for
each app's own startup log line (not `sleep N`) before considering it up
— a fixed sleep produced a false "FAILED" (502) once during testing
because Nest can take longer than a few seconds to finish booting.

### Admin UI (Admin → Rollback)

Same release list as `rollback.sh`, at `/admin/rollback`, Admin-only both
sides (`JwtAuthGuard` + `AdminGuard` on `GET /ops/releases` and
`POST /ops/rollback`/`GET /ops/rollback/status`).

1. Pick a release (radio button); a warning banner lists any
   un-reversible migrations since it.
2. Type `ROLLBACK` or the release id — button stays disabled until exact
   match.
3. Click it. **Important implementation detail:** `pm2 restart
   tracker-backend` kills the *entire process tree* of the backend
   (pm2's tree-kill walks `ps -e -o pid=,ppid=`), which would include a
   naive child rollback process — so the actual rollback runs via
   `systemd-run` (parented by systemd/PID 1, as `ec2-user`, never a
   descendant of `tracker-backend`), and the browser **polls**
   `GET /ops/rollback/status` for the result rather than waiting on a
   single blocking response, since the backend restarting mid-request
   would otherwise drop the connection.
4. Result banner shows PASS/FAIL for both the rollback and the smoke
   check; full script output is in `logs/last-rollback-output.log` on the
   server.
5. Logged to the `audit_logs` table (`rollback_triggered` action, both a
   "started" and a "completed" entry) — separate from `logs/rollback.log`,
   since this path is Admin-initiated through the app.

### Worked example: a bad deploy broke login

1. `./deploy.sh` finishes but prints `DEPLOY FINISHED BUT SMOKE CHECK
   FAILED`. Confirm for yourself: `./scripts/smoke-check.sh`.
2. `./rollback.sh` — read the list, decide how far back (not necessarily
   just one release).
3. Enter the number. If it warns about a migration, stop and read it — if
   confident it's safe, `--force-across-migration`; if unsure, restore a
   matching DB backup first.
4. Type `ROLLBACK`. It snapshots current state, restores the old source,
   rebuilds, restarts, smoke-checks automatically.
5. `SMOKE CHECK PASSED` → done, and both the broken release and this
   rollback itself are still saved as snapshots if you need to go further.
6. Still failing after rollback → not just a code issue; check
   `logs/rollback.log` and `pm2 logs`, consider `./db-restore.sh
   --production` if a bad migration is the actual culprit.

## 13. Known limitations / production hardening

- Realtime Socket.IO events aren't tenant/role-scoped (§5, §6) — fine for
  a small team, a priority to fix before onboarding a second real tenant.
- Wildcard DNS/nginx for real per-tenant subdomains isn't live (§6).
- No self-serve tenant signup, by design — staff-provisioned only.
- Authorization pattern is inconsistent across newer modules (inline role
  check vs. shared `AdminGuard`) — see §7/§8.
- 25 existing DB migrations have no down-scripts (§12) — new migrations
  should pair one going forward if reasonably reversible.
- JWT is stored in `localStorage` on web (httpOnly cookie would reduce XSS
  risk further); mobile already uses secure OS-level storage.
- No email verification or password-reset flow yet.
- `synchronize: false` is already set in `backend/src/app.module.ts` —
  schema changes go through hand-run `.sql` files in `backend/migrations/`
  (see §12 for why there's no automated migration runner).
- Root disk on the production box is ~91% full — a pre-existing condition
  independent of any single feature, worth monitoring/cleaning up.
