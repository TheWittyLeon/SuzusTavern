/**
 * Round 7 (the post-deploy prod test of 55c5e26): `div[aria-label="Session recap"]` had no role, so its label was ignored and axe reported `aria-prohibited-attr` (serious).
 * It is a `group` (a named container, not a landmark: the wrapper is always mounted and empty until a recap exists, so a `region` would put an empty landmark in every
 * screen reader's menu). The always-mounted live-region behaviour is unchanged. Take `role="group"` off -> reds.
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SessionRecapTenant } from '@/app/play/[sessionId]/tenants/StatusAnnouncers';

jest.mock('../../components/SessionRecap', () => ({ __esModule: true, default: () => <p>recap body</p> }));

describe('SessionRecapTenant', () => {
  it('is a named group: the label is honoured (a role-less div may not carry one)', () => {
    render(<SessionRecapTenant session={null} username="kes" />);
    const g = screen.getByRole('group', { name: 'Session recap' });
    expect(g).toHaveAttribute('data-tenant', 'sessionRecap');
  });

  it('is NOT a landmark (it is empty until a recap exists)', () => {
    render(<SessionRecapTenant session={null} username="kes" />);
    expect(screen.queryByRole('region', { name: 'Session recap' })).toBeNull();
  });

  it('stays always mounted and polite: with no session it is an empty live region (the announcer exists before its content)', () => {
    render(<SessionRecapTenant session={null} username="kes" />);
    const g = screen.getByRole('group', { name: 'Session recap' });
    expect(g).toHaveAttribute('aria-live', 'polite');
    expect(g).toBeEmptyDOMElement();
  });
});
