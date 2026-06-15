# Sprint 2 — Foundation Layer Design

> Author: Sora-Arch
> Date: 2026-06-15
> Covers: ST-001, ST-002, ST-003, ST-007, ST-008 (and the env/cookie scaffolding ST-004–006 also need)
> Status: Approved for Ren-Dev to implement file-by-file

---

## 0. Technical Overview

Sprint 2 builds the **foundation layer** that every later sprint plugs into: typed API client, JWT session, env/config, SSE reader, and Next middleware. The session lives in **httpOnly cookies** managed by a **BFF route** (`/api/auth/*`), not in `localStorage`. Token refresh happens inside the `apiFetch` helper on a single 401 retry. The play screen is built around an AI-independent `dm_mode` model so streamed narration is one of three providers, not a hard dependency. The existing dnd proxy is preserved (10 tests stay green) and gains one additive behaviour: inject `Bearer` from the `st_access` cookie when the caller did not supply an `Authorization` header.

---

## 1. Architecture Design

### 1.1 Component diagram

```mermaid
flowchart LR
  subgraph Browser
    UI[React pages/components]
    AP[AuthProvider<br/>(client)]
  end

  subgraph "Next.js (BFF)"
    MW[middleware.ts<br/>(Edge)]
    AUTHBFF[/api/auth/[...path]/]
    DNDPROXY[/api/dnd/[...path]/]
    NARPROXY[/api/narration/[...path]/]
  end

  subgraph "External (server-to-server)"
    AUTH[Authentication-Python<br/>:5000]
    NEKO[NekoNova Flask<br/>:8080]
  end

  UI -- "fetch (same-origin)<br/>cookies auto-sent" --> AUTHBFF
  UI -- "apiFetch /api/dnd/*" --> DNDPROXY
  UI -- "POST /api/narration/stream" --> NARPROXY
  UI -. context .- AP

  MW -. checks st_access cookie .-> UI

  AUTHBFF -- "POST /auth/login,<br/>refresh, me, logout" --> AUTH
  DNDPROXY -- "Bearer st_access<br/>fwd JSON / SSE" --> NEKO
  NARPROXY -- "Bearer st_access<br/>SSE passthrough" --> NEKO
```

### 1.2 Why cookies + BFF (decision recap)

| Constraint | Implication |
|---|---|
| Sprint 2 requires Edge middleware route protection | Edge can only read **cookies/headers**, never `localStorage` or React state |
| Tokens must not be readable by 3rd-party JS | httpOnly cookies, not `localStorage` (departs from the NekoNova dashboard pattern, intentionally) |
| Same-origin fetch removes CORS coupling | All client traffic targets `/api/*` on the Tavern origin |
| Refresh tokens rotate (Authentication-Python rotates on use) | BFF must re-set the cookie on every refresh response |

**Trade-off accepted:** the Tavern origin becomes the trust boundary for the session. CSRF risk for state-changing requests is mitigated by `SameSite=Lax` cookies plus the requirement that all auth-mutating requests are POST (Lax blocks cross-site POSTs but allows cross-site top-level GETs — fine here, since cross-site GET of the dnd API is meaningless without a body). No `SameSite=Strict` because we want the post-OAuth-redirect cookie to attach on the top-level navigation back to `/login` (Sprint 4).

---

## 2. File-by-file design

### 2.1 `src/lib/env.ts` — environment configuration (ST-002)

```ts
// src/lib/env.ts
//
// Centralised, typed env access. Read once at module load; throws in
// production if anything required is missing; falls back to dev defaults
// only when NODE_ENV !== 'production'.

export interface Env {
  /** Public — used by client + dnd/narration proxies. Spelt NEKANOVA on purpose. */
  NEKANOVA_URL: string;          // NEXT_PUBLIC_NEKANOVA_URL
  /** Server-only — used by the auth BFF to reach Authentication-Python. */
  AUTH_API_URL: string;          // AUTH_API_URL (server-only)
  /** Public — optional, only set if a client component must link to auth UI */
  PUBLIC_AUTH_URL: string | null; // NEXT_PUBLIC_AUTH_URL
  /** Set automatically by Next. */
  IS_PROD: boolean;
}

export const env: Env;           // frozen object

// Behaviour:
//   - NEXT_PUBLIC_NEKANOVA_URL  — default 'http://localhost:8080' in dev, REQUIRED in prod (throw)
//   - AUTH_API_URL              — default 'http://localhost:5000'  in dev, REQUIRED in prod (throw)
//   - NEXT_PUBLIC_AUTH_URL      — optional everywhere; null when unset
//
// MUST NOT throw at import time in dev. Prod-required-missing throws an Error
// with the exact var name and a one-line "set this in your environment" hint.
// MUST NOT import anything Next-server-only at the top level (this file is
// imported by client code too — only NEXT_PUBLIC_* is read on the client side).
```

**Why a separate file:** the dnd proxy currently reads `process.env.NEXT_PUBLIC_NEKANOVA_URL` directly. We will NOT refactor it in this sprint — see §3.1 — but new code reads through `env`. Keeps the 10 existing tests green.

---

### 2.2 `src/lib/api/types.ts` — shared types

Types are derived from the real `api/routes/dnd_*.py` and `narration.py` shapes; do not invent fields.

