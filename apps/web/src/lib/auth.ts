import { ApiException, apiFetch } from './api.js';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: string | null;
  avatarUrl: string | null;
}

export interface PublicOrganization {
  id: string;
  name: string;
  slug: string;
}

export async function getMe(): Promise<{ user: PublicUser } | null> {
  try {
    return await apiFetch<{ user: PublicUser }>('/api/v1/auth/me');
  } catch (err) {
    // 401 == not authenticated; treat as "no user" rather than an error.
    if (err instanceof ApiException && err.status === 401) {
      return null;
    }
    throw err;
  }
}

export async function signup(input: {
  email: string;
  password: string;
  name: string;
  orgName: string;
}): Promise<{ user: PublicUser; organization: PublicOrganization }> {
  return apiFetch('/api/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<{ user: PublicUser }> {
  return apiFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function logout(): Promise<void> {
  await apiFetch('/api/v1/auth/logout', { method: 'POST' });
}
