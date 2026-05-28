export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB total per email

const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'bat',
  'cmd',
  'com',
  'msi',
  'dll',
  'vbs',
  'js',
  'ps1',
  'scr',
  'jar',
  'app',
]);

const BLOCKED_MIME_TYPES = new Set([
  'application/x-msdownload',
  'application/x-msi',
  'application/x-javascript',
]);

const GENERIC_MIME_TYPES = new Set(['application/octet-stream', '']);

export interface AttachmentMeta {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export type ValidateResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'ATTACHMENT_TOO_LARGE'
        | 'ATTACHMENTS_TOTAL_TOO_LARGE'
        | 'ATTACHMENT_BLOCKED_TYPE'
        | 'ATTACHMENT_EMPTY'
        | 'ATTACHMENT_UNKNOWN_TYPE';
      message: string;
    };

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

export function validateAttachment(meta: AttachmentMeta): ValidateResult {
  if (meta.sizeBytes <= 0) {
    return { ok: false, code: 'ATTACHMENT_EMPTY', message: 'File is empty' };
  }
  if (meta.sizeBytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      code: 'ATTACHMENT_TOO_LARGE',
      message: `File exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB per-file limit`,
    };
  }
  const ext = getExtension(meta.filename);
  if (ext && BLOCKED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      code: 'ATTACHMENT_BLOCKED_TYPE',
      message: `Files with extension .${ext} are not allowed`,
    };
  }
  if (BLOCKED_MIME_TYPES.has(meta.mimeType.toLowerCase())) {
    return {
      ok: false,
      code: 'ATTACHMENT_BLOCKED_TYPE',
      message: `Content type ${meta.mimeType} is not allowed`,
    };
  }
  if (!ext && GENERIC_MIME_TYPES.has(meta.mimeType.toLowerCase())) {
    return {
      ok: false,
      code: 'ATTACHMENT_UNKNOWN_TYPE',
      message: 'File has no extension and a generic content type — cannot classify',
    };
  }
  return { ok: true };
}

export function validateAttachmentTotal(sizes: number[]): ValidateResult {
  const total = sizes.reduce((sum, n) => sum + n, 0);
  if (total > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      code: 'ATTACHMENTS_TOTAL_TOO_LARGE',
      message: `Total attachment size ${total} bytes exceeds ${MAX_TOTAL_BYTES} byte limit`,
    };
  }
  return { ok: true };
}