```ts
// src/lib/api/types.ts

// ── Envelope ───────────────────────────────────────────────────────────────
export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface ApiError extends Error {
  /** HTTP status; 0 for network/abort. */
  status: number;
  /** Upstream error string, normalised. */
  code: string;
  /** Raw body if JSON-parsable, else undefined. */
  body?: unknown;
}

// ── DM mode (client-side only — engine support is STORY-312, NOT YET) ──────
export type DmMode = 'ai' | 'human' | 'solo';

// ── Auth ───────────────────────────────────────────────────────────────────
export interface User {
  id: number;
  username: string;
  email: string | null;
  roles?: string[];
  permissions?: string[];
}

/** What the browser ever sees from POST /api/auth/login. */
export type LoginResult =
  | { kind: 'ok'; user: User }
  | { kind: '2fa'; partial_token: string };

// ── DnD: characters ────────────────────────────────────────────────────────
export interface CharacterCreateRequest {
  username: string;
  name: string;
  race?: string;       // default 'Human' upstream
  char_class?: string; // 'class' is accepted as an alias upstream — prefer 'char_class'
  background?: string;
}
export interface CharacterCreated { character_id: string; [k: string]: unknown }

export interface Character {
  character_id: string;
  username: string;
  name: string;
  race: string;
  char_class: string;
  level: number;
  hp: { current: number; max: number };
  ac: number;
  // Sheet is loosely structured upstream — keep an open index map for
  // sub-fields we haven't typed yet. Wrap further in Sprint 6.
  [k: string]: unknown;
}
export interface InventoryItem { name: string; quantity: number; equipped?: boolean }
export interface Inventory { items: InventoryItem[] }

// ── DnD: sessions ──────────────────────────────────────────────────────────
export interface SessionStartRequest { username: string; channel: string }
export interface Session {
  session_id: string;
  channel: string;
  state: 'active' | 'paused' | 'ended';
  /** Client-side enrichment — engine doesn't know this yet (see §0 / Option B). */
  dm_mode?: DmMode;
  [k: string]: unknown;
}
export interface XpAwardRequest extends SessionStartRequest { amount: number; reason?: string }

// ── DnD: combat ────────────────────────────────────────────────────────────
export interface CombatActionRequest {
  username: string;
  combat_id: string;
  target?: string;     // required for /combat/attack
}
export interface SpellCastRequest extends CombatActionRequest {
  spell_name: string;
  slot_level?: number;
}
export interface CombatStatus {
  combat_id: string;
  session_id: string;
  round: number;
  turn_index: number;
  initiative: { username: string; init: number }[];
  [k: string]: unknown;
}

// ── Narration SSE ──────────────────────────────────────────────────────────
export type NarrationEvent =
  | { kind: 'chunk'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; error: string };

export interface NarrationRequest {
  username: string;
  message: string;
  channel: string;
}
```

**Notes**
- `dm_mode` is intentionally optional on `Session` — the engine does not return it today. The client annotates it locally (e.g., from a UI toggle stored in `localStorage` keyed by `session_id`). When STORY-312 lands engine-side, we change the field from "optional, client-set" to "required, server-set" with no caller change.
- `Character.hp/ac` are conservatively shaped from what `dnd_engine` exposes; if the real shape differs in Sprint 6, narrow there — don't widen blindly here.

---

### 2.3 `src/lib/api/client.ts` — base fetcher (ST-001)

```ts
// src/lib/api/client.ts
import type { ApiError, ApiResult } from './types';

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** JSON body — will be stringified. Use `rawBody` for non-JSON. */
  json?: unknown;
  /** Raw body passthrough; mutually exclusive with `json`. */
  rawBody?: BodyInit | null;
  /** AbortSignal — propagates to the underlying fetch. */
  signal?: AbortSignal;
  /** Internal: set when retrying after refresh. Do NOT pass from callers. */
  _retried?: boolean;
}

/**
 * Same-origin fetch wrapper.
 *
 * Behaviour:
 *   1. `path` is resolved against window.location.origin (or a relative URL on
 *      the server during RSC). Callers pass '/api/dnd/...' style paths.
 *   2. JSON requests: Content-Type 'application/json', body = JSON.stringify(json).
 *   3. `credentials: 'same-origin'` (cookies attach automatically — st_access/st_refresh).
 *   4. On 401 (and not already retried):
 *        - POST '/api/auth/refresh' once, same-origin (BFF rotates cookies).
 *        - If refresh succeeds, retry the original request with `_retried = true`.
 *        - If refresh fails, throw an ApiError with status 401 and code 'unauthorized'.
 *      The caller (typically AuthProvider) interprets that as "log out + redirect".
 *   5. On non-2xx: parse JSON if possible, throw ApiError {status, code, body}.
 *   6. On network/abort: throw ApiError {status: 0, code: 'network'|'abort'}.
 *   7. Returns the parsed JSON body, unwrapped — callers expecting the
 *      {success, data} envelope use `apiCall<T>` (next).
 */
export async function apiFetch<T = unknown>(
  path: string,
  options?: ApiFetchOptions,
): Promise<T>;

/**
 * Envelope-aware wrapper for endpoints that return ApiResult<T>.
 * - On `{success: true, data}` → returns data.
 * - On `{success: false, error}` → throws ApiError {status: HTTP, code: error}.
 */
export async function apiCall<T>(
  path: string,
  options?: ApiFetchOptions,
): Promise<T>;

/** Construct an ApiError without leaking raw text. */
export function makeApiError(
  status: number,
  code: string,
  body?: unknown,
): ApiError;
```

**401-retry rule (precise):**

```
apiFetch(path, opts):
  res = fetch(path, ...)
  if res.status == 401 and not opts._retried and path != '/api/auth/refresh':
      try:
        refreshRes = fetch('/api/auth/refresh', {method:'POST', credentials:'same-origin'})
        if refreshRes.ok:
            return apiFetch(path, { ...opts, _retried: true })
      catch:
        pass
      throw ApiError(401, 'unauthorized')
```

**Why not a global axios interceptor:** zero new deps; `fetch` plus a 30-line wrapper is enough. Add interceptors only when 3+ files need cross-cutting behaviour beyond auth.

---

### 2.4 `src/lib/api/dnd.ts` — typed DnD wrappers (ST-001)

Each function calls `apiCall<T>` against `/api/dnd/<path>`. Method + path are taken verbatim from the NekoNova bridge files.

```ts
// src/lib/api/dnd.ts
import { apiCall } from './client';
import type {
  Character, CharacterCreateRequest, CharacterCreated,
  CombatActionRequest, CombatStatus,
  Inventory, Session, SessionStartRequest, SpellCastRequest, XpAwardRequest,
} from './types';

// Characters
export const createCharacter = (req: CharacterCreateRequest, signal?: AbortSignal) =>
  apiCall<CharacterCreated>('/api/dnd/characters', { method: 'POST', json: req, signal });

export const getCharacter = (characterId: string, username: string, signal?: AbortSignal) =>
  apiCall<Character>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}?username=${encodeURIComponent(username)}`,
    { method: 'GET', signal },
  );

