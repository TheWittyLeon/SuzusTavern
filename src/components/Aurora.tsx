import type { CSSProperties, ReactNode } from 'react';

export interface AuroraProps {
  children?: ReactNode;
  style?: CSSProperties;
  /** Additional className(s) composed alongside the global .aurora class. */
  className?: string;
}

/**
 * Thin wrapper over the global `.aurora` CSS class.
 *
 * All animation lives in globals.css (.aurora::before + aurora-drift keyframe).
 * The reduced-motion guard is handled via a CSS @media rule in globals.css so it
 * applies everywhere the class is used, with or without this wrapper.
 *
 * SSR-safe — no client state or effects needed.
 */
export default function Aurora({ children, style, className }: AuroraProps) {
  const cls = className ? `aurora ${className}` : 'aurora';
  return (
    <div data-component="Aurora" className={cls} style={style}>
      {children}
    </div>
  );
}
