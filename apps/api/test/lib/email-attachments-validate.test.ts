import { describe, expect, it } from 'vitest';
import {
  validateAttachment,
  validateAttachmentTotal,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
} from '../../src/lib/email-attachments-validate.js';

describe('validateAttachment', () => {
  it('accepts a normal PDF', () => {
    expect(
      validateAttachment({ filename: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }).ok,
    ).toBe(true);
  });

  it('rejects a file exactly 1 byte over the per-file limit', () => {
    const r = validateAttachment({
      filename: 'big.pdf',
      mimeType: 'application/pdf',
      sizeBytes: MAX_FILE_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ATTACHMENT_TOO_LARGE');
  });

  it('accepts a file exactly at the per-file limit', () => {
    expect(
      validateAttachment({
        filename: 'edge.pdf',
        mimeType: 'application/pdf',
        sizeBytes: MAX_FILE_BYTES,
      }).ok,
    ).toBe(true);
  });

  it('rejects a blocked extension (.exe)', () => {
    const r = validateAttachment({
      filename: 'installer.exe',
      mimeType: 'application/octet-stream',
      sizeBytes: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ATTACHMENT_BLOCKED_TYPE');
  });

  it('blocked-extension check is case-insensitive (.EXE rejected)', () => {
    expect(
      validateAttachment({
        filename: 'installer.EXE',
        mimeType: 'application/octet-stream',
        sizeBytes: 100,
      }).ok,
    ).toBe(false);
  });

  it.each([
    'installer.bat',
    'script.cmd',
    'app.com',
    'pkg.msi',
    'lib.dll',
    'macro.vbs',
    'code.js',
    'run.ps1',
    'screen.scr',
    'java.jar',
  ])('rejects %s', (filename) => {
    expect(
      validateAttachment({ filename, mimeType: 'application/octet-stream', sizeBytes: 10 }).ok,
    ).toBe(false);
  });

  it('rejects a blocked content-type', () => {
    expect(
      validateAttachment({
        filename: 'unknown',
        mimeType: 'application/x-msdownload',
        sizeBytes: 100,
      }).ok,
    ).toBe(false);
  });

  it('rejects zero-byte files', () => {
    expect(
      validateAttachment({ filename: 'empty.pdf', mimeType: 'application/pdf', sizeBytes: 0 }).ok,
    ).toBe(false);
  });

  it('rejects files with no extension when MIME is also generic', () => {
    expect(
      validateAttachment({
        filename: 'README',
        mimeType: 'application/octet-stream',
        sizeBytes: 100,
      }).ok,
    ).toBe(false);
  });

  it('accepts a file with no extension when MIME is specific', () => {
    expect(
      validateAttachment({ filename: 'photo', mimeType: 'image/jpeg', sizeBytes: 1000 }).ok,
    ).toBe(true);
  });
});

describe('validateAttachmentTotal', () => {
  it('accepts a single file under the total limit', () => {
    expect(validateAttachmentTotal([1_000_000]).ok).toBe(true);
  });

  it('rejects sum that exceeds total', () => {
    const r = validateAttachmentTotal([MAX_FILE_BYTES, MAX_FILE_BYTES]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ATTACHMENTS_TOTAL_TOO_LARGE');
  });

  it('accepts sum at exactly the total limit', () => {
    expect(validateAttachmentTotal([MAX_TOTAL_BYTES]).ok).toBe(true);
  });
});
