const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiException extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ApiError,
  ) {
    super(error.message);
    this.name = 'ApiException';
  }
}

/**
 * POST a FormData body to the API. The browser sets the multipart
 * Content-Type + boundary automatically — do NOT set it manually.
 * Throws the error envelope on non-2xx.
 */
export async function apiFetchFormData<T>(path: string, form: FormData): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) {
    let envelope: unknown;
    try {
      envelope = await res.json();
    } catch {
      envelope = { error: { code: 'UPSTREAM', message: res.statusText } };
    }
    throw envelope;
  }
  return (await res.json()) as T;
}

/**
 * Download a file from the API. Returns a Blob + filename (from
 * Content-Disposition), or { notCached: true } on a 404.
 */
export async function downloadAttachment(
  id: string,
): Promise<{ blob: Blob; filename: string } | { notCached: true }> {
  const url = `${API_BASE}/api/v1/attachments/${id}`;
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
  });
  if (res.status === 404) return { notCached: true };
  if (!res.ok) throw new Error(`Download failed: ${res.statusText}`);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(cd);
  const filename = match ? match[1]! : 'download';
  return { blob, filename };
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  // Only set Content-Type when we're actually sending a body — Fastify's
  // JSON parser rejects empty-body requests that claim Content-Type: json.
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (init.body != null) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers,
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as { error?: ApiError } & T;
  if (!res.ok) {
    throw new ApiException(
      res.status,
      body.error ?? { code: 'UNKNOWN', message: 'Request failed' },
    );
  }
  return body;
}