export const levelUpCharacter = (characterId: string, username: string, signal?: AbortSignal) =>
  apiCall<Character>(`/api/dnd/characters/${encodeURIComponent(characterId)}/levelup`,
    { method: 'POST', json: { username }, signal });

export const equipItem = (characterId: string, username: string, itemName: string, signal?: AbortSignal) =>
  apiCall<Character>(`/api/dnd/characters/${encodeURIComponent(characterId)}/equip`,
    { method: 'POST', json: { username, item_name: itemName }, signal });

export const unequipItem = (characterId: string, username: string, itemName: string, signal?: AbortSignal) =>
  apiCall<Character>(`/api/dnd/characters/${encodeURIComponent(characterId)}/unequip`,
    { method: 'POST', json: { username, item_name: itemName }, signal });

export const getInventory = (characterId: string, username: string, signal?: AbortSignal) =>
  apiCall<Inventory>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/inventory?username=${encodeURIComponent(username)}`,
    { method: 'GET', signal },
  );

// Sessions
export const startSession = (req: SessionStartRequest, signal?: AbortSignal) =>
  apiCall<Session>('/api/dnd/sessions', { method: 'POST', json: req, signal });

export const joinSession = (sessionId: string, req: SessionStartRequest, signal?: AbortSignal) =>
  apiCall<Session>(`/api/dnd/sessions/${encodeURIComponent(sessionId)}/join`,
    { method: 'POST', json: req, signal });

export const pauseSession = (sessionId: string, req: SessionStartRequest, signal?: AbortSignal) =>
  apiCall<Session>(`/api/dnd/sessions/${encodeURIComponent(sessionId)}/pause`, { method: 'POST', json: req, signal });

export const resumeSession = (sessionId: string, req: SessionStartRequest, signal?: AbortSignal) =>
  apiCall<Session>(`/api/dnd/sessions/${encodeURIComponent(sessionId)}/resume`, { method: 'POST', json: req, signal });

export const endSession = (sessionId: string, req: SessionStartRequest, signal?: AbortSignal) =>
  apiCall<Session>(`/api/dnd/sessions/${encodeURIComponent(sessionId)}/end`, { method: 'POST', json: req, signal });

export const awardSessionXp = (sessionId: string, req: XpAwardRequest, signal?: AbortSignal) =>
  apiCall<Session>(`/api/dnd/sessions/${encodeURIComponent(sessionId)}/xp`, { method: 'POST', json: req, signal });

// Combat
export const attack  = (req: Required<Pick<CombatActionRequest,'username'|'combat_id'|'target'>>, signal?: AbortSignal) =>
  apiCall<CombatStatus>('/api/dnd/combat/attack', { method: 'POST', json: req, signal });
export const dodge   = (req: CombatActionRequest, signal?: AbortSignal) =>
  apiCall<CombatStatus>('/api/dnd/combat/dodge',  { method: 'POST', json: req, signal });
export const dash    = (req: CombatActionRequest, signal?: AbortSignal) =>
  apiCall<CombatStatus>('/api/dnd/combat/dash',   { method: 'POST', json: req, signal });
export const endTurn = (req: CombatActionRequest, signal?: AbortSignal) =>
  apiCall<CombatStatus>('/api/dnd/combat/endturn',{ method: 'POST', json: req, signal });

export const getCombatStatus = (sessionId: string, signal?: AbortSignal) =>
  apiCall<CombatStatus>(`/api/dnd/combat/${encodeURIComponent(sessionId)}/status`, { method: 'GET', signal });

export const castSpell = (req: SpellCastRequest, signal?: AbortSignal) =>
  apiCall<CombatStatus>('/api/dnd/spells/cast', { method: 'POST', json: req, signal });
```

---

### 2.5 `src/lib/api/auth.ts` — auth BFF wrappers

These talk to **`/api/auth/*` on our origin** (the BFF), not to Authentication-Python directly.

```ts
// src/lib/api/auth.ts
import { apiFetch } from './client';
import type { LoginResult, User } from './types';

export const login = (username: string, password: string, signal?: AbortSignal) =>
  apiFetch<LoginResult>('/api/auth/login',
    { method: 'POST', json: { username, password }, signal });

export const verify2FA = (totp_code: string, signal?: AbortSignal) =>
  apiFetch<{ kind: 'ok'; user: User }>('/api/auth/login/verify-2fa',
    { method: 'POST', json: { totp_code }, signal });

export const refresh = (signal?: AbortSignal) =>
  apiFetch<{ ok: true }>('/api/auth/refresh', { method: 'POST', signal });

export const me = (signal?: AbortSignal) =>
  apiFetch<{ user: User }>('/api/auth/me', { method: 'GET', signal });

export const logout = (signal?: AbortSignal) =>
  apiFetch<{ ok: true }>('/api/auth/logout', { method: 'POST', signal });

export const register = (username: string, password: string, email?: string, signal?: AbortSignal) =>
  apiFetch<{ user: User }>('/api/auth/register',
    { method: 'POST', json: { username, password, email }, signal });
```

The BFF holds the partial-2FA token in a short-lived httpOnly cookie (`st_partial`, 5 min) so the browser never sees it — see §2.7.

---

### 2.6 Auth cookie + session helpers

#### 2.6.1 `src/lib/auth/cookies.ts`

```ts
// src/lib/auth/cookies.ts — server-only helpers
import 'server-only';
import type { ResponseCookies } from 'next/dist/server/web/spec-extension/cookies';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

export const ACCESS_COOKIE   = 'st_access';
export const REFRESH_COOKIE  = 'st_refresh';
export const PARTIAL_COOKIE  = 'st_partial';   // 2FA half-step

export interface CookieOpts {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;       // true in prod
  path: '/';
  maxAge: number;        // seconds
}

/** Production-grade defaults. `secure` is true iff env.IS_PROD. */
export function cookieOpts(maxAgeSeconds: number): CookieOpts;

/** Set the three managed cookies. Pass null to clear. */
export function setAccess(cookies: ResponseCookies, token: string | null): void;     // maxAge 15*60
export function setRefresh(cookies: ResponseCookies, token: string | null): void;    // maxAge 7*24*60*60
export function setPartial(cookies: ResponseCookies, token: string | null): void;    // maxAge 5*60
export function clearAll(cookies: ResponseCookies): void;

export function readAccess(cookies: ReadonlyRequestCookies | ResponseCookies): string | null;
export function readRefresh(cookies: ReadonlyRequestCookies | ResponseCookies): string | null;
export function readPartial(cookies: ReadonlyRequestCookies | ResponseCookies): string | null;
```

