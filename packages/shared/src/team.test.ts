import { describe, expect, it } from 'vitest';
import {
  ORG_ROLES,
  orgRoleSchema,
  assignableRoleSchema,
  createInvitationBodySchema,
} from './team.js';

describe('ORG_ROLES', () => {
  it('is owner, admin, member', () => {
    expect(ORG_ROLES).toEqual(['owner', 'admin', 'member']);
  });
});

describe('orgRoleSchema', () => {
  it('accepts owner, admin, and member', () => {
    expect(orgRoleSchema.parse('owner')).toBe('owner');
    expect(orgRoleSchema.parse('admin')).toBe('admin');
    expect(orgRoleSchema.parse('member')).toBe('member');
  });

  it('rejects an unknown role', () => {
    expect(orgRoleSchema.safeParse('superadmin').success).toBe(false);
    expect(orgRoleSchema.safeParse('').success).toBe(false);
  });
});

describe('assignableRoleSchema', () => {
  it('accepts admin and member', () => {
    expect(assignableRoleSchema.parse('admin')).toBe('admin');
    expect(assignableRoleSchema.parse('member')).toBe('member');
  });

  it('rejects owner (never directly grantable)', () => {
    expect(assignableRoleSchema.safeParse('owner').success).toBe(false);
  });
});

describe('createInvitationBodySchema', () => {
  it('accepts a valid email with role member', () => {
    const parsed = createInvitationBodySchema.parse({
      email: 'new@example.com',
      role: 'member',
    });
    expect(parsed).toEqual({ email: 'new@example.com', role: 'member' });
  });

  it('rejects a malformed email', () => {
    expect(
      createInvitationBodySchema.safeParse({ email: 'not-an-email', role: 'member' }).success,
    ).toBe(false);
  });

  it('rejects role owner', () => {
    expect(
      createInvitationBodySchema.safeParse({ email: 'new@example.com', role: 'owner' }).success,
    ).toBe(false);
  });
});
