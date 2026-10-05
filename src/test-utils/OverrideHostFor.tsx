/**
 * The override dialog's host for a suite that mounts DmNarrationPanel (or the stage) on its own. In the app the host wraps the whole
 * /play shell (`overrideDialog.tsx`); the panel's openers do nothing without it. Outside `__tests__/` on purpose: jest would run it as a suite.
 */
import type { ReactNode } from 'react';
import DmNarrationPanel, { type DmNarrationPanelProps } from '@/components/DmNarrationPanel';
import { OverrideDialogHost } from '@/app/play/[sessionId]/overrideDialog';
import type { CombatState } from '@/lib/api/types';

export function OverrideHostFor({
  combatState,
  children,
  onStateUpdate = () => {},
  onStateRefresh = () => {},
  appendLog = () => {},
  isHumanDM = true,
}: {
  combatState: CombatState;
  children: ReactNode;
  onStateUpdate?: (s: CombatState) => void;
  onStateRefresh?: () => void;
  appendLog?: Parameters<typeof OverrideDialogHost>[0]['appendLog'];
  isHumanDM?: boolean;
}) {
  return (
    <OverrideDialogHost
      isHumanDM={isHumanDM} combatId="c1" combatState={combatState} dmUsername="dm" appendLog={appendLog}
      onStateUpdate={onStateUpdate} onStateRefresh={onStateRefresh} fallbackFocus={() => document.body}
    >
      {children}
    </OverrideDialogHost>
  );
}

/**
 * A DmNarrationPanel with the dialog's host around it, for the suites written when the panel owned the dialog. `onOverrideMessage` keeps its old
 * meaning: it hears the engine's sentence after a successful override (the host writes the ruling row; this unwraps its "DM ruled: " prefix).
 */
export function PanelWithHost({ onOverrideMessage, ...panel }: Omit<DmNarrationPanelProps, 'onOverrideMessage'> & { onOverrideMessage?: (text: string) => void }) {
  return (
    <OverrideHostFor
      combatState={panel.combatState}
      onStateUpdate={panel.onStateUpdate}
      onStateRefresh={panel.onStateRefresh}
      appendLog={(row) => onOverrideMessage?.(row.text.replace(/^DM ruled: /, ''))}
    >
      <DmNarrationPanel {...panel} />
    </OverrideHostFor>
  );
}
