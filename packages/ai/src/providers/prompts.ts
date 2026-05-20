import type { DraftEmailOutput, ExtractContactOutput } from '../provider.js';

export const SUMMARIZE_SYSTEM = [
  'You are a CRM assistant. Read the activity history below and write a concise summary',
  'in 2–4 sentences covering: who the contact is, what we have discussed, and what the',
  'current state is. No preamble, no markdown — just the summary as plain text.',
].join(' ');

export const EXTRACT_SYSTEM = [
  'You are a contact-extraction tool. Read the text below (often an email signature, a',
  'LinkedIn snippet, or a freeform paste) and return a single JSON object with these',
  'optional keys: firstName, lastName, email, phone, title, companyName. Omit any key',
  'you cannot confidently extract. Return ONLY the JSON object — no prose, no markdown',
  'fences. If you cannot extract anything, return {}.',
].join(' ');

/**
 * Parse the model's JSON response. Handles unfenced JSON, ```json fences, or garbage
 * (returns {}). Used by all three providers since model outputs vary in format.
 */
export function parseExtractJson(raw: string): ExtractContactOutput {
  let candidate = raw;
  const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) candidate = fenceMatch[1];
  candidate = candidate.trim();
  try {
    const obj = JSON.parse(candidate) as Record<string, unknown>;
    const out: ExtractContactOutput = {};
    if (typeof obj.firstName === 'string') out.firstName = obj.firstName;
    if (typeof obj.lastName === 'string') out.lastName = obj.lastName;
    if (typeof obj.email === 'string') out.email = obj.email;
    if (typeof obj.phone === 'string') out.phone = obj.phone;
    if (typeof obj.title === 'string') out.title = obj.title;
    if (typeof obj.companyName === 'string') out.companyName = obj.companyName;
    return out;
  } catch {
    return {};
  }
}

export const DRAFT_EMAIL_SYSTEM = [
  'You are a sales-CRM email drafting assistant. Read the activity history and',
  "the user's intent below, then write a single email reply. Return a JSON object",
  'with exactly two keys: `subject` (concise, no quotes, no "Re:" prefix unless',
  'truly a reply) and `body` (plain text, 2–5 short paragraphs, no signature).',
  'Be specific, friendly, and assume the recipient already knows you.',
  'Return ONLY the JSON object — no prose, no markdown fences.',
].join(' ');

/**
 * Parse the model's draft-email JSON. Handles fences, naked JSON, garbage.
 * Throws on unparseable input (the caller should fall through to the next
 * provider in the chain).
 */
export function parseDraftEmailJson(raw: string): DraftEmailOutput {
  let candidate = raw;
  const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) candidate = fenceMatch[1];
  candidate = candidate.trim();
  const obj = JSON.parse(candidate) as Record<string, unknown>;
  if (typeof obj.subject !== 'string' || typeof obj.body !== 'string') {
    throw new Error('Model returned invalid draft email shape');
  }
  return { subject: obj.subject, body: obj.body };
}
