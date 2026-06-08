import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Per-worker env loader (Vitest `setupFiles`). Forked workers run in their own
 * process and do NOT inherit env mutations from `global-setup.ts`, so each
 * worker re-loads `apps/api/.env` here to make `DATABASE_URL` visible to the
 * schema-per-test harness. `loadDotenv` does not override vars already set
 * (e.g. by CI), so explicit env always wins.
 */
loadDotenv({ path: path.resolve(__dirname, '..', '.env') });
