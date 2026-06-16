import {
  forwardRef,
  type ElementType,
  type CSSProperties,
  type ReactNode,
  type ComponentPropsWithoutRef,
  type Ref,
} from 'react';

export interface CardOwnProps {
  /** Apply `var(--density-pad)` padding. Default: true */
  padding?: boolean;
  /** Use `--shadow-pop` (elevated glow) instead of `--shadow-soft`. Default: false */
  pop?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** Polymorphic element override. Default: 'div' */
  as?: ElementType;
}

export type CardProps<T extends ElementType = 'div'> = CardOwnProps &
  Omit<ComponentPropsWithoutRef<T>, keyof CardOwnProps>;

/**
 * Glass-surface card primitive.
 *
 * Uses the global `.glass` utility class for backdrop-filter, border, and
 * border-radius. Only `boxShadow` and `padding` are overridden per-instance.
 *
 * API-1: forwardRef exposes the root element ref. Typed as HTMLElement to
 * accommodate the polymorphic `as` prop — callers that need exact types can cast.
 */
const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    padding = true,
    pop = false,
    className = '',
    style,
    children,
    as,
    ...rest
  },
  ref,
) {
  const Tag = (as ?? 'div') as ElementType;

  return (
    <Tag
      ref={ref as Ref<HTMLElement>}
      data-component="Card"
      className={`glass ${className}`.trim()}
      style={{
        padding: padding ? 'var(--density-pad)' : 0,
        boxShadow: pop ? 'var(--shadow-pop)' : 'var(--shadow-soft)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
});

Card.displayName = 'Card';
export default Card;
