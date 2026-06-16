# Sprint 4 — Login Screen Specification

**Canvas source:** `Suzu's Tavern Design System/ui_kits/web/login.jsx`
**Rendered at:** `http://localhost:8765/index.html` → Login tab
**Viewport captured:** 1280 × 900 (desktop)
**Screenshot:** `docs/design/screenshots/login-1280.png`
**A11y snapshot:** captured live — see tree in extraction log

---

## Build Deltas vs. Canvas (APPLY THESE BEFORE BUILDING)

| Delta | Canvas shows | Sprint 4 build target |
|-------|-------------|----------------------|
| Tab toggle (Sign in / Create account) | Rendered, interactive | **CUT** — render no tab; single "Welcome back." form only (sign-in only) |
| Twitch / Discord OAuth buttons | Active ghost buttons | **Disabled** with `aria-disabled="true"` and a "coming soon" tooltip or chip label; full OAuth is deferred |
| 2FA TOTP step | **NOT IN CANVAS** | **Added state needed**: after the auth API returns `{ status: "2fa" }`, the form must replace the password field area with a 6-digit TOTP input + "Verify" button. The canvas has no design for this — flag to Aoi-UI to design the 2FA step |
| Canvas mock footer | `"standby · 7 sessions remembered"` (static string) | Replace with live session count from auth state, or omit entirely if session data not available at login |

---

## Screen Anatomy

### Top-level layout

Per `login-1280.png`: the Login screen is a full-viewport centred overlay on an `aurora` background.

