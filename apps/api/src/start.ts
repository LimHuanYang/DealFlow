import { buildApp } from './server.js';
import { loadEnv } from './env.js';

const env = loadEnv();

buildApp({ env })
  .then((app) => app.listen({ port: env.PORT, host: '0.0.0.0' }))
  .then((address) => {
    console.log(`DealFlow API listening at ${address} (${env.DEPLOYMENT_MODE})`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
