import { describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireRole } from '../../src/plugins/require-role.js';

/**
 * Minimal reply stub that records the status code and body passed to
 * reply.status(...).send(...). status() is chainable like Fastify's.
 */
function makeReplyStub() {
  const calls: { status?: number; body?: unknown } = {};
  const reply = {
    status(code: number) {
      calls.status = code;
      return reply;
    },
    send(body: unknown) {
      calls.body = body;
      return reply;
    },
  };
  return { reply: reply as unknown as FastifyReply, calls };
}

describe('requireRole', () => {
  it('403s FORBIDDEN for a member when roles are owner/admin', async () => {
    const handler = requireRole(['owner', 'admin']);
    const req = { membership: { role: 'member' } } as unknown as FastifyRequest;
    const { reply, calls } = makeReplyStub();

    await handler(req, reply);

    expect(calls.status).toBe(403);
    expect((calls.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('does not 403 when the role is allowed (admin)', async () => {
    const handler = requireRole(['owner', 'admin']);
    const req = { membership: { role: 'admin' } } as unknown as FastifyRequest;
    const { reply, calls } = makeReplyStub();

    await handler(req, reply);

    expect(calls.status).toBeUndefined();
    expect(calls.body).toBeUndefined();
  });

  it('403s FORBIDDEN when membership is undefined', async () => {
    const handler = requireRole(['owner', 'admin']);
    const req = {} as unknown as FastifyRequest;
    const { reply, calls } = makeReplyStub();

    await handler(req, reply);

    expect(calls.status).toBe(403);
    expect((calls.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });
});