#### 2.6.2 `src/lib/auth/session.ts`

```ts
// src/lib/auth/session.ts — server-only
import 'server-only';
import { cookies } from 'next/headers';
import type { User } from '@/lib/api/types';

/**
 * Decode the *exp* claim of a JWT without verifying the signature.
 * Used only by middleware/BFF for cheap expiry gating; upstream verifies on use.
 * Returns null on malformed input.
 */
export function decodeJwtExp(jwt: string): number | null;

/** True iff jwt is absent, malformed, or exp <= (now + skewSeconds). */
export function isExpired(jwt: string | null, skewSeconds?: number): boolean;

/**
 * Server-component helper. Reads st_access from cookies, decodes exp,
 * returns {user: User | null, accessExpiresAt: number | null}.
 * Does NOT call /auth/me — that's the BFF's job. RSC just needs the bool.
 */
export async function getServerSession(): Promise<{
  user: User | null;
  accessExpiresAt: number | null;
}>;
```

**Why a hand-rolled exp decode (not `jose`):** middleware runs on the Edge runtime; we only need `exp`. Authentication-Python re-verifies signatures on every authoritative use. Adds zero dependencies. ~10 lines: split on `.`, base64url-decode the middle segment, `JSON.parse`, read `exp`. Wrapped in try/catch — return null on any failure.

#### 2.6.3 `src/lib/auth/AuthProvider.tsx`

```tsx
// src/lib/auth/AuthProvider.tsx
'use client';
import type { User } from '@/lib/api/types';
import { ReactNode } from 'react';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** True iff we have a user object in state. (Cookies are not visible to JS.) */
  isAuthenticated: boolean;
  /** Returns 'ok' or '2fa'; throws on bad creds / network. */
  login(username: string, password: string): Promise<'ok' | '2fa'>;
  /** Completes the 2FA half-step. Throws on bad TOTP. */
  verify2FA(totp_code: string): Promise<void>;
  /** Best-effort: POST /api/auth/logout, then clears local user state. */
  logout(): Promise<void>;
  /** Force a silent /api/auth/refresh. Returns true on success. */
  refresh(): Promise<boolean>;
}

export function AuthProvider(props: {
  /** Hydrated from the server in RootLayout — avoids first-paint flash. */
  initialUser: User | null;
  children: ReactNode;
}): JSX.Element;

export function useAuth(): AuthContextValue;
```

**Behaviour notes**
- `initialUser` is read by a Server Component in `app/layout.tsx` via `getServerSession()` + `me()` (BFF), then passed as a prop. This avoids the "logged in but UI says logged out for 200ms" flash.
- The provider does **not** schedule a 10-minute refresh interval. Auth refresh is reactive (driven by the 401-retry in `apiFetch`), not proactive. Reason: a per-tab interval adds complexity for marginal benefit; the 401-retry covers the case that matters (an in-flight call after expiry).
- `logout()` clears `user` state immediately, then awaits the network call. UI never blocks on it.
- Outside `AuthProvider`, `useAuth()` returns a no-op fallback (matches the NekoNova dashboard ergonomic — keeps test harnesses simple).

---

### 2.7 `src/app/api/auth/[...path]/route.ts` — auth BFF

A single catch-all route handler. Routes the browser may call: `register`, `login`, `login/verify-2fa`, `refresh`, `me`, `logout`. Everything else returns 404 (we do NOT expose admin/sessions/etc through the BFF this sprint).

#### 2.7.1 Behaviour table

| Browser call | Upstream call | Cookie writes | Browser response |
|---|---|---|---|
| `POST /api/auth/register` | `POST /auth/register` | none | `{user}` on 201 / passthrough error |
| `POST /api/auth/login` | `POST /auth/login` | If 2FA: set `st_partial`. Else: set `st_access` (15m) + `st_refresh` (7d). | `{kind:'ok', user}` or `{kind:'2fa'}` |
| `POST /api/auth/login/verify-2fa` | `POST /auth/login/verify-2fa` with `Authorization: Bearer <st_partial>` | clear `st_partial`; set `st_access` + `st_refresh` | `{kind:'ok', user}` |
| `POST /api/auth/refresh` | `POST /auth/refresh` with `Authorization: Bearer <st_refresh>` | Always update `st_access`. If response includes new `refresh_token`, rotate `st_refresh`. | `{ok:true}` (no token bodies) |
| `GET  /api/auth/me` | `GET /auth/me` with `Authorization: Bearer <st_access>` | none | `{user}` |
| `POST /api/auth/logout` | `POST /auth/logout` with `Authorization: Bearer <st_access>` (best-effort, swallow non-2xx) | clear `st_access`, `st_refresh`, `st_partial` | `{ok:true}` always |

**Cookie-transport toward upstream:** the BFF does **not** opt into `?cookie=true`. It uses Bearer mode upstream because we need to programmatically copy `access_token` and `refresh_token` into our own cookies (the upstream cookie domain wouldn't match ours, and we don't want refresh tokens loose between the two services). Trade-off: we lose upstream's CSRF cookie helpers — we pay for that with `SameSite=Lax` on our cookies and POST-only mutation surface.

#### 2.7.2 Skeleton (signatures only)

```ts
// src/app/api/auth/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

type Ctx = { params: Promise<{ path: string[] }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse>;
export async function GET (req: NextRequest, ctx: Ctx): Promise<NextResponse>;
// Internal:
//   - dispatch on path.join('/'): 'register' | 'login' | 'login/verify-2fa'
//     | 'refresh' | 'me' | 'logout'
//   - each handler:
//       1. extract cookies from req (httpOnly, so they ARE present here)
//       2. call AUTH_API_URL + '/auth/<path>' with appropriate Bearer
//       3. on response: strip access_token / refresh_token / partial_token
//          out of the JSON body, set as cookies on the NextResponse
//       4. propagate upstream status code on errors (401, 400, 422, 429)
//   - any other path: NextResponse.json({error:'not_found'}, {status: 404})
//
// Headers passthrough TO upstream: only Content-Type and our Authorization.
// Do NOT forward the browser's Cookie header (auth state lives in our cookies
// alone; forwarding would leak third-party cookies upstream).
//
// Headers passthrough FROM upstream: never copy upstream Set-Cookie back to
// the browser. We synthesise our own cookies via the helpers in §2.6.1.
//
// Rate-limit handling: forward 429 status + Retry-After header verbatim.
```

