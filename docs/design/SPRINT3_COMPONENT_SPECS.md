# Suzu's Tavern — Sprint 3 Shared Component Specs

Extracted by Hoshi-DX, 2026-06-15.

Sources used:
- Rendered via browser MCP (HTTP server on port 8765, `http://localhost:8765/preview/*.html`)
- Source read directly from `Suzu's Tavern Design System/ui_kits/web/shared.jsx`, `icons.jsx`, `mascot.jsx`
- Token reference: `Suzu's Tavern Design System/colors_and_type.css` (= `SuzusTavern/src/app/globals.css`, confirmed identical)

All components in `SuzusTavern/src/components/` are **stubs** — each file returns `<div data-component="..." />` with an empty props interface. Every component needs full implementation.

---

## Screenshots

| Filename | Source |
|----------|--------|
| `screenshots/button-variants.png` | `preview/buttons.html` — rendered |
| `screenshots/card-variants.png` | `preview/card-spec.html` — rendered |
| `screenshots/die-states.png` | `preview/dice-roll-showcase.html` — rendered |
| `screenshots/icons-core.png` | `preview/icons-core.html` — rendered |
| `screenshots/icons-fantasy.png` | `preview/icons-fantasy.html` — rendered |
| `screenshots/icons-classes.png` | `preview/icons-classes.html` — rendered |
| `screenshots/aurora-background.png` | `preview/aurora-background.html` — rendered |
| `screenshots/suzudm-mascot.png` | `preview/mascot.html` — rendered |
| `screenshots/pill-tones.png` | `preview/pills-and-chips.html` — rendered |
| `screenshots/character-card.png` | `preview/character-card.html` — rendered |
| `screenshots/kit-home-full.png` | `ui_kits/web/index.html` Home screen — rendered |
| `screenshots/kit-play-waveform-die.png` | `ui_kits/web/index.html` Play screen — rendered |

Components **not rendered** (no dedicated preview page that isolates them): `SectionHead`, `Stat`, `Avatar`, `Waveform` individually. These were extracted from source (`shared.jsx`) and from the kit composite screens (`kit-home-full.png`, `kit-play-waveform-die.png`).

---

## Token Reference (design system → `globals.css`)

Both files are confirmed identical. All token names below are the same in both.

### Palette tokens (vary by `data-vibe`)

| Token | dusk-tavern (default) | candlelit (light) | aetheric (dark) | moonlit-grove (dark) |
|-------|-----------------------|-------------------|-----------------|----------------------|
| `--bg` | `#15101e` | `#f5eee2` | `#0c0f1e` | `#0f1614` |
| `--bg-2` | `#1c1530` | `#ebe1cf` | `#131830` | `#161f1c` |
| `--bg-3` | `#221a3a` | `#e0d4be` | `#1a2244` | `#1d2825` |
| `--card` | `rgba(255,255,255,0.04)` | `rgba(255,253,247,0.72)` | `rgba(255,255,255,0.04)` | `rgba(255,255,255,0.04)` |
| `--ink` | `#f5eef0` | `#2a1e16` | `#e8ecff` | `#ecf2ec` |
| `--ink-2` | `#c8bfd0` | `#5a4636` | `#b8bfdc` | `#bccbc0` |
| `--ink-3` | `#8b8298` | `#6e5c4a` (design src) / `#8a7866` (globals.css) | `#7a82a8` | `#7d9286` |
| `--line` | `rgba(255,255,255,0.08)` | `rgba(42,30,22,0.10)` | `rgba(120,160,255,0.10)` | `rgba(200,232,210,0.10)` |
| `--accent` | `#f08bb6` (dusk rose) | `#b5462a` (ember red) | `#7ee8e2` (arcane teal) | `#9cd6a8` (moss-silver) |
| `--accent-2` | `#b39ef0` (lavender) | `#6b4a2a` (burnt umber) | `#c4a3ff` (amethyst) | `#c8b6e6` (lavender mist) |
| `--accent-3` | `#f4c8d9` (petal) | `#e8c898` (candle) | `#6bb6ff` (spell-blue) | `#e2dac0` (moonlight) |
| `--warm` | `#f5cba8` | `#d4a64b` | `#ffc792` | `#e8c89a` |
| `--cool` | `#a7c5ec` | `#6b8aaa` | `#7ee8e2` | `#9cc8e0` |
| `--good` | `#6db48a` | `#5a8a5e` | `#6dd49a` | `#88c890` |
| `--bad` | `#c25353` | `#a83a3a` | `#ff7a8a` | `#d07a7a` |
| `--warn` | `#d4a64b` | `#b88a2a` | `#e8c44a` | `#d4b870` |
| `--crit` | `#ffd76a` | `#c9882a` | `#ffe27a` | `#f0d896` |
| `--fumble` | `#c25353` | `#a83a3a` | `#ff7a8a` | `#d07a7a` |

**Note on `--ink-3` discrepancy:** design system `colors_and_type.css` has `#6e5c4a` for candlelit; `globals.css` has `#8a7866`. The globals.css value is the one Ren-Dev builds against — flag to Hikari-PO if lightness matters.

### Structural tokens (palette-invariant)

