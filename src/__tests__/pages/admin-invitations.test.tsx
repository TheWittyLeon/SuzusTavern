/**
 * Tests for /admin/invitations — RevealBlock bugs.
 *
 * Bug 1: Copy buttons silently fail on HTTP (navigator.clipboard is undefined).
 *        The copyToClipboard helper must fall back to execCommand and still set
 *        the 'copied' state so the button shows "Copied!".
 *
 * Bug 2: Sign-up link showed localhost:3000 (backend FRONTEND_URL default).
 *        RevealBlock now builds the link from window.location.origin so it
 *        always matches how the Tavern was reached.
 *
 * NOTE: jsdom always satisfies the secure-context check so unit tests cannot
 *       exercise the real HTTP clipboard failure. The execCommand path is
 *       triggered here by deleting navigator.clipboard. The actual HTTP-context
 *       copy must be browser-verified on the homelab at deploy time.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before the module import
// ---------------------------------------------------------------------------

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useParams: () => ({}),
}));

jest.mock('next/link', () => {
  const Link = ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
  Link.displayName = 'Link';
  return Link;
});

// Auth — always return an admin so the page renders
const mockUseAuth = jest.fn();
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

// API — listInvitations returns an empty list
jest.mock('../../lib/api/signup', () => ({
  listInvitations: jest.fn().mockResolvedValue({ invitations: [] }),
  mintInvitation: jest.fn(),
  revokeInvitation: jest.fn(),
}));

jest.mock('../../components/TavernShell', () => {
  const Shell = ({
    children,
    title,
    actions,
  }: {
    children: React.ReactNode;
    title: React.ReactNode;
    actions?: React.ReactNode;
  }) => (
    <div data-testid="tavern-shell">
      <h1>{title}</h1>
      {actions && <div data-testid="shell-actions">{actions}</div>}
      {children}
    </div>
  );
  Shell.displayName = 'TavernShell';
  return Shell;
});

jest.mock('../../components/PageSkeleton', () => {
  const PS = () => <div data-testid="page-skeleton" />;
  PS.displayName = 'PageSkeleton';
  return PS;
});

jest.mock('../../components/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ toast: jest.fn(), dismiss: jest.fn() }),
}));

jest.mock('../../components/Pill', () => {
  const Pill = ({ children }: { children: React.ReactNode }) => <span>{children}</span>;
  Pill.displayName = 'Pill';
  return Pill;
});

jest.mock('../../components/Button', () => {
  const Button = ({
    children,
    onClick,
    href,
    disabled,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { href?: string }) => {
    if (href)
      return (
        <a href={href} {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
          {children}
        </a>
      );
    return (
      <button onClick={onClick} disabled={disabled} {...rest}>
        {children}
      </button>
    );
  };
  Button.displayName = 'Button';
  return Button;
});

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are hoisted)
// ---------------------------------------------------------------------------

import AdminInvitationsPage from '../../app/admin/invitations/page';
import { mintInvitation } from '../../lib/api/signup';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  user: { id: 1, username: 'leon', roles: ['admin'] },
  loading: false,
};

// Minimal Invitation shape returned by the mint API
const MOCK_INVITATION = {
  id: 42,
  code: 'TESTCODE-ABCD-1234',
  code_prefix: 'TESTCODE',
  signup_url: 'http://localhost:3000/signup?invite=TESTCODE-ABCD-1234',
  status: 'active' as const,
  role_to_grant: 'user',
  max_uses: 1,
  used_count: 0,
  expires_at: null,
  note: null,
  created_at: new Date().toISOString(),
  created_by: 1,
  revoked: false,
  last_used_at: null,
};

const mockMintInvitation = mintInvitation as jest.MockedFunction<typeof mintInvitation>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  mockUseAuth.mockReturnValue(ADMIN_USER);
  return render(<AdminInvitationsPage />);
}

/**
 * Open the mint modal, submit it, and wait for RevealBlock to appear.
 * - Opens the modal from the shell-actions "Mint invite" button.
 * - Submits via the dialog's own submit button (aria-label="Mint invite",
 *   class="btn btn-primary", located inside role="dialog").
 */
async function mintAndReveal() {
  renderPage();
  mockMintInvitation.mockResolvedValueOnce({ msg: 'ok', invitation: MOCK_INVITATION });

  // Open modal: the "Mint invite" button in the shell-actions area
  const shellActions = await screen.findByTestId('shell-actions');
  const openMintBtn = within(shellActions).getByRole('button');
  fireEvent.click(openMintBtn);

  // The modal renders as role="dialog". Submit using the button inside it.
  const dialog = await screen.findByRole('dialog');
  const submitBtn = within(dialog).getByRole('button', { name: /mint invite/i });
  fireEvent.click(submitBtn);

  // Wait for RevealBlock's "Invite created" label
  await screen.findByText(/invite created/i);
}

