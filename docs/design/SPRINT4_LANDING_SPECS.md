# Sprint 4 — Landing Page Specification

**Canvas source:** `Suzu's Tavern Design System/ui_kits/web/landing.jsx`
**Rendered at:** `http://localhost:8765/index.html` → Landing tab
**Viewport captured:** 1280 × 900 (desktop)
**Screenshots:**
- `docs/design/screenshots/landing-hero-1280.png` — hero viewport
- `docs/design/screenshots/landing-full-1280.png` — full page scroll
- `docs/design/screenshots/landing-how-1280.png` — "How it works" section
- `docs/design/screenshots/landing-what-1280.png` — "What she does" section
- `docs/design/screenshots/landing-story-footer-1280.png` — "The why" + footer
- `docs/design/screenshots/landing-footer-1280.png` — footer close-up
- `docs/design/screenshots/landing-books-modes-OUT-OF-SCOPE-1280.png` — #books + modes (reference only)
- `docs/design/screenshots/landing-pricing-OUT-OF-SCOPE-1280.png` — pricing (reference only)

---

## SPRINT 4 SCOPE LOCK — Out-of-Scope Sections

The following sections are present in the canvas but **must not be built in Sprint 4**. They appear in the screenshots for reference. Do not implement them.

| Section | Canvas ID | Reason |
|---------|-----------|--------|
| **Pricing** | `#pricing` | SaaS is PARKED. The $0 / $9 / $24 tier grid, checkout CTA, and footnote are not built. |
| **Bring your own books** | `#books` | Phase 3 post-MVP. PDF ingest + the three-source card grid + mix board callout. |
| **Two modes (player / host)** | *(no id, follows #books)* | Phase 3 post-MVP. The `.land-modes` two-column player/host panel. |
| **Hero aggregate stat row** | *(hero section)* | Fabricated metrics dropped. The three stat divs ("1,284 active campaigns / 41,902 rolls / 96% returning") are NOT built. |

The **right-side hero portrait card** (SuzuDM size=160 + narration box + waveform + mood/pace/memory chips + floating nat-20/session cards) **STAYS** — it is a product preview illustration, not a live metric claim.

The landing **header nav** must also drop the `#books` and `#pricing` nav links since those sections are not rendered. In-scope nav links: `#how` and `#what` only.

---

## Page Structure (In-Scope Only)

```
<div style="height: 100%; overflow: auto; background: var(--bg)">
  <header>  ← sticky nav
  <section class="aurora">  ← hero
  <section id="how">  ← How it works
  <!-- #books section — OUT OF SCOPE -->
  <!-- two-modes section — OUT OF SCOPE -->
  <section id="what">  ← What she does
  <section id="story">  ← Why / Suzu story
  <!-- #pricing section — OUT OF SCOPE -->
  <footer>
</div>
```

---

## Section 1: Sticky Header / Nav

**Per `landing-hero-1280.png` (top of viewport).**

### Layout

- **Tag:** `<header>`
- `position: sticky`, `top: 0`, `zIndex: 10`
- `display: flex`, `alignItems: center`, `justifyContent: space-between`
- `padding: 16px 40px`
- `backdropFilter: blur(16px)`, `-webkit-backdrop-filter: blur(16px)` — glass effect on scroll
- `background: color-mix(in oklab, var(--bg) 80%, transparent)`
- `borderBottom: 1px solid var(--line)`
- `prefers-reduced-motion:` the backdrop-filter is purely visual; no animation to guard

### Brand lockup (left)

- **Container:** `display: flex`, `alignItems: center`, `gap: 12px`
- **`<SuzuDM>`:** `size={36}`, `glow={false}`
- **Title:** `"Suzu's Tavern"` — `.display` class, `fontFamily: var(--font-display)`, `fontSize: 18px`, `lineHeight: 1`, `letterSpacing: -0.02em`
- **Sub:** `"A NekoNova table · 5e"` — `.label` class, `fontSize: 9px`, `marginTop: 2px`

### Nav links (centre)

`<nav>` with `display: flex`, `gap: 28px`, `fontSize: 14px`, `color: var(--ink-2)`.

**Sprint 4 in-scope nav links:**

| Link text | href | Notes |
|-----------|------|-------|
| How it works | `#how` | Smooth scroll |
| What she does | `#what` | Smooth scroll |

**Drop from canvas:** `"Your books"` (`#books`) and `"Pricing"` (`#pricing`) — those sections are not rendered.

### CTA buttons (right)

- `display: flex`, `gap: 8px`
- **"Browse tables"** — `.btn.btn-ghost` → `href="/lobby"` or `onClick` route to lobby
- **"Sign in"** — `.btn.btn-primary` → `href="/login"` or `onClick` route to login

---

## Section 2: Hero

**Per `landing-hero-1280.png` and `landing-full-1280.png`.**

### Outer wrapper

- `<section className="aurora">` — aurora gradient animation background
- `padding: 80px 40px 60px`
- `position: relative`
- `prefers-reduced-motion:` `.aurora::before { animation: none }` — already in globals.css

### Inner two-column grid

- **Container:** `maxWidth: 1240px`, `margin: 0 auto`
- `display: grid`, `gridTemplateColumns: 1.15fr 1fr` (renders ~601px / 523px at 1280px)
- `gap: 60px`, `alignItems: center`

### Left column — copy + CTAs

#### Status pill

- **`<Pill dot tone="accent">`** — renders with pulsing dot
- **Text:** `"Suzu is at the table · 4 tables live"`
- Geometry: `display: inline-flex`, `alignItems: center`, `gap: 6px`, `padding: 4px 10px`, `borderRadius: 999px`, `fontSize: 11px`, `fontWeight: 600`, `letterSpacing: 0.04em`, `textTransform: uppercase`
- Colors: `background: color-mix(in oklab, var(--accent) 14%, transparent)`, `color: var(--accent)`, `border: 1px solid color-mix(in oklab, var(--accent) 30%, transparent)`
- Dot: `width: 6px`, `height: 6px`, `borderRadius: 99px`, `background: currentColor`, `animation: pulse 2.4s ease-in-out infinite` — guard with `useReducedMotion`

#### H1 Heading

- **`<h1>`:** `"A dungeon master who's read the book. Twice."`
- `fontSize: clamp(40px, 5.2vw, 68px)` — canvas: `clamp(40px, 5.2vw, 68px)`, measured at 1280px: ~66.6px
- `lineHeight: 1.05`, `letterSpacing: -0.03em`
- `marginTop: 18px`, `marginBottom: 4px`
- `color: var(--ink)`, `maxWidth: 12ch`, `textWrap: balance`
- `fontFamily: var(--font-display)` (Fraunces 500)
- `"who's read the book."` span is plain; `"Twice."` is plain. The phrase `"A dungeon master"` is plain and `"who's read the book."` is followed by a line break, then `<em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>` wrapping `"who's read the book."` — correction: per JSX source, the em wraps `"who's read the book."` on the second visual line.

  Exact JSX: `A dungeon master{" "}<em style={{ color: "var(--accent)" }}>who's read the book.</em>{" "}Twice.`

#### Body paragraph

- `fontSize: 18px`, `color: var(--ink-2)`, `marginTop: 22px`, `maxWidth: 540px`, `lineHeight: 1.55`, `textWrap: pretty`
- **Text:** `"Suzu's Tavern is a 5e table run by Suzu — the NekoNova persocom in a slightly oversized DM hat. She rolls in the open, narrates in a dry voice, remembers your last session, and reads the modules you give her. Solo, with friends, or as your assistant when you DM your own table."`

#### Hero CTA buttons

- **Container:** `display: flex`, `gap: 12px`, `marginTop: 32px`
- **"Start a campaign"** — `.btn.btn-primary.btn-lg` (`height: 46px`, `padding: 0 22px`, `fontSize: 15px`) with `<Icon.D20 size={16} />` prefix
- **"Browse open tables"** — `.btn.btn-ghost.btn-lg` with `<Icon.Eye size={16} />` prefix

#### Aggregate stat row — OUT OF SCOPE (do not build)

Canvas renders three stat divs below the CTAs at `marginTop: 48px`:
- `"1,284"` / `"active campaigns"`
- `"41,902"` / `"rolls this week"`
- `"96%"` / `"players returning"`

**These are fabricated metrics. Do not implement.** The containing `display: flex`, `gap: 32px` div is dropped entirely.

### Right column — Portrait card

The portrait card is a product preview illustration (static, not live data). **Keep in full.**

#### Outer positioning wrapper

- `position: relative` — hosts two floating pill-cards (absolute positioned)

#### Portrait `<Card pop>` (main)

- **`<Card pop>`** — `.glass` + `box-shadow: var(--shadow-pop)`, `padding: 26px`

**Inner structure top-to-bottom:**

1. **Card header row:** `display: flex`, `justifyContent: space-between`, `alignItems: center`, `marginBottom: 12px`
   - Left: `<Pill dot tone="accent">` — `"live · 4 players"`
   - Right: `.mono`, `display: flex`, `gap: 6px`, `fontSize: 11px`, `color: var(--ink-3)` — `"SESSION 07 · 20:14"`

2. **`<SuzuDM>`:** `size={160}`, `talking` prop — mascot in narrating/talking state. Centred: `display: grid`, `placeItems: center`, `padding: 16px 0 10px`

3. **Narration bubble:** `padding: 14px`, `borderRadius: 14px`, `background: color-mix(in oklab, var(--accent-2) 8%, transparent)`, `border: 1px solid var(--line)`
   - **Kicker:** `"SUZU · NARRATING"` — `.label`, `fontSize: 9px`, `marginBottom: 6px`
   - **Quote:** `'"The tavern door creaks. Inside: low light, the smell of clove smoke, a barkeep who pretends not to see you."'` — `fontFamily: var(--font-display)`, `fontStyle: italic`, `fontSize: 14px`, `color: var(--ink-2)`, `lineHeight: 1.5`
   - **`<Waveform>`:** `bars={42}`, `height={24}`, `active` (default true — animated), `marginTop: 10px`. Guard with `useReducedMotion` → `active={false}` when reduced motion.

4. **Mood/pace/memory chips grid:** `display: grid`, `gridTemplateColumns: 1fr 1fr 1fr`, `gap: 8px`, `marginTop: 12px`
   - Three cells: `padding: 10px`, `borderRadius: 10px`, `background: color-mix(in oklab, var(--ink) 4%, transparent)`
   - Each: `.label` key at `fontSize: 9px` + value at `fontSize: 12px`, `marginTop: 4px`, `fontWeight: 500`
   - Values: `["mood","investigative"]`, `["pace","slow"]`, `["memory","7 sessions"]`

#### Floating pill-cards (absolute)

Two small `<Card>` (no `pop`) positioned absolutely:

1. **Top-right chip:** `position: absolute`, `top: -10px`, `right: -14px`
   - `<Card>` — `padding: 8px 12px`, `borderRadius: 99px` (pill-shaped card), `fontSize: 12px`, `display: flex`, `gap: 8px`, `alignItems: center`
   - Content: `<Icon.D20 size={14} style={{ color: "var(--crit)" }} />` + `"nat-20 · 4 minutes ago"`

2. **Bottom-left chip:** `position: absolute`, `bottom: 30px`, `left: -24px`
   - Same card shape as above
   - Content: `<Icon.Scroll size={14} style={{ color: "var(--accent-2)" }} />` + `"session resumed"`

---

## Section 3: How It Works (`#how`)

**Per `landing-how-1280.png`.**

- **`<section id="how">`**, `padding: 60px 40px`
- Inner: `maxWidth: 1240px`, `margin: 0 auto`

### SectionHead

- **`<SectionHead>`:**
  - `kicker="How it works"` — `.label` class, `marginBottom: 8px`
  - `title="Three rolls and you're in."` — `<h2>`, `fontSize: 28px` (shared.jsx hardcode), `fontFamily: var(--font-display)`, `fontWeight: 500`, `letterSpacing: -0.02em`
  - `sub="Sign in, find a story, roll a character. Suzu does the rest — or assists, if you'd rather DM."` — `fontSize: 13px`, `color: var(--ink-3)`, `marginTop: 6px`
  - Layout: `display: flex`, `alignItems: flex-end`, `justifyContent: space-between`, `gap: 16px`, `marginBottom: 18px`

### Three-card grid

- `display: grid`, `gridTemplateColumns: repeat(3, 1fr)` (three equal columns ~384px each at 1240px inner), `gap: 16px`
- Each card: **`<Card className="lift">`** — `.glass.lift` — default padding (`var(--density-pad)` = 22px cozy density)

**Per-card anatomy (common pattern):**

- **Icon box:** `width: 44px`, `height: 44px`, `borderRadius: 12px`, `display: grid`, `placeItems: center`, `background: color-mix(in oklab, var(--accent) 12%, transparent)`, `color: var(--accent)`
- **`<h3>`:** `fontSize: 19px`, `marginTop: 14px` — overrides globals h3 (20px)
- **`<p>`:** `color: var(--ink-2)`, `fontSize: 14px`, `marginTop: 6px`, `lineHeight: 1.55`, `textWrap: pretty`

**Three cards:**

| # | Icon | Title | Body |
|---|------|-------|------|
| 1 | `<Icon.Spellbook size={20} />` | `"1 — Pick a story"` | `"An SRD one-shot, a Suzu-curated arc, or your own PDF you drop in. The mix board lets you build a campaign out of chapters from several modules at once."` |
| 2 | `<Icon.Sparkle size={20} />` | `"2 — Roll a character"` | `"Race, class, background, six abilities. Five steps with Suzu reading over your shoulder. Or import a sheet you already have, PDF or JSON."` |
| 3 | `<Icon.D20 size={20} />` | `"3 — Play"` | `"Real-time chat, dice in the corner, a 9-action combat rail, and a session log Suzu writes as she goes. Open the codex with ⌘K."` |

### `.lift` hover interaction

```css
.lift { transition: transform .2s var(--ease), box-shadow .2s var(--ease); }
.lift:hover { transform: translateY(-2px); box-shadow: var(--shadow-pop); }
```

`prefers-reduced-motion` guard: **YES** — add to page-scoped CSS module:

```css
@media (prefers-reduced-motion: reduce) {
  .lift { transition: none; }
  .lift:hover { transform: none; }
}
```

---

## Section 4: Bring Your Own Books (`#books`) — OUT OF SCOPE

**Do not build.** Canvas renders: three source cards (SRD / Suzu / You) in `.land-books-grid` + `.land-mix` callout banner. All Phase 3.

Screenshots for reference: `landing-books-modes-OUT-OF-SCOPE-1280.png`.

---

## Section 5: Two Modes (Player / Host) — OUT OF SCOPE

**Do not build.** Canvas renders `.land-modes` two-column grid with player and host cards. Phase 3.

Screenshots for reference: `landing-books-modes-OUT-OF-SCOPE-1280.png`.

---

## Section 6: What She Does / Capabilities (`#what`)

**Per `landing-what-1280.png`.**

- **`<section id="what">`**, `padding: 20px 40px 60px`
- Inner: `maxWidth: 1240px`, `margin: 0 auto`

### SectionHead

- **`<SectionHead>`:**
  - `kicker="What she does"`
  - `title="A patient narrator. A pedantic rules lawyer. A friend."`
  - No `sub` prop
  - Same geometry as the How section SectionHead

### Six-card grid

- `display: grid`, `gridTemplateColumns: repeat(3, 1fr)` (~384px each), `gap: 16px`
- Each card: **`<Card className="lift">`**

**Per-card anatomy — note icon colour differs from How section:**

- **Icon box:** `width: 40px`, `height: 40px`, `borderRadius: 10px`, `display: grid`, `placeItems: center`, `background: color-mix(in oklab, var(--accent-2) 12%, transparent)`, `color: var(--accent-2)` ← secondary accent (lavender), not primary
- **`<h3>`:** `fontSize: 18px`, `marginTop: 12px`
- **`<p>`:** `color: var(--ink-2)`, `fontSize: 13px`, `marginTop: 6px`, `lineHeight: 1.55`, `textWrap: pretty`

**Six cards:**

| # | Icon | Title | Body |
|---|------|-------|------|
| 1 | `<Icon.Lantern size={20} />` | `"Living memory"` | `"Suzu remembers names, debts, half-promises, and the goblin you spared in session 3. There's a journal she writes between weeks."` |
| 2 | `<Icon.Scroll size={20} />` | `"A codex you can ask"` | `"All of 5e plus your homebrew, searchable from anywhere with ⌘K. 'misty step' finds the spell, 'velka' finds your rogue."` |
| 3 | `<Icon.Skull size={20} />` | `"Encounter math, live"` | `"Drop monsters in, see CR vs. party budget update as you go. Suzu reads each encounter back to you before you run it."` |
| 4 | `<Icon.D20 size={20} />` | `"Transparent rolls"` | `"Every roll is logged with the modifier breakdown. Hidden DCs stay hidden until the table earns them."` |
| 5 | `<Icon.Sparkle size={20} />` | `"Four palettes, one product"` | `"Dusk tavern, candlelit, aetheric, moonlit grove. Pick the flavor of evening — the whole table changes with you."` |
| 6 | `<Icon.Shield size={20} />` | `"Safety tools, on by default"` | `"X-card, lines and veils, an honest 'rewind' button. Listed in settings, available mid-scene, never optional."` |

---

## Section 7: Why / Suzu Story (`#story`)

**Per `landing-story-footer-1280.png`.**

- **`<section id="story">`**, `padding: 20px 40px 60px`
- Inner: `maxWidth: 920px`, `margin: 0 auto`, `textAlign: center`

### Kicker

- `.label` class, `marginBottom: 14px`
- **Text:** `"The why"`

### H2 Heading

- `<h2>` — `fontSize: clamp(34px, 4vw, 52px)` (measured at 1280px: 51.2px), `lineHeight: 1.1`, `letterSpacing: -0.02em`
- **Text:** `'"I'd love to play, but I can't find a DM."'` (quoted, line break) then `<em style={{ color: 'var(--accent)' }}>— everyone, all the time</em>`
- `fontFamily: var(--font-display)` (inherited from globals h2)

### Body paragraph

- `marginTop: 24px`, `fontSize: 17px`, `color: var(--ink-2)`, `lineHeight: 1.7`, `textWrap: pretty`
- **Text:** `"Suzu was built because the hardest part of D&D is getting six people in a room. She isn't here to replace your friend who keeps the binder of notes — she's here for when your friend has a baby, or moves to Berlin, or both. She rolls in the open. She listens. She brings the kettle."`

### CTA buttons

- **Container:** `display: flex`, `justifyContent: center`, `gap: 12px`, `marginTop: 36px`
- **"Roll a character"** — `.btn.btn-primary` (standard height 38px, padding 0 16px, fontSize 14px)
- **"Watch a table"** — `.btn.btn-ghost`

---

## Section 8: Pricing (`#pricing`) — OUT OF SCOPE

**Do not build.** Canvas renders three pricing cards (Free / Tavern / Lighthouse) in `.land-price-grid`. SaaS is PARKED.

Screenshots for reference: `landing-pricing-OUT-OF-SCOPE-1280.png`.

---

## Section 9: Footer

**Per `landing-footer-1280.png`.**

- **`<footer>`**, `padding: 30px 40px`, `borderTop: 1px solid var(--line)` (the computed value showed no border — verify in live browser: the canvas JSX sets it explicitly, globals may override)
- `display: flex`, `justifyContent: space-between`, `color: var(--ink-3)`, `fontSize: 12px`

### Left

- `"© 2026 Suzu's Tavern — a NekoNova product."`

### Right

- `.mono` class — `"build.4f1c · main · uptime 14d 02h"` (static string in canvas; in build, derive from env vars or use a static build tag)

---

## Kit.css Classes to Port

The following classes are used in `landing.jsx` but are NOT in `SuzusTavern/src/app/globals.css`. They must be ported into a page-scoped CSS Module (`Landing.module.css`) using `var()` token references. **Exact rules from kit.css lines 406–4215:**

### `.lift`

```css
.lift {
  transition: transform .2s var(--ease), box-shadow .2s var(--ease);
}
.lift:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-pop);
}
/* Add to Landing.module.css for reduced-motion guard: */
@media (prefers-reduced-motion: reduce) {
  .lift { transition: none; }
  .lift:hover { transform: none; }
}
```

**Used on:** Every `<Card className="lift">` in How section and What section.

### `.chip` (within `.land-book`)

Canvas uses `.chip` inside `.land-book` cards (out of scope), but the chip pattern is also relevant for any inline tag labels:

```css
/* from .land-book .chip: */
.chip {
  display: inline-flex;
  width: max-content;
  padding: 4px 10px;
  border-radius: 99px;
  background: color-mix(in oklab, var(--tone) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--tone) 36%, var(--line));
  color: var(--tone);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 600;
}
```

**Note:** Requires a `--tone` CSS custom property on the parent. Used in `.land-book` cards (out of scope for Sprint 4). Port if needed for in-scope content — not currently referenced by any in-scope section.

### `.land-books-grid` — OUT OF SCOPE (reference only)

```css
.land-books-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
@media (max-width: 900px) {
  .land-books-grid { grid-template-columns: 1fr; }
}
```

### `.land-book` — OUT OF SCOPE (reference only)

```css
.land-book {
  display: flex !important;
  flex-direction: column;
  gap: 10px;
  padding: 20px 22px !important;
  --tone: var(--accent);
  border-color: color-mix(in oklab, var(--tone) 18%, var(--line)) !important;
}
.land-book:hover {
  border-color: color-mix(in oklab, var(--tone) 40%, var(--line)) !important;
}
/* .land-book h3, p, .stats — see kit.css lines 4024–4041 */
```

### `.land-mix` — OUT OF SCOPE (reference only)

```css
.land-mix {
  margin-top: 18px;
  padding: 22px 26px;
  display: grid;
  grid-template-columns: 60px 1fr auto;
  gap: 22px;
  align-items: center;
  background: linear-gradient(90deg,
    color-mix(in oklab, var(--cool) 8%, transparent),
    color-mix(in oklab, var(--accent-2) 8%, transparent),
    color-mix(in oklab, var(--warm) 8%, transparent));
  border: 1px dashed color-mix(in oklab, var(--accent) 36%, var(--line));
  border-radius: 18px;
}
.mix-mark {
  width: 60px; height: 60px; border-radius: 18px;
  display: grid; place-items: center;
  background: color-mix(in oklab, var(--accent) 10%, transparent);
  color: var(--accent);
  font-family: var(--font-display);
  font-style: italic;
  font-size: 38px; line-height: 1;
}
/* .mix-bd h4 and p — standard display/body styles */
@media (max-width: 900px) {
  .land-mix { grid-template-columns: auto 1fr; }
  .land-mix .btn { grid-column: 1 / -1; }
}
```

### `.land-modes` — OUT OF SCOPE (reference only)

```css
.land-modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.land-mode {
  padding: 26px 28px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 18px;
  backdrop-filter: blur(20px) saturate(140%);
  box-shadow: var(--shadow-soft);
  display: flex; flex-direction: column; gap: 12px;
}
.land-mode.host {
  border-color: color-mix(in oklab, var(--accent-2) 30%, var(--line));
  background: color-mix(in oklab, var(--accent-2) 5%, var(--card));
}
@media (max-width: 900px) {
  .land-modes { grid-template-columns: 1fr; }
}
```

### `.badge` (within `.land-mode`) — OUT OF SCOPE (reference only)

```css
.badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 99px;
  background: color-mix(in oklab, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--accent) 32%, var(--line));
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600;
  width: max-content;
}
.land-mode.host .badge {
  background: color-mix(in oklab, var(--accent-2) 14%, transparent);
  border-color: color-mix(in oklab, var(--accent-2) 32%, var(--line));
  color: var(--accent-2);
}
```

### `.land-price-grid`, `.land-price`, `.land-price .ribbon`, `.land-price.featured`, `.land-price-foot` — OUT OF SCOPE (reference only)

See kit.css lines 4143–4206. Not ported to Sprint 4 build.

---

## In-Scope CSS Port Summary for `Landing.module.css`

Only `.lift` is required for in-scope Sprint 4 sections:

```css
/* Landing.module.css */

/* Hover-lift for How and What cards */
.lift {
  transition: transform .2s var(--ease), box-shadow .2s var(--ease);
}
.lift:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-pop);
}

@media (prefers-reduced-motion: reduce) {
  .lift {
    transition: none;
  }
  .lift:hover {
    transform: none;
  }
}
```

All other per-section layout is inline style or uses existing globals (`.glass`, `.btn`, `.pill`, `.label`, `.mono`, `.aurora`). The three-column card grids can be inline-style or a helper class in this module.

---

## Component Map

| Canvas element | Existing Tavern component | Notes |
|----------------|--------------------------|-------|
| `.aurora` background (hero) | `.aurora` global class | Apply to `<section>` |
| `<SuzuDM size={36} glow={false}>` | `<SuzuDM>` | Brand lockup, nav |
| `<SuzuDM size={160} talking>` | `<SuzuDM>` | Portrait card. Verify `talking` prop exists |
| `<Pill dot tone="accent">` | `<Pill>` | Hero status, portrait card header |
| `<Card pop>` | `<Card pop>` | Portrait card |
| `<Card className="lift">` | `<Card>` + `styles.lift` | How + What section cards |
| `<Card>` (plain, floating chips) | `<Card>` | Floating nat-20/session chips |
| `<Waveform bars={42} height={24}>` | `<Waveform>` | Active by default; guard with `useReducedMotion` |
| `<SectionHead kicker title sub>` | `<SectionHead>` | How + What sections |
| `.btn.btn-primary.btn-lg` | `<Button variant="primary" size="lg">` or `.btn.btn-primary.btn-lg` | Hero CTAs |
| `.btn.btn-ghost.btn-lg` | `<Button variant="ghost" size="lg">` or `.btn.btn-ghost.btn-lg` | Hero CTAs |
| `.btn.btn-primary` (nav, story) | `<Button variant="primary">` | Standard height |
| `.btn.btn-ghost` (nav, story) | `<Button variant="ghost">` | Standard height |
| `<Icon.D20>`, `<Icon.Eye>`, etc. | `<Icon.D20>`, etc. | From `src/components/Icon.tsx` |
| `<footer>` | No component — inline | Simple flex row |

---

## Responsive Breakpoints

Canvas is designed at 1280px. The landing `landing.jsx` has no inline breakpoints. Kit.css defines one breakpoint at `max-width: 900px` for the out-of-scope sections. For in-scope sections, Ren-Dev must implement:

| Breakpoint | Section | Behaviour |
|------------|---------|-----------|
| ≤ 1024px | Hero two-column grid | Stack to single column; right portrait card below left copy |
| ≤ 900px | Header nav | Collapse nav links to hamburger or drop them; keep brand + CTAs |
| ≤ 900px | How section 3-col | `grid-template-columns: 1fr` (or 2-col to 1-col) |
| ≤ 900px | What section 3-col | same |
| ≤ 640px | Hero portrait card | Remove floating absolute-positioned chips (they overlap at narrow widths) |

**Canvas does not define these.** Ren-Dev may implement reasonable defaults, or flag for Aoi-UI if pixel-exact mobile design is required.

---

## Interactions and Animations

| Element | Interaction | Animation | `prefers-reduced-motion` guard |
|---------|-------------|-----------|-------------------------------|
| `.aurora::before` (hero) | Gradient drift bg | `aurora-drift 24s infinite alternate` | **YES** — already in globals.css |
| `.pill .dot` | Pulse opacity | `pulse 2.4s infinite` | **YES** — `Pill` component uses `useReducedMotion` |
| `.btn:hover` | Y -1px lift | `transform var(--dur-fast)` | No motion guard needed (sub-4px) |
| `.lift:hover` | Y -2px lift + shadow-pop | `transform + box-shadow .2s` | **YES** — add `@media (prefers-reduced-motion: reduce)` in Landing.module.css |
| `<Waveform active>` (portrait) | rAF bar animation | `requestAnimationFrame` | **YES** — `Waveform` uses `useReducedMotion`; passes `active={false}` when reduced |
| Sticky header | backdrop-filter on scroll | CSS backdrop-filter (no JS) | Not motion; no guard needed |

---

## Canvas-vs-Implementation Deltas

| Element | Canvas | Current implementation (`src/app/page.tsx`) | Action |
|---------|--------|---------------------------------------------|--------|
| Entire landing page | Fully designed | Stub: `<h1>Landing — coming soon</h1>` | Build from this spec |
| Header nav | 4 links | Only `#how` and `#what` in Sprint 4 | Drop `#books` and `#pricing` links |
| Hero stat row | 3 fabricated metric divs | — | Do not implement |
| #books section | Fully designed | — | OUT OF SCOPE — Phase 3 |
| Two modes section | Fully designed | — | OUT OF SCOPE — Phase 3 |
| #what section | 6 capability cards | — | Build |
| #story section | Fully designed | — | Build |
| #pricing section | Fully designed | — | OUT OF SCOPE — SaaS PARKED |
| Footer | Static copy | — | Build (static) |

---

## Open Questions

1. **`SuzuDM talking` prop** — does the existing `SuzuDM` component support a `talking` prop? Per `landing.jsx` it passes `talking` to the portrait card mascot. If not implemented, use `active` or a `talking` boolean that cycles the mouth animation.
2. **Hero portrait card — static vs. live data** — the card renders `SESSION 07 · 20:14`, `mood: investigative`, `pace: slow`, `memory: 7 sessions`. Is this static placeholder copy, or should it reflect a real live session from the API? Canvas suggests a real-looking product preview. Recommendation: keep as static/demo copy for Sprint 4 since the lobby/session APIs are not Sprint 4 scope.
3. **Waveform `active` in portrait** — the canvas renders `<Waveform bars={42} height={24} />` with no `active` prop, which defaults to `true` (animated). This means the portrait card waveform animates on the landing page. Is this intentional? If yes, the landing page becomes a client component or the waveform must be lazy-loaded. Decision needed.
4. **Responsive mobile design** — canvas defines desktop (1280px) only. Does Aoi-UI need to design mobile breakpoints before Ren-Dev implements, or should Ren-Dev implement reasonable defaults?
5. **Nav `#books` / `#pricing` links** — the canvas header nav shows 4 links including the out-of-scope sections. Sprint 4 landing drops those sections. The nav must be trimmed to `#how` and `#what` only. Confirm.
6. **Footer build tag** — `"build.4f1c · main · uptime 14d 02h"` is a static string in the canvas. What replaces it in production? Options: inject `NEXT_PUBLIC_BUILD_TAG` at build time, or use a fixed string until deployment infrastructure supports it.
