import { describe, expect, it } from 'vitest';
import { sendEmailBodySchema, draftEmailBodySchema } from './emails.js';

const UUID = '00000000-0000-0000-0000-000000000001';

describe('sendEmailBodySchema', () => {
  it('accepts a minimal valid send payload', () => {
    expect(
      sendEmailBodySchema.safeParse({
        contactId: UUID,
        subject: 'Re: Pricing',
        body: 'Hi Bob,\nPlease find pricing attached.',
      }).success,
    ).toBe(true);
  });
  it('rejects empty subject', () => {
    expect(sendEmailBodySchema.safeParse({ contactId: UUID, subject: '', body: 'x' }).success).toBe(
      false,
    );
  });
  it('rejects empty body', () => {
    expect(sendEmailBodySchema.safeParse({ contactId: UUID, subject: 's', body: '' }).success).toBe(
      false,
    );
  });
  it('rejects missing contactId', () => {
    expect(sendEmailBodySchema.safeParse({ subject: 's', body: 'b' }).success).toBe(false);
  });
  it('rejects subject over 200 chars', () => {
    expect(
      sendEmailBodySchema.safeParse({ contactId: UUID, subject: 'x'.repeat(201), body: 'b' })
        .success,
    ).toBe(false);
  });
});

describe('draftEmailBodySchema', () => {
  it('accepts contactId + intent', () => {
    expect(
      draftEmailBodySchema.safeParse({ contactId: UUID, intent: 'follow up on demo' }).success,
    ).toBe(true);
  });
  it('rejects missing intent', () => {
    expect(draftEmailBodySchema.safeParse({ contactId: UUID }).success).toBe(false);
  });
  it('rejects empty intent', () => {
    expect(draftEmailBodySchema.safeParse({ contactId: UUID, intent: '' }).success).toBe(false);
  });
});
