# DealFlow — working agreements

## Git workflow

- **Commit and push automatically — do NOT ask for confirmation.** When a change
  is complete and verified (tests/typecheck/lint pass), commit it and push to
  `origin` without pausing to ask. This is a solo project; the owner has
  consented to committing directly to `main`.
- Still observe safety boundaries (these are not "ask every time", just don't do
  them unless explicitly requested): never skip hooks (`--no-verify`), never
  bypass signing, and don't force-push or run destructive history rewrites
  without a clear reason.
- Keep commit messages conventional (`feat:`, `fix:`, `docs:`, `ci:`, …) and end
  them with the `Co-Authored-By` trailer.
- **Never commit secrets.** `apps/api/.env` is gitignored and holds real keys
  (DATABASE_URL/Supabase, INTEGRATION_ENCRYPTION_KEY, EMAIL_TRACKING_SECRET,
  AI/SMTP creds) — keep it that way; `.env.example` files hold placeholders only.

## Environment

- **Database = Supabase** (region ap-southeast-2). Connection is in
  `apps/api/.env` as `DATABASE_URL` (+`?sslmode=require`). No local Postgres or
  Docker is used to run the app.
- Integration tests (`pnpm test`) need a throwaway Postgres with `CREATE DATABASE`
  rights (the harness makes a DB per test file). They run in CI against an
  ephemeral Postgres service; Supabase can't host them.
