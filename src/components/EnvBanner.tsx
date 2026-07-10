/**
 * EnvBanner — persistent deployment-environment indicator.
 *
 * Reads the build-time NEXT_PUBLIC_DEPLOY_ENV constant via env.DEPLOY_ENV.
 * Renders a 32 px sticky bar at the top of every page when the env is 'dev'
 * or 'local'. Renders null for 'prod'.
 *
 * Contract:
 *   - data-env-banner attribute is always present on the rendered element.
 *     Used by CI smoke tests (grep bundled JS / DOM for this attribute).
 *   - role="status" so screen readers announce it as a live region label.
 *   - Cannot be user-toggled — the value is baked at build/container time.
 *
 * Mount in src/app/layout.tsx, directly inside <body>, before other children.
 *
 * TAV-21: the banner is IN FLOW above the page content, so any full-height
 * layout (`height: 100dvh`, not `min-height`) elsewhere in the app must
 * subtract its height or its bottom edge sits off-screen. Since DEPLOY_ENV is
 * a build-time constant (not user-toggleable — see above), layout.tsx exposes
 * this height as the `--env-banner-h` CSS var directly via SSR (no client
 * effect / no document.documentElement mutation needed, so there's no
 * post-hydration layout flash the way a runtime-only value would need). Kept
 * here, next to the component that owns the real height, so the two can't
 * drift silently — mirrored again in EnvBanner.module.css's `.banner { height }`.
 */
import styles from './EnvBanner.module.css';
import { env } from '@/lib/env';

/** Must match `.banner { height }` in EnvBanner.module.css. */
export const ENV_BANNER_HEIGHT_PX = 32;

/** True whenever <EnvBanner/> below actually renders a bar (dev/local, never prod). */
export const ENV_BANNER_VISIBLE = env.DEPLOY_ENV !== 'prod';

const ENV_LABEL: Record<'dev' | 'local', string> = {
  dev: 'DEV ENVIRONMENT',
  local: 'LOCAL ENVIRONMENT',
};

const ENV_DESCRIPTION: Record<'dev' | 'local', string> = {
  dev:   'You are in the development environment — not production data.',
  local: 'You are running locally — not production data.',
};

export default function EnvBanner() {
  // Checked directly on env.DEPLOY_ENV (not the ENV_BANNER_VISIBLE constant
  // above) so TS control-flow narrows the 'dev' | 'local' lookups below —
  // narrowing only applies to a direct check on the same expression, not
  // through an indirect boolean proxy. ENV_BANNER_VISIBLE stays in sync by
  // construction (both are `env.DEPLOY_ENV !== 'prod'`).
  if (env.DEPLOY_ENV === 'prod') {
    return null;
  }

  const label = ENV_LABEL[env.DEPLOY_ENV];
  const description = ENV_DESCRIPTION[env.DEPLOY_ENV];

  return (
    <div
      className={styles.banner}
      role="status"
      aria-label={description}
      data-env-banner={env.DEPLOY_ENV}
    >
      <span className={styles.text} aria-hidden="true">
        &#9888; {label} &#8212; not production data
      </span>
      {/* Verbose SR description — the visible text is intentionally terse */}
      <span className={styles.srOnly}>{description}</span>
    </div>
  );
}
