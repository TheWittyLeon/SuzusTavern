/**
 * Tests for src/lib/auth/AuthProvider.tsx
 *
 * Covers:
 *   - initialUser hydrates from prop
 *   - login('ok') sets user
 *   - login('2fa') does NOT set user
 *   - verify2FA sets user
 *   - logout clears user even if BFF throws
 *   - useAuth outside provider returns fallback (no throw)
 *   - initialMaybeAuthed=true starts loading=true, maybeAuthed=true
 *   - initialMaybeAuthed=true: silent refresh+me populates user on mount
 *   - initialMaybeAuthed=true: refresh failure leaves user=null, loading=false
 *   - maybeAuthed exposed in context; no-op fallback has maybeAuthed:false
 */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock the auth API wrappers (apiFetch underneath touches fetch)
// ---------------------------------------------------------------------------

jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(),
  verify2FA: jest.fn(),
  logout: jest.fn(),
  refresh: jest.fn(),
  me: jest.fn(),
  register: jest.fn(),
}));

import * as authApi from '../../lib/api/auth';
import { AuthProvider, useAuth } from '../../lib/auth/AuthProvider';
import type { User } from '../../lib/api/types';

const mockLogin    = authApi.login    as jest.MockedFunction<typeof authApi.login>;
const mockVerify   = authApi.verify2FA as jest.MockedFunction<typeof authApi.verify2FA>;
const mockLogout   = authApi.logout   as jest.MockedFunction<typeof authApi.logout>;
const mockRefresh  = authApi.refresh  as jest.MockedFunction<typeof authApi.refresh>;
const mockMe       = authApi.me       as jest.MockedFunction<typeof authApi.me>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALICE: User = { id: 1, username: 'alice', email: null };

/** Consumer component that exposes auth context via test-ids */
function AuthConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="username">{auth.user?.username ?? 'none'}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="maybeAuthed">{String(auth.maybeAuthed)}</span>
      <button onClick={() => auth.login('alice', 'secret')}>login</button>
      <button onClick={() => auth.verify2FA('123456')}>verify2fa</button>
      <button onClick={() => auth.logout()}>logout</button>
      <button onClick={() => auth.refresh()}>refresh</button>
    </div>
  );
}

function wrap(initialUser: User | null = null, initialMaybeAuthed = false) {
  return render(
    <AuthProvider initialUser={initialUser} initialMaybeAuthed={initialMaybeAuthed}>
      <AuthConsumer />
    </AuthProvider>,
  );
}

// ---------------------------------------------------------------------------
// initialUser hydration
// ---------------------------------------------------------------------------

describe('AuthProvider — initialUser hydration', () => {
  it('renders with no user when initialUser is null', () => {
    wrap(null);
    expect(screen.getByTestId('username')).toHaveTextContent('none');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('maybeAuthed')).toHaveTextContent('false');
  });

  it('hydrates user from initialUser prop', () => {
    wrap(ALICE);
    expect(screen.getByTestId('username')).toHaveTextContent('alice');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('maybeAuthed')).toHaveTextContent('false');
  });
});

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

