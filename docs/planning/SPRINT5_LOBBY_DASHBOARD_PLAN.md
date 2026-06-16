# Sprint 5 — Lobby + Dashboard — Plan

> Author: Claude Code (prep pass) · Date: 2026-06-16
> Status: built overnight; backend prerequisite staged for supervised deploy
> Source of truth: this doc + `SPRINTS.md` Sprint 5 (ST-033..046) + the 2026-06-14 MVP plan (Option B)

---

## 0. Prep-pass findings (the backend reality)

The lobby/dashboard need session data. The engine's session model is **Twitch-channel-centric**, and the read surface to support a lobby **does not exist** anywhere in the stack. Confirmed by source:

| Capability the UI needs | Engine (`NekoNova-DnDEngine`) | Bridge (`ProjectNekoNova/api/routes/dnd_*.py`) | Tavern (`src/lib/api/dnd.ts`) |
|---|---|---|---|
| **List/browse sessions** | ❌ no `list_sessions` query. Only `get_active_session(channel)` (one per channel) + `get_session(id)`. | ❌ none (only 6 POST lifecycle routes) | ❌ none |
| **Get session by id** (resume) | ⚠️ `get_session(id)` exists; **no route** (only `GET /sessions/active?channel=`) | ❌ none | ❌ none |
| **Create returns a usable session** | ⚠️ `POST /sessions` returns a **Twitch chat string** (`"…ID: {id[:8]}… \| Players: type ~join"`), not a structured session | ⚠️ passes the string through as `data.message` | ⚠️ `startSession()` typed `Session` but `session_id` is **undefined** at runtime |
| **List my characters** (ST-044) | ✅ `GET /characters/by-username/{username}` exists | ❌ **not bridged** | ❌ none |
| **Join a session** (ST-036) | ✅ `POST /sessions/{id}/join` | ✅ bridged | ✅ `joinSession()` |

**Engine session schema** (`game_sessions`): `session_id, channel, status('active'|'paused'|'ended'), dm_username, started_at, paused_at, ended_at, active_combat_id, xp_pool, participant_usernames(JSON-text)`. That's **all** the real data a lobby/dashboard can bind.

The design canvases (`lobby.jsx`/`dashboard.jsx`) assume rich metadata the engine does **not** store: `title, blurb, level, seats(taken/total), mood, tags, dmKind, cadence, module, sessions-played, rolls-count, next-session-time`. All of that is fabricated demo data (`window.DATA.TABLES/QUESTS/RECENT`).

### Decision — "thin real data" (Path 1), not schema expansion

Bind **only real engine fields**; render the design's **layout** faithfully but **do not fabricate** session metadata. This matches the Sprint-4 precedent (we cut the fabricated landing hero stats) and the MVP plan's Risk #2 ("scope gravity — hold the MVP line"). A full session-metadata schema (title/blurb/mood/seats/visibility/content_rating columns) is a **post-Sprint-5 backend epic**, not this sprint.

Real fields → UI mapping:
- **Title** ← `channel` (display-formatted) until a real title column lands.
- **DM line** ← `dm_username` (`suzu` → SuzuDM "DM'd by Suzu"; else human chip). This is the real `dm_mode` signal.
- **Seats/players** ← `participant_usernames.length` (real count). **No fixed seat total** (engine has none) → show "N at the table", not "N/M seats".
- **Status pill** ← `status` (`active`/`paused`).
- **Started** ← `started_at` (rendered via a Tavern time util).
- Decorative-only flourishes (aurora, Suzu suggestion banner copy) are clearly non-data; the Suzu suggestion banner (ST-038) ships as a **static** encouragement string for now (no recommender backend), or is deferred.

---

## 1. Backend prerequisite (build + test now; **deploy = supervised, Leon's call**)

The prod NekoNova API + engine run on **nekonova-db**, the delicate production bot box (prod↔git divergence, bot-state preservation, postgres-reconnect runbook). This prompt authorized deploying **only the Tavern** (nekonova-aux). So the backend prereq is **built + unit-tested + committed locally**, and its prod deploy is staged as a supervised step. The new routes are **additive read-only GETs** (no pipeline change, low bot risk), but deploying to that box overnight unsupervised is out of authorized scope.