#### 2.7.3 Logout safety

`POST /api/auth/logout` must always:
1. Try upstream `/auth/logout` (best-effort, 2s timeout, swallow any error).
2. Then unconditionally `clearAll(cookies)` and return `{ok:true}` with status 200.

If the upstream call hangs, the browser must still get a 200 within ~2s. Logout failure on the upstream is a recoverable inconsistency (refresh token is revoked next time anyway); logout failure visible to the user is not.

---

### 2.8 `src/app/api/narration/[...path]/route.ts` — narration proxy

A sibling of the dnd proxy. Forwards only the `stream` sub-path to `${NEKANOVA_URL}/api/narration/stream`. Modelled on the existing dnd proxy (§3) for SSE handling.

```ts
// src/app/api/narration/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

type Ctx = { params: Promise<{ path: string[] }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse>;
// Behaviour:
//   - Allowed sub-path: ['stream']. Any other → 404.
//   - Resolve upstream = `${env.NEKANOVA_URL}/api/narration/${path.join('/')}`.
//   - Forward Content-Type. Inject Authorization: Bearer <st_access cookie> if
//     no Authorization header present. (If cookie is missing AND no Authorization
//     header, return 401 immediately — never call upstream anonymously.)
//   - Forward request body.
//   - Stream upstream response back with:
//       Content-Type: text/event-stream
//       Cache-Control: no-cache
//       X-Accel-Buffering: no
//     identical to the dnd proxy SSE branch.
//   - On fetch throw → 502 {success:false, error:'Upstream unavailable'} (matches dnd proxy).
//
// NB: this proxy is ONLY called when dm_mode === 'ai'. Modes 'human' and 'solo'
// never hit it — the play screen branches at the caller.
```

**Why a sibling, not folded into `/api/dnd/*`:** the engine is AI-independent. `/api/dnd/*` is engine truth; `/api/narration/*` is the AI DM narrator. Keeping them separate means swapping/disabling the narrator changes one file, not the engine proxy.

---

### 2.9 `src/lib/stream.ts` — SSE reader (ST-007)

```ts
// src/lib/stream.ts
import type { NarrationEvent } from './api/types';

/**
 * Read a fetch() Response body as Server-Sent Events.
 *
 * Wire format (from api/routes/narration.py):
 *   data: {"success":true,"text":"..."}\n\n
 *   data: {"success":false,"error":"..."}\n\n
 *   data: [DONE]\n\n
 *
 * We parse each `data:` line as JSON (except the [DONE] sentinel) and
 * yield a typed NarrationEvent. Multi-line `data:` events are concatenated
 * per the SSE spec; `event:`/`id:`/`retry:` fields are ignored for v1
 * (Suzu's narrator only emits anonymous data events).
 *
 * Cancellation: if `signal.aborted`, the reader cancels the underlying
 * stream and returns. AbortError is swallowed.
 */
export interface ReadSSEOptions {
  signal?: AbortSignal;
}

export async function* readSSE(
  res: Response,
  options?: ReadSSEOptions,
): AsyncIterableIterator<NarrationEvent>;

/**
 * Convenience: POST to a path, then iterate. Caller awaits the iterator.
 *
 *   for await (const ev of streamNarration(req)) { ... }
 *
 * Behaviour:
 *   - POSTs JSON to '/api/narration/stream'.
 *   - On non-2xx response: yields a single {kind:'error', error} then returns.
 *   - On network error: yields {kind:'error', error:'network'} then returns.
 *   - On abort: returns silently.
 */
export function streamNarration(
  payload: import('./api/types').NarrationRequest,
  options?: ReadSSEOptions,
): AsyncIterableIterator<NarrationEvent>;
```

**Reconnect behaviour:** ST-007 acceptance criteria mention "exponential backoff, max 5 retries". This file exposes the **single-stream** reader; auto-reconnect is a property of the *caller* (the play screen) since reconnect requires re-POSTing with potentially-different payload state. The design exposes `streamNarration` as a single attempt; a thin wrapper `streamNarrationWithRetry` may be added in Sprint 7 once the play screen knows what "resume from where" means. Documenting the gap explicitly so QA can mark ST-007's reconnect AC as "deferred to Sprint 7 wrapper".

---

### 2.10 `src/middleware.ts` — route protection (ST-008)

```ts
// src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decodeJwtExp } from '@/lib/auth/session';

const PROTECTED = [/^\/dashboard(\/|$)/, /^\/lobby(\/|$)/,
                   /^\/character(\/|$)/, /^\/play(\/|$)/];
const AUTH_PAGES = [/^\/login(\/|$)/];

export const config = {
  // Exclude Next internals, static assets, /api/* (route handlers handle their own auth),
  // and common public files.
  matcher: ['/((?!_next/static|_next/image|_next/dev|favicon.ico|assets|api).*)'],
};

export function middleware(req: NextRequest): NextResponse;
// Behaviour:
//   1. read st_access cookie. Decode exp; treat missing/malformed as "no session".
//   2. read st_refresh cookie. Treat missing as "no session".
//   3. For PROTECTED paths:
//        - if no st_refresh → 302 to /login?next=<pathname+search>
//        - else if st_access expired (or missing) AND st_refresh present → PASS THROUGH.
//          Rationale: middleware can't itself call /api/auth/refresh (Edge can't set
//          cross-route cookies in the same response cleanly). Instead, the page loads,
//          its first apiFetch hits 401, the in-process retry refreshes, UI is fine.
//          The protected page renders a skeleton in the meantime (ST-005).
//        - else → PASS THROUGH.
//   4. For AUTH_PAGES (/login):
//        - if st_access present and not expired → 302 to ?next=… or /dashboard.
//        - else → PASS THROUGH.
//   5. All other paths → PASS THROUGH.
//
// Never throw. Any unexpected failure must fall through to NextResponse.next().
```

