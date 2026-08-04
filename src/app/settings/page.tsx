'use client';
/**
 * /settings — account settings.
 *
 * Currently just the passphrase change, which is the first piece of account
 * self-service the Tavern has ever had: `Authentication-Python` shipped
 * `POST /auth/password/change` long ago and nothing could reach it, because
 * the auth BFF's path allow-list is strict-deny and it was never added.
 */
import TavernShell from '@/components/TavernShell';
import Card from '@/components/Card';
import PageSkeleton from '@/components/PageSkeleton';
import ChangePassphrasePanel from '@/components/ChangePassphrasePanel';
import { useAuthGate } from '@/lib/auth/useAuthGate';

export default function SettingsPage() {
  // Every other authenticated page gates; this one did not, so a logged-out
  // visitor got a dead form that could only 401 on submit rather than a
  // redirect (Kuro-Sec finding 4 — consistency, not a hole: the mutation is
  // enforced server-side regardless).
  const gate = useAuthGate({
    skeleton: <PageSkeleton variant="card" lines={3} />,
    label: 'Loading your account',
  });
  if (gate) return gate;

  return (
    <TavernShell active="dashboard" title="Account">
      <Card>
        <ChangePassphrasePanel />
      </Card>
    </TavernShell>
  );
}
