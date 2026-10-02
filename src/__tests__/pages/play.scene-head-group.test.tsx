/**
 * A9d-2 fix round 2 (Iro Minor-7): the scene head is a named focus target (the rescue target of the stranded-focus rule and the fallback of every
 * anchored popover). ARIA 1.2 does not allow a name on a role-less generic, so it is `role="group"`. Control: take `role="group"` off -> reds.
 */
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SceneStage from '@/app/play/[sessionId]/regions/SceneStage';

jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

const props = () => ({
  sceneName: 'The Sundered Hollow',
  objective: null,
  sceneHeadRef: createRef<HTMLDivElement>(),
  combatIsActive: false,
  activeEncounterId: null,
  sceneHasEncounter: false,
  combatBusy: false,
  endCombatBtnRef: createRef<HTMLButtonElement>(),
  outcomeChooserOpen: false,
  setOutcomeChooserOpen: jest.fn(),
  lastOpenerRef: createRef<HTMLButtonElement>(),
  allHostilesDown: false,
  anyMonsterDown: false,
  onEndCombat: jest.fn(),
  beginCombatRef: createRef<HTMLButtonElement>(),
  onBeginEncounter: jest.fn(),
  talking: false,
  sessionLocked: false,
  rollBusy: false,
});

describe('SceneStage: the scene head', () => {
  it.each(['inline', 'panel'] as const)('%s variant: a named group that can take programmatic focus', (variant) => {
    const p = props();
    render(<SceneStage {...p} variant={variant} />);
    const head = screen.getByRole('group', { name: 'Scene: The Sundered Hollow' });
    expect(head).toBe(p.sceneHeadRef.current);
    expect(head).toHaveAttribute('tabindex', '-1');
  });

  // Round 7 (Kage): a keyboard Dismiss that loses its card sends focus to [data-focus-fallback] when it has nowhere else; the scene head is that fallback. Take the mark off -> reds.
  it.each(['inline', 'panel'] as const)('%s variant: the scene head is the toast\'s focus fallback (data-focus-fallback)', (variant) => {
    const p = props();
    render(<SceneStage {...p} variant={variant} />);
    expect(p.sceneHeadRef.current).toHaveAttribute('data-focus-fallback');
    expect(document.querySelectorAll('[data-focus-fallback]')).toHaveLength(1);
  });
});
