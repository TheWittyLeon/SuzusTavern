# SuzusTavern — Project Instructions

## What This Is

Suzu's Tavern is an AI-DM driven 5e tabletop web app. Suzu (the NekoNova persocom) acts as Dungeon Master — players log in, pick a table, create characters, and play D&D 5e in-browser. This project is part of the MainProject workspace.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15, App Router, TypeScript (strict) |
| Styling | CSS Modules + global CSS custom properties |
| Package manager | npm |
| Design system | Suzu's Tavern Design System (`../Suzu's Tavern Design System/`) — source of truth, do not modify |
| Runtime | Node.js 20+ |

## Project Structure

```
src/
├── app/           # Next.js App Router pages and layouts
├── components/    # Shared UI components (TypeScript)
└── lib/           # Utilities, API clients, helpers (future)
public/
└── assets/        # Static design system assets (read-only copy)
```

## Design System

All design tokens live in `src/app/globals.css`. The token system uses CSS custom properties organized by palette:

- `data-vibe="dusk-tavern"` — default (cozy, fireside, aubergine)
- `data-vibe="candlelit"` — light parchment, ember accents
- `data-vibe="aetheric"` — deep midnight, arcane teal
- `data-vibe="moonlit-grove"` — mossy, silver, lavender mist

Set `data-vibe` on `<html>` to switch palettes. Density variants: `data-density="compact|cozy|airy"`.

**Never use Tailwind.** All styling uses CSS custom properties from globals.css and component-scoped CSS Modules.

## Styling Conventions

- Global utility classes (`.glass`, `.btn`, `.pill`, `.input`, etc.) are defined in `globals.css` — use them directly via `className`
- Component-specific styles go in `ComponentName.module.css` co-located with the component
- Never hardcode color values — always use `var(--token-name)`
- Never import `colors_and_type.css` from the design system folder — the tokens are already in `globals.css`

## Components

Reusable components live in `src/components/`. Each component:
- Is written in TypeScript with explicit prop interfaces
- Has its own `.module.css` file when styles are needed
- Does not import from `../Suzu's Tavern Design System/` directly

Reference `../Suzu's Tavern Design System/ui_kits/web/` for the intended visual design of each component. Reference `../Suzu's Tavern Design System/assets/` for SVG source material.

## Pages

All routes use the App Router (`src/app/`). Pages are Server Components by default; add `'use client'` only when interactivity requires it.

| Route | Purpose |
|-------|---------|
| `/` | Landing / marketing |
| `/login` | Authentication |
| `/lobby` | Browse and join sessions |
| `/dashboard` | Logged-in home |
| `/character/new` | Character creation wizard |
| `/character/[id]` | Character sheet view |
| `/play/[sessionId]` | In-session play (Suzu DM) |

## Palette Switching

The root layout (`src/app/layout.tsx`) has `data-vibe="dusk-tavern"` hardcoded on `<html>` at scaffold stage. To add dynamic palette switching, implement a `ThemeProvider` client component that sets `document.documentElement.dataset.vibe` and wrap `<body>` in the root layout.

## Testing

- Framework: Jest + React Testing Library
- Config: `jest.config.ts` using `next/jest` transformer
- Test files: `src/__tests__/`
- Run: `npm test`
- Build: `npm run build`

## Agent Team

This project is orchestrated by the Claude agent team in `.claude/agents/`. The standard workflow for new features:

```
Riku-Orch → Sora-arch → Miko-QA → Ren-dev → Kage-cr
```

For UI work, insert `Aoi-ui` after `Sora-arch`. All specialist agents read this CLAUDE.md before starting work.

## Related Projects

- `../Authentication-Python/` — Flask auth backend (JWT + Redis sessions)
- `../ProjectNekoNova/` — Suzu's AI brain and companion bot
- `../Suzu's Tavern Design System/` — design source of truth (never modify)
