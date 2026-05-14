# Suzu's Tavern — Sprint Plan

> Last updated: 2026-05-13 (Sprint 1 complete)  
> Total stories: 80 (ST-001–ST-080) — see BACKLOG.md for full story details  
> Status key: Backlog · In Progress · Done · Deferred

---

## Critical path

Sprint 1 (Backend API Bridge) must land in **ProjectNekoNova** before any frontend story can connect live data. The dnd_engine has no REST endpoints yet — only Twitch command handlers. Everything else depends on Sprint 1.

```
Sprint 1 (NekoNova) → Sprint 2 (Foundation) → Sprint 3 (Components)
  → Sprint 4 (Auth + Landing) → Sprint 5 (Lobby + Dashboard)
  → Sprint 6 (Character) → Sprint 7 (Play Session) → Sprint 8 (Polish)
```

---

## Sprint 1 — Backend API Bridge
> **Where:** ProjectNekoNova (`../ProjectNekoNova/dnd_engine/` + `../ProjectNekoNova/api/routes/`)  
> **Why first:** Exposes the dnd_engine over HTTP so the frontend can call it. No frontend story can use live data until this lands.

| Story | Title | Priority | Size | Status |
|-------|-------|----------|------|--------|
| ST-067 | Character REST endpoints in ProjectNekoNova | P0 | L | Done |
| ST-068 | Session REST endpoints in ProjectNekoNova | P0 | L | Done |
| ST-069 | Narration and combat REST endpoints in ProjectNekoNova | P0 | L | Done |
| ST-070 | Next.js API route proxies | P0 | M | Done |

**What gets built:**
- `POST /api/dnd/characters` — create character (wraps `cmd_create`)
- `GET /api/dnd/characters/:id` — character sheet (wraps `cmd_sheet`)
- `POST /api/dnd/characters/:id/levelup` — level up
- `POST /api/dnd/characters/:id/equip` — equip item
- `GET /api/dnd/characters/:id/inventory` — inventory
- `POST /api/dnd/sessions` — start session
- `POST /api/dnd/sessions/:id/join` — join session
- `POST /api/dnd/sessions/:id/pause|resume|end` — lifecycle
- `POST /api/dnd/sessions/:id/xp` — award XP
- `POST /api/dnd/combat/attack|dodge|dash|endturn` — combat actions
- `GET /api/dnd/combat/:sessionId/status` — combat state
- `POST /api/dnd/spells/cast` — cast spell
- `POST /api/narration/stream` — trigger Suzu DM narration (returns SSE)
- Next.js `/app/api/dnd/[...path]/route.ts` proxy to NekoNova

---

## Sprint 2 — Foundation
> **Where:** SuzusTavern (`src/lib/`, `src/middleware.ts`)  
> **Why second:** Auth, API client, and error primitives that every feature layer depends on.

| Story | Title | Priority | Size | Status |
|-------|-------|----------|------|--------|
| ST-001 | HTTP API client with JWT bearer auth | P0 | M | Backlog |
| ST-002 | Environment configuration | P0 | XS | Backlog |
| ST-003 | Auth session management (token storage and refresh) | P0 | M | Backlog |
| ST-007 | Axios / fetch wrapper for SSE streaming | P0 | S | Backlog |
| ST-008 | Route protection middleware | P0 | S | Backlog |
| ST-004 | Global error boundary | P0 | S | Backlog |
| ST-005 | Page-level loading skeletons | P1 | S | Backlog |
| ST-006 | Toast notification system | P1 | S | Backlog |

**What gets built:**
- `src/lib/api/client.ts` — typed fetcher with JWT injection, 401 redirect
- `src/lib/api/dnd.ts` — typed wrappers for all dnd endpoints
- `src/lib/api/auth.ts` — typed wrappers for Authentication-Python
- `src/lib/env.ts` — validated env vars (throws on missing)
- `.env.local.example` — documents `NEXT_PUBLIC_NEKANOVA_URL`, `NEXT_PUBLIC_AUTH_URL`, `NEXT_PUBLIC_WS_URL`
- `src/lib/auth/session.ts` — JWT storage, refresh, expiry
- `src/lib/stream.ts` — SSE reader utility
- `src/middleware.ts` — Next.js route protection
- `src/components/ErrorBoundary.tsx`
- `src/components/PageSkeleton.tsx`
- `src/components/Toast.tsx`

---

## Sprint 3 — Design System Components
> **Where:** SuzusTavern (`src/components/`)  
> **Reference:** `../Suzu's Tavern Design System/ui_kits/web/shared.jsx`, `assets/`

