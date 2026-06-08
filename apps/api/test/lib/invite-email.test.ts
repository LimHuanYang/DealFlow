import { describe, expect, it } from 'vitest';
import { buildInviteEmail } from '../../src/lib/invite-email.js';

describe('buildInviteEmail', () => {
  const baseOpts = {
    orgName: 'Acme Inc',
    inviterName: 'Alice Admin',
    role: 'admin' as const,
    acceptUrl: 'https://app.example.com/invite/abc.def-ghi_jk',
  };

  it('subject contains the org name', () => {
    const out = buildInviteEmail(baseOpts);
    expect(out.subject).toContain('Acme Inc');
  });

  it('text body contains the accept URL and the role', () => {
    const out = buildInviteEmail(baseOpts);
    expect(out.text).toContain('https://app.example.com/invite/abc.def-ghi_jk');
    expect(out.text).toMatch(/admin/i);
  });

  it('HTML body contains the accept URL (linked)', () => {
    const out = buildInviteEmail(baseOpts);
    expect(out.html).toContain('https://app.example.com/invite/abc.def-ghi_jk');
    // Should embed the URL inside an anchor tag, not just print it as text.
    expect(out.html).toMatch(/<a\s[^>]*href=["']https:\/\/app\.example\.com\/invite\/abc\.def-ghi_jk["']/i);
  });

  it('text body mentions the inviter when known', () => {
    const out = buildInviteEmail(baseOpts);
    expect(out.text).toContain('Alice Admin');
  });

  it('produces a sensible body when inviterName is null (no "null"/undefined leaks)', () => {
    const out = buildInviteEmail({ ...baseOpts, inviterName: null });
    // No raw "null" or "undefined" stringification anywhere.
    expect(out.text).not.toMatch(/\bnull\b/i);
    expect(out.text).not.toMatch(/\bundefined\b/i);
    expect(out.html).not.toMatch(/\bnull\b/i);
    expect(out.html).not.toMatch(/\bundefined\b/i);
    // Still contains the rest of the invite essentials.
    expect(out.text).toContain('Acme Inc');
    expect(out.text).toContain('https://app.example.com/invite/abc.def-ghi_jk');
    expect(out.subject).toContain('Acme Inc');
  });

  it('handles the "member" role just like the "admin" role', () => {
    const out = buildInviteEmail({ ...baseOpts, role: 'member' });
    expect(out.text).toMatch(/member/i);
    expect(out.html).toMatch(/member/i);
    expect(out.subject).toContain('Acme Inc');
  });
});
