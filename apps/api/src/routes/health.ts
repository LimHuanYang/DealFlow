import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', async () => ({
    status: 'ok',
    mode: process.env.DEPLOYMENT_MODE ?? 'saas',
  }));
}
