import { createDb } from '@dealflow/db';
import { buildApp } from './server.js';
import { loadEnv } from './env.js';

const env = loadEnv();

if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is required to start the API server.');
  process.exit(1);
}

const conn = createDb(env.DATABASE_URL);

buildApp({ env, db: conn.db })
  .then((app) => app.listen({ port: env.PORT, host: '0.0.0.0' }))
  .then((address) => {
    console.log(`DealFlow API listening at ${address} (${env.DEPLOYMENT_MODE})`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

// Graceful shutdown: close the pg pool when the process exits.
const shutdown = async () => {
  await conn.end().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
