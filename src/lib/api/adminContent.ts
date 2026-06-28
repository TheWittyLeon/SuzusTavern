// src/lib/api/adminContent.ts
//
// Typed wrappers for the admin content-draft endpoints, proxied through
// /api/dnd/admin/content/* (which adds the server-side admin gate + token).
// Follows the same pattern as src/lib/api/dnd.ts.
//
// S8.3 — Gated Content Pipeline: Tavern admin review screen client functions.

import { apiCall } from './client';

// ── Wire types ──────────────────────────────────────────────────────────────

export interface ContentDraftSource {
  key: string;
  page: number;
  snippet: string;
  [k: string]: unknown;
}

export interface ContentDraftListItem {
  draft_id: number;
  pack_id: string;
  system_id: string;
  content_type: string;
  slug: string;
  name: string;
  lifecycle: 'draft' | 'approved' | 'rejected';
  source: ContentDraftSource;
  previous_content_id: number | null;
  created_at: string;
}

export interface ContentDraft extends ContentDraftListItem {
  /** Content-type-specific JSONB body. Shape varies by content_type. */
  data: Record<string, unknown>;
  updated_at: string;
}

export interface DraftQueueResponse {
  items: ContentDraftListItem[];
  total: number;
}

// ── Client functions ─────────────────────────────────────────────────────────

/**
 * List pending content drafts from the review queue.
 * GET /api/dnd/admin/content/drafts?lifecycle=draft&limit=100&user=...
 *
 * The proxy gate enforces admin role server-side before forwarding.
 * Throws ApiError on non-2xx; callers handle error/retry state.
 */
export const listDrafts = (
  opts: {
    packId?: string;
    sourceKey?: string;
    username: string;
    signal?: AbortSignal;
  },
): Promise<DraftQueueResponse> => {
  const q = new URLSearchParams({ lifecycle: 'draft', limit: '100', user: opts.username });
  if (opts.packId) q.set('pack_id', opts.packId);
  if (opts.sourceKey) q.set('source_key', opts.sourceKey);
  return apiCall<DraftQueueResponse>(
    `/api/dnd/admin/content/drafts?${q.toString()}`,
    { method: 'GET', signal: opts.signal },
  );
};

/**
 * Fetch a single draft for the side-by-side review screen.
 * GET /api/dnd/admin/content/drafts/{draftId}?user=...
 */
export const getDraft = (
  draftId: number,
  username: string,
  signal?: AbortSignal,
): Promise<ContentDraft> => {
  const q = new URLSearchParams({ user: username });
  return apiCall<ContentDraft>(
    `/api/dnd/admin/content/drafts/${draftId}?${q.toString()}`,
    { method: 'GET', signal },
  );
};

/**
 * Save edits to a draft's name and/or data fields.
 * PATCH /api/dnd/admin/content/drafts/{draftId}  body: { actor, fields }
 *
 * Returns { draft_id, changed, version } — re-fetch the draft to get updated_at.
 */
export const saveDraft = (
  draftId: number,
  fields: { name?: string; data?: Record<string, unknown> },
  actor: string,
  signal?: AbortSignal,
): Promise<{ draft_id: number; changed: boolean; version: number }> =>
  apiCall(
    `/api/dnd/admin/content/drafts/${draftId}`,
    { method: 'PATCH', json: { actor, fields }, signal },
  );

/**
 * Approve a draft (atomic: transitions to approved + promotes to live in one txn).
 * POST /api/dnd/admin/content/drafts/{draftId}/approve  body: { actor, notes? }
 *
 * On success the draft row is gone from content_drafts; the item is live.
 */
export const approveDraft = (
  draftId: number,
  actor: string,
  notes?: string,
  signal?: AbortSignal,
): Promise<{ draft_id: number; lifecycle: 'live'; promoted_content_id: number }> =>
  apiCall(
    `/api/dnd/admin/content/drafts/${draftId}/approve`,
    { method: 'POST', json: { actor, ...(notes ? { notes } : {}) }, signal },
  );

/**
 * Reject a draft. The reason field is required by the engine.
 * POST /api/dnd/admin/content/drafts/{draftId}/reject  body: { actor, reason }
 */
export const rejectDraft = (
  draftId: number,
  actor: string,
  reason: string,
  signal?: AbortSignal,
): Promise<{ draft_id: number; lifecycle: 'rejected' }> =>
  apiCall(
    `/api/dnd/admin/content/drafts/${draftId}/reject`,
    { method: 'POST', json: { actor, reason }, signal },
  );
