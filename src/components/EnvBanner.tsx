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
 */
import styles from './EnvBanner.module.css';
import { env } from '@/lib/env';

const ENV_LABEL: Record<'dev' | 'local', string> = {
  dev: 'DEV ENVIRONMENT',
  local: 'LOCAL ENVIRONMENT',
};

const ENV_DESCRIPTION: Record<'dev' | 'local', string> = {
  dev:   'You are in the development environment — not production data.',
  local: 'You are running locally — not production data.',
};

export default function EnvBanner() {
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