| Token | Value |
|-------|-------|
| `--radius-sm` | `12px` |
| `--radius` | `18px` |
| `--radius-lg` | `28px` |
| `--radius-pill` | `999px` |
| `--shadow-soft` | `0 1px 0 rgba(255,255,255,.06) inset, 0 8px 24px -12px rgba(0,0,0,.45), 0 2px 6px -2px rgba(0,0,0,.20)` |
| `--shadow-pop` | `0 1px 0 rgba(255,255,255,.08) inset, 0 24px 60px -24px rgba(179,158,240,.40), 0 8px 20px -8px rgba(240,139,182,.22)` |
| `--font-display` | `'Fraunces', ui-serif, Georgia, 'Times New Roman', serif` |
| `--font-ui` | `'Inter', ui-sans-serif, system-ui, …, sans-serif` |
| `--font-mono` | `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |
| `--density-pad` | `22px` (cozy default); `14px` compact; `30px` airy |
| `--density-gap` | `16px` (cozy default); `10px` compact; `24px` airy |
| `--ease` | `cubic-bezier(.2, .8, .2, 1)` |
| `--ease-soft` | `cubic-bezier(.4, 0, .2, 1)` |
| `--dur-fast` | `150ms` |
| `--dur` | `220ms` |
| `--dur-slow` | `400ms` |

`candlelit` overrides `--shadow-soft` / `--shadow-pop` with light-palette values.

---

## Component Specifications

### 1. Button

**Screenshot:** `screenshots/button-variants.png` (rendered, `preview/buttons.html`)

#### Anatomy
A `<button>` element with class `.btn` plus one modifier class.

#### Base `.btn` (ghost / default)

| Property | Value |
|----------|-------|
| Display | `inline-flex`, `align-items: center`, `justify-content: center`, `gap: 8px` |
| Height | `38px` |
| Padding | `0 16px` |
| Border-radius | `var(--radius-pill)` → `999px` |
| Border | `1px solid var(--line)` |
| Background | `transparent` |
| Color | `var(--ink)` |
| Font | `var(--font-ui)`, `14px`, weight `500` |
| White-space | `nowrap` |
| Cursor | `pointer` |
| Transition | `transform 150ms var(--ease), box-shadow 220ms var(--ease), background 220ms var(--ease), border-color 220ms var(--ease)` |

#### Variant modifier classes

| Class | Description | Background | Color | Border | Box-shadow |
|-------|-------------|------------|-------|--------|------------|
| `.btn-primary` | Gradient fill | `linear-gradient(135deg, var(--accent), var(--accent-2))` | `#fff` | `transparent` | `0 8px 24px -10px color-mix(in oklab, var(--accent) 60%, transparent)` |
| `.btn-ghost` | Transparent with hover fill | `transparent` | `var(--ink)` | `1px solid var(--line)` | none |
| `.btn-danger` (preview-only, not in globals.css) | Semantic danger | `color-mix(in oklab, var(--bad) 16%, transparent)` | `var(--bad)` | `color-mix(in oklab, var(--bad) 30%, transparent)` | none |
| `.btn-crit` (preview-only, not in globals.css) | Nat-20 celebration | `linear-gradient(135deg, var(--crit), var(--warm))` | `#2a1e16` | `transparent` | none |

**Note:** `.btn-danger` and `.btn-crit` appear in the preview's `<style>` block only. They are not in `globals.css`. Aoi-UI should decide whether to add them to globals.css or keep them as component-local styles.

#### Size modifiers

| Class | Height | Padding | Font-size |
|-------|--------|---------|-----------|
| default | `38px` | `0 16px` | `14px` |
| `.btn-lg` | `46px` | `0 22px` | `15px` |
| `.btn-icon` | `38px` (square) | `0` | inherits; `width: 38px` set |

#### States

| State | Visual change |
|-------|--------------|
| `:hover` | `transform: translateY(-1px)` |
| `.btn-primary:hover` | box-shadow escalates to `0 12px 30px -8px color-mix(in oklab, var(--accent) 70%, transparent)` |
| `.btn-ghost:hover` | `background: color-mix(in oklab, var(--ink) 6%, transparent)` |
| `:active` | `transform: translateY(0)` |
| `disabled` | `opacity: 0.45; cursor: not-allowed` — per preview; no explicit CSS rule in globals.css (applied inline in preview) |
| `:focus-visible` | `outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px` (from globals.css base rule) |

#### Props (inferred from source + preview)

```ts
interface ButtonProps {
  variant?: 'primary' | 'ghost' | 'danger' | 'crit';
  size?: 'default' | 'lg' | 'icon';
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}
```

#### With icon
The preview shows a leading SVG inside `.btn-primary.btn-lg` (D20 icon, 16×16). Icon is sibling of text content — the `gap: 8px` on `.btn` handles spacing. No separate prop needed; pass icon as a child.

---

### 2. Card

**Screenshot:** `screenshots/card-variants.png` (rendered, `preview/card-spec.html`)

#### Anatomy
A `<div>` with class `.glass` plus optional inline style overrides.

#### Base `.glass`

| Property | Value |
|----------|-------|
| Background | `var(--card)` |
| Border | `1px solid var(--line)` |
| Border-radius | `var(--radius)` → `18px` |
| Box-shadow | `var(--shadow-soft)` (default) |
| Backdrop-filter | `blur(20px) saturate(140%)` |
| `-webkit-backdrop-filter` | `blur(20px) saturate(140%)` |

#### Variants

| Prop | CSS effect |
|------|-----------|
| `padding={true}` (default) | `padding: var(--density-pad)` → `22px` cozy |
| `padding={false}` | `padding: 0` — content fills edge-to-edge |
| `pop={false}` (default) | `box-shadow: var(--shadow-soft)` |
| `pop={true}` | `box-shadow: var(--shadow-pop)` — lavender/rose lift; used for hero cards, modals, login |

Per `screenshots/card-variants.png`: left card = default shadow, right card = `--shadow-pop` showing the elevated glow.

#### Props (inferred from `shared.jsx`)

```ts
interface CardProps {
  padding?: boolean;         // default true
  pop?: boolean;             // default false
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}
```

---

### 3. Pill

**Screenshot:** `screenshots/pill-tones.png` (rendered, `preview/pills-and-chips.html`)

