import { describe, expect, it } from 'vitest';
import { publicActivity } from '../../../src/modules/activities/routes.js';

/**
 * Unit test for the activity serializer. The activity detail page's Engagement
 * timeline and tracking badge read these email-tracking fields off the GET
 * /:id response, so the serializer MUST include them — otherwise tracking
 * always renders as "disabled" even when opens/clicks were recorded.
 */
describe('publicActivity serializer', () => {
  const now = new Date('2026-06-05T00:00:00.000Z');

  const emailRow = {
    id: 'act-1',
    kind: 'email',
    body: 'hello',
    subject: 'Quarterly update',
    externalId: '<abc@gmail.com>',
    status: null,
    dueAt: null,
    completedAt: null,
    contactId: 'contact-1',
    companyId: null,
    dealId: null,
    ownerUserId: 'user-1',
    customFields: {},
    ccEmails: ['cc@example.com'],
    bccEmails: null,
    trackingEnabled: true,
    deliveryStatus: 'sent',
    openCount: 2,
    firstOpenedAt: now,
    lastOpenedAt: now,
    clickCount: 1,
    firstClickedAt: now,
    lastClickedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  it('includes email-tracking fields so engagement can render', () => {
    const result = publicActivity(emailRow as Parameters<typeof publicActivity>[0]);

    expect(result.trackingEnabled).toBe(true);
    expect(result.deliveryStatus).toBe('sent');
    expect(result.openCount).toBe(2);
    expect(result.clickCount).toBe(1);
    expect(result.firstOpenedAt).toBe(now.toISOString());
    expect(result.lastOpenedAt).toBe(now.toISOString());
    expect(result.firstClickedAt).toBe(now.toISOString());
    expect(result.lastClickedAt).toBe(now.toISOString());
  });

  it('includes email metadata fields (subject, externalId, cc/bcc)', () => {
    const result = publicActivity(emailRow as Parameters<typeof publicActivity>[0]);

    expect(result.subject).toBe('Quarterly update');
    expect(result.externalId).toBe('<abc@gmail.com>');
    expect(result.ccEmails).toEqual(['cc@example.com']);
    expect(result.bccEmails).toBeNull();
  });
});
