# Sprint 4 — UI Specification
# Login, 2FA, Dashboard Skeleton, Landing

**Author:** Aoi-UI
**Date:** 2026-06-15
**Input docs:** SPRINT4_LOGIN_SPECS.md · SPRINT4_LANDING_SPECS.md · SPRINT2_FOUNDATION_DESIGN.md
**Status:** Ready for Ren-Dev

---

## Quick-reference: what this doc adds

Hoshi's specs (LOGIN_SPECS + LANDING_SPECS) nail the canvas-accurate layout and component map. This doc covers everything Hoshi flagged as needing design work:

1. Login state machine — every reachable state + its UI delta
2. 2FA TOTP step — designed from scratch (no canvas reference)
3. OAuth "coming soon" affordance — pattern decision + implementation rule
4. M2 first-paint fix — skeleton-while-refreshing behaviour, dashboard stub, logout control
5. Responsive collapse rules — both pages, all breakpoints
6. Accessibility spec — heading hierarchy, focus order, live regions, motion, screen reader annotations

---

## Navigation Flow

```mermaid
graph TD
    A["/  Landing page"] -->|"Sign in" CTA| B["/login  Login page"]
    A -->|"Start a campaign" / "Browse open tables"| C["/lobby  Lobby"]
    B -->|"← Back" ghost button| A

    B --> D{AuthProvider.login()}
    D -->|"'ok'"| E[redirect to ?next or /dashboard]
    D -->|"'2fa'"| F["2FA Step  same right pane"]
    D -->|"ApiError 401 bad creds"| G["error-badcreds  inline error"]
    D -->|"ApiError 429"| H["error-ratelimited  inline + submit disabled"]
    D -->|"network / abort"| I["error-network  inline error"]
    G -->|"user edits + resubmits"| D
    H -->|"Retry-After elapsed"| D
    I -->|"retry"| D

    F --> J{AuthProvider.verify2FA()}
    J -->|"void  success"| E
    J -->|"ApiError  bad code"| K["error-badtotp  inline error"]
    J -->|"network"| L["error-network-totp  inline error"]
    K -->|"user re-enters code"| J
    F -->|"← Back link"| B

    E --> M["/dashboard  Dashboard stub"]
    M -->|"Logout"| B
    M -->|"loading && maybeAuthed"| N["PageSkeleton  dashboard variant"]
```

---

## 1. Login State Machine

### States

| State | Trigger | What changes in the form |
|---|---|---|
| `idle` | Page load | Default form — handle + passphrase inputs, submit enabled, no errors |
| `submitting` | User submits valid form | Submit button → spinner + "Booting…"; inputs `disabled`; cursor blocked |
| `ok` | `login()` resolves `'ok'` | Router push to `?next` or `/dashboard`. No form state to show. |
| `2fa` | `login()` resolves `'2fa'` | Right-pane content swaps to 2FA step (§2). Focus moves to code input. |
| `error-badcreds` | ApiError 401 | Inline error under form. Password field cleared and re-focused. Inputs re-enabled. Submit re-enabled. |
| `error-ratelimited` | ApiError 429 | Inline error with cooldown timer. Submit `disabled` until `Retry-After` elapses. Inputs re-enabled (user can edit handle). |
| `error-network` | Network / abort | Inline error with retry prompt. Submit re-enabled immediately. |

### State-to-UI map

#### `idle`

The canvas-accurate layout as described in LOGIN_SPECS.md. No errors visible. Submit button shows `<Icon.Power size={16} />` + "Open the door".

#### `submitting`

```
Submit button:
  disabled=true
  content: <span className={styles.spinner} aria-hidden="true" /> "Booting…"

All <input> elements:
  disabled=true

Back button (← Back):
  disabled=true   ← prevents navigation mid-request
```

Spinner: `.nn-spinner` — 14×14px rotating ring. In `Login.module.css`:

```css
.spinner {
  display: inline-block;
  width: 14px; height: 14px; border-radius: 99px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .spinner { animation: none; border-right-color: currentColor; opacity: 0.5; }
}
```

When `useReducedMotion()` returns `true`: hide the `.spinner` element (`aria-hidden` already set) and change button text to "Checking…" (static, no animation). This is a React conditional on the `reduced` boolean — do NOT rely on CSS alone, because the text label must also change.

```tsx
const reduced = useReducedMotion();
// Inside button content:
{submitting && !reduced && <span className={styles.spinner} aria-hidden="true" />}
{submitting ? (reduced ? 'Checking…' : 'Booting…') : <><Icon.Power size={16} /> Open the door</>}
```

#### `error-badcreds`

Inline error block appears **between** the passphrase field and the "Keep me signed in" row. It does not use the Toast system — this is synchronous form feedback that must persist until the next submission attempt.

```
Component: <div role="alert" className={styles.formError}>
  <Icon.Close size={14} aria-hidden="true" />
  "Wrong handle or passphrase. Try again."
</div>
```

CSS (Login.module.css):

```css
.formError {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  background: color-mix(in oklab, var(--bad) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--bad) 28%, transparent);
  color: var(--bad);
  font-size: 13px;
  line-height: 1.4;
}
```

After rendering: `passwordRef.current?.focus()` — move focus back to password so the user can retype without mousing.

`role="alert"` on the error div delivers the message to screen readers immediately via the assertive live region (no separate `aria-live` needed — `role="alert"` implies `aria-live="assertive"`).

#### `error-ratelimited`

429 response includes `Retry-After` in seconds (passed through by the BFF verbatim).

```
Component: <div role="alert" className={styles.formError}>
  <Icon.Close size={14} aria-hidden="true" />
  "Too many attempts. Try again in {countdown}."
</div>

Submit button: disabled=true during countdown
  Text: "Wait {countdown}…"
  No spinner
```

`countdown` is formatted as `"Xs"` for <60 seconds, `"Xm Ys"` for longer. Use `setInterval` (1-second tick) starting from the `Retry-After` value. When it reaches zero: re-enable submit, clear the error message, reset button text to idle state.

