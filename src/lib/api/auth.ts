// src/lib/api/auth.ts
//
// Typed wrappers for the auth BFF at /api/auth/*.
// All calls go to our own origin — never directly to Authentication-Python.
import { apiFetch } from './client';
import type { LoginResult, User } from './types';

export const login = (username: string, password: string, signal?: AbortSignal) =>
  apiFetch<LoginResult>('/api/auth/login', {
    method: 'POST',
    json: { username, password },
    signal,
  });

export const verify2FA = (totp_code: string, signal?: AbortSignal) =>
  apiFetch<{ kind: 'ok'; user: User }>('/api/auth/login/verify-2fa', {
    method: 'POST',
    json: { totp_code },
    signal,
  });

export const refresh = (signal?: AbortSignal) =>
  apiFetch<{ ok: true }>('/api/auth/refresh', { method: 'POST', signal });

export const me = (signal?: AbortSignal) =>
  apiFetch<{ user: User }>('/api/auth/me', { method: 'GET', signal });

export const logout = (signal?: AbortSignal) =>
  apiFetch<{ ok: true }>('/api/auth/logout', { method: 'POST', signal });

export const register = (
  username: string,
  password: string,
  email?: string,
  signal?: AbortSignal,
) =>
  apiFetch<{ user: User }>('/api/auth/register', {
    method: 'POST',
    json: { username, password, email },
    signal,
  });
