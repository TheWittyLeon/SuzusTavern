/* Shared primitives — Card, Stat, Sparkline, audio waveform, etc. */

const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ---------- Card ---------- */
function Card({ children, className = "", style, padding = true, accent = false, ...rest }) {
  return (
    <div
      className={"glass " + className}
      style={{
        padding: padding ? "var(--density-pad)" : 0,
        position: "relative",
        ...style
      }}
      {...rest}
    >
      {accent && <span style={{
        position: "absolute", top: 0, left: 16, right: 16, height: 1,
        background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
        opacity: 0.5,
      }} />}
      {children}
    </div>
  );
}

/* ---------- Section header ---------- */
function SectionHead({ kicker, title, sub, action }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
      <div>
        {kicker && <div className="label" style={{ marginBottom: 6 }}>{kicker}</div>}
        <h2 className="display" style={{ fontSize: 22, color: "var(--ink)" }}>{title}</h2>
        {sub && <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 4 }}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------- Stat tile ---------- */
function Stat({ label, value, delta, deltaTone = "good", icon, accentColor }) {
  const tone = deltaTone === "good" ? "var(--good)" : deltaTone === "bad" ? "var(--bad)" : "var(--ink-3)";
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="label">{label}</div>
        {icon && (
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            display: "grid", placeItems: "center",
            background: `color-mix(in oklab, ${accentColor || "var(--accent)"} 14%, transparent)`,
            color: accentColor || "var(--accent)",
          }}>{icon}</div>
        )}
      </div>
      <div className="display" style={{ fontSize: 30, marginTop: 8, color: "var(--ink)" }}>{value}</div>
      {delta && (
        <div style={{ marginTop: 6, fontSize: 12, color: tone, fontWeight: 500 }}>
          {delta}
        </div>
      )}
    </Card>
  );
}

/* ---------- Sparkline ---------- */
function Sparkline({ data, color = "var(--accent)", height = 40, fill = true, animated = true }) {
  const w = 200, h = height;
  const max = Math.max(...data), min = Math.min(...data);
  const norm = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - ((v - min) / (max - min || 1)) * (h - 6) - 3
  ]);
  const path = norm.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(" ");
  const fillPath = path + ` L${w},${h} L0,${h} Z`;
  const id = useMemo(() => "spk-" + Math.random().toString(36).slice(2, 7), []);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={fillPath} fill={`url(#${id})`} />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {animated && <animate attributeName="stroke-dasharray" from="0,1000" to="1000,0" dur="2s" fill="freeze" />}
      </path>
    </svg>
  );
}

/* ---------- Live waveform ---------- */
function Waveform({ bars = 36, height = 36, active = true, color = "var(--accent)" }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    let r;
    const tick = () => { setT(performance.now() / 200); r = requestAnimationFrame(tick); };
    r = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(r);
  }, [active]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height }}>
      {Array.from({ length: bars }).map((_, i) => {
        const phase = i * 0.4 + t;
        const v = active
          ? 0.25 + 0.75 * Math.abs(Math.sin(phase) * Math.cos(phase * 0.3 + i * 0.2))
          : 0.18;
        return (
          <div key={i} style={{
            width: 3, height: `${v * 100}%`,
            background: color, borderRadius: 99,
            opacity: active ? 0.5 + 0.5 * v : 0.3,
            transition: active ? "none" : "height .3s ease",
          }} />
        );
      })}
    </div>
  );
}

/* ---------- Donut ring ---------- */
function Ring({ value = 60, size = 88, stroke = 8, color = "var(--accent)", label, sub }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (value / 100) * c;
  return (
    <div style={{ position: "relative", width: size, height: size, display: "grid", placeItems: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} stroke="var(--line)" strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)" }} />
      </svg>
      <div style={{ position: "absolute", textAlign: "center" }}>
        <div className="display" style={{ fontSize: 18, color: "var(--ink)" }}>{label || `${value}%`}</div>
        {sub && <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

/* ---------- Mood / emotion radar ---------- */
function Radar({ values, labels, size = 220, color = "var(--accent)" }) {
  const cx = size / 2, cy = size / 2, r = size * 0.38;
  const n = values.length;
  const points = values.map((v, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const rad = (v / 100) * r;
    return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
  });
  const poly = points.map(p => p.join(",")).join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[0.25, 0.5, 0.75, 1].map((s, i) => (
        <polygon key={i}
          points={Array.from({ length: n }).map((_, j) => {
            const a = -Math.PI / 2 + (j / n) * Math.PI * 2;
            return `${cx + Math.cos(a) * r * s},${cy + Math.sin(a) * r * s}`;
          }).join(" ")}
          fill="none" stroke="var(--line)" strokeWidth="1" />
      ))}
      {Array.from({ length: n }).map((_, i) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        return <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(a) * r} y2={cy + Math.sin(a) * r} stroke="var(--line)" />;
      })}
      <polygon points={poly} fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.6" />
      {points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill={color} />)}
      {labels.map((lab, i) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const x = cx + Math.cos(a) * (r + 14);
        const y = cy + Math.sin(a) * (r + 14);
        return <text key={i} x={x} y={y} fontSize="10" textAnchor="middle" fill="var(--ink-3)" style={{ fontFamily: "var(--font-ui)" }}>{lab}</text>;
      })}
    </svg>
  );
}

window.NN = { Card, SectionHead, Stat, Sparkline, Waveform, Ring, Radar };
