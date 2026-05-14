import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';

export async function registerCors(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });
}