#### Anatomy
An `<span>` (inline-flex). Two modes: CSS class-based (`.pill` + tone modifier) and React component (`Pill` from shared.jsx using inline styles). The canvas uses both. The globals.css `.pill` class provides only the `accent` tone. Other tones are applied via component inline styles or the preview's per-tone CSS classes.

#### Base geometry (both modes)

| Property | Value |
|----------|-------|
| Display | `inline-flex`, `align-items: center`, `gap: 6px` |
| Padding | `4px 10px` |
| Border-radius | `var(--radius-pill)` → `999px` |
| Font-size | `11px` |
| Font-weight | `600` |
| Letter-spacing | `0.04em` |
| Text-transform | `uppercase` |
| Border | `1px solid <tone-border>` |

#### 9-tone colour matrix (from `shared.jsx` toneMap)

| Tone | Background | Foreground | Border |
|------|-----------|------------|--------|
| `accent` | `color-mix(in oklab, var(--accent) 14%, transparent)` | `var(--accent)` | `color-mix(in oklab, var(--accent) 30%, transparent)` |
| `good` | `color-mix(in oklab, var(--good) 16%, transparent)` | `var(--good)` | `color-mix(in oklab, var(--good) 30%, transparent)` |
| `warn` | `color-mix(in oklab, var(--warn) 16%, transparent)` | `var(--warn)` | `color-mix(in oklab, var(--warn) 30%, transparent)` |
| `bad` | `color-mix(in oklab, var(--bad) 16%, transparent)` | `var(--bad)` | `color-mix(in oklab, var(--bad) 30%, transparent)` |
| `cool` | `color-mix(in oklab, var(--cool) 14%, transparent)` | `var(--cool)` | `color-mix(in oklab, var(--cool) 30%, transparent)` |
| `warm` | `color-mix(in oklab, var(--warm) 14%, transparent)` | `var(--warm)` | `color-mix(in oklab, var(--warm) 30%, transparent)` |
| `crit` | `color-mix(in oklab, var(--crit) 18%, transparent)` | `var(--crit)` | `color-mix(in oklab, var(--crit) 36%, transparent)` |
| `muted` | `color-mix(in oklab, var(--ink) 6%, transparent)` | `var(--ink-3)` | `var(--line)` |
| `lav` | `color-mix(in oklab, var(--accent-2) 14%, transparent)` | `var(--accent-2)` | `color-mix(in oklab, var(--accent-2) 30%, transparent)` |

Note: `accent` bg uses 14% mixing; `good`/`warn`/`bad`/`cool`/`warm` use 16%; `crit` uses 18%; `lav` uses 14%. The preview pills-and-chips.html shows accent (default/live), good (online), warn (seeking), bad (full/waitlist), cool (homebrew), warm (5e·phb), lav (level range).

#### Dot indicator (`dot={true}`)

A `<span>` child inserted before `{children}`:
- `width: 6px; height: 6px; border-radius: 99px; background: currentColor`
- `box-shadow: 0 0 0 3px color-mix(in oklab, currentColor 25%, transparent)`
- Animation in globals.css: `@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }` at `2.4s ease-in-out infinite`

**Animation flag:** requires `prefers-reduced-motion` guard — omit the `animation` property when `@media (prefers-reduced-motion: reduce)`.

#### Props (inferred from `shared.jsx`)

```ts
type PillTone = 'accent' | 'good' | 'warn' | 'bad' | 'cool' | 'warm' | 'crit' | 'muted' | 'lav';

interface PillProps {
  tone?: PillTone;     // default 'accent'
  dot?: boolean;        // default false — shows pulsing dot
  children: React.ReactNode;
}
```

#### Filter Chip (per `pills-and-chips.html`)
The canvas also shows a "filter chip" pattern (`.chip`) which is distinct from `.pill`. This is not in the Sprint-3 component scope but is noted here for Aoi-UI:
- Padding: `6px 12px`; border-radius: `999px`; `font-size: 12px`; `font-weight: 500`
- Default: `background: color-mix(in oklab, var(--ink) 4%, transparent); border: 1px solid var(--line); color: var(--ink-2)`
- Active: `background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; border-color: transparent`

---

### 4. Icon

**Screenshots:** `screenshots/icons-core.png`, `screenshots/icons-fantasy.png`, `screenshots/icons-classes.png` (all rendered)

#### Rendering primitive (`KIc`)

```
<svg width={size} height={size} viewBox="0 0 24 24"
     fill={fill}           // default "none"
     stroke="currentColor"
     strokeWidth={sw}      // default 1.7
     strokeLinecap="round"
     strokeLinejoin="round"
     style={{ flexShrink: 0, display: "block", ...style }}
>
```

- Default `size`: `18` (prop on `KIc`); preview pages render at `22px` (core/fantasy), `28px` (fantasy grid), `32px` (classes)
- All icons are **stroke-based, `currentColor`**, no hardcoded fills except where noted
- `viewBox`: `"0 0 24 24"` for all icons (uniform)

#### Complete icon inventory

**Core / NekoNova icons** (per `icons.jsx` and `icons-core.html`)

