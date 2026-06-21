/**
 * Suzu's Tavern — Icon definitions
 *
 * Source of truth for this project. Ported from the read-only design system
 * `icons.jsx` plus 6 preview-only icons (Bot, Pulse, History, Sliders, Quill, Pair).
 *
 * Each value is the inner SVG content (children of <svg viewBox="0 0 24 24">).
 * The Icon component renders the wrapper SVG and injects these children.
 *
 * All icons are stroke-based / currentColor unless a path element overrides
 * `fill` directly (Compass needle, D6 dots — these have fill="currentColor").
 */

export type IconName =
  // Core / NekoNova
  | 'Home'
  | 'Compass'
  | 'Search'
  | 'Bell'
  | 'Settings'
  | 'Send'
  | 'Power'
  | 'Eye'
  | 'Plus'
  | 'Users'
  | 'Mic'
  | 'Chat'
  | 'Sparkle'
  | 'Chevron'
  | 'Check'
  | 'Close'
  | 'Twitch'
  | 'Discord'
  | 'Heart'
  // Preview-only core icons
  | 'Bot'
  | 'Pulse'
  | 'History'
  | 'Sliders'
  // Fantasy / D&D
  | 'D20'
  | 'D4'
  | 'D6'
  | 'D8'
  | 'D10'
  | 'D12'
  | 'Scroll'
  | 'Sword'
  | 'Shield'
  | 'Spellbook'
  | 'Potion'
  | 'Skull'
  | 'Crown'
  | 'Lantern'
  | 'Map'
  | 'MapPin'
  | 'Crit'
  | 'Magic'
  | 'Initiative'
  // Preview-only fantasy icons
  | 'Quill'
  | 'Pair'
  // Class glyphs
  | 'Barbarian'
  | 'Bard'
  | 'Cleric'
  | 'Druid'
  | 'Fighter'
  | 'Monk'
  | 'Paladin'
  | 'Ranger'
  | 'Rogue'
  | 'Sorcerer'
  | 'Warlock'
  | 'Wizard'
  | 'Trash';

/**
 * Map of icon name → SVG inner markup string.
 * Injected via dangerouslySetInnerHTML inside the <svg> wrapper in Icon.tsx.
 * All content is static and comes from the read-only design system source.
 */
