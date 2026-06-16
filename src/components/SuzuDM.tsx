'use client';

import { forwardRef, useId, type CSSProperties, type HTMLAttributes } from 'react';
import { useReducedMotion } from '@/lib/useReducedMotion';
import styles from './SuzuDM.module.css';

export type SuzuDMProps = {
  /** Container size in px. Default: 96 */
  size?: number;
  /** Mouth open/close animation. Default: false */
  talking?: boolean;
  /** Render the DM hat. Default: true */
  hat?: boolean;
  /** Render the halo glow layer. Default: true */
  glow?: boolean;
  style?: CSSProperties;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>;

/**
 * SuzuDM mascot — 6-layer animated SVG persocom.
 *
 * Animations: halo pulse, orbit ring rotation, eye blink, mouth open/close,
 * port-light breath. All are suppressed under prefers-reduced-motion; a static
 * pose is rendered instead (eyes open, smile, no orbit spin).
 *
 * Decorative element → aria-hidden.
 *
 * API-1: forwardRef — ref forwarded to the root <div>.
 * API-2: spreads ...rest so callers can pass data-*, aria-*, id, style, events.
 * API-5: gradient IDs use useId() to prevent collisions between instances.
 */
const SuzuDM = forwardRef<HTMLDivElement, SuzuDMProps>(function SuzuDM(
  { size = 96, talking = false, hat = true, glow = true, style, ...rest },
  ref,
) {
  const reducedMotion = useReducedMotion();

  // API-5: useId() prevents gradient ID collisions when multiple SuzuDM
  // instances render at the same size — size-based IDs would alias <defs>.
  const uid = useId();
  const glowId = `m-glow-${uid}`;
  const faceId = `m-face-${uid}`;
  const hatId = `m-hat-${uid}`;

  return (
    <div
      ref={ref}
      data-component="SuzuDM"
      aria-hidden="true"
      style={{ width: size, height: size, position: 'relative', ...style }}
      {...rest}
    >
      <svg
        viewBox="0 0 140 150"
        width={size}
        height={size}
        className={styles.mascot}
        style={{ display: 'block' }}
      >
        <defs>
          <radialGradient id={glowId} cx="50%" cy="55%" r="60%">
            <stop offset="0%" stopColor="var(--accent-3)" stopOpacity="0.9" />
            <stop offset="60%" stopColor="var(--accent-2)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={faceId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--accent-3)" stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id={hatId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-2)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>

        {/* Layer 1 — halo glow */}
        {glow && (
          <circle cx="70" cy="85" r="56" fill={`url(#${glowId})`} opacity="0.85">
            {!reducedMotion && (
              <animate
                attributeName="r"
                values="54;58;54"
                dur="4s"
                repeatCount="indefinite"
              />
            )}
          </circle>
        )}

        {/* Layer 2 — orbit rings */}
        <g fill="none" stroke="var(--accent-2)" strokeOpacity="0.45" strokeWidth="1">
          <ellipse cx="70" cy="85" rx="48" ry="20" transform="rotate(-18 70 85)">
            {!reducedMotion && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="-18 70 85"
                to="342 70 85"
                dur="14s"
                repeatCount="indefinite"
              />
            )}
          </ellipse>
          <ellipse
            cx="70"
            cy="85"
            rx="44"
            ry="18"
            transform="rotate(28 70 85)"
            strokeOpacity="0.25"
          >
            {!reducedMotion && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="28 70 85"
                to="-332 70 85"
                dur="22s"
                repeatCount="indefinite"
              />
            )}
          </ellipse>
        </g>

        {/* Layer 3 — face circle */}
        <circle
          cx="70"
          cy="85"
          r="32"
          fill={`url(#${faceId})`}
          stroke="var(--accent-2)"
          strokeOpacity="0.4"
        />

        {/* Layer 4 — cat ears */}
        <path d="M50 63 L56 53 L62 65 Z" fill="var(--accent-3)" opacity="0.85" />
        <path d="M78 65 L84 53 L90 63 Z" fill="var(--accent-3)" opacity="0.85" />

        {/* Layer 5 — eyes */}
        <g fill="var(--accent-2)">
          <rect x="58" y={81} width="6" height={10} rx="3">
            {!talking && !reducedMotion && (
              <>
                <animate
                  attributeName="height"
                  values="10;2;10"
                  keyTimes="0;0.06;0.12"
                  dur="5s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="y"
                  values="81;85;81"
                  keyTimes="0;0.06;0.12"
                  dur="5s"
                  repeatCount="indefinite"
                />
              </>
            )}
          </rect>
          <rect x="76" y={81} width="6" height={10} rx="3">
            {!talking && !reducedMotion && (
              <>
                <animate
                  attributeName="height"
                  values="10;2;10"
                  keyTimes="0;0.06;0.12"
                  dur="5s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="y"
                  values="81;85;81"
                  keyTimes="0;0.06;0.12"
                  dur="5s"
                  repeatCount="indefinite"
                />
              </>
            )}
          </rect>
        </g>

        {/* Layer 6 — mouth */}
        {talking ? (
          <ellipse cx="70" cy="98" rx="4" ry="2.5" fill="var(--accent)">
            {!reducedMotion && (
              <animate
                attributeName="ry"
                values="1.2;3;1.2"
                dur="0.5s"
                repeatCount="indefinite"
              />
            )}
          </ellipse>
        ) : (
          <path
            d="M65 98 Q70 101 75 98"
            stroke="var(--accent)"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        )}

        {/* Layer 7 — DM hat */}
        {hat && (
          <g>
            <path
              d="M70 22 L85 56 Q70 60 55 56 Z"
              fill={`url(#${hatId})`}
              stroke="var(--accent-2)"
              strokeOpacity="0.5"
            />
            <ellipse cx="70" cy="58" rx="18" ry="3" fill="var(--accent-2)" opacity="0.7" />
            <circle cx="70" cy="22" r="2.5" fill="var(--crit)" />
            <circle cx="64" cy="40" r="1.2" fill="var(--crit)" opacity="0.9" />
            <circle cx="76" cy="34" r="1" fill="#fff" opacity="0.7" />
            <circle cx="72" cy="48" r="0.9" fill="var(--crit)" opacity="0.7" />
          </g>
        )}

        {/* Layer 8 — port lights */}
        <circle cx="38" cy="85" r="1.6" fill="var(--accent)">
          {!reducedMotion && (
            <animate
              attributeName="opacity"
              values="1;0.2;1"
              dur="2.4s"
              repeatCount="indefinite"
            />
          )}
        </circle>
        <circle cx="102" cy="85" r="1.6" fill="var(--accent-2)">
          {!reducedMotion && (
            <animate
              attributeName="opacity"
              values="0.2;1;0.2"
              dur="2.4s"
              repeatCount="indefinite"
            />
          )}
        </circle>
      </svg>
    </div>
  );
});

SuzuDM.displayName = 'SuzuDM';
export default SuzuDM;
