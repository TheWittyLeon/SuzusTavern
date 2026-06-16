import { forwardRef, type HTMLAttributes } from 'react';
import styles from './Avatar.module.css';

export type AvatarProps = {
  /** Display name — first initial is shown in initials mode. Default: '?' */
  name?: string;
  /** Diameter in px. Default: 36 */
  size?: number;
  /** CSS color value to override the gradient background in initials mode. */
  color?: string;
  /** Image URL — activates image mode. Initials are not rendered. */
  src?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>;

/**
 * Circular avatar — initials or image mode.
 *
 * Initials: shows the uppercased first letter of the first word in `name`.
 * Image: `src` prop sets the background to `center/cover url(...)`.
 *
 * A11Y-5: role="img" + aria-label are unconditional — accessible name in both modes.
 * API-1: forwardRef — ref forwarded to the root <div>.
 * API-2: spreads ...rest so callers can pass data-*, aria-*, id, style, events.
 */
const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { name = '?', size = 36, color, src, style, ...rest },
  ref,
) {
  const initial = name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 1)
    .join('')
    .toUpperCase();

  const background = src
    ? `center/cover url(${src})`
    : color ?? 'linear-gradient(135deg, var(--accent), var(--accent-2))';

  return (
    <div
      ref={ref}
      data-component="Avatar"
      className={styles.avatar}
      // A11Y-5: role="img" + aria-label unconditional — accessible name in both modes
      role="img"
      aria-label={name}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background,
        ...style,
      }}
      {...rest}
    >
      {/* A11Y-5: initials hidden from SR since the root has aria-label */}
      {!src && <span aria-hidden="true">{initial}</span>}
    </div>
  );
});

Avatar.displayName = 'Avatar';
export default Avatar;
