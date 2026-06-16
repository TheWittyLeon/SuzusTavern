import { type IconName, ICON_PATHS } from '@/components/icons';

export type { IconName };

export interface IconProps {
  name: IconName;
  /** Rendered size in px. Default: 24 */
  size?: number;
  /** SVG fill. Default: 'none' (stroke-based icons). Override for fill-heavy icons. */
  fill?: string;
  /** Stroke width. Default: 1.7 */
  sw?: number;
  /** Accessible title — switches the icon to role="img" with this as the label. */
  title?: string;
  /** Alias for title. If both provided, title wins. */
  label?: string;
  color?: string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Renders a named SVG icon from the Suzu's Tavern icon set.
 *
 * By default the icon is decorative (aria-hidden). Provide `title` or `label`
 * to make it semantic (role="img" + aria-label).
 *
 * Default size is 24px (spec §4 decision: exposed default on the component).
 * The inner KIc renderer in the design system defaults to 18; pages/kit use 22–32.
 * The component default of 24 is a neutral mid-point; callers override as needed.
 */
export default function Icon({
  name,
  size = 24,
  fill = 'none',
  sw = 1.7,
  title,
  label,
  color,
  style,
  className,
}: IconProps) {
  const paths = ICON_PATHS[name];
  const accessibleLabel = title ?? label;
  const isDecorative = !accessibleLabel;

  const svgProps = isDecorative
    ? { 'aria-hidden': true as const }
    : { role: 'img' as const, 'aria-label': accessibleLabel };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={color ?? 'currentColor'}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block', ...style }}
      className={className}
      {...svgProps}
       
      dangerouslySetInnerHTML={{ __html: paths }}
    />
  );
}