Additionally fire a toast for visibility even if the user scrolled away:
```tsx
toast({ tone: 'warn', title: 'Rate limited', message: `Too many attempts. Wait ${retryAfter}s.`, duration: retryAfter * 1000 });
```

The inline error is the primary affordance. The toast is supplementary.

#### `error-network`

```
Component: <div role="alert" className={styles.formError}>
  <Icon.Close size={14} aria-hidden="true" />
  "Can't reach the tavern right now. Check your connection and try again."
</div>

Submit button: re-enabled immediately. Text reverts to idle.
```

No countdown. User retries manually.

### `aria-live` architecture summary

| Signal | Mechanism | Why |
|---|---|---|
| Bad creds / network | `role="alert"` on `.formError` (assertive, immediate) | User needs to know now; they just submitted |
| Rate-limit (inline) | `role="alert"` on `.formError` | Same — immediate feedback after submit |
| Rate-limit (supplementary) | `toast({ tone: 'warn' })` via `useToast()` | Ensures persistence even if user scrolled past form |
| Countdown timer | `aria-live="polite"` on countdown `<span>` within the error div | Polite — seconds ticking is low-priority; assertive would be obnoxious |
| Submitting state | Button `disabled`, text change — no live region needed | Focus is on the button; screen reader reads the new label when focused |

Countdown span structure:
```html
<div role="alert" class="formError">
  …Too many attempts. Try again in
  <span aria-live="polite" aria-atomic="true">{countdown}</span>.
</div>
```

---

## 2. 2FA TOTP Step

No canvas reference exists. This is designed here.

### Design rationale

The 2FA step lives inside the same right-pane `<form>`. The left visual pane is unchanged — mascot, tagline, waveform stay put. The form content swaps: heading and all fields are replaced. This avoids a page transition and keeps the user spatially oriented.

### Component tree (right pane — 2FA state)

```
<form onSubmit={handleVerify}>
  ├── [Back affordance]
  ├── [Heading block — 2FA variant]
  ├── [TOTP input field]
  ├── [Error block — conditional]
  └── [Verify button]
```

### Back affordance

```tsx
<Button
  variant="ghost"
  type="button"
  style={{ alignSelf: 'flex-start', height: 32, padding: '0 12px', fontSize: 12 }}
  onClick={handleBackToCredentials}
>
  ← Back to sign in
</Button>
```

`handleBackToCredentials`: resets form state to `idle`, clears any TOTP error, does not call any auth API (the `st_partial` cookie on the BFF will expire naturally in 5 minutes if unused — the BFF handles that). No network call needed.

### Heading block

```tsx
<div>
  <h3 style={{ fontSize: 28, fontFamily: 'var(--font-display)', fontWeight: 500 }}>
    One more step.
  </h3>
  <p style={{ color: 'var(--ink-3)', fontSize: 14, marginTop: 4 }}>
    Enter the 6-digit code from your authenticator app.
  </p>
</div>
```

`<h3>` is correct here — the page heading hierarchy places `<h3>` in the right pane (per LOGIN_SPECS: "Welcome back." is h3). This is a state swap within the same heading level.

### TOTP input field

```tsx
<div>
  <label htmlFor="totp-code" className="label" style={{ fontSize: 10, marginBottom: 6, display: 'block' }}>
    Authenticator code
  </label>
  <input
    id="totp-code"
    ref={totpRef}
    className="input"
    type="text"
    inputMode="numeric"
    autoComplete="one-time-code"
    pattern="[0-9]{6}"
    maxLength={6}
    placeholder="000000"
    aria-label="6-digit authenticator code"
    aria-describedby="totp-hint"
    value={totpValue}
    onChange={e => setTotpValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
    disabled={verifying}
    style={{ letterSpacing: '0.3em', fontSize: 22, textAlign: 'center' }}
  />
  <span id="totp-hint" className="label" style={{ marginTop: 6, display: 'block', color: 'var(--ink-3)' }}>
    6 digits — no spaces or dashes
  </span>
</div>
```

Visual treatment: large centered monospaced digits. `letterSpacing: '0.3em'` separates the characters visually without requiring a 6-cell split input (which has poor screen reader behavior and complex focus management). Single input is the accessible choice.

`onChange` enforces numeric-only, max 6 chars — so the user cannot submit a partial or non-numeric value.

Auto-submit on 6-digit entry: yes, trigger `handleVerify()` automatically when `totpValue.length === 6` via `useEffect`. This is the expected UX pattern for TOTP. However, provide the explicit "Verify" button as well for users who prefer to confirm manually or are using assistive tech.

```tsx
useEffect(() => {
  if (totpValue.length === 6 && !verifying) {
    handleVerify();
  }
}, [totpValue]);
```

### Verify button

```tsx
<Button
  variant="primary"
  size="lg"
  type="submit"
  disabled={verifying || totpValue.length < 6}
  style={{ marginTop: 4, width: '100%' }}
>
  {verifying && !reduced && <span className={styles.spinner} aria-hidden="true" />}
  {verifying ? (reduced ? 'Checking…' : 'Verifying…') : 'Verify'}
</Button>
```

Same `.spinner` pattern as the login submit button. `disabled` when `totpValue.length < 6` to prevent submitting an incomplete code.

### 2FA error states

| Sub-state | Trigger | UI |
|---|---|---|
| `error-badtotp` | `verify2FA()` throws (ApiError 401/422) | `.formError` div below input: "That code didn't work. Check your app and try again." Focus returns to `totpRef`. |
| `error-network-totp` | Network error during `verify2FA()` | `.formError` div: "Couldn't verify — check your connection." Submit re-enabled. |
| `error-expired` | ApiError 401 with code indicating expired partial session | `.formError` div: "Session timed out. Please sign in again." + show back affordance as the primary action. The "Verify" button stays enabled so user can try a fresh code first. |

All 2FA error divs use `role="alert"` identical to credential errors.

### Focus management on 2FA entry

When `login()` returns `'2fa'` and the form swaps to the TOTP step:

```tsx
useEffect(() => {
  if (formState === '2fa') {
    totpRef.current?.focus();
  }
}, [formState]);
```

