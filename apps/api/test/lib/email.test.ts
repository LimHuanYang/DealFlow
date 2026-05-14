import { describe, expect, it } from 'vitest';
import { isValidEmail, normalizeEmail } from '../../src/lib/email.js';

describe('email utilities', () => {
  it('accepts a normal email', () => {
    expect(isValidEmail('alice@example.com')).toBe(true);
  });

  it('rejects emails with no @ sign', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(isValidEmail('')).toBe(false);
  });

  it('rejects emails with whitespace', () => {
    expect(isValidEmail('a b@example.com')).toBe(false);
  });

  it('normalizes uppercase letters to lowercase', () => {
    expect(normalizeEmail('Alice@Example.COM')).toBe('alice@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  alice@example.com  ')).toBe('alice@example.com');
  });
});
