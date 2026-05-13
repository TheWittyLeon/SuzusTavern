# Suzu's Tavern — Product Backlog

> Last updated: 2026-05-13
> Stories: ST-001 through ST-072
> Status key: Backlog · In progress · Done · Deferred

---

## Epics

| Epic | Description | Stories |
|------|-------------|---------|
| Foundation | API client layer, auth wiring, real-time transport, error/loading primitives | ST-001 – ST-008 |
| Design system components | Implement stubbed and new components to spec | ST-009 – ST-020 |
| Landing page | Marketing page: hero, how-it-works, capabilities, Suzu intro, footer | ST-021 – ST-026 |
| Auth / login | Login form, JWT session, Twitch/Discord OAuth, session persistence | ST-027 – ST-032 |
| Lobby | Session listing, join, create, suggestion banner, filters | ST-033 – ST-039 |
| Dashboard | Resume-session hero, stats, campaigns, characters, hooks, recent log | ST-040 – ST-046 |
| Character creation | 5-step wizard connected to dnd_engine; Suzu commentary | ST-047 – ST-053 |
| Character sheet | Full 5e sheet display and edit mode via dnd_engine | ST-054 – ST-059 |
| Play session | 3-pane layout, Suzu narration, chat log, dice tray, initiative, combat, spells | ST-060 – ST-066 |
| Backend API bridge | Next.js API routes proxying to ProjectNekoNova over HTTP | ST-067 – ST-070 |
| Real-time | SSE/WebSocket for narration streaming, dice broadcasts, initiative updates | ST-071 – ST-072 |
| Polish and accessibility | Palette switcher, mobile, keyboard nav, screen reader, animations | ST-073 – ST-080 |

---

## Priority rubric