This is a `useEffect` dependency on `formState`, not a one-time `useCallback`. If the user backs out and re-triggers 2FA (edge case), focus will move again correctly.

### Left pane during 2FA

No change. `<SuzuDM size={220}>` keeps glow and default idle state. `<Waveform bars={24} height={18} active={false}>` stays static. The tagline "Hi. I was / almost expecting you." stays. This is intentional — the mascot stays present as reassurance during the security step.

### 2FA component isolation note

The 2FA state is rendered as a conditional within the **same component** (LoginPage), not a separate route or component. State lives in the component:

```tsx
type FormState = 'idle' | 'submitting' | 'ok' | '2fa' | 'error-badcreds' | 'error-ratelimited' | 'error-network';
```

This avoids route changes, keeps the httpOnly `st_partial` cookie lifecycle in the BFF where it belongs, and lets the left pane remain static.

---

## 3. OAuth "Coming Soon" Affordance

### Decision

Both Twitch and Discord buttons are rendered with `aria-disabled="true"` and `disabled` on the `<button>` element. A `<Pill tone="muted">` reading "soon" is placed **above** the button row, not inline with each button, so it annotates both chips with a single accessible element.

### Implementation

```tsx
{/* "or" divider — unchanged from canvas */}

{/* Soon annotation — one label covers both buttons */}
<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <Pill tone="muted" aria-label="OAuth login coming soon">soon</Pill>
  <span className="label" style={{ color: 'var(--ink-3)', fontSize: 11 }}>
    Social sign-in is not available yet
  </span>
</div>

{/* OAuth button row */}
<div style={{ display: 'flex', gap: 8 }}>
  <Button
    variant="ghost"
    style={{ flex: 1 }}
    aria-disabled="true"
    disabled
    aria-describedby="oauth-soon-notice"
    leadingIcon={<Icon.Twitch size={14} />}
  >
    Twitch
  </Button>
  <Button
    variant="ghost"
    style={{ flex: 1 }}
    aria-disabled="true"
    disabled
    aria-describedby="oauth-soon-notice"
    leadingIcon={<Icon.Discord size={14} />}
  >
    Discord
  </Button>
</div>

{/* Screen-reader-only description for both buttons */}
<span id="oauth-soon-notice" className={styles.srOnly}>
  Social sign-in via Twitch and Discord is not yet available.
</span>
```

`aria-describedby="oauth-soon-notice"` links both buttons to the hidden text. A screen reader announces: "Twitch, button, dimmed — Social sign-in via Twitch and Discord is not yet available." This is unambiguous without being verbose.

### Reversibility

Gate the disabled state with a single constant:

```tsx
// src/lib/config.ts  (or env.ts)
export const OAUTH_ENABLED = false;
```

In the login form:
```tsx
disabled={!OAUTH_ENABLED}
aria-disabled={!OAUTH_ENABLED ? 'true' : undefined}
```

When `OAUTH_ENABLED` flips to `true`, all three affordances (disabled prop, aria-disabled, the "soon" annotation row) should be gated on the same constant. The "soon" annotation row and `aria-describedby` link can be conditionally rendered:

```tsx
{!OAUTH_ENABLED && (
  <div>
    <Pill tone="muted">soon</Pill>
    <span>Social sign-in is not available yet</span>
  </div>
)}
{!OAUTH_ENABLED && <span id="oauth-soon-notice" className={styles.srOnly}>…</span>}
```

This is **one constant, four conditional renders** — not scattered `disabled` hardcodes.

---

## 4. M2 First-Paint Fix: Skeleton, Dashboard Stub, Logout

### The problem (M2 from Sprint 2 CR)

When a user returns to `/dashboard` after > 15 minutes (access token expired but refresh token valid), `proxy.ts` passes them through. `getServerSession()` in layout.tsx returns `user: null` (access expired), so `initialUser` is null. `AuthProvider` mounts with `loading: true` and `user: null`. Meanwhile it fires `apiFetch` → 401 → silent refresh → user state updates.

During that ~200–800ms window: `loading === true` and `user === null`, but `maybeAuthed === true` (refresh cookie present). Without a guard, the page renders its logged-out view, flashes it, then snaps to the authed view.

### Fix: `maybeAuthed` prop on AuthProvider

The BFF `proxy.ts` already passes users through when `st_refresh` is present but `st_access` is expired. Layout.tsx can detect this:

```tsx
// In src/app/layout.tsx (server component):
const { user: tokenUser, accessExpiresAt } = await getServerSession();
const initialUser = tokenUser ? await safeFetchMe() : null;
const maybeAuthed = !initialUser && (await hasRefreshCookie()); // checks st_refresh presence
```

Pass `maybeAuthed` as a prop to `<AuthProvider>`. The provider exposes `loading` already. Protected pages read:

```tsx
const { user, loading, isAuthenticated } = useAuth();
// maybeAuthed is not in context — pages use loading as the gate:
```

Simpler alternative (no new prop): expose a `maybeAuthed` boolean from `AuthProvider` context that is `true` when `loading === true` and the initial `user` was null but a silent refresh is in progress. Ren-Dev has latitude on implementation; the UI requirement is:

**While `loading === true` AND `maybeAuthed === true`, the dashboard stub MUST render `<PageSkeleton>`, never the logged-out view.**

If the refresh succeeds: `loading` flips to `false`, `user` is populated, render authed content.
If the refresh fails (refresh token also expired or revoked): `proxy.ts` would have already redirected to `/login`. This case shouldn't reach the dashboard. But if it does, `AuthProvider` will throw and `ErrorBoundary` catches it.

### Dashboard stub skeleton

The Sprint 4 dashboard (`/dashboard`) is a stub — not the full nav shell (Sprint 5). It consists of:

```
<ToastProvider>
  {loading && maybeAuthed
    ? <DashboardSkeleton />
    : <DashboardStub user={user} onLogout={logout} />
  }
</ToastProvider>
```

#### DashboardSkeleton component tree

