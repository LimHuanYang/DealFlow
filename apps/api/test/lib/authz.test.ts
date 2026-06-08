import { describe, expect, it } from 'vitest';
import { assertCanWrite, AuthzError } from '../../src/lib/authz.js';

describe('assertCanWrite', () => {
  const me = 'user-1';
  const other = 'user-2';

  describe('owner', () => {
    it('may write regardless of ownerUserId', () => {
      expect(() => assertCanWrite('owner', me, me)).not.toThrow();
      expect(() => assertCanWrite('owner', other, me)).not.toThrow();
      expect(() => assertCanWrite('owner', null, me)).not.toThrow();
    });
  });

  describe('admin', () => {
    it('may write regardless of ownerUserId', () => {
      expect(() => assertCanWrite('admin', me, me)).not.toThrow();
      expect(() => assertCanWrite('admin', other, me)).not.toThrow();
      expect(() => assertCanWrite('admin', null, me)).not.toThrow();
    });
  });

  describe('member', () => {
    it('may write a record they own', () => {
      expect(() => assertCanWrite('member', me, me)).not.toThrow();
    });

    it('throws AuthzError for a record owned by someone else', () => {
      expect(() => assertCanWrite('member', other, me)).toThrow(AuthzError);
    });

    it('throws AuthzError when the record has no owner', () => {
      expect(() => assertCanWrite('member', null, me)).toThrow(AuthzError);
    });
  });
});
