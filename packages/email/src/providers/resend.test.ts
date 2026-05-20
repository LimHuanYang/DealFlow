import { describe, expect, it, vi } from 'vitest';
import { ResendEmailProvider } from './resend.js';

function fakeClient(returnValue: {
  data?: { id: string } | null;
  error?: { message: string } | null;
}) {
  return {
    emails: {
      send: vi.fn().mockResolvedValue(returnValue),
    },
  };
}

describe('ResendEmailProvider.send', () => {
  it('returns the messageId from Resend on success', async () => {
    const client = fakeClient({ data: { id: 'msg_abc123' }, error: null });
    const p = new ResendEmailProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
    });
    const out = await p.send({
      from: 'Alice via DealFlow <noreply@dealflow.app>',
      to: 'bob@example.com',
      replyTo: 'alice@acme.com',
      subject: 'Re: Pricing',
      text: 'Hi Bob, …',
    });
    expect(out.messageId).toBe('msg_abc123');
    const call = client.emails.send.mock.calls[0]![0]!;
    expect(call.from).toBe('Alice via DealFlow <noreply@dealflow.app>');
    expect(call.to).toEqual(['bob@example.com']);
    expect(call.replyTo).toBe('alice@acme.com');
    expect(call.subject).toBe('Re: Pricing');
    expect(call.text).toBe('Hi Bob, …');
  });

  it('throws when Resend returns an error payload', async () => {
    const client = fakeClient({
      data: null,
      error: { message: 'Invalid API key' },
    });
    const p = new ResendEmailProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
    });
    await expect(
      p.send({
        from: 'x',
        to: 'y@z',
        replyTo: 'x',
        subject: 's',
        text: 't',
      }),
    ).rejects.toThrow(/Invalid API key/);
  });

  it('throws when both data and error are null/undefined', async () => {
    const client = fakeClient({ data: null, error: null });
    const p = new ResendEmailProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
    });
    await expect(
      p.send({ from: 'x', to: 'y@z', replyTo: 'x', subject: 's', text: 't' }),
    ).rejects.toThrow();
  });
});
