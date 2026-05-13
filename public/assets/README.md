# Design System Assets — Source Reference

These files are copied from `../Suzu's Tavern Design System/assets/` for reference only.

**Do not import these files directly into Next.js components.** They use browser Babel patterns
(no build step, global function declarations) that are not compatible with the Next.js module system.

When implementing components, adapt the SVG paths and patterns from these files into proper
TypeScript React components in `src/components/`.

| Source File | Maps to Component |
|-------------|------------------|
| `icons.jsx` | `src/components/Icon.tsx` |
| `dice-icons.jsx` | `src/components/Die.tsx` |
| `mascot.jsx` | `src/components/SuzuDM.tsx` |
| `primitives.jsx` | `src/components/Card.tsx`, `Button.tsx`, `Pill.tsx` |
