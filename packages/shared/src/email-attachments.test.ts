import { describe, expect, it } from 'vitest';
import {
  publicEmailAttachmentSchema,
  attachmentCacheDaysSchema,
  ATTACHMENT_CACHE_DAYS,
} from './emails.js';

describe('publicEmailAttachmentSchema', () => {
  const base = {
    id: '11111111-1111-1111-1111-111111111111',
    filename: 'proposal.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    cached: true,
    createdAt: '2026-05-26T01:00:00.000Z',
  };
  it('accepts a complete attachment', () => {
    expect(() => publicEmailAttachmentSchema.parse(base)).not.toThrow();
  });
  it('rejects negative sizeBytes', () => {
    expect(() => publicEmailAttachmentSchema.parse({ ...base, sizeBytes: -1 })).toThrow();
  });
  it('rejects non-uuid id', () => {
    expect(() => publicEmailAttachmentSchema.parse({ ...base, id: 'not-a-uuid' })).toThrow();
  });
  it('requires cached to be a boolean', () => {
    expect(() => publicEmailAttachmentSchema.parse({ ...base, cached: 'yes' })).toThrow();
  });
});

describe('attachmentCacheDaysSchema', () => {
  it.each(ATTACHMENT_CACHE_DAYS)('accepts %s', (v) => {
    expect(() => attachmentCacheDaysSchema.parse(v)).not.toThrow();
  });
  it('rejects 14', () => {
    expect(() => attachmentCacheDaysSchema.parse('14')).toThrow();
  });
  it('exposes exactly four options', () => {
    expect(ATTACHMENT_CACHE_DAYS).toEqual(['7', '30', '90', 'never']);
  });
});