| Name | Paths / elements | Notes |
|------|-----------------|-------|
| `Home` | `<path d="M3 11l9-8 9 8"/>` + `<path d="M5 9v12h14V9"/>` | |
| `Compass` | `<circle cx="12" cy="12" r="9"/>` + `<path d="m15 9-2 5-5 2 2-5Z" fill="currentColor" stroke="none"/>` | Mixed fill+stroke: compass needle is fill |
| `Search` | `<circle cx="11" cy="11" r="7"/>` + `<path d="m21 21-4.3-4.3"/>` | |
| `Bell` | `<path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z"/>` + `<path d="M10 21a2 2 0 0 0 4 0"/>` | |
| `Settings` | `<circle cx="12" cy="12" r="3"/>` + long gear-tooth path | |
| `Send` | `<path d="M22 2 11 13"/>` + `<path d="M22 2 15 22l-4-9-9-4 20-7Z"/>` | |
| `Power` | `<path d="M12 3v9"/>` + `<path d="M5.6 7.6a8 8 0 1 0 12.8 0"/>` | |
| `Eye` | `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/>` + `<circle cx="12" cy="12" r="3"/>` | |
| `Plus` | `<path d="M12 5v14M5 12h14"/>` | |
| `Users` | `<circle cx="9" cy="8" r="3"/>` + `<path d="M3 20a6 6 0 0 1 12 0"/>` + `<circle cx="17" cy="9" r="2"/>` + `<path d="M15 20a4 4 0 0 1 6-3"/>` | |
| `Mic` | `<rect x="9" y="3" width="6" height="12" rx="3"/>` + `<path d="M5 11a7 7 0 0 0 14 0"/>` + `<path d="M12 18v3"/>` | |
| `Chat` | `<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/>` | |
| `Sparkle` | `<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/>` | |
| `Chevron` | `<path d="m9 6 6 6-6 6"/>` | Chevron-right |
| `Check` | `<path d="M5 12l4 4 10-10"/>` | |
| `Close` | `<path d="M6 6l12 12M18 6 6 18"/>` | ×-mark |
| `Twitch` | `<path d="M4 4h16v10l-4 4h-4l-3 3v-3H4V4z"/>` + `<path d="M11 8v5M16 8v5"/>` | |
| `Discord` | Complex multi-path Discord logo | Mixed strokes + filled circles for pupils |
| `Heart` | `<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78..."/>` | |

Additional icons shown in `icons-core.html` preview grid but **not in `icons.jsx`**:
- `Bot` — `<rect x="4" y="7" width="16" height="12" rx="3"/>` + `<path d="M9 12h.01M15 12h.01M12 3v4"/>` (appears in preview only)
- `Pulse` — `<path d="M3 12h4l2-7 4 14 2-7h6"/>` (appears in preview only)
- `History` — clock with counter-clockwise arrow (appears in preview only)
- `Sliders` — slider controls (appears in preview only)

These 4 icons exist in the preview HTML source but not in `icons.jsx`. They need to be added to the `Icon` object in `icons.jsx` / ported to `src/components/Icon.tsx`.

**Fantasy / D&D icons** (per `icons.jsx` and `icons-fantasy.html`)

| Name | Paths / elements | Notes |
|------|-----------------|-------|
| `D4` | Triangle + center vertical | stroke only |
| `D6` | `<rect x="5" y="5" width="14" height="14" rx="2"/>` + 5 `<circle>` dots | Dots use `fill="currentColor"` |
| `D8` | Diamond outline + horizontal bisector | |
| `D10` | Pentagon-ish shape + horizontal + center vertical | |
| `D12` | Hexagonal prism-ish outline + horizontal bisector | |
| `D20` | Icosahedron face + 3 structural paths | |
| `Scroll` | Scroll shape with text lines | |
| `Sword` | Diagonal blade + guard + pommel | |
| `Shield` | Shield outline + inner arc | |
| `Spellbook` | Book with bookmark + spine + cross | |
| `Potion` | Bottle shape | |
| `Skull` | Skull + eye circles | |
| `Crown` | Crown-points zigzag | |
| `Lantern` | Lantern body + flame lines | |
| `Map` | Rolled map with fold lines | |
| `MapPin` | Pin + inner circle | |
| `Crit` | 8-pointed starburst | |
| `Heart` | (also in core group — same path) | |
| `Magic` | Sunburst + center circle | |
| `Initiative` | Flag + horizontal lines | |

Additional icons in `icons-fantasy.html` preview but **not in `icons.jsx`**:
- `quill` — feather/quill path (preview only)
- `pair` — two overlapping dice (preview only)
- `compass` (with fill) — shown highlighted in fantasy grid; also exists in core as `Compass` but the fantasy preview renders it separately

**Class glyphs** (per `icons.jsx` and `icons-classes.html`)

| Name | Visual description |
|------|-------------------|
| `Barbarian` | Mountain-peak rage glyph |
| `Bard` | Lute / circle with strings |
| `Cleric` | Cross + outward spikes |
| `Druid` | Tree / branching from trunk |
| `Fighter` | Crossed blades + center circle |
| `Monk` | Head circle + stance lines |
| `Paladin` | Shield with cross interior |
| `Ranger` | Arrow+bow + circle target |
| `Rogue` | Corner-trick + dagger hint |
| `Sorcerer` | Cardinal rays + inner circle + arc |
| `Warlock` | Outer circle + inner circle + smile/grin lines |
| `Wizard` | Staff + horizontal bar |

**Dice glyphs and the Die component:** The `Die` component (see §6) does NOT use the icon SVG glyphs (D4/D6/D8/D10/D12/D20). It renders a **square tile** with a numeric value as text. The die-shape icons in `Icon.D4` etc. are used in the die-button tray (`.die-btn` in kit.css) and in the compendium/fantasy icon set — they are distinct from the animated Die tile. There is no `dice-icons.jsx` file; all die-shape glyphs live in `icons.jsx` under the Fantasy section.

#### Props (inferred from `icons.jsx`)

```ts
interface IconProps {
  name: keyof typeof Icon;     // e.g. 'Home', 'D20', 'Rogue'
  size?: number;               // default 18 (matches KIc default)
  fill?: string;               // default 'none'
  sw?: number;                 // stroke-width, default 1.7
  style?: React.CSSProperties;
}
```

