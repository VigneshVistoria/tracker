# Developer Guide — Tracker

This guide covers everything you can do in Tracker as a **Developer**. It's written for that role specifically — other roles (QA, Program Manager, Admin, Executive) see a different, fuller navigation experience.

## 1. Getting an account

You don't self-register. An Admin creates your account from **Admin → Users**, sets your role to Developer, and gives you a login. Go to the login page, sign in with your email and password, and you'll land on your **Dashboard** — your one and only sidebar entry.

## 2. Your home base: the Dashboard

As a Developer, the sidebar is intentionally hidden — Dashboard is your single navigation link, and it doubles as a control center. It shows up to five stat tiles, each one only appearing if it has something in it:

| Tile | What it means |
|---|---|
| **My Tasks** | Every task currently assigned to you |
| **Rejected** | Tasks QA sent back (status `Failed`) that need your attention |
| **Inbound** | Dependency tickets *you* filed against another developer, still unresolved |
| **Outbound** | Dependency tickets *another developer* filed against you, still unresolved |
| **Overdue** | Tasks past their Due Date, plus Outbound tickets whose parent task is overdue |

Click a tile to expand its list, then click any row to open that task's detail page — this is how you get to almost everything else in the app.

> **Note:** Some pages (Time Sheets, KPI Dashboard, Daily Update) exist and work for your role, but aren't linked from anywhere in your view of the app today. See §7 for direct links. This is a known gap, not a bug — don't spend time looking for them in a menu.

## 3. Working a task

Open a task from your Dashboard to reach the Task Detail page — this is where you'll spend most of your time.

**Fields you can edit** (only on tasks assigned to you):
- **Estimated Hours** and **Due Date** — each is a *one-time entry*. Once you set it, it locks; only a Program Manager can change it after that. Set both accurately before you submit for QA — you can't submit without them.
- **Status** is never set manually. It's fully automatic, driven by your QA submissions and QA's decisions (see §4).

**Filing a Dependency Ticket** — if you're blocked on another developer's work, use "Create Dependency Ticket" on your task: describe what you're blocked on and pick the developer who owns it. It shows up as an "Outbound" ticket for them and an "Inbound" ticket for you until they resolve it. You can only file tickets against tasks assigned to you, and only route them to another Developer.

**Resolving a ticket routed to you** — if you own a dependency ticket someone filed against you, you'll see a "Mark Resolved" button on the ticket wherever it's listed (including via your Dashboard's Outbound tile, or the dedicated **Dependency Clearance** page at `/dependency-clearance` — bookmark that URL, since it isn't in your sidebar).

## 4. Submitting work for QA

Once a task is ready, use **Submit for QA Testing** on the task detail page:

1. **Resolution** — describe what you did/fixed.
2. **Artifacts** — add one or more pieces of supporting evidence, each with a **Type** and a **URL**:
   - Screenshot, Pull Request Link, APK Build, Technical Documentation, Build Pipeline Link, Deployment Report, Demo Video
   - You can only use each type once per submission; add more rows for more artifacts.
3. **Actual Hours Spent** — how long the work actually took.
4. Click **Mark Ready for Feedback**.

This moves the task to `Feedback` (first round) or `Re-Feedback` (if you're resubmitting after a rejection). You can't submit again while a round is still pending QA's decision.

**If QA rejects your round**, the task status becomes `Failed` and lands back with you — check the QA's comment in the QA Review History table (see below), fix what's needed, and resubmit. That starts a new round.

**If QA approves**, the task status becomes `Pass` and you're done.

## 5. Reading QA Review History

Every task detail page has a QA Review History table showing every round: Round number, Status, your Description, Artifact (small icons — hover for the type, click to open the link), who submitted/reviewed and when, and QA's Comment. Rejected rounds are highlighted so you can spot them at a glance — that's always where to look first if a task bounced back to you.

## 6. Task status reference

| Status | What it means |
|---|---|
| `Development` | Assigned to you, not yet submitted for QA |
| `Feedback` | Your first submission is awaiting QA review |
| `Failed` | QA rejected the pending round — action needed from you |
| `Re-Feedback` | You resubmitted after a rejection, awaiting QA again |
| `Pass` | QA approved — task complete |

You'll occasionally see older tasks with legacy statuses like `Released - No Showstoppers` — those predate the current workflow and aren't something you can trigger.

## 7. Pages that work but aren't in your menu

These aren't linked anywhere in your view of the app, but they work for your role if you go directly to the URL:

- **`/time-sheets`** — log hours against a ticket or project, and see your own week's entries.
- **`/kpi`** — your personal KPI scores (completion %, overdue %, rejection rate, etc.) for a selected period.
- **`/daily-update`** — submit what you completed today, what's still pending, and any blockers.

## 8. What's not part of your workflow

The **Issues** module and the **Dependencies** page (a different, older concept from Dependency Tickets/Dependency Clearance — don't confuse the two) are Program Manager/QA/Admin/Executive territory. You won't find a way to create things there, and they're not part of your day-to-day flow — Tasks are.

## 9. Appearance

Use the theme icon in the top bar to cycle between Light, Dark, and Terminal (a black-background, green-monospace look) — your choice is remembered on future visits.
