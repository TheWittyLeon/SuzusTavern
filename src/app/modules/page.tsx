'use client';
/**
 * Modules — the way-to-start (Option B blocking surface; ST-037).
 *
 * A new user has no campaign and nowhere to begin, so "Start a campaign" routes
 * here: pick a prepared one-shot → configure the table → create it. The catalog
 * reflects the actually-seeded Phase-0 SRD starter set (no fabricated library).
 *
 * content_rating (baked-in decision): default 'sfw'; 'mature' is only selectable
 * on private/unlisted tables. It is client-typed (like dm_mode) — stored locally,
 * not sent to the engine, until the column lands (STORY-313). The hard SFW
 * interlock for public/streamed tables is enforced server-side (STORY-314); the
 * client gating here is convenience, not the guarantee.
 *
 * Suzu's PDF library + your homebrew tabs are post-MVP (disabled).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { createSession } from '@/lib/api/dnd';
import type { ContentRating, DmMode, Visibility } from '@/lib/api/types';
import {
  channelFromName,
  setSessionAnnotations,
} from '@/lib/sessionAnnotations';
import TavernShell from '@/components/TavernShell';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Pill from '@/components/Pill';
import Icon from '@/components/Icon';
import SuzuDM from '@/components/SuzuDM';
import styles from './Modules.module.css';

interface ModuleDef {
  id: string;
  title: string;
  blurb: string;
  levels: string;
  length: string;
  icon: 'Map' | 'Skull' | 'Scroll';
}

// The seeded Phase-0 SRD starter set (suzu_dnd: 22 items / 13 spells / 12 monsters).
const MODULES: ModuleDef[] = [
  {
    id: 'hollow-tide',
    title: 'The Hollow Tide Cave',
    blurb:
      'A coastal cave, a missing fishing crew, and goblins in the dark. The seeded starter one-shot — runs end-to-end with Suzu as DM.',
    levels: 'levels 1–2',
    length: 'one session',
    icon: 'Map',
  },
];

const VISIBILITIES: { id: Visibility; label: string; note: string }[] = [
  { id: 'public', label: 'Public', note: 'Anyone can find and watch. Always SFW.' },
  { id: 'unlisted', label: 'Unlisted', note: 'Only people with the link can join.' },
  { id: 'private', label: 'Private', note: 'Invite only.' },
];

function StarterForm({
  module,
  onCancel,
}: {
  module: ModuleDef;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [name, setName] = useState(module.title);
  const [dmMode, setDmMode] = useState<DmMode>('ai');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [rating, setRating] = useState<ContentRating>('sfw');
  const [submitting, setSubmitting] = useState(false);

  // Hard rule (client side): mature is only available on unlisted/private. A
  // public table is forced to SFW — protects the Twitch channel (STORY-314).
  const matureAllowed = visibility !== 'public';
  const effectiveRating: ContentRating = matureAllowed ? rating : 'sfw';

  const onVisibilityChange = (v: Visibility) => {
    setVisibility(v);
    if (v === 'public') setRating('sfw');
  };

  const handleBegin = async () => {
    const username = user?.username;
    if (!username || submitting) return;
    const channel = channelFromName(name);
    setSubmitting(true);
    try {
      const session = await createSession({ username, channel });
      // Persist the client-typed annotations until the engine columns land.
      const key = session?.session_id ?? channel;
      setSessionAnnotations(key, {
        dm_mode: dmMode,
        content_rating: effectiveRating,
        visibility,
        module_id: module.id,
      });
      toast({
        tone: 'success',
        title: 'Table set',
        message: `${name} is ready. Suzu will be your DM.`,
      });
      router.push('/dashboard');
    } catch {
      toast({
        tone: 'error',
        message: 'Could not start the table. Try again in a moment.',
      });
      setSubmitting(false);
    }
  };

  return (
    <Card pop className={styles.form}>
      <div className={styles.formHead}>
        <SuzuDM size={56} glow={false} aria-hidden />
        <div>
          <h2 className={styles.formTitle}>Set the table</h2>
          <p className={styles.formSub}>
            Running <strong>{module.title}</strong>. A few choices and we begin.
          </p>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Table name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
        />
      </label>

      <fieldset className={styles.field}>
        <legend className={styles.fieldLabel}>Dungeon Master</legend>
        <div className={styles.choices}>
          {([
            ['ai', 'Suzu DMs', 'narration · memory · dice in the open'],
            ['solo', 'Solo', 'no DM — just you and the engine'],
          ] as const).map(([id, label, note]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={dmMode === id}
              className={`${styles.choice} ${dmMode === id ? styles.choiceOn : ''}`}
              onClick={() => setDmMode(id)}
            >
              <span className={styles.choiceLabel}>{label}</span>
              <span className={styles.choiceNote}>{note}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.field}>
        <legend className={styles.fieldLabel}>Who can see it</legend>
        <div className={styles.choices}>
          {VISIBILITIES.map((v) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={visibility === v.id}
              className={`${styles.choice} ${visibility === v.id ? styles.choiceOn : ''}`}
              onClick={() => onVisibilityChange(v.id)}
            >
              <span className={styles.choiceLabel}>{v.label}</span>
              <span className={styles.choiceNote}>{v.note}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.field}>
        <legend className={styles.fieldLabel}>Content rating</legend>
        <div className={styles.choices}>
          <button
            type="button"
            role="radio"
            aria-checked={effectiveRating === 'sfw'}
            className={`${styles.choice} ${effectiveRating === 'sfw' ? styles.choiceOn : ''}`}
            onClick={() => setRating('sfw')}
          >
            <span className={styles.choiceLabel}>Safe for stream</span>
            <span className={styles.choiceNote}>default · always allowed</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={effectiveRating === 'mature'}
            aria-disabled={!matureAllowed}
            disabled={!matureAllowed}
            className={`${styles.choice} ${effectiveRating === 'mature' ? styles.choiceOn : ''}`}
            onClick={() => matureAllowed && setRating('mature')}
          >
            <span className={styles.choiceLabel}>Mature</span>
            <span className={styles.choiceNote}>private / unlisted only</span>
          </button>
        </div>
        {!matureAllowed && (
          <p className={styles.interlock}>
            <Icon name="Shield" size={12} aria-hidden /> Public tables are always
            safe-for-stream — it protects the channel.
          </p>
        )}
      </fieldset>

      <div className={styles.formFoot}>
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Back
        </Button>
        <Button
          variant="primary"
          onClick={() => void handleBegin()}
          disabled={submitting || name.trim().length === 0}
          leadingIcon={<Icon name="D20" size={14} aria-hidden />}
        >
          {submitting ? 'Setting the table…' : 'Begin'}
        </Button>
      </div>
    </Card>
  );
}

export default function ModulesPage() {
  const [selected, setSelected] = useState<ModuleDef | null>(null);

  return (
    <TavernShell active="modules" title="Start a campaign">
      <div className={styles.tabs} role="tablist" aria-label="Module source">
        <span className={`${styles.tab} ${styles.tabOn}`} role="tab" aria-selected="true">
          Official one-shots
        </span>
        <span className={styles.tab} role="tab" aria-disabled="true" title="Coming soon">
          Suzu&rsquo;s library <span className={styles.soon}>soon</span>
        </span>
        <span className={styles.tab} role="tab" aria-disabled="true" title="Coming soon">
          Your homebrew <span className={styles.soon}>soon</span>
        </span>
      </div>

      {selected ? (
        <StarterForm module={selected} onCancel={() => setSelected(null)} />
      ) : (
        <div className={styles.grid}>
          {MODULES.map((m) => (
            <Card key={m.id} className={styles.module}>
              <span className={styles.moduleIcon} aria-hidden>
                <Icon name={m.icon} size={26} />
              </span>
              <div className={styles.moduleHead}>
                <div className={styles.modulePills}>
                  <Pill tone="lav">{m.levels}</Pill>
                  <Pill tone="muted">{m.length}</Pill>
                </div>
                <h2 className={styles.moduleTitle}>{m.title}</h2>
                <p className={styles.moduleBlurb}>{m.blurb}</p>
              </div>
              <div className={styles.moduleFoot}>
                <Button
                  variant="primary"
                  onClick={() => setSelected(m)}
                  leadingIcon={<Icon name="D20" size={14} aria-hidden />}
                >
                  Run this
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </TavernShell>
  );
}