**Trade-off:** middleware does not silently refresh. We accept one client-side 401-then-retry on first nav after the 15-minute access window expires. Doing it in middleware would require a Set-Cookie cascade across two responses and is fragile across Next versions; the simpler model wins.

---

### 2.11 `.env.local.example`

```bash
# .env.local.example — copy to .env.local and fill in.

# Public — exposed to client JS. The DnD/narration proxies read this on the
# server, but the var is also reachable from client code (hence NEXT_PUBLIC_).
# DO NOT "fix" the spelling — NEKANOVA matches the existing proxy + tests.
NEXT_PUBLIC_NEKANOVA_URL=http://localhost:8080

# Server-only — used by the auth BFF (src/app/api/auth/[...path]/route.ts).
# Must NOT be NEXT_PUBLIC_ — refresh/access tokens never reach client JS.
AUTH_API_URL=http://localhost:5000

# Optional — only if a client page links to Authentication-Python's UI directly
# (e.g., a marketing "manage account" link). Safe to omit.
# NEXT_PUBLIC_AUTH_URL=http://localhost:5000
```

`.env.local` must be in `.gitignore` (verify; add if missing).

---

## 3. Existing-code touch points

### 3.1 `src/app/api/dnd/[...path]/route.ts` — additive edit only

**Only change:** if the incoming request has no `Authorization` header, read `st_access` from cookies (via `next/headers` `cookies()` or `req.cookies.get`) and set `Authorization: Bearer <st_access>` before forwarding. Everything else (URL handling, SSE branch, query forwarding, 502 on fetch throw) stays byte-identical.

Pseudocode for the relevant lines:

```ts
const auth = req.headers.get('authorization');
if (auth) {
  forwardHeaders.set('authorization', auth);
} else {
  const cookieAccess = req.cookies.get('st_access')?.value;
  if (cookieAccess) forwardHeaders.set('authorization', `Bearer ${cookieAccess}`);
}
```

**Test compatibility:** the 10 existing tests do not set `st_access` cookies — `req.cookies.get` returns undefined and no Authorization header is added (matching the current behaviour for unauthenticated test calls). The `forwards Authorization header to upstream` test sets `Authorization: Bearer test-token` explicitly — still wins because we check `auth` first. **All 10 tests remain green without modification.** Verified by inspection of `src/__tests__/api/dnd-proxy.test.ts`.

Do **not** migrate this file to use `src/lib/env.ts` in this sprint. The two env-config tests (`uses NEXT_PUBLIC_NEKANOVA_URL as upstream base`, `falls back to localhost:8080`) read `process.env.NEXT_PUBLIC_NEKANOVA_URL` directly; switching to a cached `env` import would break them.

### 3.2 `src/app/layout.tsx`

Add Server Component hydration:

```tsx
// At top of RootLayout (server component):
import { getServerSession } from '@/lib/auth/session';
import { me } from '@/lib/api/auth'; // safe to call from server too via fetch

// In RootLayout:
const { user: tokenUser } = await getServerSession();
const initialUser = tokenUser ? await safeFetchMe() : null;
// pass to <AuthProvider initialUser={initialUser}> wrapping <body>.
```

`safeFetchMe()` is a local helper that calls the BFF `/api/auth/me` server-side, swallowing errors and returning `null`. Must propagate the `Cookie` header from the incoming request (use `headers()` from `next/headers`).

---

## 4. Build order for Ren-Dev

Strict dependency order. Each step is independently testable.

1. **`src/lib/env.ts`** + **`.env.local.example`** + `.gitignore` check — no deps.
2. **`src/lib/api/types.ts`** — pure types.
3. **`src/lib/api/client.ts`** — depends on `types`. Mock fetch in tests.
4. **`src/lib/auth/cookies.ts`** — depends on `env`. Server-only.
5. **`src/lib/auth/session.ts`** — depends on `cookies`, `types`. Server-only.
6. **`src/app/api/auth/[...path]/route.ts`** — depends on `env`, `cookies`. End-to-end testable with a mocked upstream fetch.
7. **`src/lib/api/auth.ts`** — depends on `client`. Trivial.
8. **`src/lib/api/dnd.ts`** — depends on `client`, `types`. Trivial.
9. **`src/lib/stream.ts`** — depends on `types`.
10. **`src/lib/auth/AuthProvider.tsx`** — depends on `api/auth`, `types`.
11. **Edit `src/app/api/dnd/[...path]/route.ts`** — additive cookie fallback (§3.1). Verify all 10 existing tests still pass.
12. **`src/app/api/narration/[...path]/route.ts`** — depends on `env`, `cookies`. New tests.
13. **`src/middleware.ts`** — depends on `cookies` constant names and `session.decodeJwtExp`.
14. **Edit `src/app/layout.tsx`** — wrap body in `AuthProvider initialUser={...}`. Last, because it integrates everything.

Suggested PR slicing for review hygiene:
- **PR-A:** steps 1–3 (env + types + base client).
- **PR-B:** steps 4–7 (auth cookies + session + BFF + auth wrappers).
- **PR-C:** step 8 (dnd wrappers) — small, can be parallel to PR-B.
- **PR-D:** steps 9–10 (stream + AuthProvider).
- **PR-E:** steps 11–14 (proxy edit + narration proxy + middleware + layout). Single PR because they're coupled at runtime.

---

## 5. Testing strategy (for Miko-QA)

### 5.1 Unit / integration tests by file

