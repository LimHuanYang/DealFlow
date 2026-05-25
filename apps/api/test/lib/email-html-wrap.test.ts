import { describe, expect, it } from 'vitest';
import { wrapBodyAsHtml } from '../../src/lib/email-html-wrap.js';

const PIXEL_URL = 'https://crm.test/track/open/tok';
const rewriter = (url: string) => `https://crm.test/track/click/tok?u=${encodeURIComponent(url)}`;

describe('wrapBodyAsHtml', () => {
  it('returns both html and text strings', () => {
    const out = wrapBodyAsHtml('hello', { pixelUrl: PIXEL_URL, rewriteLink: rewriter });
    expect(out.text).toBe('hello');
    expect(out.html).toContain('hello');
  });

  it('embeds the pixel <img> with display:none', () => {
    const { html } = wrapBodyAsHtml('hi', { pixelUrl: PIXEL_URL, rewriteLink: rewriter });
    expect(html).toContain(`src="${PIXEL_URL}"`);
    expect(html).toContain('display:none');
  });

  it('preserves line breaks as <br>', () => {
    const { html } = wrapBodyAsHtml('a\nb\nc', { pixelUrl: PIXEL_URL, rewriteLink: rewriter });
    expect(html).toContain('a<br>b<br>c');
  });

  it('escapes HTML special characters', () => {
    const { html } = wrapBodyAsHtml('<script>alert(1)</script>', {
      pixelUrl: PIXEL_URL,
      rewriteLink: rewriter,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rewrites a single https link', () => {
    const { html } = wrapBodyAsHtml('Visit https://docs.acme.com/x for details', {
      pixelUrl: PIXEL_URL,
      rewriteLink: rewriter,
    });
    expect(html).toContain('href="https://crm.test/track/click/tok?u=');
    expect(html).toContain('docs.acme.com');
  });

  it('rewrites multiple links independently', () => {
    const { html } = wrapBodyAsHtml('https://a.com and https://b.com', {
      pixelUrl: PIXEL_URL,
      rewriteLink: rewriter,
    });
    // Both URLs should be wrapped
    const aMatches = (html.match(/href="/g) ?? []).length;
    expect(aMatches).toBeGreaterThanOrEqual(2);
  });

  it('omits the pixel when pixelUrl is null', () => {
    const { html } = wrapBodyAsHtml('hi', { pixelUrl: null, rewriteLink: rewriter });
    expect(html).not.toContain('<img');
  });

  it('does not rewrite links when rewriteLink is null', () => {
    const { html } = wrapBodyAsHtml('https://a.com', { pixelUrl: PIXEL_URL, rewriteLink: null });
    expect(html).toContain('https://a.com');
    expect(html).not.toContain('/track/click/');
  });

  it('keeps the text version unmodified', () => {
    const body = 'Visit https://a.com';
    const { text } = wrapBodyAsHtml(body, { pixelUrl: PIXEL_URL, rewriteLink: rewriter });
    expect(text).toBe(body);
  });
});
