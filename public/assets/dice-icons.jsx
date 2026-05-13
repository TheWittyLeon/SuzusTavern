/* ============================================================
 * Suzu's Tavern — DnD icon set
 * Stroke-based, currentColor, 24×24 viewbox, strokeWidth 1.7
 * Companion to the core Icon.* set in icons.jsx
 * ============================================================ */

const FIc = ({ d, size = 18, fill = "none", sw = 1.7, children, vb = "0 0 24 24", style }) => (
  <svg
    width={size} height={size} viewBox={vb} fill={fill}
    stroke="currentColor" strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
  >
    {d ? <path d={d} /> : children}
  </svg>
);

const Fantasy = {
  /* ---------- Dice ---------- */
  D4: (p) => <FIc {...p}><path d="M12 3 4 19h16Z" /><path d="M12 3v16M4 19l8-8 8 8" /></FIc>,
  D6: (p) => <FIc {...p}><rect x="5" y="5" width="14" height="14" rx="2" /><circle cx="9" cy="9" r="0.8" fill="currentColor"/><circle cx="15" cy="9" r="0.8" fill="currentColor"/><circle cx="9" cy="15" r="0.8" fill="currentColor"/><circle cx="15" cy="15" r="0.8" fill="currentColor"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/></FIc>,
  D8: (p) => <FIc {...p}><path d="M12 3 4 12l8 9 8-9Z"/><path d="M4 12h16M12 3v18"/></FIc>,
  D10: (p) => <FIc {...p}><path d="M12 3 4 10l2 10h12l2-10Z"/><path d="M4 10h16M12 3v17"/></FIc>,
  D12: (p) => <FIc {...p}><path d="M12 3 5 7v8l7 6 7-6V7Z"/><path d="M12 3v18M5 7l7 4 7-4M5 15l7-4 7 4"/></FIc>,
  D20: (p) => <FIc {...p}><path d="M12 2 3 7v10l9 5 9-5V7Z"/><path d="M3 7l9 5 9-5M12 12v10M7 9.5l5 7.5 5-7.5"/></FIc>,
  DicePair: (p) => <FIc {...p}><rect x="3" y="9" width="10" height="10" rx="2"/><rect x="11" y="5" width="10" height="10" rx="2"/><circle cx="6.5" cy="12.5" r="0.7" fill="currentColor"/><circle cx="9.5" cy="15.5" r="0.7" fill="currentColor"/><circle cx="14.5" cy="8.5" r="0.7" fill="currentColor"/><circle cx="17.5" cy="11.5" r="0.7" fill="currentColor"/></FIc>,

  /* ---------- Items / world ---------- */
  Scroll: (p) => <FIc {...p}><path d="M5 5a3 3 0 0 1 3-3h11v15a3 3 0 0 1-3 3H6"/><path d="M5 5v13a3 3 0 0 0 3 3M19 17H8"/><path d="M11 8h5M11 12h5"/></FIc>,
  Sword: (p) => <FIc {...p}><path d="M20 4 9 15"/><path d="M11 17l-4 4-3-3 4-4"/><path d="m7 17 1 1M14 4h6v6"/></FIc>,
  Shield: (p) => <FIc {...p}><path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3Z"/><path d="M8 12c1 2 2.5 3 4 3s3-1 4-3"/></FIc>,
  Spellbook: (p) => <FIc {...p}><path d="M5 4a2 2 0 0 1 2-2h12v17H7a2 2 0 0 0-2 2V4Z"/><path d="M5 4v17M19 19H7a2 2 0 0 1 0-4h12"/><path d="M12 7v6M9 10h6"/></FIc>,
  Potion: (p) => <FIc {...p}><path d="M9 2h6M10 2v4M14 2v4"/><path d="M8 6h8l-1 3a5 5 0 0 1 1 3v5a3 3 0 0 1-3 3h-3a3 3 0 0 1-3-3v-5a5 5 0 0 1 1-3Z"/><path d="M8 14h8"/></FIc>,
  Skull: (p) => <FIc {...p}><path d="M5 11a7 7 0 1 1 14 0v4a2 2 0 0 1-2 2v3h-2v-2H9v2H7v-3a2 2 0 0 1-2-2Z"/><circle cx="9" cy="11" r="1.4"/><circle cx="15" cy="11" r="1.4"/><path d="M11 15l1 2 1-2"/></FIc>,
  Crown: (p) => <FIc {...p}><path d="M3 8l3 9h12l3-9-5 4-4-6-4 6Z"/><circle cx="3" cy="8" r="1.2"/><circle cx="12" cy="2" r="1.2"/><circle cx="21" cy="8" r="1.2"/></FIc>,
  Lantern: (p) => <FIc {...p}><path d="M10 2h4v2h-4z"/><path d="M9 4h6v3H9z"/><path d="M8 7h8v12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V7Z"/><path d="M12 21v1M10 11h4M10 15h4"/></FIc>,
  Quill: (p) => <FIc {...p}><path d="M20 4c0 8-6 14-14 14l-3-1 1-3C4 6 12 4 20 4Z"/><path d="m3 21 6-6"/><path d="M14 10l-4 4"/></FIc>,
  Lute: (p) => <FIc {...p}><path d="M14 4c1-2 4-2 5 0s0 4-2 4l-1 1"/><circle cx="9" cy="15" r="6"/><circle cx="9" cy="15" r="2"/><path d="M9 9V6"/></FIc>,
  Compass: (p) => <FIc {...p}><circle cx="12" cy="12" r="9"/><path d="m15 9-2 5-5 2 2-5Z" fill="currentColor" stroke="none"/></FIc>,
  MapPin: (p) => <FIc {...p}><path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13Z"/><circle cx="12" cy="9" r="2.5"/></FIc>,

  /* ---------- Combat / status ---------- */
  Initiative: (p) => <FIc {...p}><path d="M12 2v6M5 12h14"/><path d="m8 8 4-4 4 4M5 16h14M5 20h14"/></FIc>,
  Crit: (p) => <FIc {...p}><path d="m12 2 2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5Z"/></FIc>,
  HP: (p) => <FIc {...p}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/><path d="M11 10h2v5h-2zM9 12h6" stroke="currentColor"/></FIc>,
  AC: (p) => <FIc {...p}><path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3Z"/><path d="M10 13v-2a2 2 0 0 1 4 0v2M9 13h6v3H9z" fill="currentColor" stroke="none" fillOpacity="0.18"/></FIc>,
  Magic: (p) => <FIc {...p}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/></FIc>,

  /* ---------- Class glyphs ---------- */
  Barbarian: (p) => <FIc {...p}><path d="M4 20 9 9l3 3 3-3 5 11"/><path d="M9 9 7 4M15 9l2-5"/></FIc>,
  Bard:      (p) => <FIc {...p}><circle cx="12" cy="14" r="7"/><path d="M12 7V3M9 3h6"/><path d="M9 13v2M12 12v4M15 13v2"/></FIc>,
  Cleric:    (p) => <FIc {...p}><path d="M12 3v18M5 9h14M7 3l-2 4 2 3M17 3l2 4-2 3M7 21l-2-4 2-3M17 21l2-4-2-3"/></FIc>,
  Druid:     (p) => <FIc {...p}><path d="M12 21V8"/><path d="M12 8c-4-4-7 0-7 0s3 3 7 0Z"/><path d="M12 8c4-4 7 0 7 0s-3 3-7 0Z"/><path d="M12 8c0-4 4-5 4-5s-1 4-4 5Z"/></FIc>,
  Fighter:   (p) => <FIc {...p}><path d="M5 5l6 6M19 5l-6 6"/><path d="M11 11 4 18l2 2 7-7M13 11l7 7-2 2-7-7"/><circle cx="12" cy="12" r="1.5"/></FIc>,
  Monk:      (p) => <FIc {...p}><circle cx="12" cy="6" r="3"/><path d="M9 21v-7l-4-2M15 21v-7l4-2"/><path d="M8 14h8"/></FIc>,
  Paladin:   (p) => <FIc {...p}><path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3Z"/><path d="M12 8v8M8 12h8"/></FIc>,
  Ranger:    (p) => <FIc {...p}><path d="M5 19c4-4 10-10 14-14"/><path d="M5 19v-4M5 19h4M14 8l3-3M14 8l3 3"/><circle cx="9" cy="9" r="2"/></FIc>,
  Rogue:     (p) => <FIc {...p}><path d="M5 5h6v6Z"/><path d="m11 11 8 8M14 19h5v-5"/><circle cx="8" cy="8" r="1"/></FIc>,
  Sorcerer:  (p) => <FIc {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="4"/><path d="M12 8a4 4 0 0 1 4 4"/></FIc>,
  Warlock:   (p) => <FIc {...p}><circle cx="12" cy="12" r="9"/><path d="M9 9c1 2 5 2 6 0M8 14c1 3 7 3 8 0"/><circle cx="12" cy="12" r="2"/></FIc>,
  Wizard:    (p) => <FIc {...p}><path d="M12 2 9 10h6Z"/><path d="m6 22 6-12 6 12"/><path d="M8 16h8"/><circle cx="12" cy="6" r="0.8" fill="currentColor"/></FIc>,
};

window.Fantasy = Fantasy;
