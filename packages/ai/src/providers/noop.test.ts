import { describe, expect, it } from 'vitest';
import { NoopAIProvider, AIDisabledError } from '../index.js';

describe('NoopAIProvider', () => {
  it('throws AIDisabledError on summarizeNote', async () => {
    const provider = new NoopAIProvider();
    await expect(provider.summarizeNote({ text: 'hi' })).rejects.toBeInstanceOf(AIDisabledError);
  });

  it('throws AIDisabledError on draftEmail', async () => {
    const provider = new NoopAIProvider();
    await expect(
      provider.draftEmail({ dealContext: { id: 'x', summary: 'y' }, intent: 'follow up' }),
    ).rejects.toBeInstanceOf(AIDisabledError);
  });

  it('throws AIDisabledError on nlFilter', async () => {
    const provider = new NoopAIProvider();
    await expect(provider.nlFilter({ query: 'q', entity: 'deals' })).rejects.toBeInstanceOf(
      AIDisabledError,
    );
  });

  it('throws AIDisabledError on extractContact', async () => {
    const provider = new NoopAIProvider();
    await expect(provider.extractContact({ text: 't' })).rejects.toBeInstanceOf(AIDisabledError);
  });
});
