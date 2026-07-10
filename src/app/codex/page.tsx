'use client';
/**
 * Codex — the in-app 5e compendium (DDX-21).
 *
 * Reads content the engine already has (GET /api/dnd/catalog, proxied through
 * /api/dnd/**) and renders it as a browsable reference: content-type tabs down
 * the left rail, a searchable/filterable result list in the center, and a
 * detail drawer on the right — following the read-only Compendium mock in
 * `Suzu's Tavern Design System/ui_kits/web/compendium.jsx` (kind tabs + rail +
 * list + drawer), re-implemented against the real catalog response shape.
 *
 * The engine has no server-side search param (routes/catalog.py: system/type/
 * packs/user/limit/offset only) — filtering is client-side over the loaded
 * per-kind list (useCodexCatalog caches each kind's page in component state
 * once fetched, so tab-switching back doesn't re-fetch).
 *
 * Security posture (Kuro-Sec, DDX-21): this page only ever renders the
 * PUBLIC catalog. Private-pack visibility is NOT enforced end-to-end yet —
 * the engine's RLS runs as the `nekonova` superuser in production (which
 * bypasses row security), and until this pass a client could set its own
 * `?user=`/`?packs=` on the catalog request. Real per-user pack isolation is
 * pending the Track-A actor-enforcement work and the non-superuser RLS
 * cutover (STORY-PLAYFIX-PRODRLS) — neither is live yet. Until then, the
 * interim guard is server-side: the BFF (src/app/api/dnd/[...path]/route.ts)
 * strips any client-supplied `user`/`packs` query params on non-admin paths
 * before forwarding upstream, so a browser cannot assert its own identity or
 * scope. This page itself adds no client-side visibility logic and no
 * cross-user cache.
 *
 * Feature flag: gated behind CODEX_ENABLED (src/lib/config.ts) — disabled in
 * production until Codex ships broadly. Disabled renders redirect to
 * /dashboard so the route can't be reached by direct URL either; the nav tab
 * is hidden the same way (TavernShell).
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import TavernShell from '@/components/TavernShell';
import Card from '@/components/Card';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import PageSkeleton from '@/components/PageSkeleton';
import { useCodexCatalog, type FetchStatus } from '@/lib/dnd/useCodexCatalog';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { CODEX_ENABLED } from '@/lib/config';
import {
  CODEX_KINDS,
  CODEX_KIND_META,
  matchesSearch,
  spellLevelLabel,
  toneVar,
  type CodexKind,
} from '@/lib/dnd/codex';
import type {
  CatalogEquipmentData,
  CatalogItem,
  CatalogMonsterData,
  CatalogSpellData,
} from '@/lib/api/types';
import CodexRow from './CodexRow';
import CodexDetail from './CodexDetail';
import CodexDetailModal from './CodexDetailModal';
import styles from './Codex.module.css';

/** A11Y MAJOR-5: typeahead buffer reset window. */
const TYPEAHEAD_RESET_MS = 500;
/** A11Y MINOR-2: debounce window for the listHead count announcement. */
const COUNT_ANNOUNCE_DEBOUNCE_MS = 400;
/** A11Y CRITICAL-1: the drawer-vs-modal breakpoint. */
const NARROW_DRAWER_QUERY = '(max-width: 1280px)';

/** Per-kind secondary filter options, derived from the currently loaded page. */
function useSubfilterOptions(kind: CodexKind, items: CatalogItem[]) {
  return useMemo(() => {
    if (kind === 'spell') {
      const levels = Array.from(
        new Set(items.map((i) => (i.data as CatalogSpellData).level)),
      ).sort((a, b) => a - b);
      return levels.map((l) => ({ value: String(l), label: spellLevelLabel(l) }));
    }
    if (kind === 'monster') {
      const types = Array.from(
        new Set(
          items
            .map((i) => (i.data as CatalogMonsterData).monster_type)
            .filter((t): t is string => Boolean(t)),
        ),
      ).sort();
      return types.map((t) => ({ value: t, label: t }));
    }
    if (kind === 'item') {
      const types = Array.from(
        new Set(
          items
            .map((i) => (i.data as CatalogEquipmentData).item_type)
            .filter((t): t is string => Boolean(t)),
        ),
      ).sort();
      return types.map((t) => ({ value: t, label: t }));
    }
    return [];
  }, [kind, items]);
}