| Story | Title | Priority | Size | Status |
|-------|-------|----------|------|--------|
| ST-009 | Button component | P0 | S | Backlog |
| ST-010 | Card component | P0 | S | Backlog |
| ST-011 | Pill component | P0 | XS | Backlog |
| ST-015 | Icon component | P0 | M | Backlog |
| ST-012 | Die component | P1 | S | Backlog |
| ST-013 | Avatar component | P1 | S | Backlog |
| ST-014 | SuzuDM component | P0 | M | Backlog |
| ST-016 | Sidebar component | P1 | M | Backlog |
| ST-017 | DiceRoller component | P1 | L | Backlog |
| ST-018 | NarratorStrip component | P1 | M | Backlog |
| ST-019 | ChatLog component | P1 | M | Backlog |
| ST-020 | InitiativeTracker component | P1 | M | Backlog |

**What gets built:**
- All 7 stubbed components fully implemented to design spec
- 5 new components: `Sidebar`, `DiceRoller`, `NarratorStrip`, `ChatLog`, `InitiativeTracker`
- Each component: TypeScript props interface + CSS Module + unit test
- Icons ported from `../Suzu's Tavern Design System/assets/icons.jsx` and `dice-icons.jsx`
- SuzuDM: animated persocom orb in DM hat, blink + mouth-open states
- DiceRoller: physics-y tumble animation (600ms), result fade-in (200ms)

---

## Sprint 4 — Auth + Landing
> **Where:** SuzusTavern (`src/app/(auth)/`, `src/app/page.tsx`)  
> **Reference:** `../Suzu's Tavern Design System/ui_kits/web/login.jsx`, `landing.jsx`

| Story | Title | Priority | Size | Status |
|-------|-------|----------|------|--------|
| ST-027 | Login page layout (two-pane) | P0 | M | Backlog |
| ST-028 | Email / password authentication | P0 | M | Backlog |
| ST-031 | Logout | P0 | XS | Backlog |
| ST-029 | Twitch OAuth login | P1 | M | Backlog |
| ST-030 | Discord OAuth login | P2 | M | Backlog |
| ST-032 | Password reset placeholder | P2 | S | Backlog |
| ST-021 | Landing page hero section | P1 | M | Backlog |
| ST-022 | How it works section | P1 | S | Backlog |
| ST-023 | Capabilities / features section | P1 | S | Backlog |
| ST-024 | Suzu intro / story section | P1 | S | Backlog |
| ST-025 | Footer | P1 | XS | Backlog |
| ST-026 | Landing page responsive layout | P1 | S | Backlog |

**What gets built:**
- Two-pane login: SuzuDM mascot intro left, form right, aurora background
- JWT auth connected to Authentication-Python
- Twitch OAuth chip (functional)
- Landing: hero + aurora gradient, how-it-works, capabilities, Suzu story section, footer
- All copy follows Suzu's voice (dry narrator, sentence case, no emoji)

---

## Sprint 5 — Lobby + Dashboard
> **Where:** SuzusTavern (`src/app/lobby/`, `src/app/dashboard/`)  
> **Reference:** `../Suzu's Tavern Design System/ui_kits/web/lobby.jsx`, `dashboard.jsx`

| Story | Title | Priority | Size | Status |
|-------|-------|----------|------|--------|
| ST-039 | Lobby shell with sidebar | P1 | M | Backlog |
| ST-033 | Session listing page | P1 | M | Backlog |
| ST-034 | Session filter strip | P1 | S | Backlog |
| ST-035 | Session search | P2 | S | Backlog |
| ST-036 | Join session | P1 | M | Backlog |
| ST-037 | Start a campaign (create session) | P1 | M | Backlog |
| ST-038 | Suzu suggestion banner | P1 | S | Backlog |
| ST-040 | Dashboard page layout | P1 | M | Backlog |
| ST-041 | Resume session hero card | P1 | S | Backlog |
| ST-042 | Stats row | P1 | S | Backlog |
| ST-043 | My campaigns list | P1 | S | Backlog |
| ST-044 | My characters grid | P1 | M | Backlog |
| ST-045 | Open hooks / quest tracker | P2 | M | Backlog |
| ST-046 | Recent activity log | P2 | S | Backlog |

**What gets built:**
- Lobby: shell + collapsible sidebar (256px desktop, drawer mobile), filter strip, 6 session table cards, Suzu suggestion
- Join/create session connected to ST-068 (session REST endpoints)
- Dashboard: resume hero, stats row, campaigns list, characters grid, activity log

---

## Sprint 6 — Character Creation + Sheet
> **Where:** SuzusTavern (`src/app/character/`)  
> **Reference:** `../Suzu's Tavern Design System/ui_kits/web/character-create.jsx`, `character.jsx`  
> **Depends on:** ST-067 (character REST endpoints)