// ---------------------------------------------------------------------------
// Bug 2: Sign-up link uses window.location.origin
//
// jsdom defines window.location as non-configurable, so we cannot override the
// origin getter. Instead we assert that:
//   (a) The displayed link uses window.location.origin (which jsdom sets to
//       'http://localhost') — NOT the backend's 'http://localhost:3000' from
//       signup_url.
//   (b) The link contains the correct ?invite= query param.
//
// This is sufficient to prove the fix: the origin comes from window.location,
// not from the API's signup_url field. The real-world difference between
// localhost and 10.69.69.127:3000 can only be verified in a real browser on
// the homelab — flagged in the deploy note below.
// ---------------------------------------------------------------------------

describe('RevealBlock — sign-up link origin (Bug 2)', () => {
  // jsdom origin is 'http://localhost' (port-less, unlike the API's :3000 URL)
  const JSDOM_ORIGIN = window.location.origin; // 'http://localhost'

  it('displays a link derived from window.location.origin, not the backend signup_url', async () => {
    await mintAndReveal();

    // The expected link uses the jsdom origin + /signup?invite=<code>
    const expectedLink = `${JSDOM_ORIGIN}/signup?invite=${MOCK_INVITATION.code}`;
    expect(screen.getByText(expectedLink)).toBeInTheDocument();

    // The backend's signup_url ('http://localhost:3000/signup?invite=…') must
    // NOT appear — the port difference proves we're reading window.location.origin
    // and not the raw API field.
    expect(screen.queryByText(MOCK_INVITATION.signup_url)).not.toBeInTheDocument();
  });

  it('uses ?invite= query param matching searchParams.get("invite") in /signup/page.tsx', async () => {
    await mintAndReveal();

    const expectedLink = `${JSDOM_ORIGIN}/signup?invite=${MOCK_INVITATION.code}`;
    expect(screen.getByText(expectedLink)).toBeInTheDocument();
    // Explicit assertion: param name is exactly "invite" (not "code" or "token")
    expect(expectedLink).toMatch(/[?&]invite=/);
  });
});

// ---------------------------------------------------------------------------
// Bug 1: Clipboard fallback on HTTP (navigator.clipboard unavailable)
// ---------------------------------------------------------------------------

describe('RevealBlock — clipboard fallback (Bug 1)', () => {
  let clipboardDescriptor: PropertyDescriptor | undefined;
  let execCommandMock: jest.Mock;

  beforeEach(() => {
    // Save the current clipboard descriptor
    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

    // Simulate HTTP context: remove the clipboard API
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    // jsdom does not implement execCommand; define it as a mock.
    execCommandMock = jest.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommandMock,
      writable: true,
    });
  });

  afterEach(() => {
    // Restore clipboard
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    }
    // Remove execCommand mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (document as any).execCommand;
  });

  it('falls back to execCommand when navigator.clipboard is undefined', async () => {
    await mintAndReveal();

    const copyCodeBtn = screen.getByRole('button', { name: /copy invite code/i });
    fireEvent.click(copyCodeBtn);

    await waitFor(() => {
      expect(execCommandMock).toHaveBeenCalledWith('copy');
    });
  });

  it('sets "Copied!" state on the code button after execCommand fallback', async () => {
    await mintAndReveal();

    const copyCodeBtn = screen.getByRole('button', { name: /copy invite code/i });
    fireEvent.click(copyCodeBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy invite code/i })).toHaveTextContent('Copied!');
    });
  });

  it('sets "Copied!" state on the url button after execCommand fallback', async () => {
    await mintAndReveal();

    const copyUrlBtn = screen.getByRole('button', { name: /copy sign-up link/i });
    fireEvent.click(copyUrlBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy sign-up link/i })).toHaveTextContent('Copied!');
    });
  });
});

// ---------------------------------------------------------------------------
// Modern clipboard path (navigator.clipboard present)
// ---------------------------------------------------------------------------

describe('RevealBlock — modern clipboard path', () => {
  let mockWriteText: jest.Mock;
  let originalClipboard: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    mockWriteText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mockWriteText },
      writable: true,
    });
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    }
  });

  it('uses navigator.clipboard.writeText when available', async () => {
    await mintAndReveal();

    const copyCodeBtn = screen.getByRole('button', { name: /copy invite code/i });
    fireEvent.click(copyCodeBtn);

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith(MOCK_INVITATION.code);
    });
  });

  it('sets "Copied!" state after successful clipboard.writeText', async () => {
    await mintAndReveal();

    const copyCodeBtn = screen.getByRole('button', { name: /copy invite code/i });
    fireEvent.click(copyCodeBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy invite code/i })).toHaveTextContent('Copied!');
    });
  });
});

// ---------------------------------------------------------------------------
// ?invite= param name matches /signup page reader
// ---------------------------------------------------------------------------

describe('RevealBlock — ?invite= param name matches /signup page', () => {
  it('generated link uses "invite" param, matching searchParams.get("invite") in signup/page.tsx', async () => {
    await mintAndReveal();

    // Find any <code> element that contains the signup link
    const codeEls = document.querySelectorAll('code');
    const linkEl = Array.from(codeEls).find((el) =>
      el.textContent?.includes('/signup?invite='),
    );
    expect(linkEl).toBeTruthy();
    expect(linkEl?.textContent).toMatch(/\/signup\?invite=/);
  });
});