```
┌─────────────────────── aurora background ───────────────────────┐
│                                                                   │
│           ┌──────────── Card(pop) ─── 980px max ───────────┐    │
│           │  Left pane 490px  │   Right pane 490px (form)   │    │
│           └───────────────────┴────────────────────────────┘    │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

- **Outer wrapper:** `className="aurora"`, `height: 100%`, `display: grid`, `placeItems: center`, `padding: 24px`
- **Card:** `<Card pop>` — uses `.glass` + `box-shadow: var(--shadow-pop)`. Explicit overrides: `display: grid`, `gridTemplateColumns: 1fr 1fr` (renders as `490px 490px` at 1280px viewport), `maxWidth: 980px`, `width: 100%`, `borderRadius: var(--radius-lg)` (28px), `overflow: hidden`, `padding: 0`

### Left pane — Visual / brand

**Measured per `login-1280.png`.**

| Property | Value |
|----------|-------|
| Padding | `44px` on all sides |
| Background | `color-mix(in oklab, var(--accent-2) 8%, transparent)` — lavender tint |
| Border right | `1px solid var(--line)` |
| Position | `relative` |

#### Brand lockup (top of left pane)

- **Container:** `display: flex`, `alignItems: center`, `gap: 10px`
- **`<SuzuDM>`:** `size={40}`, `glow={false}` — uses existing `SuzuDM` component
- **Title:** `"Suzu's Tavern"` — `fontFamily: var(--font-display)`, `fontSize: 18px`, `lineHeight: 1`, `letterSpacing: -0.02em`
- **Sub-label:** `"A NekoNova table"` — `.label` class, `fontSize: 9px`, `marginTop: 2px`

#### Hero mascot

- **Container:** `display: grid`, `placeItems: center`, `padding: 30px 0 14px`
- **`<SuzuDM>`:** `size={220}` — default glow, default idle state. At 1280px this is the dominant visual.

#### Tagline

- **`<h2>`:** `"Hi. I was / almost expecting you."` — `fontSize: 26px`, `lineHeight: 1.15`, `letterSpacing: -0.02em`. Uses global `var(--font-display)` (Fraunces). The word "almost expecting you." is wrapped in `<em>` with `color: var(--accent)`.
- **`<p>`:** `"Sign in to find your table. Suzu has the kettle on and the goblin union has questions."` — `marginTop: 10px`, `color: var(--ink-2)`, `fontSize: 14px`, `lineHeight: 1.6`

#### Waveform status strip

- **Container:** `marginTop: 20px`, `display: flex`, `gap: 10px`, `alignItems: center`
- **`<Waveform>`:** `bars={24}`, `height={18}`, `active={false}` — idle/standby state, static bars at opacity 0.3
- **Status text:** `"standby · 7 sessions remembered"` — `.mono` class, `fontSize: 11px`, `color: var(--ink-3)`
- **`prefers-reduced-motion`:** Waveform already guards via `useReducedMotion` hook — no additional guard needed

### Right pane — Form

| Property | Value |
|----------|-------|
| Padding | `44px` |
| Display | `flex`, `flexDirection: column`, `gap: 16px` |
| Tag | `<form onSubmit={submit}>` |

#### Back button

- **`.btn.btn-ghost`** — `alignSelf: flex-start`, `height: 32px`, `padding: 0 12px`, `fontSize: 12px`
- **Label:** `"← Back"` — navigates away from login (route back to landing)
- Note: `type="button"` — does NOT submit the form

#### Heading block

- **`<h3>`:** `"Welcome back."` — `fontSize: 28px`, `fontFamily: var(--font-display)` (Fraunces, weight 500)
- **`<p>`:** `"Sign in to your tavern account."` — `color: var(--ink-3)`, `fontSize: 14px`, `marginTop: 4px`

#### Tab toggle (CANVAS ONLY — CUT IN BUILD)

The canvas renders a sign-in / create-account tab switcher. **Do not build this.** The Sprint 4 implementation renders sign-in only. Omit the entire tab row element.

```
// Canvas-only — do not implement:
// <div class="tab-toggle"> … "Sign in" | "Create account" … </div>
```

#### Tavern handle field

- **Label:** `"Tavern handle"` — `.label` class, `fontSize: 10px`, `marginBottom: 6px`
- **`<input>`:** `.input` class
  - `height: 44px`, `padding: 0 14px`
  - `borderRadius: var(--radius-sm)` (12px)
  - `border: 1px solid var(--line)`
  - `background: color-mix(in oklab, var(--ink) 3%, transparent)`
  - Focus: `border-color: var(--accent)`, focus ring `0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent)`
  - Canvas default value: `"velka@littlehollow"` (demo only — clear in build)
  - `autocomplete="username"`

#### Passphrase field

- **Label:** `"Passphrase"` — `.label` class, `fontSize: 10px`, `marginBottom: 6px`
- **`<input type="password">`:** `.input` class — same geometry as handle field above
  - Canvas default: `"••••••••"` (demo only — clear in build)
  - `autocomplete="current-password"`

#### "Keep me signed in" + recovery row

- **Container:** `display: flex`, `justifyContent: space-between`, `alignItems: center`, `fontSize: 12px`, `color: var(--ink-3)`
- **Left:** `<label>` with `<input type="checkbox" defaultChecked />` + `" Keep me signed in"`, `gap: 8px`, `cursor: pointer`
- **Right:** `<a href="#">Recovery key</a>` — `color: var(--accent)` — links to password recovery flow (not designed in Sprint 4; can be a TODO stub)

#### Primary submit button

- **`.btn.btn-primary.btn-lg`** — `marginTop: 4px`, full width of form column
  - Height: `46px`, padding `0 22px`, `fontSize: 15px`
  - Background: `linear-gradient(135deg, var(--accent), var(--accent-2))`
  - **Idle label:** `<Icon.Power size={16} /> "Open the door"`
  - **Loading state:** `<span class="nn-spinner" /> "Booting…"` — spinner is a `14px × 14px` rotating circle border, `border: 2px solid currentColor; border-right-color: transparent; animation: spin .8s linear infinite`
  - `prefers-reduced-motion`: suppress `spin` animation; show static text "Checking…" or remove spinner

#### "or" divider

- **Container:** `display: flex`, `gap: 8px`, `alignItems: center`, `margin: 8px 0`
- **Left/right lines:** `flex: 1`, `height: 1px`, `background: var(--line)`
- **Label:** `"or"` — `fontSize: 11px`, `color: var(--ink-3)`, `letterSpacing: 0.16em`, `textTransform: uppercase`, `fontWeight: 600`

#### OAuth buttons (Twitch + Discord — DISABLED)

- **Container:** `display: flex`, `gap: 8px`
- **Twitch button:** `.btn.btn-ghost` — `flex: 1`, `<Icon.Twitch size={14} /> "Twitch"`
- **Discord button:** `.btn.btn-ghost` — `flex: 1`, `<Icon.Discord size={14} /> "Discord"`
- **Sprint 4 build delta:** Both must be `aria-disabled="true"` and visually indicate "coming soon." Suggested implementation: add a small `.label`-styled badge reading "soon" above or inline, or render a `Pill tone="muted"` tooltip on hover. The disabled state from globals.css applies: `opacity: 0.45; cursor: not-allowed`.

#### Footer status

- **`.mono`** — `marginTop: auto` (pushes to bottom of flex column), `fontSize: 11px`, `color: var(--ink-3)`
- **Canvas text:** `"session.encrypted · ed25519 · last sync 14:02"` — static copy in canvas. In build: derive from session state or use a fixed string like `"session.encrypted · ed25519"`.

---

## 2FA TOTP Step (Added State — Not in Canvas)

The login API response `{ status: "2fa" }` should trigger a form state transition. Canvas has no design for this. Requirements for Aoi-UI to design:

- Replace the password field area with a 6-digit code `<input>` (one input, `inputmode="numeric"`, `pattern="[0-9]{6}"`)
- Heading changes to: `"One more step."` or similar
- Sub-copy: `"Enter the code from your authenticator app."`
- Submit button label: `"Verify"` with same `.btn-primary.btn-lg` styling
- Back affordance to return to password entry
- Loading state: same spinner pattern as primary submit

**Open question to Aoi-UI:** Design the 2FA step for this form. No canvas reference exists.

---

## Loading / Spinner Animation

Canvas-defined keyframe, scoped inline:

```css
.nn-spinner {
  width: 14px; height: 14px; border-radius: 99px;
  border: 2px solid currentColor; border-right-color: transparent;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

In the Tavern implementation: add to `Login.module.css`. Guard with `prefers-reduced-motion`: when reduced motion is active, hide spinner and show text-only loading label.

---

## Responsive Behaviour

Canvas is designed at 1280px desktop (two equal 490px columns). No explicit mobile breakpoints are in `login.jsx` or `kit.css` for the login card. Recommended collapses for Ren-Dev to implement:

| Breakpoint | Behaviour |
|------------|-----------|
| ≤ 900px | Stack to single column — left visual pane moves above form, or collapses to a compact brand strip |
| ≤ 640px | Remove left visual pane entirely; show only form with brand lockup inline |

**Canvas does not define these states.** These are implementation decisions for Ren-Dev; flag if Aoi-UI should design them first.

---

## Interactions and Animations

| Element | Interaction | Animation | `prefers-reduced-motion` guard |
|---------|-------------|-----------|-------------------------------|
| `.btn:hover` | Translate Y -1px | `transform var(--dur-fast) var(--ease)` | Existing in globals.css; no extra guard needed |
| `.btn:active` | Translate Y 0 | same | Already guarded |
| `.input:focus` | Border accent + shadow ring | `transition: border-color, background, box-shadow` | Transitions only — safe |
| Submit → loading | Spinner replaces icon | `spin .8s linear infinite` | **YES** — check `useReducedMotion()`, suppress animation, show static text |
| `.aurora::before` | Gradient drift | `aurora-drift 24s ease-in-out infinite alternate` | **YES** — `@media (prefers-reduced-motion: reduce) { .aurora::before { animation: none; } }` already in globals.css |
| `<Waveform active={false}>` | Static idle bars | none (already static) | N/A — `active=false` always static |

---

## Component Map

| Canvas element | Existing Tavern component | Notes |
|----------------|--------------------------|-------|
| Aurora background | `<Aurora>` / `.aurora` class | Use `.aurora` class on page wrapper |
| Card (two-pane, pop shadow) | `<Card pop>` + inline style overrides | Pass `padding={false}`, `style={{ gridTemplateColumns: '1fr 1fr', ... }}` |
| Brand lockup | Inline — no dedicated component | Simple flex row: `<SuzuDM size={40} glow={false} />` + title/sub divs |
| `<SuzuDM size={220}>` | `<SuzuDM>` | `size={220}`, default glow |
| `<SuzuDM size={40} glow={false}>` | `<SuzuDM>` | `glow={false}` for brand lockup |
| `<Waveform bars={24} height={18} active={false}>` | `<Waveform>` | `active={false}` = standby; already guards motion |
| `.btn.btn-ghost` (Back, OAuth) | `<Button variant="ghost">` or `.btn.btn-ghost` | OAuth: add `aria-disabled`, `disabled` |
| `.btn.btn-primary.btn-lg` (submit) | `<Button variant="primary" size="lg">` | With spinner slot |
| `.input` (text/password) | `.input` global class | `<input className="input">` |
| `.label` (field labels) | `.label` global class | `<div className="label">` |
| `.mono` (footer status) | `.mono` global class | `<p className="mono">` |

---

## Canvas-vs-Implementation Deltas

| Element | Canvas | Current implementation (`src/app/login/page.tsx`) | Action |
|---------|--------|---------------------------------------------------|--------|
| Entire login UI | Fully designed two-pane card | Stub: `<h1>Login — coming soon</h1>` | Build from this spec |
| Tab toggle | Rendered | CUT | Do not implement |
| OAuth buttons | Active | Disabled / coming soon | Implement disabled state |
| 2FA TOTP step | Not designed | Not implemented | Design (Aoi-UI) → implement |

---

## Open Questions

1. **2FA step design** — Canvas has no TOTP screen. Aoi-UI must design before Ren-Dev can build.
2. **Responsive collapse** — Canvas only shows 1280px desktop. Mobile/narrow breakpoints are undefined. Decision: design first (Aoi-UI) or implement with a reasonable default collapse (Ren-Dev)?
3. **"Recovery key" link** — Where does it navigate? Password reset flow is not designed or routed in Sprint 4. Stub as `href="/recovery"` or hide?
4. **OAuth future state** — When Twitch/Discord OAuth ships, the buttons go from disabled to active. The disabled state needs to be easily reversible (feature flag or env var, not hardcoded).
5. **Session footer text** — `"session.encrypted · ed25519 · last sync 14:02"` — the "last sync" timestamp is dynamic. What is the data source? If not available at login time, omit or use a fixed string.