```
<main aria-label="Loading your dashboard" style={{ padding: '32px 24px', maxWidth: 720, margin: '0 auto' }}>
  <PageSkeleton variant="lines" lines={2} />       ← heading + greeting area
  <div style={{ marginTop: 32 }}>
    <PageSkeleton variant="card" lines={3} />      ← main content card
  </div>
  <div style={{ marginTop: 16 }}>
    <PageSkeleton variant="list" lines={4} />      ← recent activity or character list
  </div>
</main>
```

The `<main>` carries `aria-label="Loading your dashboard"` — screen readers announce the region label, which communicates context. `PageSkeleton` already outputs `role="status" aria-busy="true"` with an sr-only "Loading…" label per its implementation.

There is also a minimal top-bar skeleton:

```
<header style={{ height: 56, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 12 }}>
  <Skeleton circle width={32} height={32} />
  <Skeleton height={14} width={120} />
  <div style={{ marginLeft: 'auto' }}>
    <Skeleton height={32} width={80} radius={99} />   ← logout button placeholder
  </div>
</header>
```

All skeleton elements are `aria-hidden="true"` (per `Skeleton` component implementation). The `PageSkeleton` wrapper announces itself.

#### DashboardStub — authed content

When `user` is populated:

```
<header style={{ height: 56, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 12 }}>
  <SuzuDM size={32} glow={false} aria-hidden="true" />
  <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: '-0.02em' }}>
    Suzu's Tavern
  </span>
  <div style={{ marginLeft: 'auto' }}>
    <LogoutButton onLogout={onLogout} />
  </div>
</header>

<main style={{ padding: '40px 24px', maxWidth: 720, margin: '0 auto' }}>
  <h1>
    Welcome back{user.username ? `, ${user.username}` : ''}.
  </h1>
  <p style={{ color: 'var(--ink-2)', marginTop: 8 }}>
    Sprint 5 will bring the full dashboard here. For now, the table is set.
  </p>
</main>
```

The `<h1>` is the single page heading. The header brand is not a heading.

### Logout control

```tsx
// LogoutButton — minimal, no nav shell needed
function LogoutButton({ onLogout }: { onLogout: () => Promise<void> }) {
  const [pending, setPending] = useState(false);

  const handleLogout = async () => {
    setPending(true);
    await onLogout(); // AuthProvider.logout() — clears user, best-effort BFF call
    // AuthProvider.logout() does not redirect; caller (dashboard) does:
    router.push('/login');
  };

  return (
    <Button
      variant="ghost"
      size="default"
      onClick={handleLogout}
      disabled={pending}
      aria-label={pending ? 'Signing out…' : 'Sign out'}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
```

`AuthProvider.logout()` clears user state immediately (fire-and-forget pattern per Sprint 2 design). The router push happens after `await onLogout()`, which means the user sees "Signing out…" briefly. This is acceptable — the actual state clear is instant; the `await` is the BFF POST which has a 2s timeout then succeeds regardless.

After logout: redirect to `/login` (not landing). User explicitly signed out; they probably want to sign back in or sign in as someone else.

### `ErrorBoundary` placement on dashboard

```tsx
<ErrorBoundary>
  <ToastProvider>
    <DashboardContent />
  </ToastProvider>
</ErrorBoundary>
```

`ErrorBoundary` is the outermost guard — catches any unhandled throw from `AuthProvider` state failures. `ToastProvider` is inside so error toasts can fire.

---

## 5. Responsive Collapse Rules

### 5.1 Login page

**Breakpoint: ≤ 900px** — single column, visual pane collapses to compact strip

The `<Card pop>` grid changes from `gridTemplateColumns: '1fr 1fr'` to `flexDirection: 'column'` (or `gridTemplateColumns: '1fr'`).

Left pane transforms:
- Remove `<SuzuDM size={220}>` (the large mascot)
- Keep brand lockup (`<SuzuDM size={40} glow={false}>` + title + sub-label)
- Keep waveform status strip — it's lightweight
- Tagline `<h2>` is hidden (only the mascot card needed it; the form heading serves the page)
- Left pane becomes a compact horizontal brand bar: `display: flex; align-items: center; justify-content: space-between; padding: 20px 28px; border-bottom: 1px solid var(--line); border-right: none`

Right pane: full width, `padding: 32px 28px`

```css
/* Login.module.css */
@media (max-width: 900px) {
  .twoPane {
    grid-template-columns: 1fr;
  }
  .leftPane {
    padding: 20px 28px;
    border-right: none;
    border-bottom: 1px solid var(--line);
    flex-direction: row;
    align-items: center;
    gap: 16px;
  }
  .mascotLarge { display: none; }
  .tagline { display: none; }
  .waveformStrip { display: none; }  /* optional — keep if space permits */
}
```

**Breakpoint: ≤ 640px** — form only

Left pane is removed entirely (`display: none`). Brand lockup moves inline above the form heading in the right pane.

```css
@media (max-width: 640px) {
  .leftPane { display: none; }
  .rightPane { padding: 28px 20px; }
  .inlineBrand { display: flex; }  /* brand lockup inline in right pane */
}
```

The inline brand (`inlineBrand`) is a small flex row — `<SuzuDM size={32} glow={false} />` + "Suzu's Tavern" — inserted as the first child of the right pane form, visible only at ≤640px.

