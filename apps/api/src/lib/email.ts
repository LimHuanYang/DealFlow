const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(input: string): boolean {
  return EMAIL_REGEX.test(input);
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}
