/* Placeholder mascot: a soft "persocom" identity orb. Original art, abstract. */
function Mascot({ size = 96, mood = "calm", talking = false, style }) {
  const eyeColor = "var(--accent-2)";
  const blink = talking ? 0 : 1;
  return (
    <div className="nn-mascot" style={{ width: size, height: size, position: "relative", ...style }}>
      {/* Halo / ring */}
      <svg viewBox="0 0 120 120" width={size} height={size} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <radialGradient id="m-glow" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="var(--accent-3)" stopOpacity="0.9" />
            <stop offset="60%" stopColor="var(--accent-2)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="m-face" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--accent-3)" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        {/* outer halo */}
        <circle cx="60" cy="60" r="56" fill="url(#m-glow)" opacity="0.85">
          <animate attributeName="r" values="54;58;54" dur="4s" repeatCount="indefinite" />
        </circle>
        {/* orbit rings */}
        <g fill="none" stroke="var(--accent-2)" strokeOpacity="0.45" strokeWidth="1">
          <ellipse cx="60" cy="60" rx="48" ry="20" transform="rotate(-18 60 60)">
            <animateTransform attributeName="transform" type="rotate" from="-18 60 60" to="342 60 60" dur="14s" repeatCount="indefinite" />
          </ellipse>
          <ellipse cx="60" cy="60" rx="44" ry="18" transform="rotate(28 60 60)" strokeOpacity="0.25">
            <animateTransform attributeName="transform" type="rotate" from="28 60 60" to="-332 60 60" dur="22s" repeatCount="indefinite" />
          </ellipse>
        </g>
        {/* face disk */}
        <circle cx="60" cy="60" r="32" fill="url(#m-face)" stroke="var(--accent-2)" strokeOpacity="0.4" />
        {/* eyes */}
        <g fill={eyeColor}>
          <rect x="48" y={56} width="6" height={8 * blink + 2} rx="3">
            {!talking && <animate attributeName="height" values="10;2;10" keyTimes="0;0.06;0.12" dur="5s" repeatCount="indefinite" />}
            {!talking && <animate attributeName="y" values="56;60;56" keyTimes="0;0.06;0.12" dur="5s" repeatCount="indefinite" />}
          </rect>
          <rect x="66" y={56} width="6" height={8 * blink + 2} rx="3">
            {!talking && <animate attributeName="height" values="10;2;10" keyTimes="0;0.06;0.12" dur="5s" repeatCount="indefinite" />}
            {!talking && <animate attributeName="y" values="56;60;56" keyTimes="0;0.06;0.12" dur="5s" repeatCount="indefinite" />}
          </rect>
        </g>
        {/* mouth — small arc / "o" depending on talking */}
        {talking ? (
          <ellipse cx="60" cy="74" rx="4" ry="2.5" fill="var(--accent)">
            <animate attributeName="ry" values="1.2;3;1.2" dur="0.5s" repeatCount="indefinite" />
          </ellipse>
        ) : (
          <path d="M55 73 Q60 76 65 73" stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinecap="round" />
        )}
        {/* cat ear hint — two soft triangles on head */}
        <path d="M40 38 L46 28 L52 40 Z" fill="var(--accent-3)" opacity="0.85" />
        <path d="M68 40 L74 28 L80 38 Z" fill="var(--accent-3)" opacity="0.85" />
        {/* port lights */}
        <circle cx="36" cy="60" r="1.6" fill="var(--accent)"><animate attributeName="opacity" values="1;0.2;1" dur="2.4s" repeatCount="indefinite" /></circle>
        <circle cx="84" cy="60" r="1.6" fill="var(--accent-2)"><animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" repeatCount="indefinite" /></circle>
      </svg>
    </div>
  );
}

window.Mascot = Mascot;