| File | Test focus | New file |
|---|---|---|
| `env.ts` | Throws in prod when required vars missing; defaults in dev | `src/__tests__/lib/env.test.ts` |
| `api/client.ts` | (a) JSON body serialise; (b) ApiError shape on 4xx/5xx; (c) 401 triggers `/api/auth/refresh` + retry once; (d) 401 on refresh path itself does NOT recurse; (e) signal abort cancels mid-flight | `src/__tests__/lib/api-client.test.ts` |
| `api/dnd.ts` | Wrapper path/method per function, body shape (one assertion per function — table-driven) | `src/__tests__/lib/api-dnd.test.ts` |
| `api/auth.ts` | Same — table-driven | `src/__tests__/lib/api-auth.test.ts` |
| `auth/session.ts` | `decodeJwtExp` handles malformed input, missing exp, expired/future; `isExpired` clock skew | `src/__tests__/lib/auth-session.test.ts` |
| `auth/cookies.ts` | cookieOpts.secure flips on env.IS_PROD; clearAll deletes all three | `src/__tests__/lib/auth-cookies.test.ts` |
| `app/api/auth/[...path]/route.ts` | login OK → sets st_access + st_refresh; login 2FA → sets st_partial only; verify-2fa swaps partial→access+refresh; refresh sets new st_access; refresh with new refresh_token rotates st_refresh; logout always clears + returns 200; unknown path → 404; upstream 429 forwards Retry-After | `src/__tests__/api/auth-bff.test.ts` |
| `app/api/narration/[...path]/route.ts` | only 'stream' accepted (others 404); injects Bearer from cookie; 401 when no cookie + no header; SSE passthrough headers; 502 on fetch throw | `src/__tests__/api/narration-proxy.test.ts` |
| `app/api/dnd/[...path]/route.ts` | **All 10 existing tests still pass.** + 1 new: when no Authorization header is set and st_access cookie is present, Bearer is injected | Edit `src/__tests__/api/dnd-proxy.test.ts` (additive — append one test) |
| `lib/stream.ts` | parses chunked `data: {...}` + `[DONE]` sentinel; ignores blank lines; yields `error` event on bad JSON; abort signal stops iteration | `src/__tests__/lib/stream.test.ts` |
| `middleware.ts` | Protected route + no refresh → 302 /login?next=…; protected + expired access + valid refresh → pass-through; /login + valid access → 302 to ?next or /dashboard; static asset path → pass-through; malformed JWT → treated as no session | `src/__tests__/middleware.test.ts` |
| `AuthProvider.tsx` | initialUser hydrates; login(ok) sets user; login(2fa) doesn't set user; verify2FA sets user; logout clears user even if BFF throws; useAuth outside provider returns fallback | `src/__tests__/lib/AuthProvider.test.tsx` |

### 5.2 Coverage targets

- 90 %+ statement coverage on `lib/api/*`, `lib/auth/*`, `lib/stream.ts`.
- 100 % branch coverage on middleware decision tree and BFF dispatch table.
- The pre-existing globals-css + page-render tests must remain green (`npm test` clean).

### 5.3 What QA must NOT test

- Don't assert on httpOnly cookie values from JS code paths — they're not readable. Use the route-handler test environment (`@jest-environment node`) and inspect `NextResponse.cookies`.
- Don't write a Playwright test for the BFF this sprint; integration with real Authentication-Python is Sprint 4's burden.

---

## 6. Observability

Light-touch for the foundation layer; structured calls land in Sprint 7.

- **BFF route handler:** `console.warn` on upstream 5xx + non-2xx /auth/refresh; never log request bodies (passwords, tokens). Log only `{path, upstreamStatus, durationMs}`.
- **`apiFetch`:** in dev (`!env.IS_PROD`), `console.warn` on `ApiError` with `{status, code, path}`. Suppressed in prod (toast layer in ST-006 handles user-visible signalling).
- **Middleware:** silent. Any throw must be caught and converted to `NextResponse.next()` — never let the edge crash on a malformed cookie.
- **Masking:** the only PII at this layer is `username`. Never log `password`, `totp_code`, `access_token`, `refresh_token`, `partial_token`. Code review must reject any `console.log(req.body)` style debug leftovers.

Analytics events for the foundation layer: **none.** Adding them now is premature; Sprint 4 (Login) adds `auth.login.success / .failure / .2fa_required`.

---

## 7. Rollout & rollback

This is a frontend foundation — there's nothing to feature-flag at runtime, but we can stage the user-visible impact.

- **No feature flags this sprint.** No user-visible UI change lands until Sprint 4 (login page). Foundation merges as it lands.
- **Per-PR rollback:** revert the PR. Because PR-A through PR-D have no public route changes, rollback is risk-free. PR-E (middleware + layout + proxy edit) is the only one that changes user-visible behaviour — but until Sprint 4 ships `/login`, "no session" simply redirects to `/login` which is currently a stub page. Acceptable.
- **Sanity check after PR-E:** `npm run build` clean, the 10 existing proxy tests green, all new tests green. Manually: visit `/` (passes through), visit `/dashboard` (302 to `/login?next=/dashboard`), visit `/login` (passes through).

---

## 8. Risks & mitigation

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Next 16 / React 19 strict-mode double-invoke of `useEffect` causes double-refresh storm | Med | Med | `apiFetch` debounces the refresh: only ONE in-flight `/api/auth/refresh` at a time; concurrent 401s await the same promise. Implementation note in `client.ts`: keep a module-level `let refreshInFlight: Promise<boolean> | null`. |
| Edge runtime can't `await import('jose')` cleanly | Low | Low | We don't use `jose`. Hand-rolled `decodeJwtExp` uses only `atob` (Edge-safe) + `JSON.parse`. |
| The 10 existing dnd-proxy tests fail because `req.cookies.get` is undefined on raw `NextRequest` constructed in tests | Low | High (blocks merge) | `NextRequest.cookies` exists; on test-constructed requests with no cookie header it just returns `undefined`. Verified against test file. Fallback path: feature-detect (`if (typeof req.cookies?.get === 'function')`) before reading. |
| Authentication-Python rate-limits the BFF (10 login/min, 30 refresh/hr) and the BFF appears as a single IP | Med | Med | Forward upstream 429 + Retry-After unchanged. Document in Sprint 4 that the limiter needs an exemption for the BFF or an `X-Forwarded-For` propagation. **Escalation flag: cross-team contract.** |
| Refresh-token cookie size approaches the 4 KB-per-cookie browser limit if upstream changes JWT payload | Low | Med | Refresh JWT is ~600 B today. Add a 3000-byte guard in `setRefresh` that logs a warning if exceeded — no current action, just an early signal. |
| Cookie-transport vs Bearer mismatch with upstream CSRF | Low | Med | We never send `?cookie=true` to upstream. `csrf_refresh_token` is never set. Documented in §2.7. |
| `dm_mode` shipped as client-only diverges when STORY-312 lands | Med | Low | Field is optional and additive. Server populating it later is a non-breaking change. Add a `// STORY-312: server will set this; remove client annotation` TODO breadcrumb in the lobby/play screen when those land. |

