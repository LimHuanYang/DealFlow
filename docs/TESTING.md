# DealFlow — Testing Checklist (Outside Claude)

**Last updated:** 2026-05-13
**Current phase:** Phase 1 · Sub-Plan 1 (Foundation) · Tasks 1-4 of 12 complete
**Repo:** https://github.com/LimHuanYang/DealFlow

---

## ⚠️ Read this first — what actually exists right now

DealFlow is **scaffolding**, not a product yet. This is by design: we're building from the foundation up, one slice at a time, so each layer is solid before the next is added.

### ✅ What is built and testable RIGHT NOW (Tasks 1-4)

| Component | What you can verify |
|---|---|
| pnpm monorepo | `pnpm install` succeeds from a clean clone |
| TypeScript strict mode | `pnpm typecheck` passes across all packages |
| ESLint flat config | `pnpm lint` passes with zero errors |
| Prettier | `pnpm format:check` passes |
| `@dealflow/shared` (Zod) | 4 unit tests pass for `paginationQuerySchema` |
| `@dealflow/db` (Drizzle scaffold) | Typechecks; schema entry point exists (empty for now) |
| `@dealflow/ai` (provider + Noop) | 4 unit tests pass for `NoopAIProvider` throwing `AIDisabledError` |
| `.gitattributes` + `.gitignore` | Working tree stays clean across commits |
| Git history | 7 commits on `main`, pushed to GitHub |

### ❌ What is NOT built yet — do not try to test these

These are explicitly planned for later Sub-Plans within Phase 1:

| Feature | Plan | Don't expect to see |
|---|---|---|
| Fastify API server | Task 6 (Sub-Plan 1) | Any HTTP endpoint working |
| React web app | Task 8 (Sub-Plan 1) | A real UI — only a placeholder "DealFlow" page |
| Docker dev environment | Task 5 (Sub-Plan 1) | Postgres / MinIO / Mailhog containers |
| Auth (signup, login, sessions) | Sub-Plan 2 | A login page |
| Multi-tenancy (orgs, invites) | Sub-Plan 2 | Inviting teammates |
| Contacts & Companies | Sub-Plan 3 | Creating/viewing contacts |
| Deals & Pipeline (kanban) | Sub-Plan 4 | Drag-and-drop deals |
| Activities / Notes / Tasks | Sub-Plan 5 | Logging calls or notes |
| AI features (4 actions) | Sub-Plan 6 | AI summarize / draft / extract |
| Self-host Docker image | Sub-Plan 7 | A single-image deploy |
| E2E flows (Playwright) | Tasks 9 + Sub-Plans | Browser-based tests |
| CI on GitHub Actions | Task 10 (Sub-Plan 1) | Green checks on PRs |

If you click around expecting a CRM right now, you will see nothing. That's not a bug.

---

## Prerequisites — install BEFORE testing

You need these installed on your Windows machine:

| Tool | Why | Where to get it |
|---|---|---|
| **Windows 10 or 11** | Required for Docker Desktop with WSL 2 | (you already have this) |
| **Node.js 22 LTS or newer** | Runs the JavaScript/TypeScript code | https://nodejs.org/en/download |
| **pnpm 9+** | Package manager (faster than npm) | After Node: run `npm install -g pnpm@9.12.0` |
| **Git** | Downloads code from GitHub | https://git-scm.com/download/win |
| **Docker Desktop** | Runs Postgres / MinIO / Mailhog containers | https://docs.docker.com/desktop/install/windows-install/ |
| **GitHub account** | To pull / push code | https://github.com/signup |
| **Read access to the repo** | LimHuanYang/DealFlow is public — no special access needed |
| **A code editor** (recommended) | To read code; VS Code is the default | https://code.visualstudio.com/download |
| **A modern browser** | Chrome / Edge / Firefox latest | (you already have this) |

**Hardware:** 8 GB RAM minimum (16 GB recommended once Postgres + Node + browser all run together), 10 GB free disk space.

If you've never installed any of these, follow `SETUP.md` for the step-by-step beginner guide.

---

## Verification Checklist (in order)

Run each step. Each one has an exact command, the exact output to expect, and a ✅ / ❌ test you can apply.

### Step 1 — Verify your tools are installed

Open **PowerShell** (Start menu → type "PowerShell" → Enter) and run:

```powershell
node --version
pnpm --version
git --version
docker --version
```

**Pass if:**
- ✅ Node prints `v22.x.x` or higher (e.g. `v24.14.0`)
- ✅ pnpm prints `9.x.x` or higher
- ✅ Git prints `git version 2.x.x` or higher
- ✅ Docker prints `Docker version 27.x.x` or higher

**Fail / Troubleshoot:**
- ❌ "command not found" → that tool isn't installed (or just installed and you didn't open a fresh PowerShell). Re-install or open a new PowerShell.
- ❌ Old Node version → install Node 22 LTS.