| Story | Title | Priority | Size | Status |
|-------|-------|----------|------|--------|
| ST-047 | Character creation wizard shell (5 steps) | P0 | M | Backlog |
| ST-048 | Race selection step | P0 | M | Backlog |
| ST-049 | Class selection step | P0 | M | Backlog |
| ST-050 | Ability scores step (point buy) | P0 | L | Backlog |
| ST-051 | Background selection step | P1 | M | Backlog |
| ST-052 | Character review and submission | P0 | M | Backlog |
| ST-053 | Suzu commentary panel | P1 | M | Backlog |
| ST-054 | Character sheet page | P1 | M | Backlog |
| ST-055 | Identity card | P1 | S | Backlog |
| ST-056 | Ability scores and skills panel | P1 | M | Backlog |
| ST-057 | Inventory panel | P1 | M | Backlog |
| ST-058 | Spells panel | P2 | M | Backlog |
| ST-059 | Character sheet edit mode | P2 | L | Backlog |

**What gets built:**
- 5-step wizard: race → class → ability scores (point-buy 27pts) → background → review
- Each step pulls SRD data from dnd_engine via ST-067 endpoints
- Suzu commentary panel: AI-generated reaction to each choice (Gemini via NekoNova)
- Full 5e character sheet: identity, ability scores, saving throws, skills, inventory, spells, features
- Numbers always in JetBrains Mono with tabular-nums

---

## Sprint 7 — Play Session
> **Where:** SuzusTavern (`src/app/play/[sessionId]/`)  
> **Reference:** `../Suzu's Tavern Design System/ui_kits/web/play.jsx`  
> **Depends on:** ST-068 (session endpoints), ST-069 (combat endpoints), ST-071 (SSE), ST-072 (WebSocket)

| Story | Title | Priority | Size | Status |
|-------|-------|----------|------|--------|
| ST-071 | Narration streaming (SSE) | P0 | M | Backlog |
| ST-072 | WebSocket for session events (dice, initiative, HP) | P1 | L | Backlog |
| ST-060 | Play session page layout (3-pane) | P0 | L | Backlog |
| ST-061 | Party list panel | P1 | M | Backlog |
| ST-062 | Suzu narration (AI pipeline integration) | P0 | XL | Backlog |
| ST-063 | Message composer | P1 | M | Backlog |
| ST-064 | Combat state management | P1 | L | Backlog |
| ST-065 | Dice roll flow with server resolution | P1 | L | Backlog |
| ST-066 | Spell casting in combat | P2 | L | Backlog |

**What gets built:**
- 3-pane layout: party+initiative left (256px) | narrator+chat+composer center (flex) | map+dice+tools right (320px)
- Sticky narrator strip (56px top): Suzu's current narration, streams token by token via SSE
- Chat log: player messages + Suzu narration + system events, auto-scroll
- Composer: player action input, submit sends to NekoNova narration endpoint
- Dice tray: D4/D6/D8/D10/D12/D20, physics tumble animation, result broadcast via WebSocket
- Combat state: initiative order, HP bars, turn indicator, attack/dodge/dash/end turn buttons
- All game actions route to ProjectNekoNova dnd_engine via ST-069 endpoints

---

## Sprint 8 — Polish + Accessibility
> **Where:** SuzusTavern (cross-cutting)

| Story | Title | Priority | Size | Status |
|-------|-------|----------|------|--------|
| ST-073 | Palette switcher (tweaks panel) | P2 | M | Backlog |
| ST-074 | Mobile responsive — lobby and dashboard | P2 | M | Backlog |
| ST-075 | Mobile responsive — play session | P2 | L | Backlog |
| ST-076 | Keyboard navigation | P2 | M | Backlog |
| ST-077 | Screen reader support | P2 | M | Backlog |
| ST-078 | Page transition animations | P3 | S | Backlog |
| ST-079 | Session memory recap (Suzu's notes) | P2 | M | Backlog |
| ST-080 | Suzu's note on character sheet | P2 | S | Backlog |

**What gets built:**
- Floating tweaks panel: switches `data-vibe` (dusk-tavern / candlelit / aetheric / moonlit-grove) and `data-density` (compact / cozy / airy) live
- Mobile: sidebar becomes full-screen drawer, play session collapses to single-column with tab switching
- Keyboard nav: focus traps in modals, arrow key navigation in dice tray + initiative list
- Session memory recap: Suzu summarizes last session on dashboard resume card (via NekoNova memory API)
- Page transitions: 200ms fade on route change

---

## MVP definition

The following sprints constitute a shippable MVP:

| Sprint | Must complete | Can defer |
|--------|---------------|-----------|
| 1 | All 4 stories | — |
| 2 | ST-001–004, ST-007–008 | ST-005, ST-006 |
| 3 | ST-009–011, ST-014–015 | ST-016–020 |
| 4 | ST-027–029, ST-031 | ST-030, ST-032, ST-021–026 |
| 5 | ST-033, ST-036–037, ST-039–041, ST-044 | ST-034–035, ST-038, ST-042–043, ST-045–046 |
| 6 | ST-047–052 | ST-053–059 |
| 7 | ST-060–065, ST-071 | ST-066, ST-072 |
| 8 | All deferred | — |

**MVP = 26 stories.** A player can log in, create a character, join a session, and play with Suzu as DM.
