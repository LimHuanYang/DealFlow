import type { ExtractContactOutput } from '../provider.js';

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
