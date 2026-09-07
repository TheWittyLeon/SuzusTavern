import Icon, { type IconName } from '@/components/Icon';
import type { SeriesCover } from '@/lib/api/types';
import styles from './SeriesCoverArt.module.css';

/**
 * `cover.glyph` is a free-text string (design doc §4.2 — pattern-checked, not
 * enum-checked: the icon set can churn on the frontend without an engine
 * migration). Known glyphs map to a real icon; anything unrecognized
 * degrades to the default rather than failing to render — the design doc's
 * explicit trade for that field.
 */
const GLYPH_ICON_MAP: Partial<Record<string, IconName>> = {
  crown: 'Crown',
  star: 'Sparkle',
  sparkle: 'Sparkle',
  flame: 'Lantern',
  fire: 'Lantern',
  lantern: 'Lantern',
  scroll: 'Scroll',
  book: 'Scroll',
  skull: 'Skull',
  compass: 'Compass',
  potion: 'Potion',
  shield: 'Shield',
  map: 'Map',
  sword: 'Sword',
  magic: 'Magic',
  quill: 'Quill',
};
const DEFAULT_GLYPH_ICON: IconName = 'Scroll';

function glyphIconName(glyph: string): IconName {
  return GLYPH_ICON_MAP[glyph.toLowerCase()] ?? DEFAULT_GLYPH_ICON;
}

/**
 * Builds the procedural cover background from the {color, pattern} spec
 * (design doc §4.1/§4.2). `color` is per-row AUTHORED DATA, not a design
 * token — it flows through an inline style, never a CSS Module literal, so
 * it's outside lint:tokens' scope by construction (the same reasoning as
 * Avatar's `url()` idiom being the one other data-driven color path in the
 * app). Decorative only: color/pattern carry no meaning that isn't ALSO
 * present as text elsewhere on the card (title/level_range/content_rating —
 * design doc §17), so an unusual or low-contrast authored color never hides
 * information, only looks a little duller.
 */
function coverBackground(cover: SeriesCover): string {
  const c = cover.color;
  switch (cover.pattern) {
    case 'stripes':
      return `repeating-linear-gradient(135deg, color-mix(in oklab, ${c} 85%, var(--bg-3)) 0 14px, color-mix(in oklab, ${c} 50%, var(--bg-3)) 14px 28px)`;
    case 'hatch':
      return (
        `repeating-linear-gradient(45deg, color-mix(in oklab, ${c} 65%, var(--bg-3)) 0 2px, transparent 2px 12px), ` +
        `repeating-linear-gradient(-45deg, color-mix(in oklab, ${c} 65%, var(--bg-3)) 0 2px, transparent 2px 12px), ` +
        `color-mix(in oklab, ${c} 38%, var(--bg-3))`
      );
    case 'dots':
      return (
        `radial-gradient(color-mix(in oklab, ${c} 80%, var(--bg-3)) 2.4px, transparent 2.6px) 0 0 / 16px 16px, ` +
        `color-mix(in oklab, ${c} 32%, var(--bg-3))`
      );
    case 'none':
    default:
      return `linear-gradient(160deg, color-mix(in oklab, ${c} 78%, var(--bg-3)), color-mix(in oklab, ${c} 32%, var(--bg-3)))`;
  }
}

export interface SeriesCoverArtProps {
  cover: SeriesCover;
  /** Rendered size (square) in px. Default: 64 */
  size?: number;
  className?: string;
}

/** Procedural series cover — {color, pattern, glyph} rendered as a small
 *  swatch + centered glyph. Franchise artwork is off the table on the
 *  vault's IP posture (design doc §5); this is the zero-image-pipeline
 *  answer, per the design system's shipped `ModuleCover` spec. */
export default function SeriesCoverArt({ cover, size = 64, className = '' }: SeriesCoverArtProps) {
  return (
    <span
      className={`${styles.cover} ${className}`.trim()}
      style={{ width: size, height: size, background: coverBackground(cover) }}
      aria-hidden
    >
      <Icon
        name={glyphIconName(cover.glyph)}
        size={Math.round(size * 0.44)}
        color="rgba(255,255,255,0.92)"
      />
    </span>
  );
}