describe('AuthProvider — login', () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockVerify.mockReset();
    mockLogout.mockReset();
    mockRefresh.mockReset();
  });

  it('sets user and returns "ok" on successful login', async () => {
    mockLogin.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    wrap(null);

    await act(async () => {
      screen.getByRole('button', { name: 'login' }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('alice');
    });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
  });

  it('does NOT set user when login returns "2fa"', async () => {
    mockLogin.mockResolvedValueOnce({ kind: '2fa', partial_token: 'pt-123' });
    wrap(null);

    await act(async () => {
      screen.getByRole('button', { name: 'login' }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('username')).toHaveTextContent('none');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });
});

// ---------------------------------------------------------------------------
// verify2FA
// ---------------------------------------------------------------------------

describe('AuthProvider — verify2FA', () => {
  beforeEach(() => {
    mockVerify.mockReset();
  });

  it('sets user after successful verify2FA', async () => {
    mockVerify.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    wrap(null);

    await act(async () => {
      screen.getByRole('button', { name: 'verify2fa' }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('alice');
    });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe('AuthProvider — logout', () => {
  beforeEach(() => {
    mockLogout.mockReset();
  });

  it('clears user immediately even if BFF throws', async () => {
    mockLogout.mockRejectedValueOnce(new Error('network'));
    wrap(ALICE);

    expect(screen.getByTestId('username')).toHaveTextContent('alice');

    await act(async () => {
      screen.getByRole('button', { name: 'logout' }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('none');
    });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });

  it('clears user on successful logout', async () => {
    mockLogout.mockResolvedValueOnce({ ok: true });
    wrap(ALICE);

    await act(async () => {
      screen.getByRole('button', { name: 'logout' }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('none');
    });
  });
});

// ---------------------------------------------------------------------------
// refresh
// ---------------------------------------------------------------------------

describe('AuthProvider — refresh', () => {
  beforeEach(() => {
    mockRefresh.mockReset();
  });

  it('returns true when refresh BFF call succeeds', async () => {
    mockRefresh.mockResolvedValueOnce({ ok: true });
    let refreshResult: boolean | undefined;

    function RefreshConsumer() {
      const auth = useAuth();
      return (
        <button
          onClick={() => {
            auth.refresh().then((ok) => { refreshResult = ok; });
          }}
        >
          refresh
        </button>
      );
    }

    render(
      <AuthProvider initialUser={ALICE}>
        <RefreshConsumer />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click();
    });

    await waitFor(() => expect(refreshResult).toBe(true));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('returns false when refresh BFF call throws', async () => {
    mockRefresh.mockRejectedValueOnce(new Error('unauthorized'));
    let refreshResult: boolean | undefined;

    function RefreshConsumer() {
      const auth = useAuth();
      return (
        <button
          onClick={() => {
            auth.refresh().then((ok) => { refreshResult = ok; });
          }}
        >
          refresh
        </button>
      );
    }

    render(
      <AuthProvider initialUser={null}>
        <RefreshConsumer />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click();
    });

    await waitFor(() => expect(refreshResult).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// useAuth outside provider — fallback
// ---------------------------------------------------------------------------

describe('useAuth outside AuthProvider', () => {
  it('returns no-op fallback without throwing', () => {
    // Render a consumer outside any provider
    function Orphan() {
      const auth = useAuth();
      return (
        <div>
          <span data-testid="user">{auth.user?.username ?? 'none'}</span>
          <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
          <span data-testid="maybeAuthed">{String(auth.maybeAuthed)}</span>
        </div>
      );
    }

    render(<Orphan />);
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    // No-op fallback must have maybeAuthed: false
    expect(screen.getByTestId('maybeAuthed')).toHaveTextContent('false');
  });

  it('no-op login on fallback returns "ok" without throwing', async () => {
    function Orphan() {
      const auth = useAuth();
      const [result, setResult] = React.useState('');
      return (
        <div>
          <button onClick={() => auth.login('x', 'y').then(setResult)}>login</button>
          <span data-testid="result">{result}</span>
        </div>
      );
    }
    render(<Orphan />);
    await act(async () => {
      screen.getByRole('button', { name: 'login' }).click();
    });
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('ok'));
  });
});

// ---------------------------------------------------------------------------
// initialMaybeAuthed — silent refresh on mount
// ---------------------------------------------------------------------------

describe('AuthProvider — initialMaybeAuthed', () => {
  beforeEach(() => {
    mockRefresh.mockReset();
    mockMe.mockReset();
  });

  it('starts with loading=true and maybeAuthed=true when initialMaybeAuthed=true and no initialUser', () => {
    // Prevent the useEffect from resolving during this synchronous assertion.
    // Return a never-resolving promise so mount effect hangs.
    mockRefresh.mockReturnValue(new Promise(() => { /* never resolves */ }));

    wrap(null, true);

    // Synchronously: loading should be true, maybeAuthed true, user none
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('maybeAuthed')).toHaveTextContent('true');
    expect(screen.getByTestId('username')).toHaveTextContent('none');
  });

  it('starts with loading=false when initialMaybeAuthed=true but initialUser is already set', () => {
    // If the server already resolved the user, no silent refresh needed
    wrap(ALICE, true);

    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('maybeAuthed')).toHaveTextContent('false');
    expect(screen.getByTestId('username')).toHaveTextContent('alice');
  });

  it('populates user after successful silent refresh+me on mount', async () => {
    mockRefresh.mockResolvedValueOnce({ ok: true });
    mockMe.mockResolvedValueOnce({ user: ALICE });

    wrap(null, true);

    // Should resolve to logged-in state
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('alice');
    });
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('maybeAuthed')).toHaveTextContent('false');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockMe).toHaveBeenCalledTimes(1);
  });

  it('leaves user=null and loading=false when silent refresh fails', async () => {
    mockRefresh.mockRejectedValueOnce(new Error('unauthorized'));

    wrap(null, true);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('username')).toHaveTextContent('none');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('maybeAuthed')).toHaveTextContent('false');
  });

  it('leaves user=null and loading=false when refresh succeeds but me() fails', async () => {
    mockRefresh.mockResolvedValueOnce({ ok: true });
    mockMe.mockRejectedValueOnce(new Error('network'));

    wrap(null, true);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('username')).toHaveTextContent('none');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });

  it('does NOT start loading when initialMaybeAuthed is false (default)', () => {
    // No mock needed — effect should not run
    wrap(null, false);

    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('maybeAuthed')).toHaveTextContent('false');
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
