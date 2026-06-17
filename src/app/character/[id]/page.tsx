'use client';
/**
 * Character landing — /character/[id].
 *
 * INTERIM (Sprint 6 P0): the full 5e sheet (ST-054–058: identity card, ability +
 * skills panel, inventory, spells) is deferred pending scope confirmation. The
 * create wizard routes here (ST-052), so this renders a coherent "character
 * created" confirmation from the engine's sheet summary instead of a 404/stub.
 *
 * The engine's GET /characters/:id returns a formatted SUMMARY STRING
 * ({ sheet: "Name — Race Class Lv.1 (Background) | HP:.. AC:.. | STR:.. ..." }),
 * not structured fields — the full sheet will need a structured read (tracked
 * for ST-054). For now we surface that summary honestly.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthProvider';
import { getCharacter } from '@/lib/api/dnd';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Card from '@/components/Card';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import Icon from '@/components/Icon';
import styles from './CharacterView.module.css';

interface ParsedSheet {
  /** Leading identity line, e.g. "Velka — Half-Elf Rogue Lv.1 (Charlatan)". */
  identity: string;
  /** Remaining "key:value" segments split on " | ". */
  segments: string[];
}

function parseSheet(sheet: string): ParsedSheet {
  const parts = sheet.split(' | ').map((s) => s.trim()).filter(Boolean);
  const [identity, ...segments] = parts;
  return { identity: identity ?? sheet, segments };
}

export default function CharacterPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { user } = useAuth();
  const router = useRouter();
  const username = user?.username ?? null;

  const [sheet, setSheet] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!username || !id) return;
      try {
        const data = await getCharacter(id, username, signal);
        const sheetStr = typeof data.sheet === 'string' ? data.sheet : '';
        if (!signal.aborted) {
          setSheet(sheetStr);
          setState('ok');
        }
      } catch {
        if (!signal.aborted) setState('error');
      }
    },
    [username, id],
  );

  useEffect(() => {
    if (!username) return;
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [username, load]);

  if (!user) {
    return (
      <main aria-busy="true" aria-label="Loading character" style={{ padding: '32px 28px' }}>
        <PageSkeleton variant="card" lines={3} />
      </main>
    );
  }

  const parsed = sheet ? parseSheet(sheet) : null;
  const title = parsed?.identity ? parsed.identity.split('—')[0].trim() : 'Character';

  return (
    <TavernShell
      active="dashboard"
      title={state === 'ok' ? title : 'Character'}
      actions={
        <Button variant="ghost" href="/dashboard">
          Back to dashboard
        </Button>
      }
    >
      {state === 'loading' && <PageSkeleton variant="card" lines={4} />}

      {state === 'error' && (
        <Card className={styles.panel}>
          <p className={styles.errorTitle}>Suzu can&rsquo;t find that one.</p>
          <p className={styles.errorBody}>
            The character may not exist, or it isn&rsquo;t yours to view.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" href="/character/new">
              Create a character
            </Button>
            <Button variant="ghost" href="/dashboard">
              Back to dashboard
            </Button>
          </div>
        </Card>
      )}

      {state === 'ok' && parsed && (
        <div className={styles.wrap}>
          <Card pop className={styles.heroCard}>
            <Pill tone="good" dot>
              created
            </Pill>
            <h2 className={styles.identity}>{parsed.identity}</h2>
            {parsed.segments.length > 0 && (
              <ul className={styles.statLine} aria-label="Character stats">
                {parsed.segments.map((seg, i) => (
                  <li key={i} className={`mono ${styles.statSeg}`}>
                    {seg}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className={styles.panel}>
            <div className={styles.soonHead}>
              <Icon name="Scroll" size={16} aria-hidden />
              <span>Full character sheet</span>
              <Pill tone="lav">soon</Pill>
            </div>
            <p className={styles.soonBody}>
              Your character is saved. The full sheet — ability scores, skills, inventory,
              and spells — arrives in the next update. Until then, you can take this
              character into a session from the dashboard.
            </p>
            <div className={styles.actions}>
              <Button
                variant="primary"
                onClick={() => router.push('/lobby')}
                leadingIcon={<Icon name="Compass" size={14} aria-hidden />}
              >
                Find a table
              </Button>
              <Button variant="ghost" href="/character/new">
                Create another
              </Button>
            </div>
          </Card>
        </div>
      )}
    </TavernShell>
  );
}
