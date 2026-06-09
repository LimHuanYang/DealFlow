import { describe, it, expect, vi } from 'vitest';
import { EngineMailerEmailProvider } from './engine-mailer.js';

const okResponse = () =>
  new Response(
    JSON.stringify({ Result: { TransactionID: 'tx-123', Status: 'OK', StatusCode: '200' } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('EngineMailerEmailProvider', () => {
  it('POSTs SendEmail with APIKey header + mapped fields, returns TransactionID', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const p = new EngineMailerEmailProvider({
      apiKey: 'secret',
      fromEmail: 'crm@acme.com',
      fromName: 'Acme',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const out = await p.send({
      from: 'unused',
      to: 'bob@x.com',
      replyTo: 'crm@acme.com',
      subject: 'Hi',
      text: 'plain',
      html: '<p>hi</p>',
    });

    expect(out.messageId).toBe('tx-123');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/RESTAPI/V2/Submission/SendEmail');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).APIKey).toBe('secret');
    const body = JSON.parse(init.body as string);
    expect(body.ToEmail).toBe('bob@x.com');
    expect(body.SenderEmail).toBe('crm@acme.com');
    expect(body.SenderName).toBe('Acme');
    expect(body.Subject).toBe('Hi');
    expect(body.SubmittedContent).toBe('<p>hi</p>'); // prefers html over text
  });

  it('falls back to text when no html', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const p = new EngineMailerEmailProvider({
      apiKey: 'k',
      fromEmail: 'c@a.com',
      fromName: 'A',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await p.send({ from: '', to: 'b@x.com', replyTo: 'c@a.com', subject: 's', text: 'plain-only' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.SubmittedContent).toBe('plain-only');
  });

  it('maps cc/bcc and base64-encodes attachments', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const p = new EngineMailerEmailProvider({
      apiKey: 'k',
      fromEmail: 'c@a.com',
      fromName: 'A',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await p.send({
      from: '',
      to: 'b@x.com',
      replyTo: 'c@a.com',
      subject: 's',
      text: 't',
      cc: ['c1@x.com'],
      bcc: ['b1@x.com'],
      attachments: [{ filename: 'a.txt', content: Buffer.from('hello') }],
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.CCEmails).toEqual(['c1@x.com']);
    expect(body.BCCEmails).toEqual(['b1@x.com']);
    expect(body.Attachments[0].Filename).toBe('a.txt');
    expect(body.Attachments[0].Content).toBe(Buffer.from('hello').toString('base64'));
  });

  it('throws when Result.StatusCode is not 200', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ Result: { Status: 'Invalid sender', StatusCode: '400' } }), {
          status: 200,
        }),
    );
    const p = new EngineMailerEmailProvider({
      apiKey: 'k',
      fromEmail: 'c@a.com',
      fromName: 'A',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(
      p.send({ from: '', to: 'b@x.com', replyTo: 'c@a.com', subject: 's', text: 't' }),
    ).rejects.toThrow(/Invalid sender|400/);
  });

  it('throws on a non-2xx HTTP response', async () => {
    const fetchMock = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    const p = new EngineMailerEmailProvider({
      apiKey: 'bad',
      fromEmail: 'c@a.com',
      fromName: 'A',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(
      p.send({ from: '', to: 'b@x.com', replyTo: 'c@a.com', subject: 's', text: 't' }),
    ).rejects.toThrow(/401/);
  });
});
