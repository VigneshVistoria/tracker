# Login App — Next.js + NestJS + MySQL

A minimal but production-shaped login/registration system.

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

## 1. Set up MySQL

Create the database (the app will auto-create the `users` table on first run):

```sql
CREATE DATABASE login_app;
```

## 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` with your MySQL credentials and a strong `JWT_SECRET`. Then:

```bash
npm run start:dev
```

The API runs on **http://localhost:3001**.

### Endpoints

| Method | Path            | Body                                  |
|--------|-----------------|----------------------------------------|
| POST   | /auth/register  | `{ email, password, fullName? }`       |
| POST   | /auth/login     | `{ email, password }`                  |

Both return `{ accessToken, user: { id, email, fullName } }` on success.

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

## Security notes for going to production

- Set `synchronize: false` in `backend/src/app.module.ts` and use TypeORM migrations instead — `synchronize: true` is only for quick local development, since it can silently alter/drop columns.
- Store the JWT in an **httpOnly cookie** set by the backend rather than `localStorage`, to reduce XSS risk.
- Add rate limiting to `/auth/login` to slow down brute-force attempts.
- Consider email verification and a password-reset flow.
- Never log raw passwords, and keep `JWT_SECRET` out of source control (already gitignored via `.env`).