- **P0** — must-have for MVP (can't ship without it)
- **P1** — core experience (ships in v1)
- **P2** — important but deferrable (v1.1)
- **P3** — nice-to-have (later)

---

## Epic: Foundation

### ST-001: HTTP API client with JWT bearer auth

**Epic:** Foundation
**Priority:** P0
**Size:** M
**Status:** Backlog

As a developer, I want a typed HTTP client in `src/lib/api/` that attaches the JWT bearer token to every request so that all feature layers share a single, consistent auth pattern.

**Acceptance criteria:**
- [ ] `src/lib/api/client.ts` exports a `fetcher` that reads the JWT from `localStorage` / cookie and sets `Authorization: Bearer <token>` on every outbound request
- [ ] Handles 401 by clearing the token and redirecting to `/login`
- [ ] Handles network errors and returns typed error objects — no uncaught promise rejections
- [ ] All env-based base URLs (`NEXT_PUBLIC_NEKANOVA_URL`, `NEXT_PUBLIC_AUTH_URL`) are read at module init, not hardcoded
- [ ] Unit test coverage for auth header injection and 401 redirect logic

**Technical notes:**
- Auth pattern mirrors `ProjectNekoNova/auth/client.py` — same JWT bearer convention
- Base URL for NekoNova API bridge: `NEXT_PUBLIC_NEKANOVA_URL` (e.g., `http://localhost:8080`)
- Base URL for Authentication-Python: `NEXT_PUBLIC_AUTH_URL` (e.g., `http://localhost:5000`)

---

### ST-002: Environment configuration

**Epic:** Foundation
**Priority:** P0
**Size:** XS
**Status:** Backlog

As a developer, I want all environment-specific values declared in `.env.local` with typed access so that the app never fails silently from a missing variable.

**Acceptance criteria:**
- [ ] `.env.local.example` documents all required variables: `NEXT_PUBLIC_NEKANOVA_URL`, `NEXT_PUBLIC_AUTH_URL`, `NEXT_PUBLIC_WS_URL`
- [ ] `src/lib/env.ts` validates presence of required vars at module load and throws a descriptive error if any are missing
- [ ] `.env.local` is in `.gitignore`

**Technical notes:**
- No runtime env injection needed — Next.js `NEXT_PUBLIC_` prefix handles client-side exposure

---

### ST-003: Auth session management (token storage and refresh)

**Epic:** Foundation
**Priority:** P0
**Size:** M
**Status:** Backlog

As a player, I want my session to persist across page refreshes and browser restarts so that I don't have to sign in every time I open the site.

**Acceptance criteria:**
- [ ] JWT stored in an `httpOnly`-equivalent pattern (cookie preferred, `localStorage` acceptable for v1 with documented trade-off)
- [ ] `src/lib/auth/session.ts` exports `getToken()`, `setToken(token)`, `clearToken()`
- [ ] Auth state exposed via React context (`src/lib/auth/AuthContext.tsx`) — `useAuth()` hook returns `{ user, token, isLoading, login, logout }`
- [ ] Unauthenticated routes (`/`, `/login`) accessible without a token
- [ ] Authenticated routes (`/lobby`, `/dashboard`, `/character/*`, `/play/*`) redirect to `/login` if no valid token

**Technical notes:**
- Authentication-Python issues JWT on successful login — store and reuse
- NekoNova auth integration reference: `ProjectNekoNova/auth/client.py`

---

### ST-004: Global error boundary

**Epic:** Foundation
**Priority:** P0
**Size:** S
**Status:** Backlog

As a player, I want unhandled rendering errors to show a recoverable error state rather than a blank screen so that a single broken component doesn't end my session.

**Acceptance criteria:**
- [ ] `src/components/ErrorBoundary.tsx` wraps every page-level route in the root layout
- [ ] Error state shows Suzu's DM avatar, a dry one-line error message, and a "Try again" link back to `/dashboard`
- [ ] Error details logged to `console.error` in development; suppressed in production unless a logging service is configured
- [ ] Does not wrap the `ErrorBoundary` itself (no infinite recursion)

**Technical notes:**
- Uses React class-based error boundary (functional components cannot catch render errors)
- Error copy follows design system voice: dry, sentence case, no exclamation points

---

### ST-005: Page-level loading skeletons

**Epic:** Foundation
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want every data-fetching page to show a skeleton while loading so that I know the app is working and not frozen.

**Acceptance criteria:**
- [ ] `src/components/Skeleton.tsx` renders animated pulse placeholders using `var(--bg-2)` and `var(--bg-3)` CSS vars
- [ ] Each major page (lobby, dashboard, character sheet, play) has a skeleton variant matching its layout
- [ ] Skeletons are shown while `isLoading` is true; replaced immediately when data resolves
- [ ] No layout shift between skeleton and loaded state

**Technical notes:**
- CSS animation using `globals.css` `--ease` token; no Tailwind
- Skeleton shapes follow each page's grid columns as defined in the corresponding design system file

---

### ST-006: Toast notification system

**Epic:** Foundation
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want non-blocking toast notifications for transient events (roll results, XP awards, join confirmations) so that I stay informed without interruption.

**Acceptance criteria:**
- [ ] `src/components/Toast.tsx` and `src/lib/toast.ts` implement a `toast(message, variant)` API with variants: `info`, `success`, `warn`, `error`
- [ ] Toasts appear in the bottom-right corner, stack up to 4, auto-dismiss after 4 seconds
- [ ] `toast.dismiss(id)` available for programmatic dismissal
- [ ] Accessible: announced via `aria-live="polite"` region

**Technical notes:**
- Uses CSS vars for color; no third-party toast library
- Toasts used in: dice roll results, XP award, session join/leave, spell cast confirmation

---

### ST-007: Axios / fetch wrapper for SSE streaming

**Epic:** Foundation
**Priority:** P0
**Size:** M
**Status:** Backlog

As a developer, I want a utility in `src/lib/api/stream.ts` that opens an SSE connection to NekoNova's narration endpoint and exposes a typed async iterator so that the play session can consume Suzu's narration tokens incrementally.

**Acceptance criteria:**
- [ ] `openNarrationStream(sessionId, payload)` returns an `AsyncIterable<NarrationChunk>` where `NarrationChunk` has `{ token: string; mood: string; done: boolean }`
- [ ] Reconnects automatically on connection drop (exponential backoff, max 5 retries)
- [ ] Closes the SSE connection cleanly on component unmount
- [ ] Works in Next.js App Router client components with `'use client'` directive

**Technical notes:**
- Target endpoint: `POST /api/dnd/narrate/stream` (to be added in ST-067)
- NekoNova AI pipeline: `ProjectNekoNova/api/enhanced.py` — 18-step pipeline, Gemini 2.0 Flash primary
- Suzu has 7 mood states — `mood` field maps to design system `SuzuDM` mood prop

---

### ST-008: Route protection middleware

**Epic:** Foundation
**Priority:** P0
**Size:** S
**Status:** Backlog

As a developer, I want Next.js middleware to protect authenticated routes at the edge so that unauthenticated requests never reach page components.

**Acceptance criteria:**
- [ ] `src/middleware.ts` intercepts requests to `/lobby`, `/dashboard`, `/character/:path*`, `/play/:path*`
- [ ] Redirects to `/login?next=<original-path>` if no valid JWT cookie is present
- [ ] Does not block `/`, `/login`, or `/_next/*` static assets
- [ ] `next` query param is consumed post-login to restore the intended destination

**Technical notes:**
- Uses Next.js `middleware.ts` at `src/` root with `matcher` config
- JWT validation in middleware is signature-format only (no full decode) for edge compatibility — full validation happens in API route handlers

---

## Epic: Design system components

### ST-009: Button component

**Epic:** Design system components
**Priority:** P0
**Size:** S
**Status:** Backlog

As a developer, I want a typed `Button` component that wraps the design system's `.btn` utility classes so that all interactive controls are consistent and accessible.

**Acceptance criteria:**
- [ ] Props: `variant` (`primary` | `ghost` | `icon`), `size` (`sm` | `md` | `lg`), `disabled`, `loading`, `onClick`, `type`, `children`
- [ ] `loading` prop shows spinner and disables click without layout shift
- [ ] Renders `<button>` by default; renders `<a>` when `href` prop is provided
- [ ] `aria-disabled` set when `disabled` is true
- [ ] Uses `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-icon`, `.btn-lg` classes from `globals.css` — no inline styles except for rare override via `style` prop

**Technical notes:**
- Reference: button elements in `login.jsx`, `lobby.jsx`, `dashboard.jsx`
- Spinner markup matches the `.nn-spinner` pattern in `login.jsx`

---

### ST-010: Card component

**Epic:** Design system components
**Priority:** P0
**Size:** S
**Status:** Backlog

As a developer, I want a `Card` component that wraps the `.glass` surface token and supports `pop` and `lift` elevation variants so that all card-shaped containers share consistent depth and border styling.

**Acceptance criteria:**
- [ ] Props: `pop` (boolean), `lift` (boolean), `style`, `className`, `children`, `onClick`
- [ ] `pop` adds `box-shadow: var(--shadow-pop)` and `border: 1px solid var(--line)`
- [ ] `lift` adds hover transform `translateY(-2px)` via CSS Module transition
- [ ] Base card uses `background: var(--card)`, `border-radius: var(--radius-md)`
- [ ] Focusable and keyboard-activatable when `onClick` is provided

**Technical notes:**
- Reference: `window.UI.Card` usage across all design system screens
- CSS Module file: `Card.module.css`

---

### ST-011: Pill component

**Epic:** Design system components
**Priority:** P0
**Size:** S
**Status:** Backlog

As a developer, I want a `Pill` component that renders colored status chips with optional dot indicators so that session status, table state, and content tags render consistently.

**Acceptance criteria:**
- [ ] Props: `tone` (`accent` | `good` | `muted` | `lav` | `warn`), `dot` (boolean), `children`
- [ ] Dot is a 6px circle in the tone color, positioned left of label text
- [ ] Background is `color-mix(in oklab, <tone-color> 14%, transparent)`; text is the tone color
- [ ] Uses `.pill` utility class from `globals.css` as base

**Technical notes:**
- Reference: `window.UI.Pill` in `lobby.jsx`, `dashboard.jsx`, `play.jsx`

---

### ST-012: Die component

**Epic:** Design system components
**Priority:** P1
**Size:** M
**Status:** Backlog

As a player, I want a `Die` component that renders an animated die face for d4, d6, d8, d10, d12, and d20 so that roll results feel tactile in the play session.

**Acceptance criteria:**
- [ ] Props: `sides` (4 | 6 | 8 | 10 | 12 | 20), `value` (number), `rolling` (boolean), `crit` (boolean), `fumble` (boolean), `size` (number in px)
- [ ] `rolling` animates a spin/shake; resolves to `value` after 700ms
- [ ] `crit` applies `color: var(--crit)` highlight; `fumble` applies `color: var(--bad)`
- [ ] SVG shape sourced from `../Suzu's Tavern Design System/assets/dice-icons.jsx` — do not embed inline SVG manually
- [ ] Size scales proportionally from the `size` prop

**Technical notes:**
- Reference: `window.UI.Die` in `play.jsx` — die + roll callout at lines 121–131
- Animation: CSS keyframes using `var(--ease)` token, no JS animation library

---

### ST-013: Avatar component

**Epic:** Design system components
**Priority:** P1
**Size:** S
**Status:** Backlog

As a developer, I want an `Avatar` component that renders a character's initial in a colored gradient circle so that party lists and user identity surfaces feel consistent.

**Acceptance criteria:**
- [ ] Props: `name` (string), `size` (number), `color` (CSS color string, optional)
- [ ] Renders first character of `name` in `var(--font-display)` centered in a circle
- [ ] Background is `linear-gradient(135deg, <color>, color-mix(in oklab, <color> 50%, var(--accent-2)))` — falls back to `var(--accent)` if no color given
- [ ] Used in sidebar user panel and party list in play pane

**Technical notes:**
- Reference: `window.UI.Avatar` in `lobby.jsx` sidebar and `play.jsx` party list

---

### ST-014: SuzuDM component

**Epic:** Design system components
**Priority:** P0
**Size:** M
**Status:** Backlog

As a player, I want a `SuzuDM` component that renders Suzu's mascot at configurable sizes with glow and "talking" animation states so that Suzu's presence is consistent across every screen.

**Acceptance criteria:**
- [ ] Props: `size` (number in px), `glow` (boolean, default true), `talking` (boolean, default false), `mood` (string, optional)
- [ ] SVG sourced from `../Suzu's Tavern Design System/assets/mascot.jsx` — adapt to TypeScript/React
- [ ] `glow` applies a `filter: drop-shadow(0 0 12px var(--accent))` animation
- [ ] `talking` applies a subtle bob/pulse animation
- [ ] `mood` prop not required for v1 but interface must support it for ST-060 narration integration

**Technical notes:**
- Reference: `SuzuDM` usage in `landing.jsx`, `login.jsx`, `lobby.jsx`, `dashboard.jsx`, `play.jsx`
- Asset source: `../Suzu's Tavern Design System/assets/mascot.jsx`

---

### ST-015: Icon component

**Epic:** Design system components
**Priority:** P0
**Size:** S
**Status:** Backlog

As a developer, I want an `Icon` component that wraps the design system's SVG icon library so that all icon usage is typed and sized consistently.

**Acceptance criteria:**
- [ ] `src/components/Icon.tsx` exports a named icon component per icon in `../Suzu's Tavern Design System/assets/icons.jsx` — e.g., `<Icon name="D20" size={16} />`
- [ ] Props: `name` (union of valid icon keys), `size` (number, default 16), `style`, `className`
- [ ] No icon name typos compile — TypeScript union type enforced
- [ ] SVG renders inline (not via `<img>`) for CSS `currentColor` inheritance

**Technical notes:**
- Source: `../Suzu's Tavern Design System/assets/icons.jsx` and `assets/dice-icons.jsx`
- Icons used heavily in sidebar nav, dashboard stats, character sheet, play pane

---

### ST-016: Sidebar component

**Epic:** Design system components
**Priority:** P1
**Size:** M
**Status:** Backlog

As a player, I want a persistent sidebar navigation with active state, play/tools sections, and my user card at the bottom so that I can navigate between lobby, dashboard, and characters without disorientation.

**Acceptance criteria:**
- [ ] Nav items: Tables (→`/lobby`), My campaigns (→`/dashboard`), Characters (→`/character`)
- [ ] Tools items: Memory, Safety tools, Settings
- [ ] Active item highlighted via accent color; uses `data-active` attribute for CSS targeting
- [ ] User card at bottom: avatar + name + active character name
- [ ] Responsive: collapses to icon-only mode below 768px; expands on hover/focus

**Technical notes:**
- Reference: `Sidebar` component in `lobby.jsx` — exact structure with `.sidebar`, `.brand`, `.nav-item`, `.section` CSS classes
- Active state driven by Next.js `usePathname()` hook

---

### ST-017: DiceRoller component

**Epic:** Design system components
**Priority:** P1
**Size:** M
**Status:** Backlog

As a player, I want a dice tray component with buttons for d4, d6, d8, d10, d12, d20, and custom dice so that I can roll from the right pane without typing commands.

**Acceptance criteria:**
- [ ] Props: `onRoll(result: RollResult)`, `disabled` (boolean)
- [ ] Renders a row of die buttons; clicking rolls the die and calls `onRoll`
- [ ] Modifier input (integer ± 99) added to the result
- [ ] Roll result displayed using the `Die` component (ST-012) with animation
- [ ] Advantage/disadvantage toggle: rolls 2d20, takes the higher/lower

**Technical notes:**
- Reference: dice tray in `play.jsx` right pane
- Dice rolling logic in `ProjectNekoNova/dnd_engine/rules.py` — client-side roll for immediate feedback, server-side roll for authoritative combat results

---

### ST-018: NarratorStrip component

**Epic:** Design system components
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want a narrator strip at the top of the center play pane that shows Suzu's current narration text with her avatar so that I always know what Suzu is saying.

**Acceptance criteria:**
- [ ] Props: `text` (string), `mood` (string), `talking` (boolean)
- [ ] Layout: `SuzuDM` avatar left, narration text right, status pill bottom-right
- [ ] `talking` prop passed through to `SuzuDM` (animated while streaming)
- [ ] Text fades in token-by-token when `stream` prop is active (ST-071 integration)
- [ ] Role: `region`, `aria-label="Suzu narration"` for screen reader access

**Technical notes:**
- Reference: `.narrator-strip` in `play.jsx` lines 96–105
- Receives streamed tokens from ST-007 SSE utility

---

### ST-019: ChatLog component

**Epic:** Design system components
**Priority:** P1
**Size:** M
**Status:** Backlog

As a player, I want a scrollable chat log that shows narration, player dialogue, in-character actions, and OOC messages styled distinctly so that I can follow the session narrative.

**Acceptance criteria:**
- [ ] Props: `entries: LogEntry[]` where `LogEntry` has `{ id, who, text, kind, color, timestamp }`
- [ ] `kind` values: `narration`, `say`, `act`, `ooc`, `roll`, `system` — each with distinct background tint
- [ ] Auto-scrolls to bottom on new entries; user can scroll up to read history without the view jumping
- [ ] Timestamps shown in `mono` font, right-aligned in the `who` row
- [ ] Maximum 500 entries; older entries pruned from the top

**Technical notes:**
- Reference: `.log` and `.log-row` in `play.jsx` lines 107–132
- `kind: narration` entries styled with `var(--font-display)` italic
- Uses `useRef` + `scrollTop = scrollHeight` for auto-scroll

---

### ST-020: InitiativeTracker component

**Epic:** Design system components
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want an initiative order list in the left play pane that highlights the current turn and shows each combatant's initiative value so that I always know whose turn it is.

**Acceptance criteria:**
- [ ] Props: `combatants: Combatant[]` where `Combatant` has `{ id, name, initiative, color, isCurrentTurn, isPlayer }`
- [ ] Active combatant row is full-opacity; inactive rows at 65% opacity
- [ ] Current-turn combatant is highlighted with a `var(--crit)` accent dot
- [ ] Player combatants show "you" badge in `var(--accent)`
- [ ] Sorted by initiative descending; ties broken by insertion order

**Technical notes:**
- Reference: initiative block in `play.jsx` left pane lines 41–64
- Initiative data from `dnd_engine/combat.py` `get_participants()` function — exposed via `GET /api/dnd/combat/:combatId/status`

---

## Epic: Landing page

### ST-021: Landing page hero section

**Epic:** Landing page
**Priority:** P1
**Size:** M
**Status:** Backlog

As a prospective player, I want a compelling hero section that introduces Suzu's Tavern with a headline, subline, CTAs, and live stats so that I understand what the product is in under 10 seconds.

**Acceptance criteria:**
- [ ] Sticky top nav: logo + nav links + "Browse tables" ghost button + "Sign in" primary button
- [ ] Hero grid: headline left (max 12ch, `clamp(40px, 5.2vw, 68px)`), Suzu mascot right
- [ ] Sub-headline text matches design system copy voice: dry, no exclamation marks
- [ ] Two CTAs: "Start your campaign" (→`/login`) and "Browse open tables" (→`/lobby`)
- [ ] Three stat counters below CTAs (active campaigns, rolls this week, players returning)
- [ ] Aurora gradient background using `.aurora` CSS class from `globals.css`
- [ ] Full route: `src/app/page.tsx`

**Technical notes:**
- Reference: `landing.jsx` hero section lines 31–72
- Stat values are static placeholders in v1 — fetched from API in v1.1

---

### ST-022: How it works section

**Epic:** Landing page
**Priority:** P1
**Size:** S
**Status:** Backlog

As a prospective player, I want a "how it works" section with numbered steps that explains the flow from joining to playing so that I understand what to expect before signing in.

**Acceptance criteria:**
- [ ] Section ID `#how` for nav anchor
- [ ] Three to four steps in a horizontal or vertical layout: Pick a table → Create a character → Play with Suzu → Return next session
- [ ] Each step has an icon, a short heading, and one sentence description
- [ ] Uses `Icon` component (ST-015) for step icons
- [ ] Consistent with `var(--ink-2)` body text, `var(--font-display)` step headings

**Technical notes:**
- Reference: how-it-works section in `landing.jsx`

---

### ST-023: Capabilities / features section

**Epic:** Landing page
**Priority:** P1
**Size:** S
**Status:** Backlog

As a prospective player, I want a capabilities section that lists Suzu's DM abilities (rules, dice, memory, NPCs) as a grid of feature cards so that I know what she can do.

**Acceptance criteria:**
- [ ] Section ID `#tables` (per design system nav anchor)
- [ ] At least 6 capability cards: rules mastery, dice rolling, NPC voices, session memory, spell management, campaign continuity
- [ ] Each card: icon + short label + one-line description
- [ ] Uses `Card` component (ST-010) with `lift` variant
- [ ] Copy tone: dry narrator, no marketing superlatives

**Technical notes:**
- Reference: capabilities section in `landing.jsx`

---

### ST-024: Suzu intro / story section

**Epic:** Landing page
**Priority:** P1
**Size:** S
**Status:** Backlog

As a prospective player, I want a section that introduces Suzu as a character — who she is, her personality, why she runs the table — so that I feel connected to the experience before I sign in.

**Acceptance criteria:**
- [ ] Section ID `#story`
- [ ] `SuzuDM` component centered or prominent, large size (120–180px)
- [ ] Short first-person or third-person introduction in design system voice: dry, self-aware, no "amazing AI"
- [ ] Pull quote or callout styled with `var(--font-display)` italic

**Technical notes:**
- Reference: story section in `landing.jsx`
- Suzu's personality defined in `ProjectNekoNova/companions/suzu.yaml` — read for voice guidance

---

### ST-025: Footer

**Epic:** Landing page
**Priority:** P1
**Size:** XS
**Status:** Backlog

As a visitor, I want a footer with nav links, a brief product description, and attribution so that I can find secondary pages and understand the product's origin.

**Acceptance criteria:**
- [ ] Links: How it works, Open tables, Why, Pricing (all anchors or placeholder `#`)
- [ ] Small branding line: "A NekoNova table · 5e"
- [ ] Copyright line and privacy/terms placeholders
- [ ] Matches `var(--bg-2)` background, `var(--ink-3)` text

**Technical notes:**
- Reference: footer in `landing.jsx`

---

### ST-026: Landing page responsive layout

**Epic:** Landing page
**Priority:** P2
**Size:** S
**Status:** Backlog

As a mobile visitor, I want the landing page to be readable and usable on screens narrower than 768px so that I can evaluate the product on my phone.

**Acceptance criteria:**
- [ ] Hero grid stacks to single column below 768px; Suzu mascot moves below headline
- [ ] Nav collapses to hamburger or icon-only below 640px
- [ ] Stats row wraps naturally; no horizontal scroll
- [ ] CTA buttons full-width below 480px

**Technical notes:**
- CSS breakpoints in component-scoped modules using `@media (max-width: 768px)` — no Tailwind

---

## Epic: Auth / login

### ST-027: Login page layout (two-pane)

**Epic:** Auth / login
**Priority:** P0
**Size:** M
**Status:** Backlog

As a player, I want the login page to show Suzu's mascot on the left and a sign-in/sign-up form on the right so that the auth experience feels native to the product.

**Acceptance criteria:**
- [ ] Route: `src/app/login/page.tsx`
- [ ] Two-pane card layout: mascot/intro pane left, form pane right
- [ ] Left pane: `SuzuDM` at 220px, tagline "Hi. I was almost expecting you.", subline, waveform indicator
- [ ] Right pane: tab switcher (sign in / create account), form fields, submit button, OAuth buttons
- [ ] Uses `.aurora` background, `Card` component with `pop` variant
- [ ] Full-height layout — no scroll on standard viewport

**Technical notes:**
- Reference: `login.jsx` — entire file
- "Tavern handle" label for username field (design system copy)

---

### ST-028: Email / password authentication

**Epic:** Auth / login
**Priority:** P0
**Size:** M
**Status:** Backlog

As a player, I want to sign in with my email/handle and password so that I can access my account.

**Acceptance criteria:**
- [ ] `POST /auth/login` to Authentication-Python with `{ username, password }` body
- [ ] On success: store JWT from response, redirect to `/dashboard` (or `?next=` destination)
- [ ] On failure: inline error message below submit button; no page reload
- [ ] "Keep me signed in" checkbox: sets token expiry to 30 days vs 1 day
- [ ] Loading state: spinner in button, fields disabled during request
- [ ] "Create account" tab: `POST /auth/register` with `{ username, email, password }`

**Technical notes:**
- Authentication-Python endpoints: `POST /auth/login`, `POST /auth/register`
- JWT pattern: `Authorization: Bearer <token>` — stored per ST-003

---

### ST-029: Twitch OAuth login

**Epic:** Auth / login
**Priority:** P1
**Size:** M
**Status:** Backlog

As a Twitch user, I want to sign in with my Twitch account so that I don't need a separate password.

**Acceptance criteria:**
- [ ] "Twitch" OAuth button in login form initiates Twitch OAuth flow
- [ ] Redirects to Authentication-Python's Twitch OAuth entry point
- [ ] On callback: store JWT from Authentication-Python response, redirect to `/dashboard`
- [ ] Error state handled if user denies OAuth or flow fails

**Technical notes:**
- Authentication-Python handles OAuth exchange — SuzusTavern only initiates and handles the callback
- Reference: Twitch OAuth implementation in `Authentication-Python/` docs
- NekoNova already uses Twitch OAuth — pattern in `ProjectNekoNova/` auth module

---

### ST-030: Discord OAuth login

**Epic:** Auth / login
**Priority:** P1
**Size:** M
**Status:** Backlog

As a Discord user, I want to sign in with my Discord account so that I don't need a separate password.

**Acceptance criteria:**
- [ ] "Discord" OAuth button initiates Discord OAuth flow via Authentication-Python
- [ ] Same callback and JWT storage pattern as ST-029
- [ ] Error handling for denied access and failed flow

**Technical notes:**
- Same pattern as ST-029 but Discord provider
- Reference: `login.jsx` Discord button at line 109

---

### ST-031: Logout

**Epic:** Auth / login
**Priority:** P0
**Size:** XS
**Status:** Backlog

As a player, I want a logout action that clears my session and returns me to the landing page so that shared-device users are not left signed in.

**Acceptance criteria:**
- [ ] `POST /auth/logout` to Authentication-Python or client-side token clear
- [ ] Clears JWT from storage, resets `AuthContext` state
- [ ] Redirects to `/` after logout
- [ ] Accessible from sidebar settings and user card

**Technical notes:**
- Authentication-Python may or may not have a server-side logout endpoint — check `Authentication-Python/docs/API.md`; client-side clear is acceptable fallback

---

### ST-032: "Recovery key" / password reset placeholder

**Epic:** Auth / login
**Priority:** P2
**Size:** S
**Status:** Backlog

As a player who forgot their password, I want a recovery key link on the sign-in form so that I have a path to regain access.

**Acceptance criteria:**
- [ ] "Recovery key" link renders in the form per `login.jsx` design
- [ ] In v1, links to a static page explaining the recovery process (no live reset flow)
- [ ] Copy is in design system voice: no exclamation marks, sentence case

**Technical notes:**
- Full password reset flow is out of scope for v1 — placeholder only

---

## Epic: Lobby

### ST-033: Session listing page

**Epic:** Lobby
**Priority:** P1
**Size:** M
**Status:** Backlog

As a player, I want to browse available sessions in a card grid so that I can find a table that fits my availability and preferences.

**Acceptance criteria:**
- [ ] Route: `src/app/lobby/page.tsx`
- [ ] Sidebar navigation active on "Tables" item
- [ ] Fetches session list from `GET /api/dnd/sessions` (ST-068)
- [ ] Each session rendered as a `TableCard` component showing name, blurb, tags, mood pill, seat availability, cadence, and "Join table" / "Waitlist" button
- [ ] Loading skeleton while fetching
- [ ] Empty state with Suzu line for zero results

**Technical notes:**
- Reference: `lobby.jsx` `TableCard` and `Lobby` components
- Session data shape: `{ id, name, blurb, tags, mood, seats, taken, level, cadence, open, portrait }`
- Portrait icon mapped to `Icon` component names as in `lobby.jsx` lines 57–66

---

### ST-034: Session filter strip

**Epic:** Lobby
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want to filter sessions by status (open seats, tonight, one-shots, newcomers, mature) so that I can narrow the list to relevant tables.

**Acceptance criteria:**
- [ ] Filter pills: All, Open seats, Tonight, One-shots, Newcomers, Mature
- [ ] Active filter pill styled with `linear-gradient(135deg, var(--accent), var(--accent-2))` background
- [ ] Filtering is client-side against the fetched session list (no refetch per filter)
- [ ] Count label: "X tables · sorted by cadence"

**Technical notes:**
- Reference: filter strip in `lobby.jsx` lines 138–151
- Filter logic: `open`, tag matching for `one-shot`, `newbie`, `mature` tags

---

### ST-035: Session search

**Epic:** Lobby
**Priority:** P2
**Size:** S
**Status:** Backlog

As a player, I want to search sessions by name, mood, or DM so that I can find a specific table quickly.

**Acceptance criteria:**
- [ ] Search input in workspace header: "Search by mood, name, DM…"
- [ ] Filters the session list in real time as the user types (debounced 200ms)
- [ ] Search is case-insensitive across `name`, `mood`, and `dm_username` fields

**Technical notes:**
- Reference: search input in `lobby.jsx` header

---

### ST-036: Join session

**Epic:** Lobby
**Priority:** P1
**Size:** M
**Status:** Backlog

As a player, I want to click "Join table" on an open session and be routed to the play screen so that I can begin playing.

**Acceptance criteria:**
- [ ] "Join table" button calls `POST /api/dnd/sessions/:id/join` (ST-068)
- [ ] On success: navigates to `/play/:sessionId`
- [ ] If session becomes full between load and join: shows error toast "That seat just filled. Try another table."
- [ ] Disabled and shows "Waitlist" when session is full

**Technical notes:**
- dnd_engine: `cmd_join` in `dnd_engine/commands/session_commands.py` / `add_participant()` in `sessions.py`
- Session full conflict: handle 409 response from API bridge

---

### ST-037: Start a campaign (create session)

**Epic:** Lobby
**Priority:** P1
**Size:** M
**Status:** Backlog

As a player, I want to start a new campaign from the lobby so that I can begin a fresh session as DM or solo player.

**Acceptance criteria:**
- [ ] "Start a campaign" button opens a modal with: campaign name, max seats (1–6), cadence (daily/weekly/bi-weekly), level range, content tags, privacy (open/invite)
- [ ] Submits `POST /api/dnd/sessions` with the session config
- [ ] On success: navigates to `/play/:newSessionId`
- [ ] Validation: name required, seats 1–6, cadence required

**Technical notes:**
- dnd_engine: `cmd_startsession()` in `session_commands.py` / `start_session()` in `sessions.py`
- New REST endpoint needed: `POST /api/dnd/sessions` (ST-068)

---

### ST-038: Suzu suggestion banner

**Epic:** Lobby
**Priority:** P2
**Size:** S
**Status:** Backlog

As a player, I want to see Suzu's personalized session suggestion above the session grid so that I have a recommended table based on my characters and history.

**Acceptance criteria:**
- [ ] Banner shows `SuzuDM` avatar, suggestion text in `var(--font-display)` italic, "Take her advice" primary button
- [ ] In v1, suggestion is generated from the player's most recent character class/race and first open session matching it — no live AI call
- [ ] "Take her advice" joins the suggested session (same flow as ST-036)
- [ ] Banner hidden if player has no characters yet

**Technical notes:**
- Reference: narrator/suggestion strip in `lobby.jsx` lines 153–169
- AI-powered suggestion (calling NekoNova AI pipeline) is a v1.1 enhancement — v1 uses deterministic matching

---

### ST-039: Lobby shell with sidebar

**Epic:** Lobby
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want the lobby to use the full app shell with a persistent sidebar so that navigation feels consistent with dashboard and character screens.

**Acceptance criteria:**
- [ ] `Sidebar` component (ST-016) rendered with `active="lobby"`
- [ ] Sidebar user card shows current user's name and active character
- [ ] Shell layout: sidebar (fixed width) + workspace (flex 1) per `lobby.jsx` `.shell` and `.workspace` classes

**Technical notes:**
- Reference: `lobby.jsx` shell structure lines 123–125 and the `Sidebar` component

---

## Epic: Dashboard

### ST-040: Dashboard page layout

**Epic:** Dashboard
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want a dashboard landing page that shows my current session, stats, campaigns, characters, and recent activity in a structured layout so that I have a home base when I log in.

**Acceptance criteria:**
- [ ] Route: `src/app/dashboard/page.tsx`
- [ ] Shell with Sidebar active on "My campaigns"
- [ ] Two-column content grid: primary (1.4fr) + sidebar (1fr)
- [ ] Welcome header with player's username
- [ ] Loads all dashboard data (current session, stats, campaigns, characters, quests, recent) in parallel

**Technical notes:**
- Reference: `dashboard.jsx` full structure
- Data fetched from: `GET /api/dnd/sessions/active`, `GET /api/dnd/characters`, `GET /api/dnd/stats`

---

### ST-041: Resume session hero card

**Epic:** Dashboard
**Priority:** P1
**Size:** M
**Status:** Backlog

As a player with an active session, I want a prominent hero card showing my current session, Suzu's last remembered line, and a "Resume session" button so that returning to the table takes one click.

**Acceptance criteria:**
- [ ] Hero card: `SuzuDM` talking avatar + session name + session number + Suzu's last narration line + party size + session count + roll count
- [ ] "Resume session" button routes to `/play/:sessionId`
- [ ] "Read recap" button placeholder (v1.1 — session summary from NekoNova memory)
- [ ] Hidden or replaced with "Start your first session" CTA if no active session

**Technical notes:**
- Reference: `dashboard.jsx` hero card lines 22–42
- Session data: `GET /api/dnd/sessions/active`
- Suzu's last narration: from session log or NekoNova semantic memory (`core/memory_search.py`)

---

### ST-042: Stats row

**Epic:** Dashboard
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want a row of four stat cards showing active campaigns, rolls this week, crits/fumbles, and hours at the table so that I can see my activity at a glance.

**Acceptance criteria:**
- [ ] Four stat cards: active campaigns, rolls this week (with delta), crits/fumbles, hours at the table (with delta)
- [ ] Each card: icon + label + large value + optional delta label
- [ ] Delta shown in `var(--good)` if positive, `var(--bad)` if negative
- [ ] Stat values fetched from `GET /api/dnd/stats`

**Technical notes:**
- Reference: stats row in `dashboard.jsx` lines 45–50
- `window.UI.Stat` card component — implement as `StatCard` in `src/components/StatCard.tsx`

---

### ST-043: My campaigns list

**Epic:** Dashboard
**Priority:** P1
**Size:** M
**Status:** Backlog

As a player, I want a list of my active campaigns with session time, next session indicator, and quick-resume so that I can track all my ongoing tables.

**Acceptance criteria:**
- [ ] Shows up to 5 campaigns; "See all" link for more
- [ ] Each row: campaign icon (gradient square with class icon) + name + character/cadence + next-session pill + resume/open button
- [ ] "Resume" button on the active campaign routes to `/play/:sessionId`
- [ ] "New" button routes to session creation (same as ST-037)
- [ ] Empty state: "No campaigns yet. Start one from the lobby."

**Technical notes:**
- Reference: my campaigns section in `dashboard.jsx` lines 56–77
- Data: `GET /api/dnd/sessions?player=me`

---

### ST-044: My characters grid

**Epic:** Dashboard
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want a 2-column grid of my characters with a "+ New" card so that I can navigate to any character sheet or start creation.

**Acceptance criteria:**
- [ ] Each character card: avatar circle + name + class/level
- [ ] "+ New" card: dashed border, plus icon, routes to `/character/new`
- [ ] Character card click routes to `/character/:id`
- [ ] Maximum 4 characters visible; "See all" if more

**Technical notes:**
- Reference: `dashboard.jsx` characters section lines 101–117
- Data: `GET /api/dnd/characters?player=me`

---

### ST-045: Open hooks / quest tracker

**Epic:** Dashboard
**Priority:** P2
**Size:** S
**Status:** Backlog

As a player, I want a list of open quest hooks across my campaigns, remembered by Suzu, so that I don't forget what I was doing last session.

**Acceptance criteria:**
- [ ] Each quest row: status dot (color-coded) + title + scene label + status pill
- [ ] Completed quests shown with strikethrough and faded
- [ ] Suzu sub-label: "Suzu has been keeping notes."
- [ ] In v1: static data from session state; v1.1: populated from NekoNova semantic memory

**Technical notes:**
- Reference: open hooks section in `dashboard.jsx` lines 80–94
- NekoNova memory: `core/user_memory.py` and `core/memory_search.py`

---

### ST-046: Recent activity log

**Epic:** Dashboard
**Priority:** P2
**Size:** S
**Status:** Backlog

As a player, I want a recent activity feed showing my last few session events (rolls, level-ups, XP, session completions) so that I can remember what happened.

**Acceptance criteria:**
- [ ] Each row: colored dot + date in mono + event title + Suzu's italic one-line outcome commentary
- [ ] Last 10 events shown; most recent first
- [ ] Uses `var(--font-display)` italic for outcome line

**Technical notes:**
- Reference: `dashboard.jsx` recent log lines 122–135
- Data: `GET /api/dnd/sessions/:id/log?limit=10`

---

## Epic: Character creation

### ST-047: Character creation wizard shell (5 steps)

**Epic:** Character creation
**Priority:** P0
**Size:** M
**Status:** Backlog

As a player, I want a 5-step character creation wizard with step indicators and persistent Suzu commentary so that I can build my character with guidance.

**Acceptance criteria:**
- [ ] Route: `src/app/character/new/page.tsx`
- [ ] Steps: Race (1) → Class (2) → Abilities (3) → Background (4) → Review (5)
- [ ] Left sidebar: vertical step indicator with done/active/todo states per step
- [ ] Right panel: `SuzuDM` avatar + Suzu's commentary line for the current selection
- [ ] "Back" and "Continue" navigation between steps; "Continue" disabled until required selection made
- [ ] Wizard state held in local React state; no server calls until final submission

**Technical notes:**
- Reference: `character-create.jsx` — full file, including `Step` component and `SUZU_LINES` commentary map
- Race list from `dnd_engine/races.py` `list_races()` — 9 SRD races
- Class list from `dnd_engine/classes.py` `list_classes()` — 12 SRD classes

---

### ST-048: Race selection step

**Epic:** Character creation
**Priority:** P0
**Size:** S
**Status:** Backlog

As a player, I want to choose my character's race from a grid of SRD options with Suzu's commentary so that my choice feels consequential.

**Acceptance criteria:**
- [ ] Displays 9 SRD races: Human, Half-elf, Elf, Dwarf, Halfling, Tiefling, Gnome, Dragonborn
- [ ] Each race: icon badge + name + sub-tagline + ability bonus label
- [ ] Selected race highlighted with accent border; Suzu commentary updates immediately on hover/select
- [ ] "Continue" enabled only when a race is selected

**Technical notes:**
- Reference: `character-create.jsx` `RACES` array and step 0 render
- Race data from `dnd_engine/races.py` `get_race()` and `list_races()`
- Suzu commentary from `SUZU_LINES.race` map (hard-code in v1; fetch from AI in v2)

---

### ST-049: Class selection step

**Epic:** Character creation
**Priority:** P0
**Size:** S
**Status:** Backlog

As a player, I want to choose my character's class from a grid of 12 SRD classes with hit die, armor, and save info so that I can make an informed choice.

**Acceptance criteria:**
- [ ] Displays 12 SRD classes: Rogue, Wizard, Fighter, Cleric, Bard, Ranger, Druid, Paladin, Sorcerer, Warlock, Barbarian, Monk
- [ ] Each class card: class icon + name + hit die + brief flavor + Suzu commentary on select
- [ ] Selected class highlighted; Suzu commentary from `SUZU_LINES.class` map

**Technical notes:**
- Reference: `character-create.jsx` `SUZU_LINES.class` map and class step render
- Class data from `dnd_engine/classes.py` `get_class()`, `get_hit_die()`

---

### ST-050: Ability scores step (point buy)

**Epic:** Character creation
**Priority:** P0
**Size:** M
**Status:** Backlog

As a player, I want to allocate ability scores using the standard point-buy system so that character creation is balanced and rules-correct.

**Acceptance criteria:**
- [ ] Six ability scores: STR, DEX, CON, INT, WIS, CHA; each starts at 8
- [ ] Point buy budget: 27 points; cost table per 5e rules (8–15 base range)
- [ ] Point counter shows remaining points; spend button disabled at 0 points
- [ ] Racial bonuses shown separately and applied at review (not counted against budget)
- [ ] Modifier preview shown below each score

**Technical notes:**
- Reference: abilities step in `character-create.jsx`
- Point-buy costs from `dnd_engine/rules.py`; validate against `get_class()` recommended stats if present

---

### ST-051: Background selection step

**Epic:** Character creation
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want to choose a background that grants skill proficiencies so that my character has a history beyond combat stats.

**Acceptance criteria:**
- [ ] Lists 13 SRD backgrounds (Acolyte, Charlatan, Criminal, Entertainer, Folk Hero, Guild Artisan, Hermit, Noble, Outlander, Sage, Sailor, Soldier, Urchin)
- [ ] Each background shows granted skill proficiencies
- [ ] Selected background proficiencies reflected in the review step

**Technical notes:**
- Background → skill proficiency mapping from `_BACKGROUND_SKILLS` in `dnd_engine/commands/character_commands.py` lines 32–55

---

### ST-052: Character review and submission

**Epic:** Character creation
**Priority:** P0
**Size:** M
**Status:** Backlog

As a player, I want to review my complete character before saving so that I can confirm all choices and fix mistakes before committing.

**Acceptance criteria:**
- [ ] Shows: name input (editable), race + class + level 1 summary, final ability scores with racial bonuses applied, derived stats (HP, AC, initiative, speed), skill proficiencies, background
- [ ] "Create character" button calls `POST /api/dnd/characters` (ST-067)
- [ ] On success: routes to `/character/:newId`
- [ ] Loading state during submission; error toast on failure

**Technical notes:**
- dnd_engine: `cmd_create()` in `character_commands.py` — calls `Character()`, `apply_racial_bonuses()`, `get_saving_throw_proficiencies()`
- Initial HP from `get_hit_die()` (max at level 1) + CON modifier

---

### ST-053: Suzu commentary panel

**Epic:** Character creation
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want Suzu's commentary to update on every choice during character creation so that the wizard feels alive and in-character.

**Acceptance criteria:**
- [ ] Right panel: `SuzuDM` at ~120px, Suzu's commentary line below in `var(--font-display)` italic
- [ ] Commentary updates immediately when race or class is selected
- [ ] For abilities step: Suzu comments on the allocation pattern (e.g., "Charisma of 8. She approves of honesty.")
- [ ] For review step: Suzu gives a one-liner about the complete character

**Technical notes:**
- Reference: Suzu commentary panel in `character-create.jsx`
- v1: commentary from local `SUZU_LINES` maps; v1.1: streamed from NekoNova AI pipeline

---

## Epic: Character sheet

### ST-054: Character sheet page

**Epic:** Character sheet
**Priority:** P1
**Size:** M
**Status:** Backlog

As a player, I want to view my character's full 5e sheet with identity, ability scores, skills, inventory, spells, and features so that I have a complete reference during play.

**Acceptance criteria:**
- [ ] Route: `src/app/character/[id]/page.tsx`
- [ ] Fetches character data from `GET /api/dnd/characters/:id` (ST-067)
- [ ] Shell with Sidebar active on "Characters"
- [ ] Header: character name + race/class/subclass pill + export and resume-session buttons
- [ ] Left column: identity card, ability scores, skills
- [ ] Right column: inventory, spells (if applicable), Suzu's note

**Technical notes:**
- Reference: `character.jsx` full file
- Data from `dnd_engine/character.py` `load_character()`

---

### ST-055: Identity card

**Epic:** Character sheet
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want an identity card at the top of my character sheet showing name, HP, AC, initiative, proficiency, speed, XP, and level so that core stats are always visible.

**Acceptance criteria:**
- [ ] Avatar circle (initial in gradient) + background label + name + alignment/age/height
- [ ] Stat row: HP/HP-max, AC, INIT, PROF, SPD in mono font with color accents
- [ ] HP bar using `.hp .fill` CSS classes from design system
- [ ] Level displayed in large `var(--font-display)` numeral right-aligned; XP progress below

**Technical notes:**
- Reference: `character.jsx` identity card lines 49–77
- Data fields: `hp`, `hp_max`, `ac`, `initiative`, `proficiency_bonus`, `speed`, `level`, `xp` from `load_character()`

---

### ST-056: Ability scores and skills panel

**Epic:** Character sheet
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want my six ability scores displayed as stat boxes and my skill proficiencies shown in a two-column list so that I can reference modifiers during play.

**Acceptance criteria:**
- [ ] Six `.stat-box` elements: ability name + raw score + modifier (with sign)
- [ ] Skills grid: proficiency dot (filled/empty) + skill name + ability abbreviation + modifier
- [ ] Proficient skills highlighted with `var(--accent)` dot

**Technical notes:**
- Reference: `character.jsx` lines 80–102
- Skill proficiencies from `get_saving_throw_proficiencies()` and character `skill_proficiencies` field

---

### ST-057: Inventory panel

**Epic:** Character sheet
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want my inventory listed with item names, stats, and quantity so that I know what I'm carrying.

**Acceptance criteria:**
- [ ] Item rows: icon + name + sub (damage/range/notes) + quantity
- [ ] Weight total shown in panel header: "weight X / 80 lb"
- [ ] "Add" button placeholder (edit mode in ST-059)

**Technical notes:**
- Reference: `character.jsx` inventory panel lines 105–122
- Data from `get_character_inventory()` in `dnd_engine/equipment.py`

---

### ST-058: Spells panel

**Epic:** Character sheet
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player with spellcasting, I want my spells listed by level with slot usage so that I can manage my spell resources.

**Acceptance criteria:**
- [ ] Cantrips and spell levels grouped with level heading
- [ ] Each spell: name + range/duration/cast-time sub-line
- [ ] Spell slot tracker: current/max slots per level
- [ ] Panel hidden for non-spellcasting classes

**Technical notes:**
- Data from `dnd_engine/spells.py` `get_character_spell_slots()` and character's known spells
- Reference: `character.jsx` spells section

---

### ST-059: Character sheet edit mode

**Epic:** Character sheet
**Priority:** P2
**Size:** M
**Status:** Backlog

As a player, I want to edit my character's HP, inventory, and notes inline so that I can update my sheet between sessions without re-creating the character.

**Acceptance criteria:**
- [ ] "Edit" toggle in page header switches all editable fields to input mode
- [ ] Editable: HP current, inventory items (add/remove), notes field
- [ ] "Save" button calls `PATCH /api/dnd/characters/:id`
- [ ] Unsaved changes warning before navigating away
- [ ] Level-up (add class level) deferred to v1.1

**Technical notes:**
- dnd_engine: `update_character()` in `character.py`; `equip_item()` / `unequip_item()` in `equipment.py`
- REST: `PATCH /api/dnd/characters/:id` (ST-067)

---

## Epic: Play session

### ST-060: Play session page layout (3-pane)

**Epic:** Play session
**Priority:** P0
**Size:** L
**Status:** Backlog

As a player, I want the play screen to render a 3-pane layout — party/initiative left, narrator+chat center, dice+tactical-map right — so that all information I need is visible during a session.

**Acceptance criteria:**
- [ ] Route: `src/app/play/[sessionId]/page.tsx`
- [ ] `.play-grid` CSS grid: 220px left / flex-1 center / 260px right; all panes stretch to viewport height
- [ ] Left pane: party list (ST-061) + initiative tracker (ST-020)
- [ ] Center pane: narrator strip (ST-018) + chat log (ST-019) + composer (ST-063)
- [ ] Right pane: scene/tactical placeholder + dice tray (ST-017) + safety tools
- [ ] Back button (top-left of left pane) routes to `/lobby`

**Technical notes:**
- Reference: `play.jsx` full layout, `.play-grid`, `.play-pane`, `.play-center`
- CSS from design system `globals.css` + component module

---

### ST-061: Party list panel

**Epic:** Play session
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want to see all party members with HP bars, HP/max values, and AC in the left pane so that I can track party health at a glance.

**Acceptance criteria:**
- [ ] Each party member: avatar (initial circle) + name + "you" badge if self + character class + HP bar + HP/max + AC
- [ ] Active session member highlighted with accent background
- [ ] HP bar animates on change (transition 0.3s)
- [ ] Clicking a party member opens their character sheet in a slide-over (v1.1) or routes to `/character/:id`

**Technical notes:**
- Reference: `play.jsx` party section lines 33–65
- Data from `GET /api/dnd/sessions/:id/participants` with their character HP/AC values

---

### ST-062: Suzu narration (AI pipeline integration)

**Epic:** Play session
**Priority:** P0
**Size:** XL
**Status:** Backlog

As a player, I want Suzu to narrate the session in real-time — responding to actions, rolling for NPCs, describing scenes — streamed into the narrator strip so that the AI DM experience feels live.

**Acceptance criteria:**
- [ ] Player message submitted via composer triggers `POST /api/dnd/narrate` which calls NekoNova's 18-step AI pipeline
- [ ] Narration response streamed via SSE; tokens appear in the `NarratorStrip` component as they arrive
- [ ] `SuzuDM` is in `talking` animated state while streaming; reverts when stream ends
- [ ] Mood from the narration response updates `SuzuDM`'s `mood` prop
- [ ] Narration entry appended to `ChatLog` with `kind: narration` styling once complete
- [ ] Error state: "Suzu stepped away for a moment. Try again." if pipeline fails

**Technical notes:**
- NekoNova AI pipeline entry: `ProjectNekoNova/api/enhanced.py` — route `POST /dnd/narrate/stream` (to be added in ST-069)
- Streaming utility: ST-007 (`openNarrationStream`)
- Suzu personality: `ProjectNekoNova/companions/suzu.yaml`; Persona Guard enforced server-side (`core/persona_guard.py`)

---

### ST-063: Message composer

**Epic:** Play session
**Priority:** P1
**Size:** S
**Status:** Backlog

As a player, I want a message composer at the bottom of the center pane with Say / Act / OOC mode tabs so that I can speak, describe actions, or communicate out-of-character.

**Acceptance criteria:**
- [ ] Mode tabs: Say (in-character speech), Act (third-person action), OOC (out-of-character)
- [ ] Placeholder text changes per mode: "Say something. (Suzu will quote you.)" / "I climb the chimney quietly…" / "Out-of-character. Visible to the table, not the world."
- [ ] Send button disabled when input is empty; activates on text entry
- [ ] Enter key sends (Shift+Enter for newline)
- [ ] Message appended to chat log immediately (optimistic) with appropriate `kind`

**Technical notes:**
- Reference: `.composer` in `play.jsx` lines 134–150
- OOC messages are not sent to Suzu's AI pipeline; only shown to table members

---

### ST-064: Combat state management

**Epic:** Play session
**Priority:** P1
**Size:** L
**Status:** Backlog

As a player, I want the play screen to track combat state — initiative order, current turn, action availability — and allow me to perform combat actions (attack, dodge, dash, end turn) so that 5e combat runs correctly.

**Acceptance criteria:**
- [ ] Combat starts when Suzu narrates an encounter (or DM triggers it via API)
- [ ] Initiative tracker (ST-020) shows real-time turn order; current turn highlighted
- [ ] Player actions (attack, dodge, dash) available as buttons when it is the player's turn
- [ ] "End turn" button calls `POST /api/dnd/combat/:combatId/endturn`
- [ ] Attack flow: target selection → `POST /api/dnd/combat/:combatId/attack` → result shown in chat log and broadcaster to all players
- [ ] Combat ends when all enemies reach 0 HP; Suzu narrates the outcome

**Technical notes:**
- dnd_engine: `resolve_attack()`, `apply_condition()`, `end_turn()` in `combat.py`; `cmd_attack()`, `cmd_dodge()`, `cmd_dash()`, `cmd_endturn()`, `cmd_status()` in `combat_commands.py`
- Combat state synced via WebSocket (ST-072)

---

### ST-065: Dice roll flow with server resolution

**Epic:** Play session
**Priority:** P1
**Size:** M
**Status:** Backlog

As a player, I want dice rolls in the play session to show client-side animation immediately but have results validated server-side so that rolls are visible, fast, and cheat-proof.

**Acceptance criteria:**
- [ ] Player initiates roll from `DiceRoller` (ST-017) or Suzu prompts a roll
- [ ] Client-side Die animation plays immediately (no server round-trip for animation)
- [ ] Server authoritative roll result returned from `POST /api/dnd/roll` and replaces the client value in the chat log
- [ ] Crit (natural 20) and fumble (natural 1) highlighted per design system styles
- [ ] Roll broadcast to all players in the session via WebSocket (ST-072)

**Technical notes:**
- dnd_engine: `rules.py` dice rolling (`roll_dice`, `d20`, etc.)
- Server roll endpoint: `POST /api/dnd/roll` (ST-067) — returns `{ result, natural, crit, fumble, modifier }`

---

### ST-066: Spell casting in combat

**Epic:** Play session
**Priority:** P1
**Size:** M
**Status:** Backlog

As a spellcaster, I want to cast spells from a spell list during my turn so that my character's spellcasting abilities work in play.

**Acceptance criteria:**
- [ ] Spell list accessible from a "Spells" tab in the right pane (replaces dice tray when open)
- [ ] Each spell shows name, level, range, cast time; grayed out if no slots available
- [ ] Casting a spell calls `POST /api/dnd/combat/:combatId/cast` with spell name, slot level, target
- [ ] Slot usage updated in the right pane immediately on cast
- [ ] Suzu narrates the spell effect via the AI pipeline (ST-062)

**Technical notes:**
- dnd_engine: `cast_spell_in_combat()` in `spells.py`; `cmd_cast()` in `spell_commands.py`
- Slot management: `get_character_spell_slots()`, `restore_slots_short_rest()`, `restore_slots_long_rest()`

---

## Epic: Backend API bridge

### ST-067: Character REST endpoints in ProjectNekoNova

**Epic:** Backend API bridge
**Priority:** P0
**Size:** L
**Status:** Backlog

As a developer, I want REST endpoints added to ProjectNekoNova's Flask app that expose character CRUD so that SuzusTavern can create, read, update, and delete characters via HTTP.

**Acceptance criteria:**
- [ ] `GET /dnd/characters` — list all characters for the authenticated user
- [ ] `POST /dnd/characters` — create a character; body maps to `cmd_create()` params
- [ ] `GET /dnd/characters/:id` — load a single character sheet
- [ ] `PATCH /dnd/characters/:id` — update HP, inventory, notes
- [ ] All endpoints require valid JWT from Authentication-Python
- [ ] Responses are JSON; error responses follow existing NekoNova error format

**Technical notes:**
- Add to `ProjectNekoNova/api/app.py` under `/dnd/` prefix
- dnd_engine: `save_character()`, `load_character()`, `update_character()`, `list_characters()` in `character.py`
- DB: NekoNova core SQLite via `db/client.py`

---

### ST-068: Session REST endpoints in ProjectNekoNova

**Epic:** Backend API bridge
**Priority:** P0
**Size:** L
**Status:** Backlog

As a developer, I want REST endpoints for session lifecycle so that SuzusTavern can start, join, list, pause, and end sessions via HTTP.

**Acceptance criteria:**
- [ ] `GET /dnd/sessions` — list open/active sessions
- [ ] `POST /dnd/sessions` — start a new session
- [ ] `GET /dnd/sessions/:id` — session detail
- [ ] `GET /dnd/sessions/active` — get the authenticated user's current active session
- [ ] `POST /dnd/sessions/:id/join` — join a session
- [ ] `POST /dnd/sessions/:id/pause` — pause a session (DM only)
- [ ] `POST /dnd/sessions/:id/end` — end a session (DM only)
- [ ] `GET /dnd/sessions/:id/participants` — list participants with character HP/AC
- [ ] `POST /dnd/sessions/:id/xp` — award XP

**Technical notes:**
- dnd_engine: `start_session()`, `pause_session()`, `resume_session()`, `end_session()`, `add_participant()`, `award_xp()` in `sessions.py`
- Auth: JWT required on all endpoints

---

### ST-069: Narration and combat REST endpoints in ProjectNekoNova

**Epic:** Backend API bridge
**Priority:** P0
**Size:** L
**Status:** Backlog

As a developer, I want REST endpoints for combat actions and AI narration so that the play session can execute 5e mechanics and trigger Suzu's AI pipeline.

**Acceptance criteria:**
- [ ] `POST /dnd/narrate/stream` — accepts `{ sessionId, playerMessage, combatState }` and returns SSE stream of narration tokens; calls `api/enhanced.py` pipeline
- [ ] `POST /dnd/roll` — server-side dice roll; returns `{ result, natural, crit, fumble, modifier }`
- [ ] `GET /dnd/combat/:combatId/status` — current combat state including initiative order, HP, conditions
- [ ] `POST /dnd/combat/:combatId/attack` — resolve attack
- [ ] `POST /dnd/combat/:combatId/endturn` — end current turn
- [ ] `POST /dnd/combat/:combatId/cast` — cast a spell in combat

**Technical notes:**
- Narration: `api/enhanced.py` 18-step pipeline — wrap in a Flask route that streams chunks via SSE
- Combat: `resolve_attack()`, `end_turn()`, `get_participants()` in `combat.py`
- Spell: `cast_spell_in_combat()` in `spells.py`

---

### ST-070: Next.js API route proxies

**Epic:** Backend API bridge
**Priority:** P0
**Size:** M
**Status:** Backlog

As a developer, I want Next.js API routes in `src/app/api/` that proxy to ProjectNekoNova and Authentication-Python so that browser CORS restrictions are handled server-side and secrets stay out of the client bundle.

**Acceptance criteria:**
- [ ] `src/app/api/dnd/[...path]/route.ts` — catches all `/api/dnd/*` calls and proxies to `NEKANOVA_URL/dnd/*` with JWT forwarded
- [ ] `src/app/api/auth/[...path]/route.ts` — proxies to `AUTH_URL/*`
- [ ] SSE proxying: narration stream forwarded to the browser as a `text/event-stream` response without buffering
- [ ] Server-side env vars (`NEKANOVA_URL`, `AUTH_URL`) are not `NEXT_PUBLIC_` — never exposed to the client

**Technical notes:**
- Next.js App Router `route.ts` with `GET`, `POST`, `PATCH` handlers
- SSE proxy: use `ReadableStream` + `TransformStream` to pipe NekoNova's SSE to the browser

---

## Epic: Real-time

### ST-071: Narration streaming (SSE)

**Epic:** Real-time
**Priority:** P0
**Size:** M
**Status:** Backlog

As a player, I want Suzu's narration to appear word-by-word in the narrator strip rather than all at once so that the DM voice feels live and immediate.

**Acceptance criteria:**
- [ ] `NarratorStrip` (ST-018) consumes the `AsyncIterable<NarrationChunk>` from `openNarrationStream` (ST-007)
- [ ] Each token appended to displayed text as it arrives; `SuzuDM` stays in `talking` state throughout
- [ ] Stream completion triggers: talking animation stops, full narration appended to `ChatLog`, scroll-to-bottom
- [ ] If stream drops mid-sentence: partial narration kept, error indicator shown, retry available

**Technical notes:**
- SSE proxy: ST-070 Next.js route handler
- NekoNova endpoint: `POST /dnd/narrate/stream` (ST-069)
- `NarrationChunk`: `{ token: string; mood: string; done: boolean }`

---

### ST-072: WebSocket for session events (dice, initiative, HP)

**Epic:** Real-time
**Priority:** P1
**Size:** L
**Status:** Backlog

As a player, I want dice rolls, initiative changes, and HP updates to appear on all connected players' screens in real-time so that the session feels multiplayer.

**Acceptance criteria:**
- [ ] `src/lib/api/socket.ts` opens a WebSocket to `WS_URL/dnd/sessions/:id/ws`
- [ ] Events received: `dice_roll`, `initiative_update`, `hp_change`, `turn_change`, `combat_start`, `combat_end`
- [ ] Each event updates the relevant component state: `DiceRoller` / `ChatLog` for dice; `InitiativeTracker` for initiative; party list HP bars for HP changes
- [ ] WebSocket reconnects on disconnect (same backoff as SSE utility)
- [ ] Connection closed on component unmount

**Technical notes:**
- WebSocket endpoint to be added to ProjectNekoNova Flask app (use `flask-sock` or integrate with existing NekoNova WebSocket infrastructure)
- Event schema: `{ event: string; sessionId: string; payload: object; timestamp: string }`

---

## Epic: Polish and accessibility

### ST-073: Palette switcher (tweaks panel)

**Epic:** Polish and accessibility
**Priority:** P2
**Size:** M
**Status:** Backlog

As a player, I want a tweaks panel that lets me switch between the four design system palettes and density settings so that I can personalize my experience.

**Acceptance criteria:**
- [ ] Tweaks panel accessible from a settings button in the sidebar
- [ ] Four palette swatches: dusk-tavern (default), candlelit, aetheric, moonlit-grove
- [ ] Density options: compact, cozy, airy
- [ ] Selection sets `document.documentElement.dataset.vibe` and `dataset.density`
- [ ] Preference persisted to `localStorage`; applied on page load before first paint (prevents flash)

**Technical notes:**
- Reference: `../Suzu's Tavern Design System/preview/tweaks-panel.html` and `ui_kits/web/tweaks-panel.jsx`
- `ThemeProvider` client component wrapping `<body>` in root layout, per `SuzusTavern/CLAUDE.md` note on palette switching

---

### ST-074: Mobile responsive — lobby and dashboard

**Epic:** Polish and accessibility
**Priority:** P2
**Size:** M
**Status:** Backlog

As a mobile player, I want lobby and dashboard to be readable and operable on 375px+ screens so that I can check my sessions on my phone.

**Acceptance criteria:**
- [ ] Sidebar collapses to bottom tab bar below 768px
- [ ] Campaign grid and stats row stack to single column
- [ ] Session cards full-width below 640px
- [ ] Touch targets: minimum 44×44px for all interactive elements

**Technical notes:**
- CSS breakpoints in component modules; reference `../Suzu's Tavern Design System/ui_kits/web/mobile.css`

---

### ST-075: Mobile responsive — play session

**Epic:** Polish and accessibility
**Priority:** P3
**Size:** L
**Status:** Backlog

As a mobile player, I want the play session to be usable on mobile with a tabbed pane switcher in place of the 3-column layout so that I can play on a phone in a pinch.

**Acceptance criteria:**
- [ ] Below 768px: 3-pane grid replaced by a 3-tab switcher (Party / Play / Tools)
- [ ] Active tab renders its pane content; inactive tabs hidden
- [ ] Composer always visible at bottom regardless of active tab
- [ ] Tab bar: 44px height, `var(--bg-2)` background, accent on active tab

**Technical notes:**
- Reference: `mobile.css` in design system

---

### ST-076: Keyboard navigation

**Epic:** Polish and accessibility
**Priority:** P2
**Size:** M
**Status:** Backlog

As a player who navigates by keyboard, I want all interactive elements in the app to be reachable and operable via Tab and keyboard shortcuts so that I don't require a mouse.

**Acceptance criteria:**
- [ ] Tab order follows visual reading order on all pages
- [ ] Modals and slide-overs trap focus while open; restore focus on close
- [ ] Escape key closes open modals and dismisses toasts
- [ ] Dice roll: `d` + die sides shortcut in play session (e.g., `d20` to roll d20) — v1.1
- [ ] No keyboard traps outside of modals

**Technical notes:**
- Focus management via `useRef` and `focus()` on modal open
- `aria-modal="true"` on modal elements

---

### ST-077: Screen reader support

**Epic:** Polish and accessibility
**Priority:** P2
**Size:** M
**Status:** Backlog

As a screen reader user, I want critical play session events announced automatically so that I can follow the session without visual reliance.

**Acceptance criteria:**
- [ ] Narration strip has `role="region"` and `aria-label="Suzu narration"`; new narration text announced via `aria-live="polite"`
- [ ] Dice roll results announced via `aria-live="assertive"` live region
- [ ] Initiative tracker uses `role="list"` / `role="listitem"` with descriptive `aria-label`
- [ ] HP bars have `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-label`

**Technical notes:**
- No visual-only information conveyed solely through color — all status communicated with text label or pattern in addition to color

---

### ST-078: Page transition animations

**Epic:** Polish and accessibility
**Priority:** P3
**Size:** S
**Status:** Backlog

As a player, I want smooth fade transitions between pages so that navigation doesn't feel abrupt.

**Acceptance criteria:**
- [ ] Route changes fade out old page (200ms) and fade in new page (200ms)
- [ ] Animation disabled when `prefers-reduced-motion` media query is active
- [ ] No layout shift during transition

**Technical notes:**
- Next.js App Router does not natively support page transitions — use View Transitions API wrapped with a client-side navigation hook, or a simple CSS opacity transition in layout

---

### ST-079: Session memory recap (Suzu's notes)

**Epic:** Polish and accessibility
**Priority:** P2
**Size:** M
**Status:** Backlog

As a returning player, I want to see a brief "last time on..." recap from Suzu when I resume a session so that I remember what happened.

**Acceptance criteria:**
- [ ] On `/play/:sessionId` load, `GET /api/dnd/sessions/:id/recap` returns a short paragraph from Suzu
- [ ] Displayed in a dismissible banner above the narrator strip on session resume
- [ ] Banner dismissed after first read and does not reappear for the same session
- [ ] Recap generated by NekoNova semantic memory search (`core/memory_search.py`) — not a cached string

**Technical notes:**
- Recap endpoint: `GET /dnd/sessions/:id/recap` in ProjectNekoNova (calls `memory_search.py`)
- Dismissed state stored in `sessionStorage` keyed by `sessionId`

---

### ST-080: Suzu's note on character sheet

**Epic:** Polish and accessibility
**Priority:** P3
**Size:** S
**Status:** Backlog

As a player, I want to see a short personal note from Suzu on my character sheet — her assessment of my character — so that the sheet feels alive.

**Acceptance criteria:**
- [ ] "Suzu's note" section at the bottom of the character sheet right column
- [ ] Note displayed in `var(--font-display)` italic
- [ ] In v1: note is static text derived from character class/race (same `SUZU_LINES` map)
- [ ] In v1.1: fetched from NekoNova user memory (`core/user_memory.py`) personalized to player history

**Technical notes:**
- Reference: `character.jsx` — Suzu note section (right column, bottom)
- v1 note generation: look up class + race combination in a local commentary map

---

## Story index

| ID | Title | Epic | Priority | Size |
|----|-------|------|----------|------|
| ST-001 | HTTP API client with JWT bearer auth | Foundation | P0 | M |
| ST-002 | Environment configuration | Foundation | P0 | XS |
| ST-003 | Auth session management | Foundation | P0 | M |
| ST-004 | Global error boundary | Foundation | P0 | S |
| ST-005 | Page-level loading skeletons | Foundation | P1 | S |
| ST-006 | Toast notification system | Foundation | P1 | S |
| ST-007 | SSE streaming utility | Foundation | P0 | M |
| ST-008 | Route protection middleware | Foundation | P0 | S |
| ST-009 | Button component | Design system components | P0 | S |
| ST-010 | Card component | Design system components | P0 | S |
| ST-011 | Pill component | Design system components | P0 | S |
| ST-012 | Die component | Design system components | P1 | M |
| ST-013 | Avatar component | Design system components | P1 | S |
| ST-014 | SuzuDM component | Design system components | P0 | M |
| ST-015 | Icon component | Design system components | P0 | S |
| ST-016 | Sidebar component | Design system components | P1 | M |
| ST-017 | DiceRoller component | Design system components | P1 | M |
| ST-018 | NarratorStrip component | Design system components | P1 | S |
| ST-019 | ChatLog component | Design system components | P1 | M |
| ST-020 | InitiativeTracker component | Design system components | P1 | S |
| ST-021 | Landing page hero section | Landing page | P1 | M |
| ST-022 | How it works section | Landing page | P1 | S |
| ST-023 | Capabilities section | Landing page | P1 | S |
| ST-024 | Suzu intro / story section | Landing page | P1 | S |
| ST-025 | Footer | Landing page | P1 | XS |
| ST-026 | Landing page responsive layout | Landing page | P2 | S |
| ST-027 | Login page layout (two-pane) | Auth / login | P0 | M |
| ST-028 | Email / password authentication | Auth / login | P0 | M |
| ST-029 | Twitch OAuth login | Auth / login | P1 | M |
| ST-030 | Discord OAuth login | Auth / login | P1 | M |
| ST-031 | Logout | Auth / login | P0 | XS |
| ST-032 | Recovery key placeholder | Auth / login | P2 | S |
| ST-033 | Session listing page | Lobby | P1 | M |
| ST-034 | Session filter strip | Lobby | P1 | S |
| ST-035 | Session search | Lobby | P2 | S |
| ST-036 | Join session | Lobby | P1 | M |
| ST-037 | Start a campaign | Lobby | P1 | M |
| ST-038 | Suzu suggestion banner | Lobby | P2 | S |
| ST-039 | Lobby shell with sidebar | Lobby | P1 | S |
| ST-040 | Dashboard page layout | Dashboard | P1 | S |
| ST-041 | Resume session hero card | Dashboard | P1 | M |
| ST-042 | Stats row | Dashboard | P1 | S |
| ST-043 | My campaigns list | Dashboard | P1 | M |
| ST-044 | My characters grid | Dashboard | P1 | S |
| ST-045 | Open hooks / quest tracker | Dashboard | P2 | S |
| ST-046 | Recent activity log | Dashboard | P2 | S |
| ST-047 | Character creation wizard shell | Character creation | P0 | M |
| ST-048 | Race selection step | Character creation | P0 | S |
| ST-049 | Class selection step | Character creation | P0 | S |
| ST-050 | Ability scores step (point buy) | Character creation | P0 | M |
| ST-051 | Background selection step | Character creation | P1 | S |
| ST-052 | Character review and submission | Character creation | P0 | M |
| ST-053 | Suzu commentary panel | Character creation | P1 | S |
| ST-054 | Character sheet page | Character sheet | P1 | M |
| ST-055 | Identity card | Character sheet | P1 | S |
| ST-056 | Ability scores and skills panel | Character sheet | P1 | S |
| ST-057 | Inventory panel | Character sheet | P1 | S |
| ST-058 | Spells panel | Character sheet | P1 | S |
| ST-059 | Character sheet edit mode | Character sheet | P2 | M |
| ST-060 | Play session page layout (3-pane) | Play session | P0 | L |
| ST-061 | Party list panel | Play session | P1 | S |
| ST-062 | Suzu narration (AI pipeline integration) | Play session | P0 | XL |
| ST-063 | Message composer | Play session | P1 | S |
| ST-064 | Combat state management | Play session | P1 | L |
| ST-065 | Dice roll flow with server resolution | Play session | P1 | M |
| ST-066 | Spell casting in combat | Play session | P1 | M |
| ST-067 | Character REST endpoints in ProjectNekoNova | Backend API bridge | P0 | L |
| ST-068 | Session REST endpoints in ProjectNekoNova | Backend API bridge | P0 | L |
| ST-069 | Narration and combat REST endpoints in ProjectNekoNova | Backend API bridge | P0 | L |
| ST-070 | Next.js API route proxies | Backend API bridge | P0 | M |
| ST-071 | Narration streaming (SSE) | Real-time | P0 | M |
| ST-072 | WebSocket for session events | Real-time | P1 | L |
| ST-073 | Palette switcher (tweaks panel) | Polish and accessibility | P2 | M |
| ST-074 | Mobile responsive — lobby and dashboard | Polish and accessibility | P2 | M |
| ST-075 | Mobile responsive — play session | Polish and accessibility | P3 | L |
| ST-076 | Keyboard navigation | Polish and accessibility | P2 | M |
| ST-077 | Screen reader support | Polish and accessibility | P2 | M |
| ST-078 | Page transition animations | Polish and accessibility | P3 | S |
| ST-079 | Session memory recap (Suzu's notes) | Polish and accessibility | P2 | M |
| ST-080 | Suzu's note on character sheet | Polish and accessibility | P3 | S |

---

## MVP scope (P0 stories)

The following stories constitute the minimum viable product — nothing ships without them:

ST-001, ST-002, ST-003, ST-004, ST-007, ST-008 (Foundation)
ST-009, ST-010, ST-011, ST-014, ST-015 (Core components)
ST-027, ST-028, ST-031 (Auth)
ST-047, ST-048, ST-049, ST-050, ST-052 (Character creation)
ST-060, ST-062 (Play session)
ST-067, ST-068, ST-069, ST-070 (API bridge — prerequisite for everything)
ST-071 (SSE narration streaming)

Total: 22 P0 stories. The API bridge stories (ST-067–ST-070) are the critical path — nothing in the frontend works until REST routes exist in ProjectNekoNova.