The current `Icon.tsx` stub uses a single flat `IconProps` interface. Ren-Dev should port the `KIc` base renderer and the full `Icon` name-map. Note the `vb` prop on `KIc` (viewBox, default `"0 0 24 24"`) — all current icons use the default; no overrides needed yet.

---

### 5. Die

**Screenshot:** `screenshots/die-states.png` (rendered, `preview/dice-roll-showcase.html`)

The showcase renders a static nat-20 state only. The rolling/fumble states are read from `shared.jsx`.

#### Geometry

| Property | Value |
|----------|-------|
| Width / Height | `size` prop (default `56px`) |
| Border-radius | `14px` (hardcoded, not a token) |
| Border | `1px solid var(--line)` |
| Display | `grid; place-items: center` |
| Font | `var(--font-display)`, `size * 0.42` px |
| Transition | `all .2s var(--ease)` |

#### State backgrounds and colors

| State | Background | Color | Box-shadow |
|-------|-----------|-------|-----------|
| resting | `linear-gradient(135deg, color-mix(in oklab, var(--accent) 20%, transparent), color-mix(in oklab, var(--accent-2) 20%, transparent))` | `var(--ink)` | `var(--shadow-soft)` |
| `rolling={true}` | same as resting | `var(--ink)` | `var(--shadow-soft)` |
| `crit={true}` | `linear-gradient(135deg, var(--crit), var(--warm))` | `#2a1e16` | `0 0 24px color-mix(in oklab, var(--crit) 50%, transparent)` |
| `fumble={true}` | `linear-gradient(135deg, var(--fumble), var(--bad))` | `#fff` | `var(--shadow-soft)` |

Per `screenshots/die-states.png`: the nat-20 tile shows crit state — gold gradient, dark text, golden outer glow.

#### Rolling animation

```ts
// From shared.jsx
const i = setInterval(() => setN(Math.floor(Math.random() * sides) + 1), 80);
```

- **Tick interval:** `80ms` — the displayed number cycles to a new random value every 80ms
- The gradient/shadow do NOT animate during rolling — only the number value changes
- `sides` prop controls the random range (default `20`)

**Animation flag:** The rolling ticker uses `setInterval` directly — Ren-Dev should guard against this running during `prefers-reduced-motion: reduce` (show a static mid-range value instead of cycling).

#### Props (inferred from `shared.jsx`)

```ts
interface DieProps {
  size?: number;       // default 56
  value?: number | null; // controlled value; null = internally random on mount
  sides?: number;      // default 20
  rolling?: boolean;   // default false — triggers 80ms tick
  crit?: boolean;      // default false — gold gradient + glow
  fumble?: boolean;    // default false — red gradient
}
```

**Priority:** `crit` > `fumble` > resting (both can be false during rolling — only gradient changes on crit/fumble, not on rolling state).

---

### 6. Avatar

**Screenshot:** `screenshots/kit-home-full.png` (in context — avatars appear in the character list and topnav)

Read from source (`shared.jsx`) — no isolated avatar preview page exists.

#### Geometry

| Property | Value |
|----------|-------|
| Shape | Circle (`border-radius: 50%`) |
| Width / Height | `size` prop (default `36px`) |
| Display | `grid; place-items: center` |
| Font | `var(--font-display)`, weight `500`, `size * 0.42` px |
| Color | `#fff` |

Defined via `.avatar` class in `kit.css`:
```css
.avatar {
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  display: grid; place-items: center;
  color: #fff; font-family: var(--font-display); font-weight: 500;
  flex-shrink: 0;
}
```
The component overrides `background` and `font-size` via inline style.

#### Modes

| Mode | Background | Content |
|------|-----------|---------|
| initials | `color` prop if provided, else `linear-gradient(135deg, var(--accent), var(--accent-2))` | First letter of `name`, uppercased |
| image | `center/cover url(${src})` | No text rendered |

Initials logic: `name.split(/\s+/).map(s => s[0]).slice(0, 1).join("").toUpperCase()` — takes only the first word's initial (not first+last). Single initial only.

#### Props (inferred from `shared.jsx`)

```ts
interface AvatarProps {
  name?: string;              // default '?' — used for initials
  size?: number;              // default 36
  color?: string;             // CSS value overriding gradient background
  src?: string;               // image URL — activates image mode
}
```

---

### 7. SuzuDM

**Screenshot:** `screenshots/suzudm-mascot.png` (rendered, `preview/mascot.html`)

Read from `mascot.jsx`. The preview renders a static SVG (no React animation runtime), so the blink and talking mouth animations are visible only via the React component.

#### Outer container

- `div` with `width: size; height: size; position: relative`
- `<svg viewBox="0 0 140 150" width={size} height={size}>`

Default `size`: `96`. Preview renders at `160×170`.

#### SVG structure (layers, bottom to top)

1. **Halo glow** — `<circle cx="70" cy="85" r="56">` filled with `radial-gradient(id=m-glow-{size})` at `opacity: 0.85`
   - Glow gradient: center `var(--accent-3)` opacity 0.9 → 60% `var(--accent-2)` opacity 0.4 → edge `var(--accent)` opacity 0
   - **Animation:** `<animate attributeName="r" values="54;58;54" dur="4s" repeatCount="indefinite"/>` — halo pulses r ±4 over 4s
   - Only rendered when `glow={true}` (default)

2. **Orbit rings** — 2 `<ellipse>` on `<g>` with `stroke: var(--accent-2)`, `strokeOpacity: 0.45`, `strokeWidth: 1`, `fill: none`
   - Ring 1: `rx="48" ry="20"`, starting `rotate(-18 70 85)`, **animates** full 360° rotation in `14s`
   - Ring 2: `rx="44" ry="18"`, starting `rotate(28 70 85)`, `strokeOpacity: 0.25`, **animates** counter-rotation in `22s`

