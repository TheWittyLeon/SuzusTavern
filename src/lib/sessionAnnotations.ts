// src/lib/sessionAnnotations.ts
//
// Client-side session annotations. The engine has no column for dm_mode /
// content_rating / visibility yet (STORY-312/313), so the Tavern annotates them
// locally, keyed by session_id (or channel before the id is known), exactly as
// the Sprint-2 design specified for dm_mode. When the engine columns land, these
// become server-set and this store is removed.
//
// SAFETY: the 'mature' rating here is a *preference*, never a guarantee. The
// server-side hard interlock (STORY-314) forces SFW for any public/streamed
// table regardless of this value — a public table can never use the mature model.

import type { ContentRating, DmMode, Visibility } from '@/lib/api/types';

export interface SessionAnnotations {
  dm_mode?: DmMode;
  content_rating?: ContentRating;
  visibility?: Visibility;
  module_id?: string;
}

const PREFIX = 'st:session-meta:';

export function setSessionAnnotations(key: string, ann: SessionAnnotations): void {
  if (typeof window === 'undefined' || !key) return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(ann));
  } catch {
    // storage unavailable (private mode / quota) — annotations are best-effort
  }
}

export function getSessionAnnotations(key: string): SessionAnnotations | null {
  if (typeof window === 'undefined' || !key) return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as SessionAnnotations) : null;
  } catch {
    return null;
  }
}

/** Slugify a table name into an engine channel key (lowercase, underscores). */
export function channelFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'table';
}
