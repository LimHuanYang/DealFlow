import { describe, expect, it } from 'vitest';
import {
  publicEmailEventSchema,
  publicEmailRowSchema,
  emailEngagementRollupSchema,
  emailDashboardQuerySchema,
} from './email-tracking.js';
import { sendEmailBodySchema } from './emails.js';

describe('sendEmailBodySchema (extended)', () => {
  const base = { contactId: '11111111-1111-1111-1111-111111111111', subject: 'Hi', body: 'Body' };
  it('accepts a payload with no cc/bcc/trackEnabled', () => {
    expect(() => sendEmailBodySchema.parse(base)).not.toThrow();
  });
  it('accepts cc + bcc arrays of valid emails', () => {
    expect(() =>
      sendEmailBodySchema.parse({ ...base, cc: ['a@b.com'], bcc: ['c@d.com'] }),
    ).not.toThrow();
  });
  it('rejects an invalid email in cc', () => {
    expect(() => sendEmailBodySchema.parse({ ...base, cc: ['not-an-email'] })).toThrow();
  });
  it('accepts trackEnabled boolean', () => {
    expect(() => sendEmailBodySchema.parse({ ...base, trackEnabled: false })).not.toThrow();
  });
  it('rejects cc with more than 20 entries', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `u${i}@example.com`);
    expect(() => sendEmailBodySchema.parse({ ...base, cc: tooMany })).toThrow();
  });
});

describe('publicEmailEventSchema', () => {
  it('accepts a sent event with no url', () => {
    expect(() =>
      publicEmailEventSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        eventType: 'sent',
        url: null,
        occurredAt: '2026-05-25T01:00:00.000Z',
      }),
    ).not.toThrow();
  });
  it('accepts a click event with a url', () => {
    expect(() =>
      publicEmailEventSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        eventType: 'click',
        url: 'https://example.com',
        occurredAt: '2026-05-25T01:00:00.000Z',
      }),
    ).not.toThrow();
  });
  it('rejects an unknown event type', () => {
    expect(() =>
      publicEmailEventSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        eventType: 'reply',
        url: null,
        occurredAt: '2026-05-25T01:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('emailEngagementRollupSchema', () => {
  it('accepts a fully zeroed rollup', () => {
    expect(() =>
      emailEngagementRollupSchema.parse({
        sent: 0,
        opened: 0,
        openedPct: 0,
        clickedWith: 0,
        clickedWithPct: 0,
        lastActivityAt: null,
      }),
    ).not.toThrow();
  });
  it('accepts a populated rollup', () => {
    expect(() =>
      emailEngagementRollupSchema.parse({
        sent: 8,
        opened: 5,
        openedPct: 0.62,
        clickedWith: 3,
        clickedWithPct: 0.37,
        lastActivityAt: '2026-05-25T01:00:00.000Z',
      }),
    ).not.toThrow();
  });
});

describe('emailDashboardQuerySchema', () => {
  it('applies defaults', () => {
    const out = emailDashboardQuerySchema.parse({});
    expect(out.status).toBe('all');
    expect(out.range).toBe('7d');
  });
  it('rejects an unknown status', () => {
    expect(() => emailDashboardQuerySchema.parse({ status: 'unread' })).toThrow();
  });
});

describe('publicEmailRowSchema', () => {
  it('accepts a row with engagement counts', () => {
    expect(() =>
      publicEmailRowSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        subject: 'Hi',
        recipientName: 'Sarah',
        recipientEmail: 'sarah@acme.com',
        sentAt: '2026-05-25T01:00:00.000Z',
        deliveryStatus: 'sent',
        openCount: 3,
        clickCount: 1,
        attachmentCount: 2,
      }),
    ).not.toThrow();
  });
});
