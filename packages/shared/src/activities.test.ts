import { describe, expect, it } from 'vitest';
import {
  createActivityBodySchema,
  updateActivityBodySchema,
  listTasksQuerySchema,
  ACTIVITY_KINDS,
  TASK_STATUSES,
} from './activities.js';

describe('createActivityBodySchema', () => {
  it('accepts a minimal note attached to a contact', () => {
    const r = createActivityBodySchema.safeParse({
      kind: 'note',
      body: 'Met at conference',
      contactId: '00000000-0000-0000-0000-000000000001',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a task with a due date attached to a deal', () => {
    const r = createActivityBodySchema.safeParse({
      kind: 'task',
      body: 'Send proposal',
      dealId: '00000000-0000-0000-0000-000000000001',
      dueAt: '2026-06-01',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown kind', () => {
    const r = createActivityBodySchema.safeParse({
      kind: 'call',
      body: 'x',
      contactId: '00000000-0000-0000-0000-000000000001',
    });
    expect(r.success).toBe(false);
  });

  it('rejects payload with NO parent', () => {
    const r = createActivityBodySchema.safeParse({ kind: 'note', body: 'x' });
    expect(r.success).toBe(false);
  });

  it('rejects payload with TWO parents', () => {
    const r = createActivityBodySchema.safeParse({
      kind: 'note',
      body: 'x',
      contactId: '00000000-0000-0000-0000-000000000001',
      companyId: '00000000-0000-0000-0000-000000000002',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty body', () => {
    const r = createActivityBodySchema.safeParse({
      kind: 'note',
      body: '',
      contactId: '00000000-0000-0000-0000-000000000001',
    });
    expect(r.success).toBe(false);
  });

  it('rejects bad uuid', () => {
    const r = createActivityBodySchema.safeParse({
      kind: 'note',
      body: 'x',
      contactId: 'not-a-uuid',
    });
    expect(r.success).toBe(false);
  });
});

describe('updateActivityBodySchema', () => {
  it('accepts an empty patch', () => {
    const r = updateActivityBodySchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('accepts partial body and status', () => {
    const r = updateActivityBodySchema.safeParse({ body: 'edit', status: 'done' });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const r = updateActivityBodySchema.safeParse({ status: 'archived' });
    expect(r.success).toBe(false);
  });

  it('accepts null dueAt (clearing the due date)', () => {
    const r = updateActivityBodySchema.safeParse({ dueAt: null });
    expect(r.success).toBe(true);
  });
});

describe('listTasksQuerySchema', () => {
  it('accepts empty query (defaults to status=open, due=all)', () => {
    const r = listTasksQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe('open');
      expect(r.data.due).toBe('all');
    }
  });

  it('accepts status=done', () => {
    const r = listTasksQuerySchema.safeParse({ status: 'done' });
    expect(r.success).toBe(true);
  });

  it('accepts due=overdue, today, upcoming', () => {
    expect(listTasksQuerySchema.safeParse({ due: 'overdue' }).success).toBe(true);
    expect(listTasksQuerySchema.safeParse({ due: 'today' }).success).toBe(true);
    expect(listTasksQuerySchema.safeParse({ due: 'upcoming' }).success).toBe(true);
  });

  it('rejects unknown filter values', () => {
    expect(listTasksQuerySchema.safeParse({ status: 'foo' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ due: 'bar' }).success).toBe(false);
  });
});

describe('ACTIVITY_KINDS / TASK_STATUSES', () => {
  it('ACTIVITY_KINDS is exactly ["note","task"]', () => {
    expect([...ACTIVITY_KINDS]).toEqual(['note', 'task']);
  });
  it('TASK_STATUSES is exactly ["open","done"]', () => {
    expect([...TASK_STATUSES]).toEqual(['open', 'done']);
  });
});
