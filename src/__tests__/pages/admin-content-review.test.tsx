/**
 * Tests for /admin/content/[draftId] review screen (S8.3).
 *
 * Covers:
 *   - Loading state renders PageSkeleton
 *   - Success state renders source pane and fields pane
 *   - Not-found state renders appropriate message
 *   - Error state renders error message with retry
 *   - Approve action: calls approveDraft with correct args, navigates back
 *   - Reject action: opens RejectDialog, calls rejectDraft with reason, navigates back
 *   - Save action: calls saveDraft with correct args, reloads draft
 *   - Non-admin redirected to /dashboard
 *
 * S8.3 — Gated Content Pipeline.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import type { ContentDraft } from '../../lib/api/adminContent';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockToast = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useParams: () => ({ draftId: '42' }),
}));

jest.mock('next/link', () => {
  const Link = ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  );
  Link.displayName = 'Link';
  return Link;
});

const mockGetDraft = jest.fn<Promise<ContentDraft>, []>();
const mockSaveDraft = jest.fn();
const mockApproveDraft = jest.fn();
const mockRejectDraft = jest.fn();

jest.mock('../../lib/api/adminContent', () => ({
  listDrafts: jest.fn(),
  getDraft: (...args: unknown[]) => mockGetDraft(...(args as [])),
  saveDraft: (...args: unknown[]) => mockSaveDraft(...args),
  approveDraft: (...args: unknown[]) => mockApproveDraft(...args),
  rejectDraft: (...args: unknown[]) => mockRejectDraft(...args),
}));

// Note: all jest.mock paths use relative imports (no @/) to avoid alias resolution
// issues during jest.mock hoisting.
const mockUseAuth = jest.fn();
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../../components/TavernShell', () => {
  const Shell = ({ children, title, actions }: { children: React.ReactNode; title: React.ReactNode; actions?: React.ReactNode }) => (
    <div data-testid="tavern-shell">
      <h1>{typeof title === 'string' ? title : 'Review'}</h1>
      {actions && <div data-testid="header-actions">{actions}</div>}
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
  useToast: () => ({ toast: mockToast, dismiss: jest.fn() }),
}));

jest.mock('../../components/Pill', () => {
  const Pill = ({ children, tone, dot }: { children: React.ReactNode; tone?: string; dot?: boolean }) => (
    <span data-testid="pill" data-tone={tone} data-dot={dot ? 'true' : undefined}>{children}</span>
  );
  Pill.displayName = 'Pill';
  return Pill;
});

jest.mock('../../components/Button', () => {
  const Button = ({ children, onClick, href, disabled, type: btnType, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { href?: string }) => {
    if (href) return <a href={href} {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>;
    return <button type={btnType ?? 'button'} onClick={onClick} disabled={disabled} {...rest}>{children}</button>;
  };
  Button.displayName = 'Button';
  return Button;
});

jest.mock('../../components/RejectDialog', () => {
  const RD = ({ open, onConfirm, onCancel, busy }: {
    open: boolean;
    onConfirm: (reason: string) => void;
    onCancel: () => void;
    busy?: boolean;
  }) => {
    if (!open) return null;
    return (
      <div data-testid="reject-dialog" role="dialog" aria-modal="true">
        <button onClick={() => onConfirm('Test reject reason')} disabled={busy}>
          Reject draft
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    );
  };
  RD.displayName = 'RejectDialog';
  return RD;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const adminUser = { id: 1, username: 'Leon', email: null, roles: ['admin'] };
const regularUser = { id: 2, username: 'Other', email: null, roles: ['user'] };

function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    draft_id: 42,
    pack_id: 'fallout-core',
    system_id: 'fallout2d20',
    content_type: 'weapon',
    slug: 'laser-rifle',
    name: 'Laser Rifle',
    lifecycle: 'draft',
    source: {
      key: 'fallout-owned-leon',
      page: 142,
      snippet: 'LASER RIFLE (3 CD energy) Reliable, Bright. The laser rifle fires a precise beam...',
    },
    previous_content_id: null,
    created_at: '2026-06-26T18:04:11Z',
    updated_at: '2026-06-26T18:05:00Z',
    data: { damage: [{ amount: 3, type: 'energy' }], skill: 'Guns', qualities: ['Reliable', 'Bright'] },
    ...overrides,
  };
}

// Async import after mocks — use relative path to avoid @/ alias resolution issues with jest.mock hoisting
let ReviewPage: typeof import('../../app/admin/content/[draftId]/page').default;

beforeAll(async () => {
  // The dynamic import path must match the jest.mock path pattern so the mock applies
  ReviewPage = (
    await import('../../app/admin/content/[draftId]/page')
  ).default;
});

beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockToast.mockReset();
  mockGetDraft.mockReset();
  mockSaveDraft.mockReset();
  mockApproveDraft.mockReset();
  mockRejectDraft.mockReset();
  mockUseAuth.mockReturnValue({ user: adminUser, loading: false, isAuthenticated: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewDraftPage — loading state', () => {
  it('renders PageSkeleton while draft is loading', async () => {
    mockGetDraft.mockReturnValue(new Promise(() => {}));

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
    });
  });
});

describe('ReviewDraftPage — success state', () => {
  it('renders source pane with extracted snippet', async () => {
    const draft = makeDraft();
    mockGetDraft.mockResolvedValueOnce(draft);

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByText(/LASER RIFLE \(3 CD energy\)/i)).toBeInTheDocument();
    });
  });

  it('renders fields pane with the draft name', async () => {
    const draft = makeDraft();
    mockGetDraft.mockResolvedValueOnce(draft);

    render(<ReviewPage />);

    await waitFor(() => {
      const nameInput = screen.getByRole('textbox', { name: /name/i });
      expect((nameInput as HTMLInputElement).value).toBe('Laser Rifle');
    });
  });

  it('renders Approve, Save edits, and Reject buttons', async () => {
    mockGetDraft.mockResolvedValueOnce(makeDraft());

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeInTheDocument();
      expect(screen.getByText('Save edits')).toBeInTheDocument();
      expect(screen.getByText('Reject')).toBeInTheDocument();
    });
  });

  it('calls getDraft with draftId=42 and username=Leon', async () => {
    mockGetDraft.mockResolvedValueOnce(makeDraft());

    render(<ReviewPage />);

    await waitFor(() => {
      expect(mockGetDraft).toHaveBeenCalledWith(42, 'Leon', expect.any(AbortSignal));
    });
  });

  it('shows draft slug in the fields pane', async () => {
    mockGetDraft.mockResolvedValueOnce(makeDraft());

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByText('laser-rifle')).toBeInTheDocument();
    });
  });
});

describe('ReviewDraftPage — not-found state', () => {
  it('renders not-found message when API returns 404', async () => {
    const notFoundErr = Object.assign(new Error('Not found'), { status: 404, code: '404' });
    mockGetDraft.mockRejectedValueOnce(notFoundErr);

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByText(/This draft was not found/i)).toBeInTheDocument();
    });
  });
});

describe('ReviewDraftPage — error state', () => {
  it('renders error message with retry button on API failure', async () => {
    const apiErr = Object.assign(new Error('Network error'), { status: 502, code: '502' });
    mockGetDraft.mockRejectedValueOnce(apiErr);

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Could not load this draft/i)).toBeInTheDocument();
      expect(screen.getByText('Try again')).toBeInTheDocument();
    });
  });
});

describe('ReviewDraftPage — approve flow', () => {
  it('calls approveDraft with correct draftId and actor', async () => {
    mockGetDraft.mockResolvedValueOnce(makeDraft());
    mockApproveDraft.mockResolvedValueOnce({
      draft_id: 42,
      lifecycle: 'live',
      promoted_content_id: 9871,
    });

    render(<ReviewPage />);
    await waitFor(() => screen.getByText('Approve'));

    await act(async () => {
      fireEvent.click(screen.getByText('Approve'));
    });

    expect(mockApproveDraft).toHaveBeenCalledWith(42, 'Leon');
  });

  it('navigates to /admin/content after successful approve', async () => {
    mockGetDraft.mockResolvedValueOnce(makeDraft());
    mockApproveDraft.mockResolvedValueOnce({
      draft_id: 42,
      lifecycle: 'live',
      promoted_content_id: 9871,
    });

    render(<ReviewPage />);
    await waitFor(() => screen.getByText('Approve'));

    await act(async () => {
      fireEvent.click(screen.getByText('Approve'));
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/admin/content');
    });
  });

  it('shows a success toast after approve', async () => {
    mockGetDraft.mockResolvedValueOnce(makeDraft());
    mockApproveDraft.mockResolvedValueOnce({ draft_id: 42, lifecycle: 'live', promoted_content_id: 9871 });

    render(<ReviewPage />);
    await waitFor(() => screen.getByText('Approve'));

    await act(async () => {
      fireEvent.click(screen.getByText('Approve'));
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'success', message: expect.stringContaining('live') }),
      );
    });
  });

  it('shows inline error banner when approve fails', async () => {
    mockGetDraft.mockResolvedValueOnce(makeDraft());
    mockApproveDraft.mockRejectedValueOnce(new Error('Engine error'));

    render(<ReviewPage />);
    await waitFor(() => screen.getByText('Approve'));

    await act(async () => {
      fireEvent.click(screen.getByText('Approve'));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Failed to approve/i)).toBeInTheDocument();
    });
    // Does NOT navigate away
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('ReviewDraftPage — reject flow', () => {
  it('opens RejectDialog when Reject button is clicked', async () => {
    mockGetDraft.mockResolvedValueOnce(makeDraft());

    render(<ReviewPage />);
    await waitFor(() => screen.getByText('Reject'));

    fireEvent.click(screen.getByText('Reject'));

    expect(screen.getByTestId('reject-dialog')).toBeInTheDocument();
  });

  it('calls rejectDraft with draftId, actor, and reason from dialog', async () => {
    mockGetDraft.mockResolvedValueOnce(makeDraft());
    mockRejectDraft.mockResolvedValueOnce({ draft_id: 42, lifecycle: 'rejected' });

    render(<ReviewPage />);
    await waitFor(() => screen.getByText('Reject'));

    fireEvent.click(screen.getByText('Reject'));
    await screen.findByTestId('reject-dialog');

    await act(async () => {
      fireEvent.click(screen.getByText('Reject draft'));
    });

    expect(mockRejectDraft).toHaveBeenCalledWith(42, 'Leon', 'Test reject reason');
  });

  it('navigates to /admin/content after successful reject', async () => {
    mockGetDraft.mockResolvedValueOnce(makeDraft());
    mockRejectDraft.mockResolvedValueOnce({ draft_id: 42, lifecycle: 'rejected' });

    render(<ReviewPage />);
    await waitFor(() => screen.getByText('Reject'));
    fireEvent.click(screen.getByText('Reject'));
    await screen.findByTestId('reject-dialog');

    await act(async () => {
      fireEvent.click(screen.getByText('Reject draft'));
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/admin/content');
    });
  });
});

describe('ReviewDraftPage — save flow', () => {
  it('Save edits button is disabled when form is not dirty', async () => {
    mockGetDraft.mockResolvedValueOnce(makeDraft());

    render(<ReviewPage />);
    await waitFor(() => screen.getByText('Save edits'));

    const saveBtn = screen.getByText('Save edits').closest('button');
    expect(saveBtn).toBeDisabled();
  });

  it('calls saveDraft when Save edits is clicked after making a change', async () => {
    const draft = makeDraft();
    mockGetDraft.mockResolvedValueOnce(draft);
    // Second call on reload after save
    mockGetDraft.mockResolvedValueOnce({ ...draft, name: 'Updated Laser Rifle', updated_at: '2026-06-26T19:00:00Z' });
    mockSaveDraft.mockResolvedValueOnce({ draft_id: 42, changed: true, version: 2 });

    render(<ReviewPage />);
    await waitFor(() => screen.getByRole('textbox', { name: /name/i }));

    // Dirty the form by changing the name
    const nameInput = screen.getByRole('textbox', { name: /name/i });
    fireEvent.change(nameInput, { target: { value: 'Updated Laser Rifle' } });

    // Save edits button should now be enabled
    await waitFor(() => {
      const saveBtn = screen.getByText('Save edits').closest('button');
      expect(saveBtn).not.toBeDisabled();
    });

    await act(async () => {
      // Submit the form
      const form = screen.getByRole('form', { name: /Edit draft fields/i });
      fireEvent.submit(form);
    });

    await waitFor(() => {
      expect(mockSaveDraft).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ name: 'Updated Laser Rifle' }),
        'Leon',
      );
    });
  });
});

describe('ReviewDraftPage — auth gate', () => {
  it('redirects non-admin user to /dashboard', async () => {
    mockUseAuth.mockReturnValue({ user: regularUser, loading: false, isAuthenticated: true });

    render(<ReviewPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('does NOT call getDraft when user is not admin', async () => {
    mockUseAuth.mockReturnValue({ user: regularUser, loading: false, isAuthenticated: true });

    render(<ReviewPage />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockGetDraft).not.toHaveBeenCalled();
  });
});

describe('ReviewDraftPage — perk content type', () => {
  it('renders perk-specific fields (Ranks, Required level, SPECIAL, Effect)', async () => {
    const perkDraft = makeDraft({
      content_type: 'perk',
      data: {
        ranks: 3,
        requirements: {
          special: { strength: 0, perception: 4, endurance: 0, charisma: 0, intelligence: 6, agility: 0, luck: 0 },
          level: 8,
        },
        effect: 'Gain +10 to Science skill per rank.',
      },
    });
    mockGetDraft.mockResolvedValueOnce(perkDraft);

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Ranks')).toBeInTheDocument();
      expect(screen.getByLabelText('Required level')).toBeInTheDocument();
      expect(screen.getByLabelText('Effect')).toBeInTheDocument();
    });
  });
});

describe('ReviewDraftPage — creature content type', () => {
  it('renders creature-specific fields (HP, Skills, Attacks)', async () => {
    const creatureDraft = makeDraft({
      content_type: 'creature',
      data: {
        special: { strength: 6, perception: 4, endurance: 5, charisma: 2, intelligence: 3, agility: 4, luck: 3 },
        skills: { Athletics: 3 },
        hp: { max: 40 },
        attacks: [{ weapon_ref: 'claws' }],
      },
    });
    mockGetDraft.mockResolvedValueOnce(creatureDraft);

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('HP (max)')).toBeInTheDocument();
      expect(screen.getByLabelText('Skills')).toBeInTheDocument();
    });
  });
});

describe('ReviewDraftPage — unsupported content type', () => {
  it('renders raw data fallback for unknown content types', async () => {
    const unknownDraft = makeDraft({
      content_type: 'perk_unknown_type_xyz',
      data: { some: 'raw', json: true },
    });
    mockGetDraft.mockResolvedValueOnce(unknownDraft);

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByText(/read-only — content type not yet supported/i)).toBeInTheDocument();
    });
  });
});
