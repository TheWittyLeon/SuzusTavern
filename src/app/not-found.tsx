/**
 * src/app/not-found.tsx — Branded 404 (TAV-1).
 *
 * Server Component. Next.js renders this inside the root layout's <body>, so
 * globals.css tokens + the data-vibe palette apply. Replaces the framework
 * default not-found, which rendered unstyled near-invisible text (1.14:1 in
 * light palettes) with no way back into the app (UIR2-TAV-1). Also the fix
 * vehicle flagged for the bare /admin/review 404 (UIR2-TAV-10).
 *
 * SuzuDM is a client island but renders fine from a Server Component (same
 * pattern as the landing page header). No 'use client' needed here.
 */

import Link from 'next/link';
import SuzuDM from '@/components/SuzuDM';
import styles from './not-found.module.css';

export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className={styles.wrap}>
      <div className={`glass ${styles.card}`}>
        <SuzuDM size={64} glow={false} aria-hidden="true" />
        <div className={styles.code}>404</div>
        <h1 className={styles.title}>This path isn&rsquo;t on the map</h1>
        <p className={styles.body}>
          The page you were looking for wandered off into the Everfree. Suzu can
          point you back to a well-lit table.
        </p>
        <div className={styles.actions}>
          <Link href="/dashboard" className="btn btn-primary btn-lg">
            Return to your table
          </Link>
          <Link href="/" className="btn btn-ghost btn-lg">
            Back to the landing
          </Link>
        </div>
      </div>
    </main>
  );
}
