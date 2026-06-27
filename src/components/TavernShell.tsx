'use client';
/**
 * TavernShell — the authed chrome shared by the lobby + dashboard (ST-039).
 *
 * The design evolved the original left "sidebar" into a top nav (topnav.jsx,
 * aliased `window.Sidebar = TopNav`); lobby.jsx and dashboard.jsx both compose
 * <TopNav> + a .workspace. This is the faithful current design.
 *
 * MVP scope: player mode only (host mode = Phase 3). Search + notifications are
 * omitted rather than shipped non-functional (no backend) — honest over decorative.
 * Codex/Memory tabs render disabled ("soon") — they're v1.1 fast-follow surfaces.
 *
 * Lessons baked in:
 *  - The avatar opens a MENU; it never logs you out on click (NekoNova dashboard trap).
 *  - The top nav owns its stacking context (sticky + z-index) and the menu sits
 *    above it, so the backdrop-filter can't trap the dropdown behind page content.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Icon, { type IconName } from '@/components/Icon';
import Avatar from '@/components/Avatar';
import SuzuDM from '@/components/SuzuDM';
import TweaksPanel from '@/components/TweaksPanel';
import { useAuth } from '@/lib/auth/AuthProvider';
import styles from './TavernShell.module.css';

export type TabId = 'dashboard' | 'lobby' | 'modules' | 'compendium' | 'memory' | 'admin';

interface TabDef {
  id: TabId;
  label: string;
  href: string;
  icon: IconName;
  disabled?: boolean;
}

const TABS: TabDef[] = [
  { id: 'dashboard', label: 'Home', href: '/dashboard', icon: 'Home' },
  { id: 'lobby', label: 'Tables', href: '/lobby', icon: 'Compass' },
  { id: 'modules', label: 'Modules', href: '/modules', icon: 'Spellbook' },
  { id: 'compendium', label: 'Codex', href: '#', icon: 'Scroll', disabled: true },
  { id: 'memory', label: 'Memory', href: '#', icon: 'Lantern', disabled: true },
];

export interface TavernShellProps {
  /** Which primary tab is active. */
  active: TabId;
  /** The page's single <h1>. */
  title: ReactNode;
  /** Right-aligned header actions (typically a Button). */
  actions?: ReactNode;
  /** Workspace body. */
  children: ReactNode;
}

function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const username = user?.username ?? 'Adventurer';

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Close on outside-click + Escape (Escape returns focus to the trigger).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false); // pointer dismissal — don't steal focus back
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      // APG menu-button: Tab closes the menu and lets focus proceed naturally
      // (don't preventDefault — the browser moves focus in document order).
      else if (e.key === 'Tab') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // APG menu-button pattern: focus the first item when the menu opens.
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"]:not([disabled])',
    );
    first?.focus();
  }, [open]);

  // Roving focus between menu items via Arrow keys.
  const handleMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
    );
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'ArrowDown'
        ? items[(idx + 1) % items.length]
        : items[(idx - 1 + items.length) % items.length];
    next?.focus();
  };

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await logout(); // clears user state immediately, then best-effort BFF call
      router.replace('/login');
    } finally {
      setSigningOut(false); // insurance if navigation is deferred
    }
  }, [logout, router]);

  return (
    <div className={styles.userWrap} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.userBtn}
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
      >
        <Avatar name={username} size={30} />
        <span className={styles.userMeta}>
          <span className={styles.userName}>{username}</span>
        </span>
        <Icon
          name="Chevron"
          size={12}
          className={open ? styles.chevOpen : styles.chev}
        />
      </button>

      {open && (
        <div
          className={styles.menu}
          id={menuId}
          role="menu"
          ref={menuRef}
          onKeyDown={handleMenuKeyDown}
        >
          <Link
            href="/character/new"
            role="menuitem"
            className={styles.menuRow}
            onClick={() => close(false)}
          >
            <Icon name="Scroll" size={14} aria-hidden />
            <span>New character</span>
          </Link>
          <Link
            href="/trash"
            role="menuitem"
            className={styles.menuRow}
            onClick={() => close(false)}
          >
            <Icon name="Trash" size={14} aria-hidden />
            <span>Trash</span>
          </Link>
          {/* S8.3: admin-only menu item — review queue shortcut */}
          {user?.roles?.includes('admin') && (
            <Link
              href="/admin/content"
              role="menuitem"
              className={styles.menuRow}
              onClick={() => close(false)}
            >
              <Icon name="Scroll" size={14} aria-hidden />
              <span>Review queue</span>
            </Link>
          )}
          <div className={styles.menuSep} />
          <button
            type="button"
            role="menuitem"
            className={`${styles.menuRow} ${styles.menuDanger}`}
            onClick={() => void handleSignOut()}
            disabled={signingOut}
          >
            <Icon name="Power" size={14} aria-hidden />
            <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function TavernShell({
  active,
  title,
  actions,
  children,
}: TavernShellProps) {
  // useAuth is already called by UserMenu sub-component; we also call it here
  // for the admin tab conditional. Both calls share the same context, no extra cost.
  const { user } = useAuth();

  return (
    <div className={styles.shell}>
      <header className={styles.topnav}>
        <Link href="/dashboard" className={styles.brand} aria-label="Aurora Tavern — home">
          <SuzuDM size={32} glow={false} aria-hidden />
          <span className={styles.brandMeta}>
            <span className={styles.brandName}>Aurora Tavern</span>
            <span className={styles.brandSub}>v0.5 · 5e</span>
          </span>
        </Link>

        <nav className={styles.tabs} aria-label="Primary">
          {TABS.map((t) =>
            t.disabled ? (
              <span
                key={t.id}
                className={`${styles.tab} ${styles.tabDisabled}`}
                aria-disabled="true"
                title="Coming soon"
              >
                <Icon name={t.icon} size={15} aria-hidden />
                <span>{t.label}</span>
                <span className={styles.soon}>soon</span>
              </span>
            ) : (
              <Link
                key={t.id}
                href={t.href}
                className={`${styles.tab} ${active === t.id ? styles.tabActive : ''}`}
                aria-current={active === t.id ? 'page' : undefined}
              >
                <Icon name={t.icon} size={15} aria-hidden />
                <span>{t.label}</span>
              </Link>
            ),
          )}
          {/* S8.3: Admin tab — only visible to users with the 'admin' role */}
          {user?.roles?.includes('admin') && (
            <Link
              href="/admin/content"
              className={`${styles.tab} ${active === 'admin' ? styles.tabActive : ''}`}
              aria-current={active === 'admin' ? 'page' : undefined}
            >
              <Icon name="Scroll" size={15} aria-hidden />
              <span>Admin</span>
            </Link>
          )}
        </nav>

        <div className={styles.end}>
          <TweaksPanel />
          <UserMenu />
        </div>
      </header>

      <div className={styles.workspace}>
        <header className={styles.workspaceHeader}>
          <h1 className={styles.title}>{title}</h1>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
        <main id="main-content" tabIndex={-1} className={`${styles.body} aurora`}>
          {children}
        </main>
      </div>
    </div>
  );
}