The aurora background remains on all breakpoints (it's the page wrapper, not the card).

Card at ≤640px: `borderRadius: var(--radius)` (18px) instead of `var(--radius-lg)` (28px), and the outer wrapper padding reduces from 24px to 12px.

### 5.2 Landing page

**Breakpoint: ≤ 1024px** — hero collapses to single column

```css
/* Landing.module.css */
@media (max-width: 1024px) {
  .heroGrid {
    grid-template-columns: 1fr;
    gap: 40px;
  }
  .heroPortrait {
    /* Portrait card stays but floats to bottom of stacked layout */
    max-width: 380px;
    margin: 0 auto;
  }
}
```

Floating pill-cards (nat-20, session resumed): keep them at ≤1024px. They are absolutely positioned relative to the portrait card, so they follow the card regardless of layout.

**Breakpoint: ≤ 900px** — nav collapses, 3-column grids go to 1-column

```css
@media (max-width: 900px) {
  .navLinks { display: none; }          /* #how + #what links hidden */
  /* Brand + CTA row stays full width */

  .howGrid,
  .whatGrid {
    grid-template-columns: 1fr;
  }
}
```

Nav at ≤900px: only `<SuzuDM size={36}>` brand lockup and the two CTA buttons ("Browse tables" + "Sign in") remain. No hamburger menu this sprint — the two nav links (#how, #what) are convenience anchors, not critical navigation. They are excluded from the viewport on narrow screens.

**Breakpoint: ≤ 640px** — floating hero chips dropped

```css
@media (max-width: 640px) {
  .floatingChip { display: none; }
}
```

The `.floatingChip` class applies to both the "nat-20" and "session resumed" absolutely positioned cards. At ≤640px they overlap the portrait card and the copy — removing them is correct.

Hero portrait card at ≤640px: `max-width: 100%`, `margin: 0 auto`, the card `padding` reduces to `16px`.

---

## 6. Accessibility Specification

### 6.1 Heading hierarchy

#### Login page

```
<html>
  <body>
    [no page <h1> — the login card is a form, not a document]
    <Card>  ← not a heading
      <left pane>
        [No headings — "Hi. I was / almost expecting you." is <h2>]
        NOTE: the <h2> tagline in the left pane creates an implicit heading
        above the <h3> in the right pane. This is intentional: the card
        presents itself as a document fragment. However — see note below.
      </left pane>
      <right pane as <form>>
        <h3>"Welcome back."</h3>   ← The form heading; the primary visible heading
      </right pane>
    </Card>
  </body>
</html>
```

**Note on the h2/h3 relationship.** The left pane `<h2>` ("Hi. I was / almost expecting you.") and right pane `<h3>` ("Welcome back.") create a valid but potentially confusing heading tree — there is an h2 and h3 but no h1. Since this is a single-purpose authentication screen with no other page content, the absence of h1 is acceptable. However, add a visually-hidden h1 for screen reader orientation:

```tsx
<h1 className={styles.srOnly}>Sign in — Suzu's Tavern</h1>
```

Placement: immediately inside `<main>` wrapping the aurora div, before the card. This gives screen readers a clear page landmark without affecting visual design.

The srOnly class:
```css
.srOnly {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
  white-space: nowrap;
  border: 0;
}
```

#### 2FA step (heading adjustment)

When the form is in `2fa` state, the right pane heading swaps from `<h3>One more step.</h3>`. The left pane `<h2>` stays. The hidden `<h1>` stays. No heading hierarchy change needed — still valid.

#### Landing page

```
<html>
  <body>
    <header>  [landmark: banner]
      [brand lockup — NOT a heading]
      <nav>  [landmark: navigation]
    </header>
    <main>  [landmark: main]
      <section class="aurora">  [hero — no ARIA landmark needed]
        <h1>"A dungeon master who's read the book. Twice."</h1>
      </section>
      <section id="how">
        <h2>"Three rolls and you're in."</h2>
        <article>  [each card]
          <h3>"1 — Pick a story"</h3>
          <h3>"2 — Roll a character"</h3>
          <h3>"3 — Play"</h3>
        </article>
      </section>
      <section id="what">
        <h2>"A patient narrator. A pedantic rules lawyer. A friend."</h2>
        <article>
          <h3>"Living memory"</h3>
          <h3>"A codex you can ask"</h3>
          … (6 total)
        </article>
      </section>
      <section id="story">
        <h2>'"I'd love to play, but I can't find a DM."'</h2>
      </section>
    </main>
    <footer>  [landmark: contentinfo]
  </body>
</html>
```

One `<h1>`, valid `<h2>` per section, `<h3>` for cards. The brand "Suzu's Tavern" in the header is NOT a heading — render as a styled `<span>` or `<p>`.

The `<SectionHead>` component renders a `<h2>` via its `title` prop (per the component spec). Verify this in `SectionHead.tsx` before implementation — the component must use semantic heading elements, not styled `<div>`s.

### 6.2 Labelled inputs

#### Login form

All three interactive inputs must have programmatic labels:

```tsx
{/* Handle */}
<label htmlFor="tavern-handle" className="label" style={{ fontSize: 10, marginBottom: 6, display: 'block' }}>
  Tavern handle
</label>
<input id="tavern-handle" className="input" type="text" autoComplete="username" … />

{/* Passphrase */}
<label htmlFor="passphrase" className="label" style={{ fontSize: 10, marginBottom: 6, display: 'block' }}>
  Passphrase
</label>
<input id="passphrase" className="input" type="password" autoComplete="current-password" … />

{/* Keep me signed in */}
<label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
  <input type="checkbox" defaultChecked />
  Keep me signed in
</label>
```

`<label>` wraps the checkbox — no `htmlFor` needed when wrapping. For text inputs, use explicit `htmlFor` pairing.

#### 2FA input

Covered in §2. `htmlFor="totp-code"` on the label, `id="totp-code"` on the input.

### 6.3 Decorative elements — `aria-hidden`

| Element | Treatment |
|---|---|
| `<SuzuDM>` (all sizes, all contexts) | `aria-hidden="true"` — decorative mascot, no semantic meaning |
| `<Waveform>` | `aria-hidden="true"` — audio visualization graphic, decorative |
| `.aurora::before` gradient | CSS pseudo-element, no DOM node to annotate |
| `<Aurora>` component (if used as a component) | `aria-hidden="true"` |
| Floating pill-cards in hero ("nat-20 · 4 minutes ago", "session resumed") | `aria-hidden="true"` — static decorative product illustration |
| Icon elements inside buttons | `aria-hidden="true"` — button text provides the label |
| `.spinner` animation | `aria-hidden="true"` — the button's text label communicates state |
| `<Pill dot tone="accent">` in hero | The Pill text IS content ("Suzu is at the table · 4 tables live") — NOT aria-hidden. The `dot` span inside is decorative; Pill's implementation already handles this. |
| Mood/pace/memory chip grid in portrait card | `aria-hidden="true"` — static demo copy, not live data |
| Waveform inside portrait card narration bubble | `aria-hidden="true"` — per above |

Verify: `SuzuDM.tsx` must accept and forward `aria-hidden` as a prop. Check that the component spreads `...rest` onto the root element. If it does not, Ren-Dev must add `aria-hidden` forwarding.

Same check for `Waveform.tsx` and `Aurora.tsx`.

### 6.4 Focus order

#### Login page — tab sequence

```
1. [Skip-to-content link]  (see §6.7)
2. "← Back" ghost button
3. Tavern handle input
4. Passphrase input
5. "Keep me signed in" checkbox
6. "Recovery key" — if rendered as a muted non-interactive span: NOT in tab sequence
7. "Open the door" submit button
8. Twitch button  (disabled — removed from tab sequence via disabled prop; verified by Button component)
9. Discord button  (disabled — removed from tab sequence)
```

Items 8 and 9: `<button disabled>` is removed from the tab sequence by the browser automatically. No `tabIndex={-1}` needed. The `Button` component passes `disabled` to the native `<button>` element.

#### 2FA step — tab sequence (replaces 3–9)

```
1. [Skip-to-content link]
2. "← Back to sign in" ghost button
3. TOTP code input
4. Verify button
```

On 2FA entry: `totpRef.current?.focus()` (§2, covered). On back: focus returns to the passphrase field (`passwordRef.current?.focus()`), which is the field the user was on before submitting.

#### Landing page — tab sequence

```
1. [Skip-to-content link]  → skips to <main>
2. "Suzu's Tavern" brand (if interactive — if it's a link to /, include it)
3. "How it works" nav link
4. "What she does" nav link
5. "Browse tables" button (nav CTA)
6. "Sign in" button (nav CTA)
7. [hero section: no interactive elements except CTAs]
8. "Start a campaign" button
9. "Browse open tables" button
10. [How section cards: .lift cards are not interactive; no tab stop]
11. [What section cards: same]
12. "Roll a character" button (story CTA)
13. "Watch a table" button (story CTA)
```

Card `.lift` hover effect: the cards are not links or buttons. They are `<div>` elements with a CSS hover lift. They should NOT be focusable (no `tabIndex`). The hover effect is purely presentational and does not gate any action.

### 6.5 Screen reader announcements

#### Login transitions

| Transition | Announcement mechanism |
|---|---|
| Form submitted | Button becomes disabled + text changes to "Booting…". Screen reader reads the new button label when focus is on the button. |
| Error appears | `role="alert"` fires assertive announcement immediately. |
| 2FA step appears | Focus moves to TOTP input via `useEffect`. Screen reader reads: "One more step. [heading] | Authenticator code [label] | 6-digit authenticator code [aria-label]". |
| Countdown ticking | `aria-live="polite"` on the countdown span. Reader announces every change — but since polite is queued, it won't interrupt. For long countdowns (>60s), announce only every 10s by updating the live region less frequently. |
| Logout complete | Router push navigates to `/login`. The new page load is its own announcement. No explicit live region needed. |

#### Landing — live region

The hero `<Pill dot tone="accent">` text "Suzu is at the table · 4 tables live" is static copy this sprint. No live region needed. If this becomes live data in a future sprint, add `aria-live="polite"` to the pill at that point.

### 6.6 Visual accessibility

#### Color contrast — flags for Iro-A11y

The following token usages need contrast verification under the dusk-tavern (default) palette. These are not failures — they are flags based on the known token values and known background contexts.

| Element | Foreground | Background | Computed colors | Note |
|---|---|---|---|---|
| `.label` class (field labels, kickers) | `var(--ink-3)` = `#8b8298` | `var(--card)` = `rgba(255,255,255,0.04)` over `--bg` `#15101e` | ~`#8b8298` on `#15101e` | Approx 3.5:1 — FAILS AA for small text (11px). Iro must verify. |
| `var(--ink-3)` sub-copy in right pane | `#8b8298` | card background | same as above | Flag |
| `var(--ink-2)` body text | `#c8bfd0` | `#15101e` | ~8.2:1 | PASSES |
| `var(--accent)` on gradient button | `var(--on-accent)` = `#15101e` | `var(--accent)` + `var(--accent-2)` gradient | dark on pastel | Per globals.css A11Y-1 comment: verified by design system |
| `.mono` status text `var(--ink-3)` | `#8b8298` | card over `--bg` | ~3.5:1 | Flag — same issue as .label |

The `.label` contrast issue at 11px text is a known design system tension. The candlelit palette resolves this (it uses `--ink-3: #6e5c4a` on `--bg: #f5eee2` = ~5.53:1, per the existing comment in globals.css). For dusk-tavern at 11px: **escalate to Iro-A11y** to audit and determine whether the font weight (600) and letter-spacing (0.16em) sufficiently compensate, or whether the token must be brightened.

Do NOT unilaterally change `--ink-3` in dusk-tavern — it would affect all four palettes' `.label` rendering. This is a design system decision that must go through review.

#### Text scaling

All font sizes in the login and landing are expressed in `px`, not `rem`. This means they do not scale with user browser font-size preferences. This is a design system decision inherited from the canvas — the tokens use `px`. **Flag to Iro-A11y:** `font-size: 11px` labels at 200% browser zoom fall to effective 22px (fine), but at small viewport + zoom the `.label` text may be unreadable. Iro should verify at 200% zoom on 375px viewport.

#### Color-independent indicators

Errors use:
- Color: `var(--bad)` red fill and border
- Icon: `<Icon.Close size={14}>` — a visual symbol independent of color
- Text: explicit error message

Rate-limit disabled state:
- Opacity: `.btn[aria-disabled="true"]` → `opacity: 0.45`
- Cursor: `not-allowed`
- Text: the button label changes ("Wait Xs…") — color-independent

The success (logged-in) state does not have a visible indicator in the login form — it results in navigation. This is correct.

#### Reduced motion summary

| Element | Reduced motion behavior |
|---|---|
| `.aurora::before` gradient drift | `animation: none` — static gradient (globals.css, already present) |
| `.pill .dot` pulse | `animation: none` — static dot (Pill component via `useReducedMotion`) |
| Submit spinner | `animation: none`; text changes to "Checking…" (Login component) |
| Verify spinner (2FA) | Same as submit spinner |
| `.lift:hover` card lift | `transition: none; transform: none` (Landing.module.css — add this rule) |
| `<Waveform active>` in portrait card | `active={false}` when reduced (Waveform component via `useReducedMotion`) |
| Countdown interval | Not animation — timer is functional, not decorative. Leave unchanged. |
| Toast enter/exit animation | `Toast.module.css` already handles this via `styles.entering`/`styles.visibleStatic` — no new work |

### 6.7 Skip-to-content

Both pages need a skip-to-content link for keyboard users. It appears as the first focusable element, visually hidden until focused.

```tsx
// Placed as first child of <body> in layout.tsx:
<a href="#main-content" className={styles.skipLink}>
  Skip to content
</a>

// Target:
<main id="main-content" tabIndex={-1}>
  …
</main>
```

```css
/* globals.css or layout-specific module */
.skipLink {
  position: absolute;
  top: -40px;
  left: 12px;
  padding: 8px 16px;
  background: var(--bg);
  color: var(--ink);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  z-index: 9999;
  transition: top var(--dur-fast) var(--ease);
}
.skipLink:focus {
  top: 12px;
}
```

`tabIndex={-1}` on `<main>` allows `.focus()` to be called on it programmatically (e.g., after the skip link activates or after a client-side route change).

### 6.8 Forms and validation

#### Login form validation timing

- Validation is NOT inline as the user types (no red border while typing the passphrase). This avoids false-positive errors on partially-typed input.
- Validation fires on submit. Before calling `AuthProvider.login()`:
  - If handle field is empty: focus handle input, do not submit, show inline error "Please enter your tavern handle."
  - If passphrase field is empty: focus passphrase input, show inline error "Please enter your passphrase."
  - HTML5 `required` attribute on both inputs provides a basic accessible layer: browsers will show a native validation tooltip. Add `required` but do not rely on it as the sole mechanism.

```tsx
<input id="tavern-handle" className="input" type="text" required autoComplete="username" … />
<input id="passphrase" className="input" type="password" required autoComplete="current-password" … />
```

#### 2FA input validation

- The Verify button is `disabled` when `totpValue.length < 6`. This prevents submitting an incomplete code without error messages.
- The `onChange` handler strips non-digits — silent input filtering, no error shown for it.
- If `totpValue.length === 6` and submit fires and fails: show `.formError` with `role="alert"`.

### 6.9 "Recovery key" treatment

The canvas renders a `"Recovery key"` link with `href="#"`. Per the locked decisions: recovery is deferred (ST-032). A dead `href="#"` is never acceptable.

Render it as a muted non-interactive span:

```tsx
<span
  className="label"
  style={{ color: 'var(--ink-3)', cursor: 'default' }}
  aria-label="Password recovery — coming soon"
  title="Password recovery is not yet available"
>
  Recovery key
</span>
```

This is not a link, not a button, and not a heading. It sits in the flex row with "Keep me signed in." It has no `tabIndex` — not in focus order. The `aria-label` provides context if a screen reader encounters it in a different traversal mode. The `title` provides a hover tooltip for sighted keyboard users.

Alternative: omit it entirely. The locked decision says "your call." Keeping a muted stub is preferable to omitting it entirely — it signals that recovery exists as a concept and will come back. Ren-Dev may omit it if they judge it creates expectation management issues.

---

## 7. Sensitive Screen Identification

### Login page — PII and credential handling

The login form collects:

| Field | Data type | Handling |
|---|---|---|
| Tavern handle | Username (PII) | `autoComplete="username"`. NOT `autocomplete="off"` — password managers must work. No masking. |
| Passphrase | Password (credential) | `type="password"` — browser masks. `autoComplete="current-password"`. NEVER log or display. |
| TOTP code (2FA) | One-time code (credential) | `autoComplete="one-time-code"`. `inputMode="numeric"`. Clear the field on error (replace with empty string). NEVER log. |

**Password cleared on error:** when `error-badcreds` is shown, the passphrase field value must be cleared (`setPassphrase('')`). The handle field retains its value so the user doesn't have to retype it.

**TOTP cleared on error:** when 2FA verification fails, `setTotpValue('')` so the user doesn't resubmit the same wrong code.

**No sensitive data in URL:** the `?next=` redirect parameter contains only a path, never tokens. `proxy.ts` constructs this.

**No sensitive data in DOM attributes:** error messages contain no credential values. Console.warn in `apiFetch` logs `{status, code, path}` — never request bodies (per Sprint 2 observability spec §6).

### Dashboard stub

The dashboard renders `user.username` as a greeting. Username is PII but is not sensitive in context — the user is authenticated and viewing their own name. No masking required.

**Email**: `User.email` is available on the user object (`email: string | null`). The Sprint 4 dashboard stub does NOT render the email — it only renders the username. This minimizes PII exposure in the stub.

### Landing page

No PII. No credentials. Static marketing content. No sensitive screen classification.

---

## 8. Footer and Status Text — Final Decisions

### Login footer

**Canvas copy:** `"session.encrypted · ed25519 · last sync 14:02"` — the "last sync" part is fabricated dynamic data.

**Sprint 4 build target:** static string only.

```tsx
<p className="mono" style={{ marginTop: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>
  session.encrypted · ed25519
</p>
```

Drop "last sync 14:02" and "7 sessions remembered" entirely. The remaining copy is accurate (the BFF uses httpOnly cookies over TLS; `ed25519` refers to the JWT signing algorithm used by Authentication-Python — verify this is actually ed25519 before shipping, or change to `"session.encrypted"` alone if unsure).

### Landing footer

**Canvas copy:** `"build.4f1c · main · uptime 14d 02h"` — fabricated uptime.

**Sprint 4 build target:**

```tsx
<span className="mono">
  {process.env.NEXT_PUBLIC_BUILD_TAG ?? 'build.dev · main'}
</span>
```

`NEXT_PUBLIC_BUILD_TAG` is set at build time (e.g., `build.$(git rev-parse --short HEAD) · main`). If not set, falls back to `"build.dev · main"`. Drop the fabricated uptime entirely. This is a `NEXT_PUBLIC_*` variable so it's injected at build time and safe to expose to the client.

---

## 9. Component-Level Prop Checklist for Ren-Dev

| Component | Required props for Sprint 4 | Verification note |
|---|---|---|
| `<Card pop>` (login card) | `pop={true}` `padding={false}` + inline `style` for grid layout | Card's padding prop defaults true — must explicitly pass false |
| `<SuzuDM size={220}>` | default glow, default idle | Verify component supports default props without explicit `glow` |
| `<SuzuDM size={40} glow={false}>` | `glow={false}` | Brand lockup |
| `<SuzuDM size={160} talking>` | `talking` prop | Verify `talking` prop exists in `SuzuDM.tsx` — LANDING_SPECS §open question 1 flags this |
| `<Waveform bars={24} height={18} active={false}>` | `active={false}` | Static/standby; already motion-guarded |
| `<Waveform bars={42} height={24}>` | default `active` (true) | Portrait card; `useReducedMotion` gates it |
| `<Pill tone="muted">` | `tone="muted"` `children="soon"` | OAuth coming soon chip |
| `<Pill dot tone="accent">` | `dot={true}` `tone="accent"` | Hero status, portrait card |
| `<PageSkeleton variant="card" lines={3}>` | as specified | Dashboard skeleton content |
| `<PageSkeleton variant="list" lines={4}>` | as specified | Dashboard skeleton content |
| `<Button variant="ghost" disabled aria-disabled="true">` | both `disabled` and `aria-disabled` | OAuth buttons — Button component passes `disabled` to native element (confirmed in Button.tsx) |
| `<SectionHead kicker title sub>` | all three props | How section. Verify `sub` prop renders as a `<p>` not a heading |
| `useToast()` | `toast({ tone: 'warn', … })` | Rate-limit supplementary toast |
| `ErrorBoundary` | wraps dashboard root | Catches auth state failures |

---

## 10. Open Questions for Ren-Dev

These are the remaining ambiguities after all locked decisions are applied. They require either a quick judgment call from Ren-Dev or a brief escalation.

1. **`SuzuDM talking` prop** — `SuzuDM.tsx` was not read during this pass. LANDING_SPECS flags this: does the component support a `talking` prop? If not, use `active` or simply render the default idle state for Sprint 4 (the portrait card is static demo copy; the mascot talking vs. idle is cosmetic). Ren-Dev should read `SuzuDM.tsx` first and proceed with what exists.

2. **`--ink-3` on `.label` contrast (11px)** — flagged in §6.6. This needs Iro-A11y audit before final ship. Ren-Dev can implement as-designed; Iro audits in the parallel review pass.

3. **`getServerSession` + `maybeAuthed` prop shape** — `SPRINT2_FOUNDATION_DESIGN.md §10` records that `getServerSession` now calls `/auth/me` server-to-server. The M2 fix requires detecting "refresh present, access expired." Ren-Dev must decide: expose `maybeAuthed` from `AuthProvider` context, or handle the skeleton logic inside each protected page. The spec recommends the context approach for reuse across Sprint 5+ pages, but the simpler per-page approach works for Sprint 4's single stub.

4. **`NEXT_PUBLIC_BUILD_TAG`** — needs to be wired in CI or the `docker-compose.tavern.yml` build args. If not wired for Sprint 4, the footer shows `"build.dev · main"` which is acceptable for the sprint. Flag to Tatsu-Dep for the deploy step.

5. **Landing page — Waveform `active` requires client component** — the `<Waveform>` with `active` (default true) uses `requestAnimationFrame` internally. If `landing/page.tsx` is a Server Component, the Waveform must be in a `'use client'` child component or wrapped in a lazy import. Ren-Dev must decide: either make the portrait card section a client component, or pass `active={false}` to the landing waveform (static bars, no animation) and reserve the animated waveform for the session play screen. Recommendation: `active={false}` on landing is fine — it reads as a status illustration, not a live feed.

6. **`ed25519` claim in login footer** — verify that Authentication-Python's JWT signing algorithm is actually ed25519 before shipping the static string. If it's HS256 or RS256, change the copy to `"session.encrypted"` only to avoid a factually incorrect claim.

---

## Design Checklist

- [x] All screens inventoried with navigation flow
- [x] Component tree provided for each screen
- [x] Every component mapped to design system (via LOGIN_SPECS component map + §9 above)
- [x] All data states covered — login: idle, submitting, ok, 2fa, error-badcreds, error-ratelimited, error-network; 2FA: verifying, error-badtotp, error-network-totp, error-expired; dashboard: loading+maybeAuthed (skeleton), authed (stub), logout pending
- [x] Interaction specs complete — form submission, spinner, cooldown timer, auto-submit on 6-digit TOTP, back affordance, logout
- [x] Accessibility specification complete — heading hierarchy, focus order, live regions, screen reader annotations
- [x] Visual accessibility flagged — `--ink-3` at 11px (flag for Iro), color-independent error indicators confirmed
- [x] Sensitive screens identified — login collects credentials (passphrase cleared on error, TOTP cleared on error, no PII in URLs)
- [x] Responsive behavior defined — login: 900px + 640px; landing: 1024px + 900px + 640px
- [x] Mermaid diagrams included — §Navigation Flow
- [x] OAuth coming-soon affordance — `OAUTH_ENABLED` constant pattern specified
- [x] 2FA step designed from scratch with full component spec and focus management
- [x] M2 first-paint skeleton specified — `PageSkeleton` layout for dashboard stub, logout control
- [x] Reduced motion — all animated elements covered across both pages