const SUBFILTER_LABEL: Partial<Record<CodexKind, string>> = {
  spell: 'Level',
  monster: 'Type',
  item: 'Item type',
};

// DDX21-1: a stable reference (not a fresh `[]` literal per render) for the
// gated-items fallback below — keeps `filtered`'s useMemo dep array
// (`[items, ...]`) actually stable across the (possibly several) renders
// where `kindReady` is false, instead of invalidating it every time.
const EMPTY_ITEMS: CatalogItem[] = [];

export default function CodexPage() {
  const router = useRouter();
  const [activeKind, setActiveKind] = useState<CodexKind>('spell');
  const [query, setQuery] = useState('');
  const [sub, setSub] = useState('');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(0);
  // A11Y CRITICAL-1: narrow-viewport detail modal (replaces the drawer's
  // display:none-with-no-fallback below 1280px).
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  // A11Y MINOR-2: the visible listHead count updates instantly (see the
  // `filtered.length` render below); this is the debounced text an AT user
  // actually hears, so rapid typing doesn't fire an announcement per keystroke.
  const [announcedCount, setAnnouncedCount] = useState('');

  const {
    counts,
    items: rawItems,
    itemsKind,
    status: rawStatus,
    retry,
  } = useCodexCatalog(activeKind);

  // DDX21-1 (fix pass 3, architectural — see useCodexCatalog.ts's doc comment
  // for the full mechanism): `rawItems`/`rawStatus` above can lag one render
  // behind `activeKind` right after a kind-tab switch, still holding the
  // PREVIOUS kind's rows. `itemsKind` is tagged in the exact same
  // state-update batch as `rawItems`, so `itemsKind !== activeKind` is true
  // for precisely that stale render. Force both to a safe "still loading,
  // nothing to show" shape for that window — every downstream computation
  // below (subfilter options, `filtered`, the row map, `selected`/
  // CodexDetail) reads these gated values, never the raw hook output, so a
  // kind-specific renderer can never receive another kind's data. This is a
  // single choke point rather than guarding individual fields one at a time
  // (~13 of them, per Aoi-UI's live-browser re-verify).
  const kindReady = itemsKind === activeKind;
  const items = kindReady ? rawItems : EMPTY_ITEMS;
  const status: FetchStatus = kindReady ? rawStatus : 'loading';

  const subfilterOptions = useSubfilterOptions(activeKind, items);
  const retryRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const railRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // A11Y MAJOR-5: buffered single-char type-to-find state — a ref, not state,
  // since it doesn't need to trigger a render on its own.
  const typeaheadRef = useRef<{ buffer: string; timer: ReturnType<typeof setTimeout> | null }>({
    buffer: '',
    timer: null,
  });
  const listboxId = useId();
  const panelId = useId();
  const activeMeta = CODEX_KIND_META[activeKind];

  // A11Y CRITICAL-1: track the viewport breakpoint that changes *behavior*
  // (not just CSS) — below 1280px the drawer becomes a modal. (The rail's
  // tablist was briefly also behavior-switched below 860px; reverted to
  // vertical-always — see Codex.module.css's .rail comment and
  // onRailKeyDown below.)
  const isNarrowDrawer = useMediaQuery(NARROW_DRAWER_QUERY);

  // DDX-21 follow-up: /codex is feature-flagged (CODEX_ENABLED, src/lib/config.ts)
  // — disabled in production until Codex ships broadly. Mirrors the client-side
  // role-gate pattern used by the admin pages (e.g. src/app/admin/flags/page.tsx):
  // redirect via effect + a render guard below, so direct URL entry can't reach
  // the page even though the nav tab is already hidden (TavernShell).
  useEffect(() => {
    if (!CODEX_ENABLED) router.replace('/dashboard');
  }, [router]);

  // Reset the secondary filter and selection whenever the active tab changes —
  // a spell-level filter or a selected spell has no meaning once you're
  // looking at monsters. This is a UX nicety (closes the drawer/modal
  // promptly), not the crash fix — the `kindReady`/`items`/`status` gate
  // above is what makes the stale-tick render safe regardless of this
  // effect's timing (see useCodexCatalog.ts's doc comment).
  useEffect(() => {
    setSub('');
    setSelectedSlug(null);
    setFocusedIdx(0);
    setMobileDetailOpen(false);
  }, [activeKind]);

  // A11Y CRITICAL-1: if the viewport widens back past the breakpoint while
  // the mobile modal is open, drop the open flag too — otherwise narrowing
  // back down later would resurrect a stale modal without a fresh selection.
  useEffect(() => {
    if (!isNarrowDrawer) setMobileDetailOpen(false);
  }, [isNarrowDrawer]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (!matchesSearch(it, query)) return false;
      if (!sub) return true;
      if (activeKind === 'spell') return String((it.data as CatalogSpellData).level) === sub;
      if (activeKind === 'monster') return (it.data as CatalogMonsterData).monster_type === sub;
      if (activeKind === 'item') return (it.data as CatalogEquipmentData).item_type === sub;
      return true;
    });
  }, [items, query, sub, activeKind]);

  // Keep the virtual-focus index in range whenever the filtered list changes.
  useEffect(() => {
    setFocusedIdx((i) => (filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (status === 'error') retryRef.current?.focus();
  }, [status]);

  const selected = filtered.find((i) => i.slug === selectedSlug) ?? null;
  const optionId = useCallback((slug: string) => `${listboxId}-${slug}`, [listboxId]);

  // A11Y MAJOR-4 / MAJOR-5: scroll the virtually-focused row into view. Looks
  // the row up by its option id rather than keeping a parallel ref array —
  // `filtered`'s order already matches what's rendered.
  const scrollRowIntoView = useCallback(
    (idx: number) => {
      const target = filtered[idx];
      if (!target) return;
      document
        .getElementById(optionId(target.slug))
        ?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    },
    [filtered, optionId],
  );

  // A11Y MAJOR-6: selection changes are otherwise silent to AT users, since
  // the desktop drawer is a separate landmark the listbox's DOM focus never
  // moves into (virtual-focus, correct per APG) — this is the only
  // announcement of what got selected. Derived directly (no debounce): a
  // selection is a single discrete action, not a rapid-fire keystroke stream.
  const selectionAnnouncement = selected ? `Showing details for ${selected.name}` : '';

  // A11Y MINOR-2: debounce the *announcement* only — the visible listHead
  // count below still updates every render/keystroke.
  useEffect(() => {
    if (status !== 'ok') {
      setAnnouncedCount('');
      return;
    }
    const t = setTimeout(() => {
      // DDX21-3: nounPlural, not naive `${noun}s` ("class" -> "classes", not
      // "classs").
      const noun = filtered.length === 1 ? activeMeta.noun : activeMeta.nounPlural;
      const total = items.length !== filtered.length ? ` · ${items.length} total` : '';
      setAnnouncedCount(`${filtered.length} ${noun}${total}`);
    }, COUNT_ANNOUNCE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filtered.length, items.length, status, activeMeta.noun, activeMeta.nounPlural]);

  const onListboxKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(focusedIdx + 1, filtered.length - 1);
      setFocusedIdx(next);
      scrollRowIntoView(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(focusedIdx - 1, 0);
      setFocusedIdx(next);
      scrollRowIntoView(next);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusedIdx(0);
      scrollRowIntoView(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = filtered.length - 1;
      setFocusedIdx(last);
      scrollRowIntoView(last);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedSlug(filtered[focusedIdx].slug);
      // A11Y CRITICAL-1: below 1280px the drawer is display:none — open the
      // reachable modal instead.
      if (isNarrowDrawer) setMobileDetailOpen(true);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // A11Y MAJOR-5: buffered single-char type-to-find, ~500ms reset —
      // jumps virtual focus to the first *filtered* row whose name starts
      // with the accumulated buffer (case-insensitive).
      const ta = typeaheadRef.current;
      if (ta.timer) clearTimeout(ta.timer);
      ta.buffer += e.key.toLowerCase();
      ta.timer = setTimeout(() => {
        ta.buffer = '';
      }, TYPEAHEAD_RESET_MS);
      const match = filtered.findIndex((it) => it.name.toLowerCase().startsWith(ta.buffer));
      if (match !== -1) {
        setFocusedIdx(match);
        scrollRowIntoView(match);
      }
    }
  };

  // Rail: vertical tablist, always (DDX-21 fix pass 3: reverted the ≤860px
  // horizontal reflow — see Codex.module.css's .rail comment for why). Roving
  // tabindex + Up/Down is the APG vertical-tabs pattern; no Left/Right, since
  // there's no horizontal state left to drive. A11Y MAJOR-8: Home/End jump to
  // the first/last tab.
  const onRailKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const idx = CODEX_KINDS.findIndex((k) => k.kind === activeKind);
    let next = idx;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      next = (idx + 1) % CODEX_KINDS.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      next = (idx - 1 + CODEX_KINDS.length) % CODEX_KINDS.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      next = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      next = CODEX_KINDS.length - 1;
    } else {
      return;
    }
    setActiveKind(CODEX_KINDS[next].kind);
    railRefs.current[next]?.focus();
  };

  // DDX-21 follow-up: render guard for CODEX_ENABLED — sits after every hook
  // above (Rules of Hooks: hooks must still run unconditionally every render)
  // and before the real UI. The effect above already kicked off the redirect;
  // this just keeps the page from flashing real content on the way out.
  if (!CODEX_ENABLED) {
    return null;
  }

  return (
    <TavernShell
      active="compendium"
      title="Codex"
      actions={
        <div className={styles.search}>
          <Icon name="Search" size={14} className={styles.searchIcon} aria-hidden />
          <input
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${activeMeta.label.toLowerCase()}…`}
            aria-label={`Search ${activeMeta.label.toLowerCase()}`}
          />
        </div>
      }
    >
      <div className={styles.body}>
        {/* ---------- LEFT RAIL: content-type tabs ---------- */}
        <div className={styles.rail}>
          {/* TAV-2: role="tablist" wraps ONLY the tabs; the subfilter <select>
              below is a sibling, not a tablist child (aria-required-children). */}
          <div
            className={styles.tablist}
            role="tablist"
            aria-orientation="vertical"
            aria-label="Content type"
            onKeyDown={onRailKeyDown}
          >
            {CODEX_KINDS.map((m, i) => {
              const on = m.kind === activeKind;
              const count = counts?.[m.kind];
              return (
                <button
                  key={m.kind}
                  ref={(el) => {
                    railRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${panelId}-tab-${m.kind}`}
                  aria-selected={on}
                  aria-controls={panelId}
                  tabIndex={on ? 0 : -1}
                  className={`${styles.railItem} ${on ? styles.railItemOn : ''}`}
                  style={{ ['--tone' as string]: toneVar(m.tone) }}
                  onClick={() => setActiveKind(m.kind)}
                >
                  <span className="ic">
                    <Icon name={m.icon} size={14} aria-hidden />
                  </span>
                  <span className={styles.railLbl}>{m.label}</span>
                  {count != null && <span className={styles.railCount}>{count}</span>}
                </button>
              );
            })}
          </div>

          {subfilterOptions.length > 0 && (
            <div className={styles.subfilter}>
              <label htmlFor={`${panelId}-subfilter`} className={styles.subfilterLabel}>
                {SUBFILTER_LABEL[activeKind] ?? 'Filter'}
              </label>
              <select
                id={`${panelId}-subfilter`}
                className={styles.subfilterSelect}
                value={sub}
                onChange={(e) => setSub(e.target.value)}
              >
                <option value="">Any</option>
                {subfilterOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ---------- CENTER: the active tab's result list (the tabpanel) ---------- */}
        <main
          id={panelId}
          role="tabpanel"
          aria-labelledby={`${panelId}-tab-${activeKind}`}
          className={styles.list}
        >
          <div className={styles.listHead}>
            {status === 'ok' && (
              <span>
                {/* DDX21-3: nounPlural, not naive `${noun}s` ("class" -> "classes"). */}
                <b>{filtered.length}</b> {filtered.length === 1 ? activeMeta.noun : activeMeta.nounPlural}
                {items.length !== filtered.length ? ` · ${items.length} total` : ''}
              </span>
            )}
          </div>
          {/* A11Y MINOR-2: the visible count above is instant; this is the
              debounced (~400ms) announcement so a screen reader doesn't get a
              burst of "N spells" per keystroke while filtering. */}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {announcedCount}
          </p>
          {/* A11Y MAJOR-6: announce what got selected — see selectionAnnouncement above. */}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {selectionAnnouncement}
          </p>

          {status === 'loading' && <PageSkeleton variant="list" lines={6} />}

          {status === 'error' && (
            <Card className={styles.stateCard} role="alert" aria-labelledby="codex-error-title">
              <p id="codex-error-title" className={styles.stateTitle}>
                Suzu can&rsquo;t reach the codex right now.
              </p>
              <p id="codex-error-body" className={styles.stateBody}>
                The {activeMeta.label.toLowerCase()} list couldn&rsquo;t be loaded. Check your
                connection or try again in a moment.
              </p>
              <Button
                ref={retryRef}
                variant="primary"
                onClick={retry}
                aria-describedby="codex-error-body"
              >
                Try again
              </Button>
            </Card>
          )}

          {status === 'ok' && filtered.length === 0 && (
            <div className={styles.listEmpty}>
              <p className={styles.listEmptyTitle}>Nothing here.</p>
              <p>
                {items.length === 0
                  ? `No ${activeMeta.label.toLowerCase()} are in the catalog yet.`
                  : 'No results match your search.'}
              </p>
            </div>
          )}

          {status === 'ok' && filtered.length > 0 && (
            <div
              ref={listboxRef}
              className={styles.rows}
              role="listbox"
              aria-label={`${activeMeta.label} results`}
              tabIndex={0}
              aria-activedescendant={optionId(filtered[focusedIdx]?.slug ?? '')}
              onKeyDown={onListboxKeyDown}
            >
              {filtered.map((item, i) => (
                <CodexRow
                  key={item.slug}
                  item={item}
                  kind={activeKind}
                  selected={item.slug === selectedSlug}
                  focused={i === focusedIdx}
                  optionId={optionId(item.slug)}
                  onSelect={() => {
                    setSelectedSlug(item.slug);
                    setFocusedIdx(i);
                    listboxRef.current?.focus();
                    // A11Y CRITICAL-1: below 1280px the drawer is
                    // display:none — open the reachable modal instead.
                    if (isNarrowDrawer) setMobileDetailOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </main>

        <aside
          className={styles.drawer}
          aria-label={
            selected ? `${activeMeta.label} details: ${selected.name}` : `${activeMeta.label} details`
          }
        >
          {selected ? (
            <CodexDetail item={selected} kind={activeKind} />
          ) : (
            <div className={styles.emptyDrawer}>
              <Icon name={activeMeta.icon} size={40} aria-hidden style={{ opacity: 0.5 }} />
              <p className={styles.emptyDrawerTitle}>Pick a {activeMeta.noun}.</p>
              <p>Select an entry from the list to see its full details here.</p>
            </div>
          )}
        </aside>

        {/* A11Y CRITICAL-1: the reachable replacement for the drawer above
            when it's display:none (<1280px). Always mounted (matches the
            ConfirmDialog/DmOverrideModal convention) — internally a no-op
            render when closed. */}
        <CodexDetailModal
          open={isNarrowDrawer && mobileDetailOpen}
          item={selected}
          kind={activeKind}
          onClose={() => {
            setMobileDetailOpen(false);
            listboxRef.current?.focus();
          }}
        />
      </div>
    </TavernShell>
  );
}
