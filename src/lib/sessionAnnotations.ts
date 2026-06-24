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

/**
 * Return a collision-resistant channel key for a new Tavern-created session.
 * Appends a random 4-character [a-z0-9] suffix separated by a hyphen so that:
 *   - Two players who both name their table "The Hollow Tide Cave" get distinct channels.
 *   - The base slug remains human-readable for ops/grep.
 *   - A future slugify pass leaves the string stable (hyphen is not collapsed by channelFromName).
 * The bot path never calls this; it uses the Twitch login (already unique-per-streamer).
 */
export function uniqueChannelFromName(name: string): string {
  const base = channelFromName(name);
  // Pad before slicing so the degenerate Math.random()===0 case
  // ("0".slice(2)==='') can't yield an empty suffix / trailing hyphen.
  const suffix = (Math.random().toString(36).slice(2) + '0000').slice(0, 4);
  return `${base}-${suffix}`;
}
