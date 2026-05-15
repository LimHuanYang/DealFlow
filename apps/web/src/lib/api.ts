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
