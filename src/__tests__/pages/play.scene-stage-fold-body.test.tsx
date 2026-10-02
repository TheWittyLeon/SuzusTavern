/**
 * A9d-2 F1 (build brief 4, Iro A9d-1 IMPORTANT-1, Kage S5, F-1): only the stage PICTURE
 * folds. The head (the focus-rescue anchor), the encounter controls and both announcers
 * stay outside `[data-fold-body]`, in every SceneStage state.
 */
import { createRef } from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import SceneStage, { SCENE_STAGE_BODY_ID, type SceneStageProps } from '@/app/play/[sessionId]/regions/SceneStage';
import { FOLD_SPECS } from '@/app/play/[sessionId]/foldSpecs';
import fs from 'node:fs';
import path from 'node:path';

const base = (): SceneStageProps => ({
  sceneName: 'The Cellar',
  objective: 'Find the key',
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

const STATES: Array<[string, Partial<SceneStageProps>]> = [
  ['exploring', {}],
  ['exploring, scene has an encounter (Stand and fight)', { sceneHasEncounter: true }],
  ['combat', { combatIsActive: true }],
  ['combat, all hostiles down, chooser open', { combatIsActive: true, allHostilesDown: true, outcomeChooserOpen: true }],
  ['combat ended', { activeEncounterId: 'enc-1' }],
];

describe('SceneStage fold body', () => {
  // A9d-2 N5 (named exception): the stage's FOLD_SPECS entry is deleted with its fold (no row sets `collapsible` on it); the body contract
  // is DORMANT (the `debt:` on FoldSpec.body) until the phone map returns at step 12. The wrapper it will fold stays in `panel` and `hero`.
  it('no FoldSpec names the stage (dormant: the fold returns with the phone map at step 12); the body wrapper it will fold is still rendered, `panel` and `hero`', () => {
    expect(FOLD_SPECS.sceneStage).toBeUndefined();
    for (const variant of ['panel', 'hero'] as const) {
      const { container, unmount } = render(<SceneStage {...base()} variant={variant} />);
      expect(container.querySelectorAll('[data-fold-body]')).toHaveLength(1);
      unmount();
    }
  });

  it('the phone\'s strip (`inline`) renders no picture and no fold body, and stamps its variant', () => {
    const { container } = render(<SceneStage {...base()} variant="inline" />);
    expect(container.querySelector('[data-fold-body]')).toBeNull();
    expect(container.querySelector('[data-region="sceneStage"]')).toHaveAttribute('data-variant', 'inline');
    expect(container.textContent).not.toMatch(/tactical map arrives/);
  });

  it.each(STATES)('%s: one fold body; no live region, no focus anchor and no control inside it', (_n, over) => {
    const props = { ...base(), ...over };
    const { container } = render(<SceneStage {...props} />);
    const bodies = container.querySelectorAll('[data-fold-body]');
    expect(bodies).toHaveLength(1);
    const body = bodies[0] as HTMLElement;
    expect(body.id).toBe(SCENE_STAGE_BODY_ID);
    expect(body.querySelectorAll('[aria-live], [role="status"], [role="alert"], button, [tabindex]')).toHaveLength(0);
    for (const ref of [props.sceneHeadRef, props.endCombatBtnRef, props.beginCombatRef]) {
      if (ref.current) expect(body.contains(ref.current)).toBe(false);
    }
    // The head is still rendered and is the first thing in the region.
    expect(props.sceneHeadRef.current).not.toBeNull();
    expect(body.contains(props.sceneHeadRef.current)).toBe(false);
  });

  it('control: a body that swallowed the head would fail the same assertions', () => {
    const { container } = render(<SceneStage {...{ ...base(), combatIsActive: true }} />);
    const body = container.querySelector('[data-fold-body]') as HTMLElement;
    // Move the live combat note into the body (what folding the whole region used to do).
    body.appendChild(container.querySelector('[role="status"]') as HTMLElement);
    expect(body.querySelectorAll('[aria-live], [role="status"], [role="alert"], button, [tabindex]').length).toBeGreaterThan(0);
  });
});

describe('FoldDock.module.css: the body fold is a stylesheet rule keyed on the dock state', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/components/FoldDock.module.css'), 'utf8');
  it('hides only [data-fold-body] under a folded dock', () => {
    expect(css).toMatch(/\.dock\[data-folded='true'\]\s+\[data-fold-body\]\s*\{\s*display:\s*none;?\s*\}/);
  });
});
