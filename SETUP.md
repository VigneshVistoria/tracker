# Setup Guide — New Laptop / Fresh Environment

Follow this once per new machine. After this, use `start-all.bat` (in this
folder) any time you want to run the app.

## 1. Install prerequisites (one-time per machine)

| Tool | Download | Check it worked |
|---|---|---|
| Node.js (LTS) | https://nodejs.org | `node -v` in Command Prompt shows a version |
| Git | https://git-scm.com/download/win | `git --version` shows a version |

Install both with default options (click Next through everything). Restart
Command Prompt after installing so it picks up the new commands.

## 2. Get the code onto the machine

**Option A — clone from GitHub (recommended):**
```
git clone https://github.com/VigneshVistoria/tracker.git
cd tracker
```

**Option B — copy this folder** (e.g. via USB drive or zip) to anywhere on
the new machine, e.g. `C:\Users\<you>\tracker`.

## 3. Set up the backend

```
cd backend
npm install
copy .env.example .env
notepad .env
```

Fill in your **real** values (see "Where to find these values" below), save, close Notepad.

## 4. Set up the frontend

```
cd ..\frontend
npm install
copy .env.local.example .env.local
```

The default `.env.local` values are fine as-is (they just point to `http://localhost:3001`).

## 5. Run it

From the project root (the folder containing both `backend` and `frontend`), double-click:

```
start-all.bat
```

This opens two Command Prompt windows automatically — one for the backend, one for the frontend — and starts both. Leave both windows open while using the app.

Then open **http://localhost:3000** in your browser.

---

## Where to find these values (`backend/.env`)

```
DB_HOST=aws-0-eu-north-1.pooler.supabase.com
DB_PORT=5432
DB_USERNAME=postgres.xsvdwugaxuvzswpztxzb
DB_PASSWORD=<your Supabase database password>
DB_NAME=postgres

JWT_SECRET=<any long random string — same value everywhere for consistency>
JWT_EXPIRES_IN=1d

PORT=3001
FRONTEND_URL=http://localhost:3000
```

- **DB_HOST / DB_PORT / DB_USERNAME / DB_NAME**: From your Supabase project → click **"Connect"** → **"Session pooler"** tab. (Use the *pooler* host, not the direct `db.xxxx.supabase.co` one — the direct one fails on many networks.)
- **DB_PASSWORD**: The database password you saved when you first created the Supabase project. If lost, click **"Reset database password"** on that same Connect screen and update it here.
- **JWT_SECRET**: Any long random string of your choosing — it just needs to be secret and stay the same. If you use a different value than before, previously issued logins will stop working (users just log in again, no data is lost).

## Common errors and fixes

| Error | Fix |
|---|---|
| `'npm' is not recognized` | Node isn't installed or Command Prompt wasn't restarted after install |
| `'git' is not recognized` | Git isn't installed or Command Prompt wasn't restarted after install |
| `Could not read package.json` (ENOENT) | You're in the wrong folder — run `cd` alone to see where you are, then navigate to `backend` or `frontend` |
| `getaddrinfo ENOTFOUND db.xxxx.supabase.co` | You're using the direct connection host — switch to the **Session pooler** host instead (see above) |
| `error establishing an SSL connection` | Usually wrong password or wrong host in `.env` — double check both |
| Browser says "localhost refused to connect" | The corresponding Command Prompt window (backend or frontend) isn't running — restart it |
