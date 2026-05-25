export interface WrapOptions {
  /** Absolute URL the recipient's mail client GETs when the body renders. Set to null to omit the pixel. */
  pixelUrl: string | null;
  /** Maps an original URL → the click-redirect URL. Set to null to skip link rewriting. */
  rewriteLink: ((originalUrl: string) => string) | null;
}

export interface WrappedBody {
  /** Multipart/alternative HTML half. */
  html: string;
  /** Multipart/alternative plain-text half (unchanged from caller input). */
  text: string;
}

/**
 * Wrap a plain-text email body in minimal HTML suitable for tracking.
 *
 *   • Escapes HTML-significant characters so user input can't break out.
 *   • Replaces every `http(s)://` URL in the body with an anchor pointing at
 *     the click-redirect endpoint (when `rewriteLink` is provided).
 *   • Appends an invisible 1x1 tracking pixel referencing `pixelUrl`.
 *
 * Returns BOTH html and text — the SMTP transport sends them as a
 * multipart/alternative payload so HTML-blocking clients still see the
 * unmodified plaintext.
 */
export function wrapBodyAsHtml(plainBody: string, opts: WrapOptions): WrappedBody {
  // 1. Find and tokenise URLs BEFORE escaping (so we keep them intact).
  //    URL regex: http(s)://<non-whitespace>+, conservative — punctuation at the end
  //    is stripped from the captured URL but stays in surrounding text.
  const URL_RE = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/gi;
  const parts: { kind: 'text' | 'url'; value: string }[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(plainBody)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ kind: 'text', value: plainBody.slice(lastIndex, m.index) });
    }
    parts.push({ kind: 'url', value: m[0]! });
    lastIndex = m.index + m[0]!.length;
  }
  if (lastIndex < plainBody.length) {
    parts.push({ kind: 'text', value: plainBody.slice(lastIndex) });
  }

  // 2. Build HTML by escaping text parts and (optionally) wrapping URL parts in anchors.
  let inner = '';
  for (const p of parts) {
    if (p.kind === 'text') {
      inner += escapeHtml(p.value).replace(/\n/g, '<br>');
    } else {
      const href = opts.rewriteLink ? opts.rewriteLink(p.value) : p.value;
      const display = escapeHtml(p.value);
      inner += `<a href="${escapeAttr(href)}">${display}</a>`;
    }
  }

  const pixel = opts.pixelUrl
    ? `<img src="${escapeAttr(opts.pixelUrl)}" width="1" height="1" alt="" style="display:none;border:0">`
    : '';

  const html =
    '<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#111">' +
    `<div>${inner}</div>${pixel}` +
    '</body></html>';

  return { html, text: plainBody };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