3. **Face circle** — `<circle cx="70" cy="85" r="32">` with `linearGradient(id=m-face-{size})` fill — white-to-accent-3 gradient; `stroke: var(--accent-2)`, `strokeOpacity: 0.4`

4. **Cat ears** — 2 filled triangles (`<path>`) using `fill: var(--accent-3)`, `opacity: 0.85`
   - Left ear: `M50 63 L56 53 L62 65 Z`
   - Right ear: `M78 65 L84 53 L90 63 Z`

5. **Eyes** — 2 rounded rectangles (`<rect>` with `rx="3"`), `fill: var(--accent-2)` (lavender)
   - Left eye: `x="58" y="81" width="6" height="10"`
   - Right eye: `x="76" y="81" width="6" height="10"`
   - **Blink animation** (when `talking={false}`): height cycles `10→2→10` over 5s with keyTimes `0; 0.06; 0.12` (blink occupies 0–0.6s, then stays open for ~4.4s). Y adjusts correspondingly `81→85→81`. Eyes blink together.
   - When `talking={true}`: no blink animation; height stays at `10`.

6. **Mouth**
   - `talking={false}`: `<path d="M65 98 Q70 101 75 98">` — small smile curve, `stroke: var(--accent)`, `strokeWidth: 2`, no fill
   - `talking={true}`: `<ellipse cx="70" cy="98" rx="4" ry="2.5">` filled `var(--accent)` with animation `ry` cycles `1.2→3→1.2` at `dur="0.5s"` — mouth opens/closes rapidly

7. **DM Hat** (when `hat={true}`, default)
   - Cone: `<path d="M70 22 L85 56 Q70 60 55 56 Z">` — `linearGradient(id=m-hat-{size})` from `var(--accent-2)` to `var(--accent)`; `stroke: var(--accent-2)`, `strokeOpacity: 0.5`
   - Brim: `<ellipse cx="70" cy="58" rx="18" ry="3">` filled `var(--accent-2)`, `opacity: 0.7`
   - Tip jewel: `<circle cx="70" cy="22" r="2.5">` filled `var(--crit)` (gold)
   - 3 star accents on hat body: `<circle cx="64" cy="40" r="1.2">` (crit, opacity 0.9), `<circle cx="76" cy="34" r="1">` (ink, opacity 0.7), `<circle cx="72" cy="48" r="0.9">` (crit, opacity 0.7)

8. **Port lights** — 2 small circles that breathe (alternating phase)
   - Left: `cx="38" cy="85" r="1.6"` filled `var(--accent)`, animation `opacity: 1→0.2→1` at `dur="2.4s"`
   - Right: `cx="102" cy="85" r="1.6"` filled `var(--accent-2)`, animation `opacity: 0.2→1→0.2` at `dur="2.4s"` (inverted phase)

#### States (per `preview/mascot.html`)

| State | Visual |
|-------|--------|
| idle/listening | Eyes blink every ~5s, small smile, orbit rings rotate, halo pulses |
| talking | Mouth animates open/close at 0.5s; eyes stop blinking (stay open) |
| hat=false | DM hat omitted |
| glow=false | Halo glow layer omitted |

The mascot preview also describes semantic states (listening / speaking / rolling / standby) using dot indicators — those are surrounding UI context, not part of SuzuDM itself.

**Animation flag:** Halo pulse, orbit ring rotation, eye blink, mouth animation, port light breath — all need `prefers-reduced-motion` guards. Suggested: under `prefers-reduced-motion: reduce`, render static frame (eyes open, smile, no orbit spin).

#### Props (inferred from `mascot.jsx`)

```ts
interface SuzuDMProps {
  size?: number;      // default 96
  talking?: boolean;  // default false
  hat?: boolean;      // default true
  glow?: boolean;     // default true
  style?: React.CSSProperties;
}
```

---

### 8. SectionHead

**Screenshot:** `screenshots/kit-home-full.png` (in context — appears as section headers above each content block)

Read from source (`shared.jsx`) — no isolated preview page.

#### Layout

```
flex-row, align-items: flex-end, justify-content: space-between, gap: 16px, margin-bottom: 18px
  └── left block (flex: 1, min-width: 0)
        ├── kicker (optional): <div className="label"> — 11px, weight 600, letter-spacing 0.16em, uppercase, color var(--ink-3); margin-bottom: 8px
        ├── title:  <h2> — font-display, 28px, white-space: nowrap, overflow: hidden, text-overflow: ellipsis
        └── sub (optional): <p> — 13px, color var(--ink-3), margin-top: 6px
  └── action slot (optional): any React node (typically a Button)
```

#### Props (inferred from `shared.jsx`)

```ts
interface SectionHeadProps {
  kicker?: string;            // label style (uppercase overline)
  title: string;              // ellipsed at overflow
  sub?: string;               // secondary description
  action?: React.ReactNode;   // right-side action slot
}
```

Note: The `h2` font-size is `28px` hardcoded, not `clamp(26px, 3vw, 32px)` from the base `h2` rule — the component overrides with `style={{ fontSize: 28 }}`.

---

### 9. Stat

**Screenshot:** `screenshots/kit-home-full.png` (Stat tiles visible in the dashboard Home screen)

Read from source (`shared.jsx`) — no isolated preview page.

#### Structure

Stat wraps `Card` (so it gets `.glass` surface). Inside:

```
Card
  └── flex-row, justify-content: space-between, align-items: flex-start
        ├── label: <div className="label"> — 11px, 600, uppercase, ink-3
        └── icon tile (optional):
              28×28px, border-radius: 8px, grid/center
              background: color-mix(in oklab, {accentColor|var(--accent)} 14%, transparent)
              color: {accentColor|var(--accent)}
  └── value: font-display, 28px, margin-top: 8px, color: var(--ink), letter-spacing: -0.02em, line-height: 1
  └── delta (optional): font-mono, 12px, margin-top: 6px, font-weight: 500
        — color driven by deltaTone: good=var(--good), bad=var(--bad), neutral=var(--ink-3)
```