---

## 9. What is explicitly OUT of scope this sprint

- **Twitch OAuth login.** Authentication-Python's `/auth/oauth/twitch` requires an *existing* JWT (it's "link this account", not "log me in"). Sprint 4 needs a separate upstream change OR a "sign up via Twitch" flow we don't have yet. Park.
- **Discord OAuth login.** Same as above.
- **Password reset, email verification, 2FA enrolment.** Sprint 4+.
- **Toast wiring of API errors.** ST-006 ships the component; ST-001 only ensures errors are throwable. The wiring is a 5-line concern in each call site, intentionally deferred.
- **SSE auto-reconnect.** See §2.9 — single-attempt this sprint; backoff wrapper in Sprint 7 when call-site state is known.

---

## Conventions Checklist

- [x] Follows module structure from `SuzusTavern/CLAUDE.md` (`src/app`, `src/lib`, `src/components`)
- [x] Adheres to coding standards: TS strict, `@/*` paths, CSS Modules (no Tailwind), `'use client'` only where interactive
- [x] PR slicing per §4 keeps each review tractable (5 PRs, clear deps)
- [x] Security requirements: httpOnly cookies, no tokens in JS, SameSite=Lax, Secure in prod, BFF strips tokens from response bodies
- [x] Reuses existing patterns: the new narration proxy mirrors the existing dnd-proxy SSE branch byte-for-byte; no new HTTP library
- [x] Integration points have full API contracts (§2.4, §2.5, §2.7, §2.8)
- [x] Auth path traced and documented (§1.1 diagram + §2.7 behaviour table)
- [x] Feature flags: none needed; rollback per-PR documented (§7)
- [x] Observability covers BFF, client, middleware, with explicit masking rules (§6)
- [x] Accessibility: no UI components this sprint; Toast/Skeleton/ErrorBoundary defer to Sprint 3
- [x] Implementation steps are ordered by dependency (§4)

---

## 10. Implementation deltas & review resolutions (2026-06-15, as-built)

Recorded after Ren-Dev (2 passes) → Miko-QA (172→232 tests) → Kage-CR. Final state: `tsc --noEmit` clean, **235 tests / 22 suites green**, `next build` clean.

### Intentional deltas from the design above
- **`middleware.ts` → `proxy.ts`.** The repo runs `next@16.2.6`, which deprecates the `middleware` file convention in favour of `proxy` (build warned). Renamed `src/middleware.ts` → `src/proxy.ts` and the exported `middleware` fn → `proxy` (Next reads `mod.proxy`). Behaviour and matcher are identical; the deprecation warning is gone and the handler still registers (`ƒ Proxy (Middleware)`). §2.10 otherwise stands.
- **`getServerSession` calls `${AUTH_API_URL}/auth/me` directly** (server-to-server, `cache: 'no-store'`) rather than self-fetching the BFF `/api/auth/me` route — avoids the RSC self-fetch footgun (`window.location.origin` is undefined server-side). Supersedes §2.6.2's note that it "does NOT call /auth/me".
- **Edge-safe JWT split.** `decodeJwtExp`/`isExpired` live in `src/lib/auth/jwt.ts` (no `server-only`, `atob`+`JSON.parse` only); `session.ts` re-exports them; `proxy.ts` imports from `jwt.ts`. Keeps the Edge bundle clean.

### Kage-CR findings — resolution
- **B1 (BLOCKER) — FIXED.** `/auth/logout` is `@jwt_required(refresh=True)` (auth.py:767): it revokes the refresh-token row + blocks the linked access session. The BFF now authenticates the upstream logout with the **refresh** token (was: access → would 422, session never revoked). Test added.
- **M1 (MAJOR) — verified NON-ISSUE.** `/auth/refresh` always rotates and returns `{access_token, refresh_token}` in the Bearer-mode JSON body (auth.py:649-652); cookie-transport would omit it, but the BFF uses Bearer. So "rotate `st_refresh` when present" is always correct. Covered by the existing rotation test.
- **M3 (MAJOR) — FIXED.** `parseUpstreamBody` now builds the browser-facing body from an explicit **allow-list** (`user`/`msg`/`error`/`error_code`/`errors`/`requires_2fa`) instead of a token deny-list — safe-by-default against any future token/credential field upstream adds. Test added (`csrf_refresh_token`/`mfa_recovery_token`/`access_token` stripped).
- **M4 (MINOR) — FIXED.** Oversized-refresh-token warning in `setRefresh` is now one-shot per process (was: every 15-min refresh → log flood).
- **m1 (MINOR) — FIXED.** `apiCall` envelope-error now throws `ApiError{status:422}` (was: misleading `200`).

### Accepted & TRACKED (not fixed this sprint)
- **M2 — first-paint "logged-out" flash** for returning users whose access token expired (>15 min idle) but whose refresh is valid: layout hydrates `initialUser:null`, the first client `apiFetch` 401-retry then refreshes. No user is exposed to this until Sprint 4 ships `/login` + authed pages. **Decision: accept now; revisit in Sprint 4** — either proactively refresh in `getServerSession` (server-side) or render a skeleton (ST-005) during the silent refresh.
- **M5 (MINOR) — `proxy.ts` matcher** doesn't exclude root static files (`/robots.txt`, `/manifest.json`, `sw.js`). None exist yet; revisit when Sprint 4 adds PWA/marketing assets so the proxy doesn't run per static fetch.
- **m5 (MINOR) — narration error passthrough** surfaces upstream `str(e)` verbatim; map to a generic message + log raw separately when the play screen wires it (Sprint 7).
- **getInventory** wrapper exists but its NekoNova `/api/dnd/characters/<id>/inventory` bridge route is not built — commented as pending Sprint 6 (ST-057).
- **BFF rate-limit / single-IP** (Auth-Python: 10 login/min, 30 refresh/hr per IP): the BFF appears as one IP. Needs a limiter exemption or `X-Forwarded-For` propagation **before Sprint 4** ships real login traffic. Cross-team contract item.