### Engine (`NekoNova-DnDEngine`)
- `engine/sessions.py`: `list_sessions(db, username=None, statuses=('active','paused')) -> List[GameSession]` — `SELECT … WHERE status IN (…) ORDER BY started_at DESC`; participant filter applied in Python (homelab scale). Pool-discipline `try/finally` per invariant #4.
- `routes/sessions.py`:
  - `GET /sessions` (`?username=`, `?status=`) → `{success, data:{sessions:[{session_id, channel, status, dm_username, started_at, player_count, participant_usernames}]}}`. **Register before** `GET /{session_id}` and after `GET /active` (FastAPI registration-order rule, invariant #6).
  - `GET /sessions/{session_id}` → structured single session.
  - `POST /sessions` (`start_session`): **additively** include the structured session in `data` (call `get_active_session(channel)` post-start) so the frontend gets `session_id/channel/status` alongside the legacy `message`.
- Tests + README endpoint-table update (invariant: keep it synced).

### Bridge (`ProjectNekoNova/api/routes/`)
- `dnd_sessions.py`: `GET /api/dnd/sessions` (forward `username`/`status`), `GET /api/dnd/sessions/<id>`.
- `dnd_characters.py`: `GET /api/dnd/characters/by-username/<username>` (proxy the existing engine route).
- Tests (mirror the existing thin-proxy test pattern).

### Tavern (`src/lib/api/`) — ships with the frontend, deploys tonight
- `dnd.ts`: `listSessions(opts?)`, `getSession(id)`, `listMyCharacters(username)`. (`startSession` already exists; the Tavern proxy `[...path]` is method-agnostic — GET already works, cf. `getCombatStatus`.)
- `types.ts`: extend `Session` with real optional fields (`dm_username?, started_at?, player_count?, participant_usernames?`); add `ContentRating = 'sfw'|'mature'`, `Visibility = 'public'|'unlisted'|'private'`; `content_rating?`/`visibility?` as **client-annotated** fields (same pattern as `dm_mode`).

### Graceful degradation (so the Tavern deploys tonight without the backend live)
Until the backend prereq is deployed, the live NekoNova returns 404 for `GET /api/dnd/sessions` etc. The lobby/dashboard treat 404/`success:false` as **empty state** (no error-toast loop). The **way-to-start create flow works live today** (`POST /api/dnd/sessions` is already deployed) — so "Start a campaign → pick a module → create" is verifiable end-to-end tonight even before the read endpoints land.

---

## 2. content_rating (baked in per decision)

- Create-session UI gains a **`content_rating`** control: default `'sfw'`; `'mature'` is **only selectable when visibility is private/unlisted**. Client-typed (like `dm_mode`), stored client-side keyed by `session_id` until the engine column lands. **Not** sent to the engine yet (body stays `{username, channel}`).
- **No NSFW model is built** (post-MVP, hardware-gated).
- Two backend stories filed (below).

### Backend stories filed
- **STORY-313 (engine):** add `content_rating` (+ `visibility`, `dm_mode`) columns to `game_sessions` on `suzu_dnd` / `suzu_dnd_dev`; surface in create + list. Migrates the client-typed annotations to server-set.
- **STORY-314 (engine/bridge — HARD INTERLOCK):** if a session is `public`/streamed OR `streaming.enabled`, **force the SFW narration model regardless of `content_rating`** — protects the Twitch channel from a ToS ban. Safe-by-default; a public table can never use the mature model. Enforce server-side (the client `'mature'`-gating is convenience, not the guarantee).

---

## 3. Frontend build order (Tavern Sprint 5)

Reuse the 14-component library + the M2 AuthProvider pattern (`maybeAuthed`/`loading` → `PageSkeleton`, no logged-out flash). Server Components by default; `'use client'` only where interactive. Route protection via `src/proxy.ts` (already guards `/lobby`, `/dashboard`). Reuse `sanitizeNextPath` for any new redirect.

1. **lib layer** — types + `listSessions`/`getSession`/`listMyCharacters` wrappers + tests.
2. **TavernShell + Sidebar (ST-039)** — collapsible sidebar (256px desktop / drawer mobile), TopNav, the authed chrome both pages share. Reuse Icon/Avatar/SuzuDM/Button.
3. **Lobby (ST-033/036/037)** — session list (real `listSessions`, empty-state), TableCard bound to real fields, Join (ST-036), **Start a campaign → routes to modules (Option B way-to-start)**. Filter strip (ST-034)/search (ST-035)/suggestion banner (ST-038) as time allows (static).
4. **Modules way-to-start** — pick-a-module / one-shot (SRD starter set from Phase-0 seed) → "Run this" → `createSession` (+ content_rating/visibility/dm_mode client annotations) → toast + land on dashboard. (Compendium/PDF-library/homebrew tabs are stubs/disabled — post-MVP.)
5. **Dashboard (ST-040/041/044)** — layout + three states (empty/one/many keyed off `listSessions` result), resume hero (ST-041, real active session), my-characters grid (ST-044, real `listMyCharacters` + "+ New"→/character/new). my-campaigns (ST-043)/stats (ST-042)/hooks (ST-045)/activity (ST-046) **deferred** (no real backing data; would be fabricated).

**a11y from the start:** ≥44px targets, contrast tokens (`--bad-ink`, `--ink-2`), one `<h1>`/page, `aria-live` for async, skip-link in layout.

## 4. Agent quick-path
Hoshi-DX (extract lobby + dashboard + modules canvases) → Aoi-UI (state maps + a11y + content_rating UI) → Ren-Dev (passes above; verify disk + `npm test`/`build` after each) → Miko-QA → Kage-CR + Iro-A11y. QA + a11y never skipped.

## 5. Tonight (autonomous) vs. queued for Leon
- **Autonomous:** backend prereq (build+test+local commit), full Tavern frontend, Tavern deploy to nekonova-aux, live-verify (render + create-flow + graceful empty-states logged in as Leon), Current Status update.
- **Queued for Leon (supervised):** deploy the backend prereq to **nekonova-db + engine** (rsync+compose, additive GET routes, rollback image) to light up the lobby browse + dashboard resume + my-characters with real data. Then re-verify the live lobby shows the real session.
