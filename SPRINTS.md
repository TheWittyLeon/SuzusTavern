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

---

## Deployment Changelog

| Date | Build | Status | Notes |
|------|-------|--------|-------|
| 2026-08-12 | `dd511f2` + `d25d452` | DEV-DEPLOYED | **1.7 audit follow-through (WF-B Tavern lane):** LeaveCampaignButton (C1) + C3 rescue-transition line as Suzu narration + reason-map completeness with generic fallback across 5 proxies + campaigns-on-/trash restore + full 67-stylesheet density wiring (200 subs, 154 non-reproducible) + token batch (--radius-xs/--scrim/--scrim-soft/--shadow-raise, 30 dead fallbacks) + typography Tier 1 (99 sites) + F2 upstream_non_json guards at 4 BFF proxy sites + ui-audit harness hardening (`7156c89`, vibes.mjs newly tracked). Gates: tsc 0, eslint 0, jest 203/2921, axe 0 (held), secret scans clean both repos incl. positional-arg patterns. Reviews: Kage CHANGES-REQ→resolved, Iro CHANGES-REQ→resolved, Tora APPROVED-W-COMMENTS, Kuro BLOCKED→cleared (14/14 cross-user probes, S5 oracle sha256-verified, blast radius zero). Deployed .226 dev only, serving-verified in-container (rescue_outcome_line ×32); rollback `tavern-pre-1.7audit-20260813T015621Z.tar.gz` retained to prod night. **Leon signed off on the density respacing 2026-08-13.** **TAV-CHAR-STUCK BLOCKED on F1** (no middle-tier proxy hop — 3-tier system, 2-tier contract). main NOT FF'd (prod-night only). |
| 2026-07-23 | `1b2d07f` + `1c18292` | DEPLOYED+VERIFIED | **TAV-AUDIT 7-finding fix batch — ALL 7 LIVE-VERIFIED + PROD-DEPLOYED (Leon-supervised).** CAST-FAIL-SILENT (4xx→toast) · CHECK-DOUBLE-RENDER (single node) · CAST-DEAD-TARGET (filter HP=0 from cast dropdown) · COMBAT-NO-AUTO-RESOLVE (advisory banner when enemies down) · LEVELUP-NO-MOMENT (party panel fresh lv + badge + session toast; engine 1b2d07f fixes toast name-read) · MLP-SHEET-SPEED-CRASH (speed scalar + multi-mode) · CREATE-EDIT-NOT-RETRO (client-recreate model). **Defect found during #5(b) verify:** end-session level-up toast lost the "Level up: <name>" clause (engine read `data['name']` = null instead of `msm.characters.name`); Leon chose fix+re-gate+deploy: 1-line engine fix + Miko regression test, Kage APPROVED, re-verified live. Engine → nekonova-db (.43), Tavern → nekonova-aux (.127): surgical additive reconcile onto rsync-diverged prod (3-way merge per file, 0 conflicts, combat.py inserted only `_normalize_speed`, not dev-only conditions helper prod lacks); Kage-APPROVED reconcile (delta-equivalent, 0 prod-only losses), engine preflight-import clean, both containers healthy, all 6 flags preserved. api/bot/postgres/redis untouched (29h uptime — no Twitch-bleed); no migrations; rollback `.bak-pretavaudit-20260722` + tree tarballs on both hosts. Prod verify (suzu-prod-tester): 0 console errors everywhere, #6 char sheet SPD "25 ft." scalar (no crash), #5(c) "↑ level up" badge live. **New follow-up filed:** TAV-CAMPAIGN-DELETE-500 (campaign soft-delete 500s on dev+prod, pre-existing, char delete OK; reconcile didn't touch delete logic). Commits engine `hardening/engine-2026-07-17` `d2ec47f`, Tavern `hardening/tavern-ui-2026-07-17` `1c18292` (local-not-pushed). Full detail: `audits/2026-07-21 Tavern Experience+Logic Playthrough Audit.md` (LAST-3 LIVE-VERIFIED section). |
| 2026-07-20 | `de0d256` | DEPLOYED+VERIFIED | **TAV-SPELLBOOK-STALE-AFTER-PICKER + TAV-SPELLPICK-POOL-GROUPING shipped to prod** — 2 post-1.0 P3 fixes. SpellbookPanel now live-refreshes (refresh nonce + AbortController) after a level-up spell pick instead of staying stale until reload; level-up picker's leveled pool grouped by spell level (shared single cap), creation-wizard cantrip/level-1 lists sorted by name. Kage-CR APPROVED, Miko-QA PASS, 92/92 affected Jest suites green, tsc clean. Surgical per-file reconcile of 5 files onto prod's diverged tree (2 of the 5 had unrelated pre-existing divergence — a Session-8 wizard `leveledPrepared` forward + a clamp-pattern rewrite — correctly preserved, not overwritten); container rebuild (the compile gate) clean, health 200, 0 console/log errors. Rollback `suzustavern-suzu-tavern:rollback-spellbook5fix-20260720T131500Z` + file backups `/home/leon/backups/tavern-5fix-20260720T131500Z/`. |
| 2026-07-20 | `ddx12-reconcile` | DEPLOYED+VERIFIED | **DDX-12 Slice A shipped to prod** — in-combat action-budget enforcement + reaction-economy wiring. Surgical reconcile of engine combat.py onto prod's ~1000-line divergence; prod-tree-tested (import clean + 7/7 isolated-sqlite behavioral checks); zero lines removed. Kage-CR APPROVED, Kuro-Sec not needed (game-rule gate, no authz surface). Enforcement gating: DND_ENFORCE_SPELL_KNOWN=1 flag preserved, api/bot untouched. **Verified on deployed bytecode:** action-cast spends action → 2nd same-turn action-cast rejected `no_action_remaining`; reaction spell spends reaction pool not action. Prod verified end-to-end: suzu-prod-tester real-session cast/attack/reaction cycles (0 console errors). Positional model (movement/OA/cover/grapple) deferred post-1.0. Rollback `nekonova-dndengine-nekonova-dnd-engine:rollback-ddx12-action-budget-2026-07-20`. |
| 2026-07-13 | `7194545` | DEPLOYED+VERIFIED | DM-NARRATION-MARKDOWN: ChatLog renders inline `**bold**`→strong / `*italic*`→em for prose DM kinds (narration/dm_narration/dm_override) so gemma's markdown stops showing as literal asterisks; XSS-safe (React-escaped strings only, no dangerouslySetInnerHTML; `<img onerror>` renders inert, test-locked), italic DM rows get em→upright+semibold (Iro MINOR-1). Gates: Kuro-Sec SECURE (XSS+ReDoS proven inert), Kage-CR APPROVED, Iro-A11y APPROVED-W-COMMENTS; tsc clean, jest 2038 (+13 ChatLog tests), build ✓. Prod nekonova-tavern (prod==base whole-copy, /api/health 200); pushed. Prod-verified live: narration `*completely*`→`<em>`, no literal asterisks, 0 console errors. Rollback `suzustavern-suzu-tavern:rollback-mdrender-2026-07-13`. |
| 2026-07-13 | `b0bb5a9`+`ea359fe`+`d30645b` | DEPLOYED+VERIFIED+PUSHED | UIR2-TAV a11y/copy/contrast batch (9 items closed); login accessible-name + lobby aria-labels + proficiency dots role="img" + copy nits + contrast tokens (dusk --ink-3 #8b8298→#9992a4; candlelit --ink-3 #6e5c4a→#655442 & --bad-ink #962d2d→#8a2727); gates: Kage-CR APPROVED-W-COMMENTS, Iro-A11y all-folded, tsc clean jest 2029, npm build ✓; live-harness: login/dashboard/lobby axe=0 light+dark desktop+mobile, char-sheet serious=0, PartyPanel .sub ≥4.5:1 contrast. **Pushed to origin + deployed to prod nekonova-tavern (surgical whole-copy of 7 src files, /api/health 200, RestartCount 0), prod-verified as suzu-prod-tester (axe=0, TAV-20 serious=0). Rollback `suzustavern-suzu-tavern:rollback-2026-07-13`.** Filed follow-ups: TAV-PARTY-YOUBADGE-CONTRAST-CANDLELIT/TAV-PLAY-LANDMARKS (P2), TAV-A11Y-LOGIN-BUSY-LABEL/PROFDOT-ROW-COHESION/SHEET-HEADING-ORDER (P3). Scope-changed UIR2-TAV-26→TAV-CAMPAIGN-LEVELING-MODE-BAR (P2 feature).
| 2026-07-11 | `49227b0` | DEPLOYED | DDX-22 Phase 3 (SessionNote type + getSessionNotes/putSessionNotes + JournalPane localStorage→API debounced-autosave); prod nekonova-tavern 10.69.69.127:3000; gates: Kage CHANGES-REQ→resolved, Iro CHANGES-REQ→resolved, Miko PASS; tsc+eslint clean, jest 1997 green; cross-account RLS isolation verified live; rollback `suzustavern-suzu-tavern:rollback-ddx22-notes-2026-07-11`. |
| 2026-07-10 | `31906e0` | DEPLOYED | Phase-1 Tavern UI (8 P1 UIR2-TAV items + DDX T3/T5/T6/T7/T13/T12); prod nekonova-tavern 10.69.69.127:3000; gates: tsc 0, jest 1921, build ✓; lint 41 pre-existing (non-gating); live-verified as suzu-prod-tester; rollback `nekonova-tavern:rollback-2026-07-10`. |
| 2026-08-11 | WF-C Investigation | — | **DM-CHRONICLE design delivered (design-only, awaiting Leon) + DM-LATENCY-KV-CACHE root-caused:** 27B narrator swap over-subscribes the 32.3 GiB Vulkan budget, evicting the narrator every turn; 3-fix proposal projects ~65s→~28–31s. Probe aborted 15:45 on .226 activity; possible contribution to a 500/timeout at 15:44:22. Engine tree clean, zero product code. Backlog row DM-OLLAMA-BUDGET-GUARD filed (guard against working set exceeding budget + runner-split fix + prompt token-budget check + startup assertion). WF-A and WF-B running. |
| 2026-08-13 | WF-E+WF-F | leave-campaign COMPLETE end-to-end: proxy hop cfd5c70 + always-on actor guard 0c7ca15 + Tavern 617d423, all DEV-LIVE .226 | 57/57 vs deployed SHA; owner-leave DB-proven under RLS; UI live-verified | escape hatch WORKS | debris purge blocked on Leon | main un-FF'd (prod night) |
| 2026-08-12 | WF-A engine dev-live EXECUTED on .226 (089988c) | /health 200, rollback staged; Tavern dd511f2 also live. WF-E opened: missing middle-tier proxy hop blocks leave-campaign E2E. | 26 commits @ 089988c | PG-security 580/1skip/0fail, full 8872P/14F(pre-existing)/76S/6E | C3=rescue_outcome_line; new reason code not_in_campaign | 6/6 items shipped live; prod deployment pending Leon's night-of go |
| 2026-08-11 | WF-D prose lane CLOSED | — | **61 prose candidates delivered + staged import runbook.** 18 DM-arrival narrations (all 6 arrived-at scenes, ≤400 verified), 8 combat-outcome lines, 35 multi-source scene prose. Trees clean, nothing imported, awaiting Leon's prose pass. Backlog rows SLICE-PROSE-CANDIDATES-1.6 + appends to DM-ARRIVAL-NARRATION / COMBAT-UX-FOLLOW-UP-1 / CHECKRETRY-LINT-FOLLOWUPS updated; 3 findings escalated. WF-A/B running. |
| 2026-08-01 | `12b7358` | DEV-DEPLOYED | **EVERFREE PLAYTEST FIXES (same-day triage of Leon's live playtest report):** TAV-PLAY-INPUT-LOCK-NO-FEEDBACK defect fixed. Play UI locked input during generation with no indicator; shipped visible-only NarratorStrip "Suzu is narrating…" cue (scene line stays; accessible text invariant), Composer disabledReason → visible .lockStatus banner (+ "Sending…" pending-only fallback, ::placeholder contrast pin). Commit `12b7358` (9 files: NarratorStrip + Composer + play page + 4 test files) pushed feature/lvl-starting-level-workshop, deployed to bind-mounted tavern-dev on .226 (hot-reload, :13000 serving). Miko-QA + Kage-CR ×2 + Iro-A11y approved. Sister defects ENGINE-AUTOADVANCE-SHAPE-BLOCKED + STAGING-DM-UNGROUNDED fixed in engine + NekoNova staging compose (see Current Status for full detail). Follow-ups filed: ENGINE-CHECK-EVENT-ON-FAILED-WRITE (P2), TAV-COMPOSER-FOCUS-STRAND (P2). Prod untouched. |
| 2026-07-15 | `cdbdf23` | BUILD-TO-REVIEW | DDX-20 Pass 3 synthetic-beat design (closes T1 gate): `narrateDurableBeat` beat-router routes 5 non-composer beats (roll-confirm/scene-transition/check-confirm/combat-start/end-turn) + Pass 3 fold commits (F1 retry-routing SSE-tail error drop via `origin` param, F2 orphan-hijack dedup by `job_id`, F3 turnKeyRef clobber characterized w/ lock). Engine G1 mechanics-freeze (hard blocker before flag flip): runner routes combat/numeric-stakes beats through buffered narrate() vs narrate_stream to enforce frozen mechanics before DM prose; commits engine `a8afb0e`→fold `813eb85`, NekoNova `753871f`→fold `01e75e2`. P4 mobile poll-only contract: Hana-TW designed + code-verified `planning/DDX-20 — P4 Mobile Poll-Only Client Contract.md` (525L, zero code-design discrepancies; doc-only). All 6 engine phases (P0/P1a/P1b/P2/P3) + Tavern wiring gate-clean + folded; **147 suites/2147 tests green**, tsc clean, flag-OFF byte-unchanged. NOTHING PUSHED/DEPLOYED; Fumi closure complete. Leon-gated prod deploy pending live-staging money-path exercise. |
| 2026-07-09 | `541e9ee` + `82b882f` | DEPLOYED | TAV-S1 screen-reader flood fix + TAV-ENV-INLINE (Turbopack env inlining); prod nekonova-tavern; rolled back once for env.ts fix, then clean redeploy. |
