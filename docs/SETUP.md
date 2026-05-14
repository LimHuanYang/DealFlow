# DealFlow — Setup Guide for Non-Technical Users

> 👋 **Welcome.** This guide assumes you know how to use Windows but have **never used a terminal, Git, or any developer tools**. We go slowly. Every step says what to do AND what you should see afterwards.
>
> **Time required:** 30-60 minutes (most of it is waiting for downloads).
>
> **What you'll have at the end:** DealFlow's dev environment running on your computer, ready for the team to build features on top of.

---

## 📋 Quick Map of This Guide

1. [What is DealFlow and what are we doing here?](#1-what-is-dealflow)
2. [Things you'll need before starting](#2-what-youll-need)
3. [Install Git for Windows](#3-install-git)
4. [Install Node.js](#4-install-nodejs)
5. [Install pnpm](#5-install-pnpm)
6. [Install Docker Desktop](#6-install-docker-desktop)
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
- ✅ At least **8 GB of RAM** (16 GB is more comfortable).
- ✅ At least **10 GB of free disk space**.
- ✅ A working **internet connection** (you'll be downloading ~1.5 GB total).
- ✅ **Administrator rights** on your computer (you'll be installing software).

### Accounts (free)

- A **GitHub account** — sign up free at https://github.com/signup if you don't have one.

### Materials we'll install together (don't install them yet — we'll go step by step)

- **Git for Windows** — for downloading the DealFlow code
- **Node.js** — runs the JavaScript code that powers DealFlow
- **pnpm** — manages the libraries DealFlow uses
- **Docker Desktop** — runs the database and other supporting services
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
   - You'll see screens about "License", "Components", "Default editor", "Initial branch name", "PATH environment", "SSH", "HTTPS transport", "Line endings", etc.
   - **You don't need to change anything.** Click **Next** each time.
   - On the final screen, click **Install**.
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
2. **Important:** make sure the version selector says **"v22.x.x (LTS)"** or higher. (LTS = Long-Term Support, the stable version.)
3. Click **"Windows Installer (.msi)"** for **x64** (most modern PCs).
4. When the file finishes downloading, **double-click it**.
5. Windows asks to allow changes → **Yes**.
6. The installer walks you through several screens. **Just click Next every time.** Defaults are correct.
7. On the screen **"Tools for Native Modules"**, leave the checkbox **unchecked** unless you know you need it.
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
   (or higher — `v24.x.x` is fine too)

✅ **Done with Step 4.**

---

<a id="5-install-pnpm"></a>
## 5. Install pnpm

**What it is:** pnpm is a tool that downloads and organizes the small libraries DealFlow depends on (like LEGO bricks). It comes from npm (which is included with Node.js) but is faster and uses less disk space.

### Step-by-step

1. Open **PowerShell**.
2. Before installing pnpm, we need to allow PowerShell to run scripts. Type and press Enter:
   ```
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
   ```
   - This is a one-time setting. It allows scripts you write yourself (or trust) to run. It's a standard developer setup.
   - You won't see any output. That's fine.
3. Now install pnpm:
   ```
   npm install -g pnpm@9.12.0
   ```
4. Wait ~10-20 seconds. You'll see something like:
   ```
   added 1 package in 16s
   ```

### How to verify pnpm installed correctly

1. **Close PowerShell completely** and open a fresh one. (This refreshes the list of programs it knows about.)
2. Type:
   ```
   pnpm --version
   ```
3. You should see:
   ```
   9.12.0
   ```

✅ **Done with Step 5.**

❌ **Trouble?** If you see a script signing error, you skipped the `Set-ExecutionPolicy` command. Go back and do it.

---

<a id="6-install-docker-desktop"></a>
## 6. Install Docker Desktop

**What it is:** Docker Desktop is software that runs little self-contained "containers" — mini-computers inside your computer. DealFlow uses it to run a database (Postgres), file storage (MinIO), and a test email server (Mailhog) without you needing to install each one separately.

> ⚠️ **This is the most complex install.** Read through before starting. You may need to restart your computer.

### Step-by-step

1. Go to **https://docs.docker.com/desktop/install/windows-install/**.
2. Click the big blue **"Docker Desktop for Windows"** button. This downloads `Docker Desktop Installer.exe` (~600 MB).
3. When it finishes, **double-click** the installer.
4. Windows asks to allow changes → **Yes**.
5. The installer will show a **Configuration** screen with two checkboxes:
   - ✅ **"Use WSL 2 instead of Hyper-V"** — leave this **CHECKED** (this is the modern, recommended option).
   - ✅ **"Add shortcut to desktop"** — your choice.
6. Click **OK**. Installation takes 2-5 minutes.
7. When you see **"Installation succeeded"**, click **Close and restart** if it offers a restart. **If asked, let your computer restart — it's required.**
8. After restart, **Docker Desktop should start automatically**. If it doesn't:
   - Press **Windows key** → type **Docker Desktop** → **Enter**.
9. **First launch:**
   - It may show a **Service Agreement**. Read it, then click **Accept**.
   - It may ask about a tutorial — you can **skip** it.
   - It may say **"WSL 2 needs an update"** → click **Update**. (This downloads a small Windows update.)
   - If it asks for a restart again, do it.
10. **Wait for the bottom-left of the Docker Desktop window to turn green and say "Engine running".** This can take 30 seconds to 2 minutes the first time.

### How to verify Docker installed correctly

1. Open a fresh **PowerShell**.
2. Type:
   ```
   docker --version
   ```
3. You should see:
   ```
   Docker version 27.X.X, build XXXXXXX
   ```
4. Now check the engine is actually running:
   ```
   docker info
   ```
   - If it works, you'll see a long list of details ending with something like `Server Version: 27.X.X`.
   - If you see `"Cannot connect to the Docker daemon"`, Docker Desktop isn't running. Open it from the Start menu and wait for the green status.

✅ **Done with Step 6.**

❌ **"WSL 2 not installed" error:**

Run this in **PowerShell as Administrator** (right-click PowerShell → "Run as administrator"):
```
wsl --install
```
Then **restart your computer** and try Docker Desktop again.

❌ **"Virtualization not enabled" error:**

This is a BIOS setting. The fix depends on your PC manufacturer. Search Google for: `<your laptop model> enable virtualization BIOS` — most have a one-page guide. Common keys to enter BIOS at startup: F2, F10, F12, Del.

> 📚 **Docker's official Windows install guide with screenshots:** https://docs.docker.com/desktop/install/windows-install/

---

<a id="7-install-vs-code"></a>
## 7. Install VS Code (Optional but Recommended)

**What it is:** Visual Studio Code is a free editor for code. You don't strictly need it for this guide, but it makes everything easier.

### Step-by-step

1. Go to **https://code.visualstudio.com/download**.
2. Click **Windows** → download the User Installer.
3. Run the installer. Default options are fine.
4. Recommended: on the **"Select Additional Tasks"** screen, **check the box** that says **"Add 'Open with Code' action to Windows Explorer file context menu"** — this lets you right-click any folder and open it in VS Code.

✅ **Done with Step 7.**

---

<a id="8-download-dealflow"></a>
## 8. Download the DealFlow Code from GitHub

We use Git to "clone" (copy) the code from GitHub to your computer.

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
4. Download (clone) DealFlow:
   ```
   git clone https://github.com/LimHuanYang/DealFlow.git
   ```
5. After ~10 seconds, you'll see:
   ```
   Cloning into 'DealFlow'...
   remote: Enumerating objects: XX, done.
   Receiving objects: 100% (XX/XX), XX.XX KiB
   Resolving deltas: 100% (XX/XX), done.
   ```
6. Move into the project folder:
   ```
   cd DealFlow
   ```

### How to verify the download worked

```
ls
```

You should see folders like `apps`, `packages`, `docs`, and files like `package.json`, `README.md`, `.gitignore`.

✅ **Done with Step 8.**

---

<a id="9-first-time-setup"></a>
## 9. First-Time Setup

Now we install all the libraries DealFlow depends on.

### Step-by-step

1. Make sure you're still in the `DealFlow` folder (your PowerShell prompt should end with `\DealFlow>`).
2. Run:
   ```
   pnpm install
   ```
3. **Be patient.** This downloads ~111 packages. First time: **45-90 seconds**. After that, ~5-10 seconds.
4. You should see a progress bar, then:
   ```
   devDependencies:
   + @eslint/js 9.X.X
   + ...
   Done in XXs
   ```

✅ **Done with Step 9.**

---

<a id="10-run-tests"></a>
## 10. Run the Tests to Confirm Everything Works

DealFlow has **8 automatic tests** that prove the foundation is healthy. Let's run them.

### Step-by-step

1. In PowerShell (still in the DealFlow folder), run:
   ```
   pnpm test
   ```
2. You should see something like:
   ```
   @dealflow/shared:
   ✓ src/pagination.test.ts (4 tests) 17ms
   Test Files  1 passed (1)
   Tests       4 passed (4)

   @dealflow/ai:
   ✓ src/providers/noop.test.ts (4 tests) 25ms
   Test Files  1 passed (1)
   Tests       4 passed (4)
   ```
3. Also try:
   ```
   pnpm typecheck
   ```
   Expect a quick, silent success (no errors).
4. And:
   ```
   pnpm lint
   ```
   Expect a quick, silent success.

✅ **🎉 If all three commands succeed: you're done. DealFlow's foundation is running on your computer.**

---

<a id="11-troubleshooting"></a>
## 11. Common Problems and How to Fix Them

### ❌ "pnpm is not recognized" or "git is not recognized"

**Cause:** Your terminal was open before you installed the tool. It doesn't know about it yet.

**Fix:** Close PowerShell completely (every window) and open a fresh one.

### ❌ "The script cannot be loaded. Not digitally signed."

**Cause:** Windows blocks PowerShell scripts by default.

**Fix:** Run this once in PowerShell:
```
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
```

### ❌ Docker Desktop says "Engine running" but `docker info` fails

**Cause:** WSL 2 backend might be paused. Or the PowerShell window opened before Docker became ready.

**Fix:** Close PowerShell, wait 10 more seconds for Docker, open a fresh PowerShell, try again.

### ❌ `pnpm install` fails with network errors

**Cause:** Corporate proxy, VPN, or flaky internet.

**Fix:** Disable VPN if you're on one. If you're on a corporate network, ask IT for proxy settings or use a personal connection for the first install.

### ❌ "Cannot connect to the Docker daemon"

**Cause:** Docker Desktop isn't running.

**Fix:** Open Docker Desktop from the Start menu. Wait for the bottom-left to be green.

### ❌ Disk space errors

**Cause:** Docker images + Node packages can take ~5 GB. Your drive is full.

**Fix:** Free up space. `pnpm store prune` reclaims some.

### ❌ Tests fail saying "Cannot find module"

**Cause:** `pnpm install` didn't finish, or the lock file is out of date.

**Fix:** Run again:
```
pnpm install --frozen-lockfile
```

If that fails too, fully reset:
```
rm -rf node_modules
rm -rf packages\*\node_modules
pnpm install
```

### Something else?

Open an issue at **https://github.com/LimHuanYang/DealFlow/issues** with:
- What you tried to do
- What you expected
- What actually happened (copy-paste the error)
- Output of `node --version`, `pnpm --version`, `docker --version`
- A screenshot if possible

---

<a id="12-glossary"></a>
## 12. Glossary — What Do These Strange Words Mean?

| Word | Plain English explanation |
|---|---|
| **Terminal** / **PowerShell** | The black window where you type commands instead of clicking buttons. |
| **Command** | A line of text you type that tells the computer to do something. |
| **CLI** | "Command-Line Interface" — fancy word for "tool you use in the terminal". |
| **Repo** / **Repository** | A folder of code that lives on GitHub, plus its history of changes. |
| **Clone** | To download a copy of a repository from GitHub to your computer. |
| **Commit** | A saved snapshot of code changes, with a message describing what changed. |
| **Push** | To upload your commits to GitHub. |
| **Pull** | To download new commits from GitHub. |
| **Package** | A reusable bundle of code someone wrote that DealFlow uses. |
| **Dependency** | A package DealFlow needs to work. |
| **Node.js** | The "engine" that runs JavaScript / TypeScript on your computer. |
| **pnpm** | The tool that downloads and organizes packages for DealFlow. |
| **Docker** | Software that runs "containers" — mini self-contained environments. |
| **Container** | A self-contained mini-computer running one program (like Postgres). |
| **Postgres** / **PostgreSQL** | The database where DealFlow stores everything. |
| **Frontend** / **Web** | The part you see — buttons, pages, the browser experience. |
| **Backend** / **API** | The part you don't see — the brain that the frontend talks to. |
| **Build** | The process of turning source code into the version that runs. |
| **Test** | A small piece of code that checks another piece of code does the right thing. |
| **Typecheck** | A check that the code uses the right types everywhere (TypeScript's job). |
| **Lint** | A check that the code follows style rules (catches bugs and inconsistencies). |
| **WSL 2** | "Windows Subsystem for Linux 2" — lets Windows run Linux for tools like Docker. |
| **Workspace** / **Monorepo** | A single repo containing multiple projects (DealFlow has 5: api, web, shared, db, ai). |

---

## 🎉 You're Done

If you got through all 10 steps, you have a working DealFlow development environment. The team can now build features on top of this foundation, and you can pull updates as they come.

**To pull updates later:**

```powershell
cd $HOME\source\repos\DealFlow
git pull
pnpm install
pnpm test
```

That's it. Welcome to the team.
