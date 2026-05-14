# DealFlow — Testing Checklist (Outside Claude)

**Last updated:** 2026-05-15
**Current phase:** Phase 1 · Sub-Plan 1 (Foundation) · Complete, tagged `phase-1-foundation`
**Repo:** https://github.com/LimHuanYang/DealFlow

> ℹ️ **Stack note (May 2026):** DealFlow runs on **native Postgres** on the host machine — Docker and WSL are no longer used. Lighter on RAM and simpler to set up. See `SETUP.md` for installation.

---

## ⚠️ Read this first — what actually exists right now

DealFlow is **scaffolding plus a few tests**, not a CRM product yet. This is by design.

### ✅ What is built and testable RIGHT NOW

| Component | What you can verify |
|---|---|
| pnpm monorepo | `pnpm install` succeeds from a clean clone |
| TypeScript strict mode | `pnpm typecheck` passes across all packages |
| ESLint flat config | `pnpm lint` passes with zero errors |
| Prettier | `pnpm format:check` passes |
| `@dealflow/shared` (Zod) | 4 unit tests pass for `paginationQuerySchema` |
| `@dealflow/db` (Drizzle scaffold) | Typechecks; schema entry point exists (empty for now) |
| `@dealflow/ai` (provider + Noop) | 4 unit tests pass for `NoopAIProvider` throwing `AIDisabledError` |
| `apps/api` Fastify health route | 2 tests pass (200 + 404 envelope) via `Fastify.inject()` |
| `apps/api` Postgres test helper | 1 test passes — creates a disposable per-test database, runs `SELECT 1`, drops it |
| `apps/web` skeleton | `pnpm --filter @dealflow/web build` produces a dist bundle |
| Playwright E2E smoke | 1 test passes — opens the web app and asserts the "DealFlow" hero |
| `.gitattributes` + `.gitignore` | Working tree stays clean across commits |
| Git history | 15+ commits on `main`, pushed to GitHub, tagged `phase-1-foundation` |

### ❌ What is NOT built yet — do not try to test these

| Feature | Plan | Don't expect to see |
|---|---|---|
| Auth (signup, login, sessions) | Sub-Plan 2 | A login page |
| Multi-tenancy (orgs, invites) | Sub-Plan 2 | Inviting teammates |
| Contacts & Companies | Sub-Plan 3 | Creating/viewing contacts |
| Deals & Pipeline (kanban) | Sub-Plan 4 | Drag-and-drop deals |
| Activities / Notes / Tasks | Sub-Plan 5 | Logging calls or notes |
| AI features (4 actions) | Sub-Plan 6 | AI summarize / draft / extract |
| Self-host single-image deploy | Sub-Plan 7 (Phase 3+) | A one-command deploy |

If you click around expecting a CRM right now, you will see nothing. That's not a bug — the web page literally only renders the word "DealFlow".

---

## Prerequisites — install BEFORE testing

| Tool | Why | Where to get it |
|---|---|---|
| **Windows 10 or 11** | Host OS | (you already have this) |
| **Node.js 22 LTS or newer** | Runs the code | https://nodejs.org/en/download |
| **pnpm 9+** | Package manager | After Node: `npm install -g pnpm@9.12.0` |
| **Git** | Downloads code from GitHub | https://git-scm.com/download/win |
| **PostgreSQL 16** + `dealflow` user + `dealflow` and `dealflow_test` databases | Database for the API + integration tests | https://www.postgresql.org/download/windows/ — see `SETUP.md` §6 for the exact setup commands |
| **GitHub account** | To pull / push code | https://github.com/signup |

**Hardware:** 4 GB RAM free, 5 GB free disk, modern Windows.

If you've never installed any of these, follow `SETUP.md` for the step-by-step beginner guide.

---

## Verification Checklist (in order)

### Step 1 — Verify your tools are installed

```powershell
node --version
pnpm --version
git --version
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" --version
```

**Pass if:**
- ✅ Node prints `v22.x.x` or higher
- ✅ pnpm prints `9.x.x` or higher
- ✅ Git prints `git version 2.x.x` or higher
- ✅ psql prints `psql (PostgreSQL) 16.x`

### Step 2 — Clone the repo

```powershell
cd $HOME\source\repos
git clone https://github.com/LimHuanYang/DealFlow.git
cd DealFlow
```

**Pass if:**
- ✅ A `DealFlow` folder is created with files inside.
- ✅ `git log --oneline` shows commits ending with the design doc.

### Step 3 — Install dependencies

```powershell
pnpm install
```

**Pass if:**
- ✅ Ends with `Done in XX.Xs` — no red errors.

### Step 4 — Lint + format checks pass

```powershell
pnpm lint
pnpm format:check
```

**Pass if:**
- ✅ Both exit with code 0.
- ✅ `pnpm format:check` says "All matched files use Prettier code style!".

### Step 5 — TypeScript typecheck passes

```powershell
pnpm typecheck
```

**Pass if all 5 workspace packages compile clean.**

### Step 6 — Unit + integration tests pass

```powershell
pnpm test
```

**Pass if:**
- ✅ `@dealflow/shared` 4 passed
- ✅ `@dealflow/ai` 4 passed
- ✅ `@dealflow/api` 3 passed (2 health + 1 Postgres helper)
- ✅ Total: **11 passed, 0 failed**

### Step 7 — Verify git remote points to GitHub

```powershell
git remote -v
```

**Pass if:** output contains `origin  https://github.com/LimHuanYang/DealFlow.git`

### Step 8 — Verify Postgres is running

```powershell
Get-Service postgresql-x64-16
```

**Pass if:** Status **Running**, StartType **Automatic**.

```powershell
$env:PGPASSWORD = "dealflow"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U dealflow -h localhost -d dealflow -c "SELECT 1;"
$env:PGPASSWORD = ""
```

**Pass if:** returns `1` row. ✅

### Step 9 — E2E smoke (Playwright)

```powershell
pnpm test:e2e
```

(First run downloads ~300 MB of Chromium — be patient.)

**Pass if:** 1 test passes.

---

## Status Summary at the End

If everything from Step 1–9 passes:

> ✅ **Foundation is healthy.** No DealFlow features exist yet (Sub-Plan 2+ not started), but the scaffolding is solid.

If anything fails, see SETUP.md §11 "Common problems" or report below.

---

## Reporting a Problem

When something fails, please include:

1. **Which step number** failed.
2. **Exact command** you ran.
3. **Exact output / error message** (copy-paste).
4. **Your environment:**
   - `node --version`
   - `pnpm --version`
   - `psql --version`
   - Windows version (Settings → System → About → "Edition" and "Version")
5. **Screenshot** if helpful.

Open an issue: https://github.com/LimHuanYang/DealFlow/issues

---

## Test Sign-off Form (copy-paste)

```
Tester:
Date:

Environment:
- Windows:
- Node:
- pnpm:
- Postgres:

Step 1  (versions):                  [ PASS / FAIL ]
Step 2  (clone):                     [ PASS / FAIL ]
Step 3  (pnpm install):              [ PASS / FAIL ]
Step 4  (lint + format):             [ PASS / FAIL ]
Step 5  (typecheck):                 [ PASS / FAIL ]
Step 6  (unit tests — 11 passing):   [ PASS / FAIL ]
Step 7  (git remote):                [ PASS / FAIL ]
Step 8  (Postgres running):          [ PASS / FAIL ]
Step 9  (Playwright E2E):            [ PASS / FAIL ]

Overall foundation status:  [ GREEN / YELLOW / RED ]

Notes / issues:


```
