import { describe, expect, it } from 'vitest';
import { NoopEmailProvider } from './noop.js';
import { EmailDisabledError } from '../provider.js';

describe('NoopEmailProvider', () => {
  it('throws EmailDisabledError on send', async () => {
    const p = new NoopEmailProvider();
    await expect(
      p.send({
        from: 'a@x',
        to: 'b@y',
        replyTo: 'a@x',
        subject: 's',
        text: 't',
      }),
    ).rejects.toBeInstanceOf(EmailDisabledError);
  });
});