### Step 2 — Clone the repo

```powershell
cd $HOME\source\repos
git clone https://github.com/LimHuanYang/DealFlow.git
cd DealFlow
```

**Pass if:**
- ✅ A `DealFlow` folder is created with files inside.
- ✅ `git log --oneline` shows a list of commits ending with `docs: initial Phase 1 (Kernel) design`.

### Step 3 — Install dependencies

```powershell
pnpm install
```

**Pass if:**
- ✅ Ends with `Done in XX.Xs` — no red errors.
- ✅ A `node_modules` folder appears in the project root and inside each package.
- ✅ `pnpm-lock.yaml` already exists and is not modified afterwards.

**First run takes ~45 seconds** (downloading packages from the internet). Subsequent runs are much faster (~5-10 seconds, mostly cached).

**Fail / Troubleshoot:**
- ❌ "ERR_PNPM_UNSUPPORTED_ENGINE" → your Node is older than 22. Upgrade.
- ❌ Network errors → check your internet connection / proxy.
- ❌ PowerShell script signing error → run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force` once, then retry.

### Step 4 — Lint + format checks pass

```powershell
pnpm lint
pnpm format:check
```

**Pass if:**
- ✅ Both end with exit code 0.
- ✅ `pnpm format:check` prints `All matched files use Prettier code style!`.
- ✅ `pnpm lint` prints nothing (no errors).

### Step 5 — TypeScript typecheck passes

```powershell
pnpm typecheck
```

**Pass if:**
- ✅ All packages (`shared`, `db`, `ai`) typecheck with no errors.
- ✅ Exit code 0.

**Expected time:** ~5-15 seconds.

### Step 6 — Unit tests pass

```powershell
pnpm test
```

**Pass if:**
- ✅ `@dealflow/shared`: **4 tests passed** (paginationQuerySchema)
- ✅ `@dealflow/ai`: **4 tests passed** (NoopAIProvider)
- ✅ Total: **8 tests passed, 0 failed**.

**Expected time:** ~5-10 seconds.

### Step 7 — Verify git remote points to GitHub

```powershell
git remote -v
```

**Pass if:**
- ✅ Output contains `origin  https://github.com/LimHuanYang/DealFlow.git`

### Step 8 — Verify Docker Desktop is running

Open Docker Desktop (Start menu → Docker Desktop). Wait until the bottom-left status shows **green** and says **"Engine running"**.

In PowerShell:

```powershell
docker info
```

**Pass if:**
- ✅ Output includes a `Server Version: 27.x.x` (or newer) line.
- ✅ No "Cannot connect" errors.

**This is the gate** before we can run Task 5 (the dev environment). If it fails, see SETUP.md → "Docker Desktop won't start".

### Step 9 — (Once Task 5 is built) Bring up the dev environment

This step **will not work yet** because Task 5 hasn't been done. After it's complete, this section will be:

```powershell
pnpm dev:env
```

You'd expect to see Postgres, MinIO, and Mailhog containers starting.

---

## Status Summary at the End

If everything from Step 1–8 passes:

> ✅ **Foundation is healthy.** No DealFlow features exist yet (Tasks 5-12 not done), but the scaffolding is solid. Ready to continue with Sub-Plan 1 Tasks 5-12, then move into Sub-Plan 2 (Auth & Tenancy).

If steps 1-7 pass but Step 8 (Docker) fails:

> ⚠️ **Foundation builds and tests fine; Docker isn't ready yet.** That's only a blocker for Task 5 onwards. Fix Docker before continuing.

If anything in steps 1-7 fails:

> ❌ **Foundation has a real problem.** Report it with the section below.

---

## Reporting a Problem

When something fails, please include:

1. **Which step number** failed.
2. **Exact command** you ran.
3. **Exact output / error message** (copy-paste the whole thing).
4. **Your environment:**
   - Output of `node --version`
   - Output of `pnpm --version`
   - Output of `docker --version`
   - Windows version (Settings → System → About → "Edition" and "Version")
5. **Screenshot** of the PowerShell window if visual context matters.

Open an issue on GitHub: https://github.com/LimHuanYang/DealFlow/issues

---

## Test Sign-off Form (copy-paste this)

```
Tester:
Date:

Environment:
- Windows: 
- Node: 
- pnpm: 
- Docker: 

Step 1  (versions):                  [ PASS / FAIL ]
Step 2  (clone):                     [ PASS / FAIL ]
Step 3  (pnpm install):              [ PASS / FAIL ]
Step 4  (lint + format):             [ PASS / FAIL ]
Step 5  (typecheck):                 [ PASS / FAIL ]
Step 6  (unit tests — 8 passing):    [ PASS / FAIL ]
Step 7  (git remote):                [ PASS / FAIL ]
Step 8  (docker info):               [ PASS / FAIL ]

Overall foundation status:  [ GREEN / YELLOW / RED ]

Notes / issues:


```
