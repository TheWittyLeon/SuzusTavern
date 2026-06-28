// src/lib/api/signup.ts
//
// Client-side wrappers for the signup + admin signup-management BFF routes.
// All calls go to our own origin — never directly to Authentication-Python.
//
// B3 — signup UI + admin screens.

import { apiFetch } from './client';

// ── Shared types ──────────────────────────────────────────────────────────────

/** Shape of GET /api/auth/registration-mode */
export interface RegistrationMode {
  mode: 'closed' | 'open' | 'invite' | 'approval';
  signup_enabled: boolean;
  requires_invite_code: boolean;
  requires_approval: boolean;
  message: string;
}

/** Request body for POST /api/auth/register (b3 extension with invite_code) */
export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
  invite_code?: string;
}

/** Response shape from a successful registration */
export interface RegisterResult {
  /** present on 201 (created) */
  user?: {
    id: number;
    username: string;
    email: string | null;
    is_active: boolean;
  };
  msg?: string;
  auto_granted_apps?: string[];
}

// ── Admin types ───────────────────────────────────────────────────────────────

export type InvitationStatus = 'active' | 'exhausted' | 'expired' | 'revoked';

export interface Invitation {
  id: number;
  code_prefix: string;
  created_by: number;
  role_to_grant: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  revoked: boolean;
  note: string | null;
  created_at: string;
  last_used_at: string | null;
  status: InvitationStatus;
  /** Only present immediately after mint (returned once). */
  code?: string;
  /** Only present immediately after mint (returned once). */
  signup_url?: string;
}

export interface MintInviteRequest {
  role_to_grant?: string;
  max_uses?: number;
  expires_in_hours?: number;
  note?: string;
}

export interface MintInviteResult {
  msg: string;
  invitation: Invitation;
}

export interface InvitationListResult {
  invitations: Invitation[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface PendingUser {
  id: number;
  username: string;
  email: string | null;
  created_at: string;
}

export interface PendingListResult {
  pending: PendingUser[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

// ── Public endpoints ──────────────────────────────────────────────────────────

export const getRegistrationMode = (signal?: AbortSignal): Promise<RegistrationMode> =>
  apiFetch<RegistrationMode>('/api/auth/registration-mode', { method: 'GET', signal });

/**
 * Submit a signup request. Returns the raw response so the caller can
 * distinguish 201 (active account) from 202 (pending approval).
 *
 * apiFetch throws on non-2xx, so callers catch ApiError for 400/403/409/429.
 */
export const submitRegister = (
  body: RegisterRequest,
  signal?: AbortSignal,
): Promise<RegisterResult> =>
  apiFetch<RegisterResult>('/api/auth/register', {
    method: 'POST',
    json: body,
    signal,
  });

// ── Admin endpoints ───────────────────────────────────────────────────────────

export const listInvitations = (
  opts: { status?: InvitationStatus | 'all'; page?: number; signal?: AbortSignal },
): Promise<InvitationListResult> => {
  const q = new URLSearchParams();
  if (opts.status) q.set('status', opts.status);
  if (opts.page) q.set('page', String(opts.page));
  return apiFetch<InvitationListResult>(
    `/api/admin/auth/invitations?${q.toString()}`,
    { method: 'GET', signal: opts.signal },
  );
};

export const mintInvitation = (
  body: MintInviteRequest,
  signal?: AbortSignal,
): Promise<MintInviteResult> =>
  apiFetch<MintInviteResult>('/api/admin/auth/invitations', {
    method: 'POST',
    json: body,
    signal,
  });

export const revokeInvitation = (
  id: number,
  signal?: AbortSignal,
): Promise<{ msg: string; invitation: Invitation }> =>
  apiFetch(`/api/admin/auth/invitations/${id}`, { method: 'DELETE', signal });

export const listPending = (
  opts: { page?: number; search?: string; signal?: AbortSignal },
): Promise<PendingListResult> => {
  const q = new URLSearchParams();
  if (opts.page) q.set('page', String(opts.page));
  if (opts.search) q.set('search', opts.search);
  return apiFetch<PendingListResult>(
    `/api/admin/auth/pending?${q.toString()}`,
    { method: 'GET', signal: opts.signal },
  );
};

export const approveRegistration = (
  userId: number,
  role?: string,
  signal?: AbortSignal,
): Promise<{ msg: string; user: PendingUser }> =>
  apiFetch(`/api/admin/auth/pending/${userId}/approve`, {
    method: 'POST',
    json: role ? { role } : {},
    signal,
  });

export const denyRegistration = (
  userId: number,
  reason?: string,
  signal?: AbortSignal,
): Promise<{ msg: string; user_id: number; username: string }> =>
  apiFetch(`/api/admin/auth/pending/${userId}/deny`, {
    method: 'POST',
    json: reason ? { reason } : {},
    signal,
  });
