/**
 * Pure mapper from an EngineMailer transactional webhook payload to a
 * normalized DealFlow update. Confirmed shape (Task-0 spike):
 *   { "event": "opened", "details": { "txid": 12345, "url"?, ... } }
 * Events correlate to the original send via `details.txid`, which equals the
 * `Result.TransactionID` we store on `activities.external_id`.
 */
export interface EngineMailerWebhookPayload {
  event?: string;
  details?: { txid?: string | number; url?: unknown; [k: string]: unknown };
}

export type MappedWebhookEvent =
  | { txid: string; kind: 'open' }
  | { txid: string; kind: 'click'; url?: string }
  | { txid: string; kind: 'delivery'; deliveryStatus: 'delivered' | 'bounced' | 'spam' };

export function mapEngineMailerEvent(
  payload: EngineMailerWebhookPayload,
): MappedWebhookEvent | null {
  const raw = payload?.details?.txid;
  if (raw === undefined || raw === null || raw === '') return null;
  const txid = String(raw);
  switch ((payload.event ?? '').toLowerCase()) {
    case 'opened':
      return { txid, kind: 'open' };
    case 'clicked': {
      const url = typeof payload.details?.url === 'string' ? payload.details.url : undefined;
      return { txid, kind: 'click', url };
    }
    case 'delivered':
      return { txid, kind: 'delivery', deliveryStatus: 'delivered' };
    case 'bounce':
      return { txid, kind: 'delivery', deliveryStatus: 'bounced' };
    case 'spam-complaint':
      return { txid, kind: 'delivery', deliveryStatus: 'spam' };
    default:
      return null;
  }
}
