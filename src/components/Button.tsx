import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';

// ---- Variant / size unions ----
export type ButtonVariant = 'primary' | 'ghost' | 'default' | 'danger' | 'crit';
export type ButtonSize = 'default' | 'lg' | 'icon';

// ---- Shared props (excluding element-specific conflicting keys) ----
interface ButtonBaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children?: ReactNode;
  className?: string;
}

// ---- Polymorphic: <a> when href is present ----
type AnchorMode = ButtonBaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonBaseProps> & {
    href: string;
    disabled?: boolean;
  };

type ButtonMode = ButtonBaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonBaseProps> & {
    href?: undefined;
  };

export type ButtonProps = AnchorMode | ButtonMode;

/**
 * Polymorphic button primitive.
 *
 * - Renders `<button type="button">` by default (override `type` via spread).
 * - Renders `<a>` when `href` is provided.
 * - Maps `variant` and `size` to global `.btn*` utility classes from globals.css.
 * - Icon-only buttons (`size="icon"`, no children) must provide `aria-label`
 *   via standard HTML attribute spread — enforced by convention, not type system,
 *   because the aria-label lives in the passthrough attrs.
 * - API-1: forwardRef — ref forwarded to the root element (button or anchor).
 * - API-3: disabled anchor guards onClick/onKeyDown to prevent handler fires.
 * - API-4: disabled styling delegated to CSS (.btn:disabled, .btn[aria-disabled]).
 */
const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  function Button(props, ref) {
    const {
      variant = 'default',
      size = 'default',
      leadingIcon,
      trailingIcon,
      children,
      className = '',
      ...rest
    } = props;

    // Build class list from global utilities
    const variantClass =
      variant === 'primary'
        ? 'btn-primary'
        : variant === 'ghost'
          ? 'btn-ghost'
          : variant === 'danger'
            ? 'btn-danger'
            : variant === 'crit'
              ? 'btn-crit'
              : ''; // 'default' — base .btn styles only

    const sizeClass =
      size === 'lg' ? 'btn-lg' : size === 'icon' ? 'btn-icon' : '';

    const cls = ['btn', variantClass, sizeClass, className]
      .filter(Boolean)
      .join(' ');

    const content = (
      <>
        {leadingIcon}
        {children}
        {trailingIcon}
      </>
    );

    if ('href' in props && props.href !== undefined) {
      const { href, disabled, onClick, onKeyDown, ...anchorRest } = rest as Omit<
        AnchorMode,
        'variant' | 'size' | 'leadingIcon' | 'trailingIcon' | 'children' | 'className'
      >;

      // API-3: disabled anchor must not fire handlers
      const handleClick: AnchorHTMLAttributes<HTMLAnchorElement>['onClick'] =
        disabled
          ? (e) => { e.preventDefault(); e.stopPropagation(); }
          : onClick;
      const handleKeyDown: AnchorHTMLAttributes<HTMLAnchorElement>['onKeyDown'] =
        disabled
          ? (e) => { e.preventDefault(); e.stopPropagation(); }
          : onKeyDown;

      return (
        <a
          ref={ref as Ref<HTMLAnchorElement>}
          href={disabled ? undefined : href}
          aria-disabled={disabled || undefined}
          data-component="Button"
          className={cls}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          {...anchorRest}
        >
          {content}
        </a>
      );
    }

    const { disabled, type = 'button', ...buttonRest } = rest as Omit<
      ButtonMode,
      'variant' | 'size' | 'leadingIcon' | 'trailingIcon' | 'children' | 'className'
    >;

    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        type={type}
        disabled={disabled}
        data-component="Button"
        className={cls}
        // API-4: disabled styles moved to CSS (.btn:disabled, .btn[aria-disabled="true"])
        {...buttonRest}
      >
        {content}
      </button>
    );
  },
);

Button.displayName = 'Button';
export default Button;
