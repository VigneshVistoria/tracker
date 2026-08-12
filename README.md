# Login App — Next.js + NestJS + Supabase (Postgres)

A minimal but production-shaped login/registration system, with an issue tracker.

**New machine or fresh environment?** See `SETUP.md` for the consolidated step-by-step guide, plus `first-time-setup.bat` and `start-all.bat` to automate the repetitive parts.

- **Frontend**: Next.js (login + register + a simple protected dashboard)
- **Backend**: NestJS REST API (`/auth/register`, `/auth/login`)
- **Database**: MySQL, accessed via TypeORM
- Passwords are hashed with **bcrypt** — never stored in plain text.
- On successful login/register, the backend returns a **JWT** the frontend stores and can send on future requests.

## Folder structure

```
backend/    NestJS API + MySQL
frontend/   Next.js UI
```

## 1. Set up Supabase (Postgres database)

1. Go to https://supabase.com and create a free account/project.
2. In your project dashboard, go to **Project Settings → Database**.
3. Copy the connection details (host, port, database name, password) — you'll need these for `backend/.env`. The `users` table is auto-created on first run by TypeORM (`synchronize: true`).

## 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` with your Supabase database credentials and a strong `JWT_SECRET`. Then:

```bash
npm run start:dev
```

The API runs on **http://localhost:3001**.

### Endpoints

| Method | Path              | Auth required | Body                                                    |
|--------|-------------------|----------------|-----------------------------------------------------------|
| POST   | /auth/register    | No             | `{ email, password, fullName? }`                          |
| POST   | /auth/login       | No             | `{ email, password }`                                      |
| GET    | /issues           | Yes            | — (admins see all; users see only issues assigned to them) |
| GET    | /issues/:id       | Yes            | —                                                            |
| POST   | /issues           | Yes            | `{ title, description?, assigneeUserId?, projectId?, mode?, showstopper? }`    |
| PATCH  | /issues/:id       | Yes            | `{ title?, description?, status?, assigneeUserId?, projectId?, mode?, showstopper? }` |
| GET    | /projects         | Yes            | — (admins see all; users see only their assigned projects) |
| GET    | /projects/:id     | Yes            | —                                                            |
| POST   | /projects         | Admin only     | `{ name, description? }`                                   |
| PATCH  | /projects/:id     | Admin only     | `{ name?, description? }`                                   |
| GET    | /users/assignable | Yes            | — minimal list `{ id, email, fullName }` for dropdowns      |
| GET    | /users            | Admin only     | — full user list                                             |
| GET    | /users/:id        | Admin only     | —                                                            |
| POST   | /users            | Admin only     | `{ email, password, fullName?, role?, projectIds? }`         |
| PATCH  | /users/:id        | Admin only     | `{ fullName?, role?, password?, projectIds? }`               |
| POST   | /issues/analyze   | Yes            | `{ title?, description? }` → returns guidance, never creates anything |
| POST   | /daily-updates    | Yes            | `{ date?, completedText?, pendingText?, blockersText? }`     |
| GET    | /daily-updates/me | Yes            | — your own submission history                                |
| GET    | /daily-updates    | Admin only     | — every submission, `?date=YYYY-MM-DD` to filter              |
| GET    | /daily-updates/team-summary | Admin only | `?date=YYYY-MM-DD` → aggregated counts + avg productivity |
| GET    | /integrations/teams | Admin only | — list connected Teams channels |
| POST   | /integrations/teams/connect | Admin only | `{ teamId, channelId, channelName?, projectId? }` |
| DELETE | /integrations/teams/:id | Admin only | — disconnect a channel |
| POST   | /integrations/teams/webhook | None (Microsoft calls this) | Receives Graph notifications - secured via a shared `clientState` secret, not a login |

Auth/login endpoints return `{ accessToken, user: { id, email, fullName, role } }` on success.

For all other endpoints, send the token as `Authorization: Bearer <accessToken>`.

`status` must be one of: `Open`, `In Progress`, `Client Review`, `Closed`.
`role` must be one of: `admin`, `user`.
`mode` must be one of: `Auto`, `Manual` (defaults to `Manual`).
`showstopper` is a boolean flagging a critical, blocking issue.
`closedOn` is set automatically the moment `status` becomes `Closed`, and clears itself if the issue is reopened - it's never set directly.

**Note on the first account:** the very first person to register becomes an **admin** automatically. Everyone who registers after that gets the `user` role by default — an admin can promote them later from the User Management page.

## 3. Frontend setup

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

The app runs on **http://localhost:3000**.

- `/` — login form
- `/register` — create account form
- `/dashboard` — shown after a successful login (reads the stored user from localStorage)
- `/issues` — list of issues (all of them for admins, only your assigned ones otherwise)
- `/issues/new` — create an issue: fill in the form, click **"Review Issue"** to get feedback (valid/incomplete/needs more info/invalid, plus gaps and suggestions), then either **"Proceed with Submission"** or **"Refine the Issue"** to keep editing
- `/issues/[id]` — view/edit an issue's title, description, status, project, and assignee
- `/admin/projects` — admins can create projects; everyone can see the projects assigned to them
- `/admin/users` — **admin only**: list all users
- `/admin/users/new` — **admin only**: create a user, set their role, assign projects
- `/admin/users/[id]` — **admin only**: edit a user's name, role, password, and project assignments
- `/daily-update` — submit today's completed/pending/blockers; get an instant breakdown with productivity score, status light, and manager summary
- `/admin/team-updates` — **admin only**: everyone's daily updates for a chosen day, with team-wide stats, updating live as people submit
- `/admin/teams-integration` — **admin only**: connect a Microsoft Teams channel so its messages auto-create tickets. See `TEAMS_INTEGRATION.md` for the full setup, including exactly what to request from your organization's Azure AD admin - this one needs real organizational credentials and a public URL, it can't be fully set up from inside the app alone.

## Real-time updates
The backend runs a WebSocket server (Socket.IO) alongside the REST API. When anyone creates or updates an issue, creates a project, is added as a user, or submits a daily update, every connected browser tab sees it immediately - no manual refresh needed. A small dot in the top bar shows live-connection status.

**Note for production use:** the socket currently broadcasts to every connected client rather than only the people who should see a given item (the REST endpoints still enforce all the real permission checks, so nobody can *act* on data they shouldn't see - but the live event itself isn't filtered by role). Fine for a small team; if this ever needs to scale to many organizations, add per-role/per-project Socket.IO rooms.

## Microsoft Teams integration

See `TEAMS_INTEGRATION.md` for full setup. In short: connect a Teams channel to a project, and it works both directions - new channel messages become tickets (Mode: Auto), and assigning a ticket linked to that project posts a message in the channel that @mentions the new assignee. Requires real Azure AD credentials and a public URL for the backend; not testable purely from localhost.

## Security notes for going to production

- Set `synchronize: false` in `backend/src/app.module.ts` and use TypeORM migrations instead — `synchronize: true` is only for quick local development, since it can silently alter/drop columns.
- Store the JWT in an **httpOnly cookie** set by the backend rather than `localStorage`, to reduce XSS risk.
- Add rate limiting to `/auth/login` to slow down brute-force attempts.
- Consider email verification and a password-reset flow.
- Never log raw passwords, and keep `JWT_SECRET` out of source control (already gitignored via `.env`).
