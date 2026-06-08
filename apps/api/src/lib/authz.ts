import type { OrgRole } from '@dealflow/shared';

export class AuthzError extends Error {
  constructor(message = 'You do not have permission to modify this record.') {
    super(message);
    this.name = 'AuthzError';
  }
}

/** Owner/admin may write anything; a member may write only records they own. */
export function assertCanWrite(role: OrgRole, ownerUserId: string | null, userId: string): void {
  if (role === 'owner' || role === 'admin') return;
  if (ownerUserId && ownerUserId === userId) return;
  throw new AuthzError();
}