#### Props (inferred from `shared.jsx`)

```ts
interface StatProps {
  label: string;
  value: React.ReactNode;             // display-font number or string
  delta?: string;                     // mono text e.g. '+12% this week'
  deltaTone?: 'good' | 'bad' | 'neutral'; // default 'good'
  icon?: React.ReactNode;             // 16–18px icon component
  accentColor?: string;               // CSS color for icon tile; defaults to var(--accent)
}
```

The `delta` line uses `var(--font-mono)` — Ren-Dev should apply the `.mono` class or explicit `fontFamily`.

---

### 10. Waveform

**Screenshot:** `screenshots/kit-play-waveform-die.png` (visible in play screen's narrator strip)

Read from source (`shared.jsx`) — no isolated preview page.

#### Rendering

A `flex-row` container of `{bars}` (default 32) vertical bars:

```
div { display: flex; align-items: center; gap: 3px; height: {height}px }
  └── div × bars {
        width: 3px;
        height: v * 100%;   // v = animated amplitude 0–1
        background: {color};
        border-radius: 99px;
        opacity: active ? 0.5 + 0.5 * v : 0.3;
      }
```

#### Animation math

```ts
// t updates via requestAnimationFrame — performance.now() / 200
const phase = i * 0.4 + t;
const v = active
  ? 0.25 + 0.75 * Math.abs(Math.sin(phase) * Math.cos(phase * 0.3 + i * 0.2))
  : 0.18;
```

- `active={true}`: bars animate using sine×cosine formula, amplitude varies 0.25–1.0, phase offset per bar creates wave effect
- `active={false}`: all bars at constant `v = 0.18` (height 18% of container), `opacity: 0.3` — static idle state
- The `rAF` loop runs continuously while `active` — cancel on unmount (the source correctly uses `cancelAnimationFrame`)

**Animation flag:** Continuous `requestAnimationFrame` loop — under `prefers-reduced-motion: reduce`, use the `active={false}` static rendering regardless of `active` prop.

#### Props (inferred from `shared.jsx`)

```ts
interface WaveformProps {
  bars?: number;       // default 32 — number of vertical bars
  height?: number;     // default 24 — container height in px
  active?: boolean;    // default true — animated vs static
  color?: string;      // default 'var(--accent)'
}
```

---

### 11. Aurora

**Screenshot:** `screenshots/aurora-background.png` (rendered, `preview/aurora-background.html`)

#### CSS implementation (preferred path)

Aurora is a CSS class, not a React component with logic. The React `Aurora` wrapper in `shared.jsx` is just:

```jsx
function Aurora({ children, style }) {
  return <div className="aurora" style={style}>{children}</div>;
}
```

All visual work is in `globals.css`:

```css
.aurora { position: relative; isolation: isolate; }
.aurora::before {
  content: '';
  position: absolute; inset: -10%;
  background: var(--grad-aurora);
  z-index: -1;
  pointer-events: none;
  filter: blur(20px);
  animation: aurora-drift 24s ease-in-out infinite alternate;
}
@keyframes aurora-drift {
  0%   { transform: translate(0, 0) scale(1); }
  100% { transform: translate(2%, -2%) scale(1.05); }
}
```

The `::before` pseudo-element extends 10% outside the container on all sides (`inset: -10%`), then gets `blur(20px)`. `isolation: isolate` prevents the blurred layer from bleeding into parent stacking contexts. `z-index: -1` keeps it behind children.

#### `--grad-aurora` per palette (see token table above)

- **dusk-tavern:** 3 radials — rose (20% 10%), lavender (80% 20%), peach (50% 100%)
- **candlelit:** ember red, gold, parchment
- **aetheric:** teal, amethyst, spell-blue
- **moonlit-grove:** moss, lavender mist, moonlight

#### Animation

- **Duration:** `24s`
- **Easing:** `ease-in-out`
- **Direction:** `alternate` (plays forward then reverse)
- **Effect:** drifts `(0,0) scale(1)` → `(2%, -2%) scale(1.05)` — very slow ambient drift, barely perceptible

**Animation flag:** The `aurora-drift` animation is continuous — apply `prefers-reduced-motion` guard. Under reduce, omit the `animation` property to render static gradient.

#### Props (inferred from `shared.jsx`)

```ts
interface AuroraProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;          // for combining with other layout classes
}
```

In Next.js/CSS Modules context, `className="aurora"` (from globals.css) is the correct usage. The Aurora component exists primarily as a convenience wrapper; pages can also use `<div className="aurora">` directly.

---

## Canvas-vs-Implementation Deltas

| Component | Canvas has | Implementation has | Action |
|-----------|-----------|--------------------|--------|
| Button | Full variant/state/size matrix, danger + crit bonus variants | Stub `<div data-component="Button"/>` | Implement from spec; decide where to add `.btn-danger` / `.btn-crit` |
| Card | `padding` bool + `pop` bool variants | Stub | Implement |
| Pill | 9-tone system, dot pulse | Stub | Implement |
| Icon | 37+ named icons incl. 12 class glyphs | Stub | Port full inventory from `icons.jsx`; add 4 preview-only icons (Bot, Pulse, History, Sliders) |
| Die | 3 states (resting/crit/fumble) + rolling tick | Stub | Implement; add `prefers-reduced-motion` guard on ticker |
| Avatar | initials + image mode | Stub | Implement |
| SuzuDM | Talking/idle states, 6-layer SVG animation | Stub | Implement; add `prefers-reduced-motion` guard on all animations |
| SectionHead | kicker/title/sub/action layout | Not in `src/components/` — no file at all | Create `SectionHead.tsx` |
| Stat | label/value/delta/icon tile layout | Not in `src/components/` — no file at all | Create `Stat.tsx` |
| Waveform | Animated bars, active/idle | Not in `src/components/` — no file at all | Create `Waveform.tsx` |
| Aurora | CSS-only animated gradient wrapper | In `globals.css` — class present | Create optional `Aurora.tsx` thin wrapper; the CSS class is already there |

**SectionHead, Stat, Waveform are missing entirely from `src/components/`** — they need to be created as new files.

---

## Open Questions

1. **`--ink-3` mismatch (candlelit):** design system `colors_and_type.css` has `#6e5c4a`; `globals.css` has `#8a7866`. Downstream contrast ratios differ slightly. Hikari-PO to confirm which is canonical before Ren-Dev implements Pill/Stat/Label in the candlelit palette.

2. **`.btn-danger` / `.btn-crit`:** These two button variants exist only in `preview/buttons.html`'s `<style>` block — not in `globals.css`. The canvas shows them as designed. Aoi-UI to confirm whether they belong in `globals.css` (reusable utility classes) or in `Button.module.css` (component-scoped).

3. **Aurora component necessity:** The `Aurora` React component is a trivial wrapper over the `.aurora` CSS class that already exists in `globals.css`. Aoi-UI to decide whether to keep `Aurora.tsx` (for encapsulation) or just use `className="aurora"` directly at page level.

4. **4 preview-only icons (Bot, Pulse, History, Sliders):** Present in `icons-core.html` preview, not in `icons.jsx`. Paths are readable from the HTML source. These should be added to the icon inventory — flag to Aoi-UI/Ren-Dev whether to add them to `icons.jsx` canonical source or define them in `Icon.tsx` directly.

5. **`quill` and `pair` icons:** Present in `icons-fantasy.html` preview, not in `icons.jsx`. Same question as above.

6. **Waveform `prefers-reduced-motion`:** The `requestAnimationFrame` loop needs explicit handling. The simplest safe implementation: detect `window.matchMedia('(prefers-reduced-motion: reduce)').matches` on mount and keep `active` false regardless of prop. Miko-QA to add a test for this.

7. **Canvas has no empty state for Waveform (no audio):** The `active={false}` static render shows 18%-height flat bars. This covers the idle case. No additional empty state is needed.

8. **Die `value=null` vs `value=undefined`:** Source uses `value ?? Math.floor(Math.random() * sides) + 1` — `null` is the explicit "randomise on mount" signal. TypeScript interface should type this as `number | null`.

---

## Decisions (orchestrator, 2026-06-15) — resolve the open questions; build to these

1. **`--ink-3` candlelit (#8a7866 vs #6e5c4a):** **Do NOT change the token this sprint.** `globals.css` is the Tavern's source of truth (CLAUDE.md); components reference `var(--ink-3)` by name regardless of value. **Iro-A11y** verifies candlelit contrast (`--ink-3` text on `--bg #f5eee2`) against WCAG AA in its audit; if it fails, fix the token as a follow-up, not mid-sprint. Non-blocking.
2. **`.btn-danger` / `.btn-crit`:** Add them to **`globals.css`** alongside the existing `.btn-*` family (consistent with `.btn-primary`/`.btn-ghost`/`.btn-lg`/`.btn-icon` already there). `Button` maps `variant` → the global class. Keep using the global `.btn` utilities (CLAUDE.md: "use them directly via className"); the component is a thin typed wrapper, not a re-implementation.
3. **Aurora:** **Keep a thin `Aurora.tsx`** wrapper over `className="aurora"` — gives a typed boundary + a single place for the reduced-motion guard. Cheap, consistent with "components live in `src/components/`".
4 & 5. **Missing icons (Bot, Pulse, History, Sliders, quill, pair):** The Tavern's **`Icon` component is the new source of truth** — do NOT edit the read-only design-system `icons.jsx`. Port the full `icons.jsx` inventory **plus** these 6 (paths captured in §4 of this doc) into the Tavern Icon set (a co-located `icons.ts`/map). One canonical typed `IconName` union.
6. **Reduced-motion:** Create **one shared hook** `src/lib/useReducedMotion.ts` (SSR-safe: false on server, subscribes to `matchMedia('(prefers-reduced-motion: reduce)')` on the client). Every animated component (Die ticker, Waveform rAF, Aurora drift, SuzuDM SVG anims, Pill dot pulse) consumes it and renders the static/idle frame when reduced motion is preferred. Miko-QA tests each.
7. Waveform idle state — fine, no action.
8. **Die:** type `value?: number | null` (`null`/`undefined` → randomise on mount).

**Cross-cutting build rules for Ren-Dev:**
- **Reuse the existing global utilities** (`.btn*`, `.pill`, `.glass`, `.label`, `.input`, `.mono`) — don't duplicate them in CSS Modules. Component `.module.css` only for what globals don't cover. Never hardcode colors — always `var(--token)`.
- **a11y baseline:** `Button` renders a real `<button>` (with `type`, `disabled`) or `<a>` when `href` given (polymorphic); icon-only buttons require an `aria-label`. `Icon` is `aria-hidden` by default with an optional `title`/`label` that switches it to `role="img"`. Respect `:focus-visible` (already global). SuzuDM/Waveform/Aurora are decorative → `aria-hidden`.
- TS strict; explicit prop interfaces; `@/*` imports; Server Components by default, `'use client'` only where state/effects/matchMedia are used (Die, Waveform, SuzuDM, Aurora-if-it-guards, Toast).
