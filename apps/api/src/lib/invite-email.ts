/**
 * Builds the subject + text + HTML for an invitation email.
 *
 * Kept intentionally plain and inline-styled so it degrades gracefully in
 * basic email clients (no external CSS, no images, no marketing copy).
 *
 * `inviterName` may be `null` when the inviter has been deleted or when
 * we genuinely don't know who issued the invite — in that case the body
 * falls back to a generic phrasing rather than leaking "null"/"undefined".
 */
export interface BuildInviteEmailOpts {
  orgName: string;
  inviterName: string | null;
  role: 'admin' | 'member';
  acceptUrl: string;
}

export interface BuiltInviteEmail {
  subject: string;
  text: string;
  html: string;
}

const ROLE_LABEL: Record<BuildInviteEmailOpts['role'], string> = {
  admin: 'admin',
  member: 'member',
};

/**
 * Minimal HTML-attribute / text escape. Invitation emails embed
 * user-provided organization names and inviter display-names, so we always
 * escape these before injecting into the HTML body.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildInviteEmail(opts: BuildInviteEmailOpts): BuiltInviteEmail {
  const { orgName, inviterName, role, acceptUrl } = opts;
  const roleLabel = ROLE_LABEL[role];

  const subject = `You're invited to join ${orgName} on DealFlow`;

  // ── Plain text body ──────────────────────────────────────────────────────
  const inviterLineText = inviterName
    ? `${inviterName} has invited you to join ${orgName} on DealFlow.`
    : `You have been invited to join ${orgName} on DealFlow.`;

  const text = [
    `Hi,`,
    ``,
    inviterLineText,
    ``,
    `Role: ${roleLabel}`,
    ``,
    `Accept the invitation:`,
    acceptUrl,
    ``,
    `This invitation will expire in 7 days. If you weren't expecting it, you can safely ignore this email.`,
    ``,
    `— DealFlow`,
  ].join('\n');

  // ── HTML body ────────────────────────────────────────────────────────────
  // Inline-styled, single-column, no external assets. The CTA button is a
  // styled <a> so it works without any client-side rendering.
  const safeOrg = escapeHtml(orgName);
  const safeInviter = inviterName ? escapeHtml(inviterName) : null;
  const safeUrl = escapeHtml(acceptUrl);
  const safeRole = escapeHtml(roleLabel);

  const inviterLineHtml = safeInviter
    ? `<strong>${safeInviter}</strong> has invited you to join <strong>${safeOrg}</strong> on DealFlow.`
    : `You have been invited to join <strong>${safeOrg}</strong> on DealFlow.`;

  const html = [
    `<!doctype html>`,
    `<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;padding:24px 0;">`,
    `<tr><td align="center">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px;">`,
    `<tr><td>`,
    `<p style="margin:0 0 16px 0;font-size:16px;line-height:24px;">${inviterLineHtml}</p>`,
    `<p style="margin:0 0 16px 0;font-size:14px;line-height:20px;color:#475569;">Role: <strong style="color:#0f172a;">${safeRole}</strong></p>`,
    `<p style="margin:24px 0;">`,
    `<a href="${safeUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;font-size:14px;">Accept invitation</a>`,
    `</p>`,
    `<p style="margin:0 0 8px 0;font-size:12px;line-height:18px;color:#64748b;">Or paste this link into your browser:</p>`,
    `<p style="margin:0 0 24px 0;font-size:12px;line-height:18px;word-break:break-all;"><a href="${safeUrl}" style="color:#4f46e5;text-decoration:underline;">${safeUrl}</a></p>`,
    `<p style="margin:0;font-size:12px;line-height:18px;color:#94a3b8;">This invitation will expire in 7 days. If you weren't expecting it, you can safely ignore this email.</p>`,
    `</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
    `</body></html>`,
  ].join('');

  return { subject, text, html };
}