export const ICON_PATHS: Record<IconName, string> = {
  // ----------------------------------------------------------------
  // Core / NekoNova
  // ----------------------------------------------------------------
  Home: '<path d="M3 11l9-8 9 8"/><path d="M5 9v12h14V9"/>',
  Compass:
    '<circle cx="12" cy="12" r="9"/><path d="m15 9-2 5-5 2 2-5Z" fill="currentColor" stroke="none"/>',
  Search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  Bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  Settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.3 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  Send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/>',
  Power: '<path d="M12 3v9"/><path d="M5.6 7.6a8 8 0 1 0 12.8 0"/>',
  Eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  Plus: '<path d="M12 5v14M5 12h14"/>',
  Users:
    '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2"/><path d="M15 20a4 4 0 0 1 6-3"/>',
  Mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  Chat: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/>',
  Sparkle:
    '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/>',
  Chevron: '<path d="m9 6 6 6-6 6"/>',
  Check: '<path d="M5 12l4 4 10-10"/>',
  Close: '<path d="M6 6l12 12M18 6 6 18"/>',
  Trash:
    '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6"/>',
  Twitch:
    '<path d="M4 4h16v10l-4 4h-4l-3 3v-3H4V4z"/><path d="M11 8v5M16 8v5"/>',
  Discord:
    '<path d="M19 6c-1.5-.7-3-1-4.5-1l-.4 1c-2 0-2.2 0-4.2 0l-.4-1C8 5 6.5 5.3 5 6c-1 2-2 5-2 9 1.6 1.3 3.2 2 4.7 2l.7-1.2C7.5 15.5 7 15 7 15c3 1.5 7 1.5 10 0 0 0-.5.5-1.4.8L16.3 17c1.5 0 3.1-.7 4.7-2 0-4-1-7-2-9Z"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>',
  Heart:
    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/>',

  // Preview-only core icons
  Bot: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M9 12h.01M15 12h.01M12 3v4"/>',
  Pulse: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
  History:
    '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
  Sliders:
    '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h14M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/>',

  // ----------------------------------------------------------------
  // Fantasy / D&D
  // ----------------------------------------------------------------
  D20: '<path d="M12 2 3 7v10l9 5 9-5V7Z"/><path d="M3 7l9 5 9-5M12 12v10M7 9.5l5 7.5 5-7.5"/>',
  D4: '<path d="M12 3 4 19h16Z"/><path d="M12 3v16"/>',
  D6: '<rect x="5" y="5" width="14" height="14" rx="2"/><circle cx="9" cy="9" r="0.8" fill="currentColor"/><circle cx="15" cy="9" r="0.8" fill="currentColor"/><circle cx="9" cy="15" r="0.8" fill="currentColor"/><circle cx="15" cy="15" r="0.8" fill="currentColor"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/>',
  D8: '<path d="M12 3 4 12l8 9 8-9Z"/><path d="M4 12h16"/>',
  D10: '<path d="M12 3 4 10l2 10h12l2-10Z"/><path d="M4 10h16M12 3v17"/>',
  D12: '<path d="M12 3 5 7v8l7 6 7-6V7Z"/><path d="M5 7l7 4 7-4"/>',
  Scroll:
    '<path d="M5 5a3 3 0 0 1 3-3h11v15a3 3 0 0 1-3 3H6"/><path d="M5 5v13a3 3 0 0 0 3 3M19 17H8M11 8h5M11 12h5"/>',
  Sword:
    '<path d="M20 4 9 15"/><path d="M11 17l-4 4-3-3 4-4"/><path d="m7 17 1 1M14 4h6v6"/>',
  Shield:
    '<path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3Z"/><path d="M8 12c1 2 2.5 3 4 3s3-1 4-3"/>',
  Spellbook:
    '<path d="M5 4a2 2 0 0 1 2-2h12v17H7a2 2 0 0 0-2 2V4Z"/><path d="M5 4v17M19 19H7a2 2 0 0 1 0-4h12M12 7v6M9 10h6"/>',
  Potion:
    '<path d="M9 2h6M10 2v4M14 2v4M8 6h8l-1 3a5 5 0 0 1 1 3v5a3 3 0 0 1-3 3h-3a3 3 0 0 1-3-3v-5a5 5 0 0 1 1-3Z"/>',
  Skull:
    '<path d="M5 11a7 7 0 1 1 14 0v4a2 2 0 0 1-2 2v3h-2v-2H9v2H7v-3a2 2 0 0 1-2-2Z"/><circle cx="9" cy="11" r="1.4"/><circle cx="15" cy="11" r="1.4"/>',
  Crown: '<path d="M3 8l3 9h12l3-9-5 4-4-6-4 6Z"/>',
  Lantern:
    '<path d="M10 2h4v2h-4zM9 4h6v3H9zM8 7h8v12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V7Z"/><path d="M12 21v1M10 11h4M10 15h4"/>',
  Map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  MapPin:
    '<path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13Z"/><circle cx="12" cy="9" r="2.5"/>',
  Crit: '<path d="m12 2 2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5Z"/>',
  Magic:
    '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/>',
  Initiative:
    '<path d="M12 2v6M5 12h14m-11-4 4-4 4 4M5 16h14M5 20h14"/>',

  // Preview-only fantasy icons
  Quill: '<path d="M20 4c0 8-6 14-14 14l-3-1 1-3C4 6 12 4 20 4Z"/><path d="m3 21 6-6"/>',
  Pair: '<rect x="3" y="9" width="10" height="10" rx="2"/><rect x="11" y="5" width="10" height="10" rx="2"/>',

  // ----------------------------------------------------------------
  // Class glyphs
  // ----------------------------------------------------------------
  Barbarian:
    '<path d="M4 20 9 9l3 3 3-3 5 11M9 9 7 4M15 9l2-5"/>',
  Bard: '<circle cx="12" cy="14" r="7"/><path d="M12 7V3M9 3h6M9 13v2M12 12v4M15 13v2"/>',
  Cleric:
    '<path d="M12 3v18M5 9h14M7 3l-2 4 2 3M17 3l2 4-2 3"/>',
  Druid:
    '<path d="M12 21V8M12 8c-4-4-7 0-7 0s3 3 7 0M12 8c4-4 7 0 7 0s-3 3-7 0M12 8c0-4 4-5 4-5s-1 4-4 5Z"/>',
  Fighter:
    '<path d="M5 5l6 6M19 5l-6 6M11 11 4 18l2 2 7-7M13 11l7 7-2 2-7-7"/><circle cx="12" cy="12" r="1.5"/>',
  Monk: '<circle cx="12" cy="6" r="3"/><path d="M9 21v-7l-4-2M15 21v-7l4-2M8 14h8"/>',
  Paladin:
    '<path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3ZM12 8v8M8 12h8"/>',
  Ranger:
    '<path d="M5 19c4-4 10-10 14-14M5 19v-4M5 19h4M14 8l3-3M14 8l3 3"/><circle cx="9" cy="9" r="2"/>',
  Rogue:
    '<path d="M5 5h6v6Z"/><path d="m11 11 8 8M14 19h5v-5"/><circle cx="8" cy="8" r="1"/>',
  Sorcerer:
    '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="4"/>',
  Warlock:
    '<circle cx="12" cy="12" r="9"/><path d="M9 9c1 2 5 2 6 0M8 14c1 3 7 3 8 0"/><circle cx="12" cy="12" r="2"/>',
  Wizard:
    '<path d="M12 2 9 10h6Z"/><path d="m6 22 6-12 6 12"/><path d="M8 16h8"/>',
};
