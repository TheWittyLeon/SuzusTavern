/* Lightweight inline SVG icon set — stroke-based, currentColor */
const Ic = ({ d, size = 18, fill = "none", sw = 1.7, children, vb = "0 0 24 24", style }) => (
  <svg width={size} height={size} viewBox={vb} fill={fill} stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}>
    {d ? <path d={d} /> : children}
  </svg>
);

const Icon = {
  Home:    (p) => <Ic {...p}><path d="M3 11l9-8 9 8" /><path d="M5 9v12h14V9" /></Ic>,
  Bot:     (p) => <Ic {...p}><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M9 12h.01M15 12h.01" /><path d="M12 3v4" /><circle cx="12" cy="3" r="1" /><path d="M8 19v2M16 19v2" /></Ic>,
  Heart:   (p) => <Ic {...p}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/></Ic>,
  Pulse:   (p) => <Ic {...p}><path d="M3 12h4l2-7 4 14 2-7h6"/></Ic>,
  Brain:   (p) => <Ic {...p}><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3 3 3 0 0 0 2 3v1a3 3 0 0 0 3 3"/><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 3 3 3 0 0 1-2 3v1a3 3 0 0 1-3 3"/><path d="M9 4h6M9 20h6"/></Ic>,
  Chat:    (p) => <Ic {...p}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/></Ic>,
  History: (p) => <Ic {...p}><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></Ic>,
  Bell:    (p) => <Ic {...p}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z"/><path d="M10 21a2 2 0 0 0 4 0"/></Ic>,
  Sliders: (p) => <Ic {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h14M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/></Ic>,
  Shield:  (p) => <Ic {...p}><path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/></Ic>,
  Cmd:     (p) => <Ic {...p}><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 9 3 3-3 3M13 15h4"/></Ic>,
  Gift:    (p) => <Ic {...p}><path d="M3 8h18v4H3z"/><path d="M5 12v9h14v-9"/><path d="M12 8v13"/><path d="M12 8c-2 0-4-1-4-3s2-3 4 0c2-3 4-2 4 0s-2 3-4 3Z"/></Ic>,
  Logs:    (p) => <Ic {...p}><path d="M4 4h13l3 3v13a0 0 0 0 1 0 0H4z"/><path d="M8 10h8M8 14h8M8 18h5"/></Ic>,
  Users:   (p) => <Ic {...p}><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2"/><path d="M15 20a4 4 0 0 1 6-3"/></Ic>,
  Stats:   (p) => <Ic {...p}><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></Ic>,
  Cpu:     (p) => <Ic {...p}><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/><rect x="9" y="9" width="6" height="6" rx="1"/></Ic>,
  Mic:     (p) => <Ic {...p}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></Ic>,
  Play:    (p) => <Ic {...p}><path d="M6 4v16l14-8L6 4z" fill="currentColor" stroke="none"/></Ic>,
  Pause:   (p) => <Ic {...p}><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/></Ic>,
  Power:   (p) => <Ic {...p}><path d="M12 3v9"/><path d="M5.6 7.6a8 8 0 1 0 12.8 0"/></Ic>,
  Settings:(p) => <Ic {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.3 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></Ic>,
  Search:  (p) => <Ic {...p}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></Ic>,
  Sun:     (p) => <Ic {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></Ic>,
  Moon:    (p) => <Ic {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></Ic>,
  Menu:    (p) => <Ic {...p}><path d="M4 6h16M4 12h16M4 18h16"/></Ic>,
  Chevron: (p) => <Ic {...p}><path d="m9 6 6 6-6 6"/></Ic>,
  Plus:    (p) => <Ic {...p}><path d="M12 5v14M5 12h14"/></Ic>,
  Send:    (p) => <Ic {...p}><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></Ic>,
  Spark:   (p) => <Ic {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></Ic>,
  Twitch:  (p) => <Ic {...p}><path d="M4 4h16v10l-4 4h-4l-3 3v-3H4V4z"/><path d="M11 8v5M16 8v5"/></Ic>,
  Discord: (p) => <Ic {...p}><path d="M19 6c-1.5-.7-3-1-4.5-1l-.4 1c-2 0-2.2 0-4.2 0l-.4-1C8 5 6.5 5.3 5 6c-1 2-2 5-2 9 1.6 1.3 3.2 2 4.7 2l.7-1.2C7.5 15.5 7 15 7 15c3 1.5 7 1.5 10 0 0 0-.5.5-1.4.8L16.3 17c1.5 0 3.1-.7 4.7-2 0-4-1-7-2-9Z"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/></Ic>,
  Wave:    (p) => <Ic {...p}><path d="M2 12c2 0 2-4 4-4s2 8 4 8 2-12 4-12 2 8 4 8 2-4 4-4"/></Ic>,
  Eye:     (p) => <Ic {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></Ic>,
};

window.Icon = Icon;
