import { describe, it, expect } from 'vitest';
import { mapEngineMailerEvent } from '../../../src/modules/emails/webhook-event-mapper.js';

describe('mapEngineMailerEvent', () => {
  it('maps opened -> open keyed by txid (coerced to string)', () => {
    expect(mapEngineMailerEvent({ event: 'opened', details: { txid: 12345 } })).toEqual({
      txid: '12345',
      kind: 'open',
    });
  });

  it('maps clicked -> click with the url', () => {
    expect(
      mapEngineMailerEvent({ event: 'clicked', details: { txid: 'tx-1', url: 'https://x.com/' } }),
    ).toEqual({ txid: 'tx-1', kind: 'click', url: 'https://x.com/' });
  });

  it('maps delivered/bounce/spam-complaint to a delivery status', () => {
    expect(mapEngineMailerEvent({ event: 'delivered', details: { txid: 't' } })).toEqual({
      txid: 't',
      kind: 'delivery',
      deliveryStatus: 'delivered',
    });
    expect(mapEngineMailerEvent({ event: 'bounce', details: { txid: 't' } })).toEqual({
      txid: 't',
      kind: 'delivery',
      deliveryStatus: 'bounced',
    });
    expect(mapEngineMailerEvent({ event: 'spam-complaint', details: { txid: 't' } })).toEqual({
      txid: 't',
      kind: 'delivery',
      deliveryStatus: 'spam',
    });
  });

  it('returns null for an unknown event or a missing txid', () => {
    expect(mapEngineMailerEvent({ event: 'whatever', details: { txid: 't' } })).toBeNull();
    expect(mapEngineMailerEvent({ event: 'opened', details: {} })).toBeNull();
    expect(mapEngineMailerEvent({})).toBeNull();
  });
});
