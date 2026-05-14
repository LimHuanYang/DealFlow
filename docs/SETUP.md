# DealFlow — Setup Guide for Non-Technical Users

> 👋 **Welcome.** This guide assumes you know how to use Windows but have **never used a terminal, Git, or any developer tools**. We go slowly. Every step says what to do AND what you should see afterwards.
>
> **Time required:** 30-45 minutes (most of it is waiting for downloads).
>
> **What you'll have at the end:** DealFlow's dev environment running on your computer, ready for the team to build features on top of.

> ℹ️ **As of May 2026** DealFlow runs on **native Postgres** directly on Windows — no Docker, no WSL. Lighter on RAM and simpler to set up.

---

## 📋 Quick Map of This Guide

1. [What is DealFlow and what are we doing here?](#1-what-is-dealflow)
2. [Things you'll need before starting](#2-what-youll-need)
3. [Install Git for Windows](#3-install-git)
4. [Install Node.js](#4-install-nodejs)
5. [Install pnpm](#5-install-pnpm)
6. [Install PostgreSQL 16](#6-install-postgres)
7. [Install a code editor (optional but recommended)](#7-install-vs-code)
8. [Download the DealFlow code from GitHub](#8-download-dealflow)
9. [Set up the project for the first time](#9-first-time-setup)
10. [Run the tests to confirm everything works](#10-run-tests)
11. [Common problems and how to fix them](#11-troubleshooting)
12. [Glossary — what do these strange words mean?](#12-glossary)

---

<a id="1-what-is-dealflow"></a>
## 1. What is DealFlow?

DealFlow is a **CRM** — a piece of software that businesses use to keep track of their customers, sales deals, and follow-ups. Think of it as a smart contact book + to-do list + sales pipeline, all in one.

Today, DealFlow is **under construction**. You're not installing a finished app — you're installing the **building blocks** so the development team can keep adding features. By the end of this guide, you'll be able to run a small web page that says "DealFlow" — and that's the foundation everything else will be built on.

> 💡 **Why is this useful for you?** Once you can run DealFlow on your own machine, you can test new features as they're added, give feedback early, and have your own private copy for experiments.

---

<a id="2-what-youll-need"></a>
## 2. Things You'll Need Before Starting

### Your computer

- ✅ A **Windows 10 or Windows 11** PC.
- ✅ At least **4 GB of RAM** free (8 GB total is fine).
- ✅ At least **5 GB of free disk space**.
- ✅ A working **internet connection** (you'll be downloading ~500 MB total).
- ✅ **Administrator rights** on your computer (you'll be installing software).

### Accounts (free)

- A **GitHub account** — sign up free at https://github.com/signup if you don't have one.

### Materials we'll install together (don't install them yet — we'll go step by step)

- **Git for Windows** — for downloading the DealFlow code
- **Node.js** — runs the JavaScript code that powers DealFlow
- **pnpm** — manages the libraries DealFlow uses
- **PostgreSQL 16** — the database where DealFlow stores everything
- **VS Code** (optional) — to look at the code

### What you should know (don't worry, we'll explain as we go)

- How to **open the Start menu** and search for an app.
- How to **click links**, **download files**, and **run installers**.
- How to **copy and paste** (Ctrl+C / Ctrl+V).
- That's it.

---

<a id="3-install-git"></a>
## 3. Install Git for Windows

**What it is:** Git is the tool that lets your computer talk to GitHub (where the DealFlow code lives). It downloads code, tracks changes, and uploads your changes back.

### Step-by-step

1. Open your web browser and go to **https://git-scm.com/download/win**.
2. The download should start automatically. If not, click the big **"Click here to download manually"** link.
3. When the file (`Git-2.X.X-64-bit.exe`) finishes downloading, **double-click it** to run.
4. Windows may ask **"Do you want to allow this app to make changes to your device?"** — click **Yes**.
5. The installer opens. Just click **Next** through every screen — the defaults are correct.
6. After ~30 seconds, click **Finish**.

### How to verify Git installed correctly

1. Press the **Windows key**, type **PowerShell**, and press **Enter**.
   - A black-or-blue window will open. This is the **terminal**. You can type commands here.
2. Type this command and press **Enter**:
   ```
   git --version
   ```
3. You should see something like:
   ```
   git version 2.46.0.windows.1
   ```

✅ **You're done with Step 3.** Close PowerShell. Move on.

❌ **Trouble?** If you see "git is not recognized", close PowerShell, **open a brand new one**, and try again. Windows needs a fresh terminal to see new installations.

> 📚 **Official guide with pictures:** https://git-scm.com/book/en/v2/Getting-Started-Installing-Git#_installing_on_windows

---

<a id="4-install-nodejs"></a>
## 4. Install Node.js

**What it is:** Node.js is the engine that runs DealFlow's code. You can think of it as the "fuel" — without it, the code doesn't move.

### Step-by-step

1. Go to **https://nodejs.org/en/download/prebuilt-installer**.
2. **Important:** make sure the version selector says **"v22.x.x (LTS)"** or higher.
3. Click **"Windows Installer (.msi)"** for **x64** (most modern PCs).
4. When the file finishes downloading, **double-click it**.
5. Windows asks to allow changes → **Yes**.
6. The installer walks you through several screens. **Just click Next every time.** Defaults are correct.
7. On the screen **"Tools for Native Modules"**, leave the checkbox **unchecked**.
8. Click **Install**, wait ~1 minute, then click **Finish**.

### How to verify Node installed correctly

1. Open a **fresh PowerShell** (close any old one).
2. Type:
   ```
   node --version
   ```
3. You should see something like:
   ```
   v22.10.0
   ```

✅ **Done with Step 4.**

---

<a id="5-install-pnpm"></a>
## 5. Install pnpm

**What it is:** pnpm is a tool that downloads and organizes the small libraries DealFlow depends on (like LEGO bricks).

### Step-by-step

1. Open **PowerShell**.
2. Allow PowerShell to run scripts (one-time):
   ```
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
   ```
3. Install pnpm:
   ```
   npm install -g pnpm@9.12.0
   ```
4. Wait ~10-20 seconds. You'll see `added 1 package in 16s`.

### How to verify pnpm installed correctly

1. **Close PowerShell completely** and open a fresh one.
2. Type:
   ```
   pnpm --version
   ```
3. You should see:
   ```
   9.12.0
   ```

✅ **Done with Step 5.**

---

<a id="6-install-postgres"></a>
## 6. Install PostgreSQL 16

**What it is:** PostgreSQL ("Postgres") is the **database** — the program that stores everything DealFlow remembers: contacts, deals, notes, users. It runs quietly in the background as a Windows service.

> ✅ **Replaces the old Docker + WSL approach.** Uses ~80-150 MB of RAM at idle. Always available — starts with Windows.

### Step-by-step

1. Go to **https://www.postgresql.org/download/windows/**.
2. Click **"Download the installer"** under **EDB**.
3. Pick **Version 16.x** for **Windows x86-64** and click **Download**.
4. When the installer (`postgresql-16.X-windows-x64.exe`, ~350 MB) finishes downloading, **double-click** it.
5. Windows asks to allow changes → **Yes**.

### Click through the installer

| Screen | What to do |
|---|---|
| 1. Welcome | **Next** |
| 2. Installation Directory | keep default (`C:\Program Files\PostgreSQL\16`) → **Next** |
| 3. Select Components | **Uncheck "Stack Builder"**. Keep PostgreSQL Server, pgAdmin 4, Command Line Tools checked → **Next** |
| 4. Data Directory | keep default → **Next** |
| 5. **Password** | type **`postgres`** *(simplest match for our dev convention; change later if you want)* → **Next** |
| 6. Port | keep `5432` → **Next** |
| 7. Locale | keep `Default locale` → **Next** |
| 8. Pre-installation Summary | **Next** |
| 9. Ready to Install | **Next** *(takes 2-3 minutes)* |
| 10. Completion | **Uncheck "Launch Stack Builder"** → **Finish** |

### Create the `dealflow` user and databases

After install, run this **once** in PowerShell to set up the dev user and the two databases (`dealflow` for the app, `dealflow_test` for tests):

```powershell
$env:PGPASSWORD = "postgres"
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"

& $psql -U postgres -h localhost -c "CREATE ROLE dealflow LOGIN PASSWORD 'dealflow' CREATEDB;"
& $psql -U postgres -h localhost -c "CREATE DATABASE dealflow OWNER dealflow;"
& $psql -U postgres -h localhost -c "CREATE DATABASE dealflow_test OWNER dealflow;"

$env:PGPASSWORD = ""
```

### How to verify PostgreSQL installed correctly

In PowerShell:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" --version
Get-Service postgresql-x64-16
```

You should see:
- `psql (PostgreSQL) 16.x`
- A `postgresql-x64-16` service with status **Running**, StartType **Automatic**.

### How to verify the `dealflow` user works

```powershell
$env:PGPASSWORD = "dealflow"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U dealflow -h localhost -d dealflow -c "SELECT current_user, current_database();"
$env:PGPASSWORD = ""
```

You should see a row with `dealflow | dealflow`. ✅

> 📚 **Official Postgres Windows install guide:** https://www.postgresql.org/docs/16/install-windows.html
> 📚 **Want a GUI to browse the database?** pgAdmin 4 was installed with Postgres. Start menu → search **pgAdmin 4**.

---

<a id="7-install-vs-code"></a>
## 7. Install VS Code (Optional but Recommended)

1. Go to **https://code.visualstudio.com/download**.
2. Click **Windows** → download the User Installer.
3. Run the installer. Default options are fine.
4. On **"Select Additional Tasks"**, **check** "Add 'Open with Code' action to Windows Explorer file context menu".

✅ **Done with Step 7.**

---

<a id="8-download-dealflow"></a>
## 8. Download the DealFlow Code from GitHub

### Step-by-step

1. Open **PowerShell**.
2. Create a folder for code (skip if you already have one):
   ```
   mkdir $HOME\source\repos
   ```
3. Move into it:
   ```
   cd $HOME\source\repos
   ```
4. Clone DealFlow:
   ```
   git clone https://github.com/LimHuanYang/DealFlow.git
   ```
5. Move into the project folder:
   ```
   cd DealFlow
   ```

### How to verify the download worked

```
ls
```

Folders: `apps`, `packages`, `docs`. Files: `package.json`, `README.md`, etc.

✅ **Done with Step 8.**

---

<a id="9-first-time-setup"></a>
## 9. First-Time Setup

```
pnpm install
```

Be patient — first run takes ~45-90 seconds. After: `Done in XXs`.

✅ **Done with Step 9.**

---

<a id="10-run-tests"></a>
## 10. Run the Tests to Confirm Everything Works

```
pnpm test
```

You should see:

```
@dealflow/shared:   ✓ 4 tests passed
@dealflow/ai:       ✓ 4 tests passed
@dealflow/api:      ✓ 3 tests passed (health x2 + Postgres helper x1)
Total:              11 passed
```

Also try:

```
pnpm typecheck
pnpm lint
```

Both should print no errors.

✅ **🎉 If all succeed: DealFlow's foundation is running on your computer.**

---

<a id="11-troubleshooting"></a>
## 11. Common Problems and How to Fix Them

### ❌ "pnpm/git/psql is not recognized"
Close PowerShell and open a fresh one. Windows needs a new terminal to see newly-installed tools.

### ❌ "The script cannot be loaded. Not digitally signed."
Run once: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force`

### ❌ Tests fail with "connect ECONNREFUSED 127.0.0.1:5432"
Postgres isn't running. Check the service:
```powershell
Get-Service postgresql-x64-16
Start-Service postgresql-x64-16   # if stopped
```

### ❌ Tests fail with "role 'dealflow' does not exist" or "password authentication failed"
You skipped the "Create the dealflow user and databases" sub-step in Step 6. Run those `CREATE ROLE` / `CREATE DATABASE` commands now.

### ❌ Tests fail with "database 'dealflow_test_XXXX' already exists"
A previous test run leaked. Reset cleanly:
```powershell
$env:PGPASSWORD = "postgres"
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
# List leaked test DBs
& $psql -U postgres -h localhost -c "SELECT datname FROM pg_database WHERE datname LIKE 'dealflow_test_%';"
# Drop one:  & $psql -U postgres -h localhost -c "DROP DATABASE dealflow_test_xxxxx;"
$env:PGPASSWORD = ""
```

### ❌ `pnpm install` fails with network errors
Disable VPN if on one. If on a corporate network, ask IT for proxy settings or use a personal connection.

### Something else?
Open an issue at **https://github.com/LimHuanYang/DealFlow/issues** with:
- What you tried
- What you expected
- What actually happened (copy-paste the error)
- Output of `node --version`, `pnpm --version`, `psql --version`
- A screenshot if relevant.

---

<a id="12-glossary"></a>
## 12. Glossary — What Do These Strange Words Mean?

| Word | Plain English explanation |
|---|---|
| **Terminal** / **PowerShell** | The black window where you type commands instead of clicking buttons. |
| **Command** | A line of text you type that tells the computer to do something. |
| **Repo** / **Repository** | A folder of code that lives on GitHub, plus its history of changes. |
| **Clone** | To download a copy of a repository from GitHub to your computer. |
| **Commit** | A saved snapshot of code changes, with a message describing what changed. |
| **Push** | To upload your commits to GitHub. |
| **Pull** | To download new commits from GitHub. |
| **Package** | A reusable bundle of code someone wrote that DealFlow uses. |
| **Dependency** | A package DealFlow needs to work. |
| **Node.js** | The "engine" that runs JavaScript / TypeScript on your computer. |
| **pnpm** | The tool that downloads and organizes packages for DealFlow. |
| **PostgreSQL** / **Postgres** | The database where DealFlow stores everything (contacts, deals, notes…). |
| **Windows Service** | A program that runs in the background, started automatically by Windows (Postgres is one). |
| **Frontend** / **Web** | The part you see — buttons, pages, the browser experience. |
| **Backend** / **API** | The part you don't see — the brain the frontend talks to. |
| **Test** | A small piece of code that checks another piece of code does the right thing. |
| **Typecheck** | A check that the code uses the right types everywhere (TypeScript's job). |
| **Lint** | A check that the code follows style rules (catches bugs and inconsistencies). |
| **Workspace** / **Monorepo** | A single repo containing multiple projects (DealFlow has 5: api, web, shared, db, ai). |

---

## 🎉 You're Done

If you got through all 10 steps, you have a working DealFlow development environment.

**To pull updates later:**

```powershell
cd $HOME\source\repos\DealFlow
git pull
pnpm install
pnpm test
```

That's it. Welcome to the team.
