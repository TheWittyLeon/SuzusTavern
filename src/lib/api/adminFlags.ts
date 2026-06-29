// src/lib/api/adminFlags.ts
//
// Client-side wrapper for the feature-flag admin BFF route.
// All calls go to our own origin — never directly to Authentication-Python.
//
// Phase 1 = read-only (GET /api/admin/flags).
// Phase 2 will add PUT/DELETE per-user override calls here.

import { apiFetch } from './client';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FlagType = 'boolean' | 'string' | 'integer';
export type FlagScope = 'global' | 'user';
export type ResolutionSource = 'env' | 'config' | 'default' | 'remote';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface FeatureFlag {
  key: string;
  label: string;
  description: string | null;
  default: boolean | string | number;
  type: FlagType;
  options: string[] | null;
  scope: FlagScope[];
  services: string[];
  env_var: string | null;
  config_key: string | null;
  risk: RiskLevel;
  owner: string;
  resolved_value: boolean | string | number | null;
  resolution_source: ResolutionSource;
}

export interface FlagsListResult {
  flags: FeatureFlag[];
  count: number;
  phase: number;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

export const listFlags = (signal?: AbortSignal): Promise<FlagsListResult> =>
  apiFetch<FlagsListResult>('/api/admin/flags', { method: 'GET', signal });
