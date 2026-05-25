import { describe, expect, it, vi } from 'vitest';
import { SmtpEmailProvider } from './smtp.js';

function fakeTransport(messageId = '<msg.smtp.test@dealflow>') {
  return {
    sendMail: vi.fn().mockResolvedValue({
      messageId,
      accepted: ['bob@example.com'],
      rejected: [],
      response: '250 OK',
    }),
  };
}

describe('SmtpEmailProvider.send', () => {
  it('returns the messageId from the SMTP transport on success', async () => {
    const transport = fakeTransport('<test-id@dealflow>');
    const p = new SmtpEmailProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transport: transport as any,
    });
    const out = await p.send({
      from: 'Alice via DealFlow <alice@dealflow.app>',
      to: 'bob@example.com',
      replyTo: 'alice@acme.com',
      subject: 'Re: Pricing',
      text: 'Hi Bob, …',
    });
    expect(out.messageId).toBe('<test-id@dealflow>');
    const call = transport.sendMail.mock.calls[0]![0]!;
    expect(call.from).toBe('Alice via DealFlow <alice@dealflow.app>');
    expect(call.to).toBe('bob@example.com');
    expect(call.replyTo).toBe('alice@acme.com');
    expect(call.subject).toBe('Re: Pricing');
    expect(call.text).toBe('Hi Bob, …');
  });

  it('throws when SMTP rejects the message', async () => {
    const transport = {
      sendMail: vi.fn().mockRejectedValue(new Error('5.7.1 Relay denied')),
    };
    const p = new SmtpEmailProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transport: transport as any,
    });
    await expect(
      p.send({
        from: 'x',
        to: 'y@z',
        replyTo: 'x',
        subject: 's',
        text: 't',
      }),
    ).rejects.toThrow(/Relay denied/);
  });

  it('throws when transport returns no messageId', async () => {
    const transport = {
      sendMail: vi.fn().mockResolvedValue({
        accepted: ['bob@example.com'],
        rejected: [],
        response: '250 OK',
      }),
    };
    const p = new SmtpEmailProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transport: transport as any,
    });
    await expect(
      p.send({ from: 'x', to: 'y@z', replyTo: 'x', subject: 's', text: 't' }),
    ).rejects.toThrow();
  });
});

describe('SmtpEmailProvider — cc/bcc/html extensions', () => {
  it('passes cc and bcc arrays through to the transporter', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: any[] = [];
    const fakeTransporter = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendMail: async (opts: any) => {
        calls.push(opts);
        return { messageId: 'm-1' };
      },
    };
    const p = new SmtpEmailProvider({ transport: fakeTransporter as never });
    await p.send({
      from: 'Alice <a@a.com>',
      to: 's@s.com',
      replyTo: 'a@a.com',
      subject: 'Hi',
      text: 'plain',
      cc: ['x@x.com', 'y@y.com'],
      bcc: ['z@z.com'],
    });
    expect(calls[0].cc).toEqual(['x@x.com', 'y@y.com']);
    expect(calls[0].bcc).toEqual(['z@z.com']);
  });

  it('passes html when provided (alongside text)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: any[] = [];
    const fakeTransporter = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendMail: async (opts: any) => {
        calls.push(opts);
        return { messageId: 'm-2' };
      },
    };
    const p = new SmtpEmailProvider({ transport: fakeTransporter as never });
    await p.send({
      from: 'Alice <a@a.com>',
      to: 's@s.com',
      replyTo: 'a@a.com',
      subject: 'Hi',
      text: 'plain',
      html: '<p>plain</p>',
    });
    expect(calls[0].html).toBe('<p>plain</p>');
    expect(calls[0].text).toBe('plain');
  });
});
