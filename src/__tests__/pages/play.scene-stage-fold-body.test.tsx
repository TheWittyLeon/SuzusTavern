/**
 * A9d-2 F1 (build brief 4, Iro A9d-1 IMPORTANT-1, Kage S5, F-1): only the stage PICTURE
 * folds. The head (the focus-rescue anchor), the encounter controls and both announcers
 * stay outside `[data-fold-body]`, in every SceneStage state.
 */
import { createRef } from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import SceneStage, { SCENE_STAGE_BODY_ID, type SceneStageProps } from '@/app/play/[sessionId]/regions/SceneStage';
import FoldDock from '@/components/FoldDock';
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
  // A10 step 11 S2b (named exception: `panel` loses its body; the stand-in is gone while exploring): the body is a `hero`'s, the map's room. What pins
  // the invariant now: this test (a body in a `hero` only, in every state), the `panel` / `inline` assertions below, and the registry's hero-stage guards.
  it('no FoldSpec names the stage (dormant: the fold returns with the phone map at step 12); the body wrapper it will fold is rendered in a `hero` and in no other form', () => {
    expect(FOLD_SPECS.sceneStage).toBeUndefined();
    for (const [variant, bodies] of [['panel', 0], ['inline', 0], ['hero', 1]] as const) {
      const { container, unmount } = render(<SceneStage {...base()} variant={variant} />);
      expect(container.querySelectorAll('[data-fold-body]')).toHaveLength(bodies);
      unmount();
    }
  });

  it('a `panel` (Story exploring) renders no body and no stand-in, in any state', () => {
    for (const [, over] of STATES) {
      const { container, unmount } = render(<SceneStage {...{ ...base(), ...over }} variant="panel" />);
      expect(container.querySelector('[data-fold-body]')).toBeNull();
      expect(container.textContent).not.toMatch(/tactical map arrives/);
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
    const { container } = render(<SceneStage {...props} variant="hero" />);
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
    const { container } = render(<SceneStage {...{ ...base(), combatIsActive: true }} variant="hero" />);
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

// B8c-4 P0 (brief 2.3, Iro F-n): the dock provides the folded state and the stage puts the `hidden` ATTRIBUTE on its body: a class alone is invisible to the removed-focus probe and the AX tree.
describe('SceneStage under a body dock: the body takes the hidden attribute, and the handle is placed by the stage', () => {
  const inDock = (folded: boolean, variant: 'hero' | 'inline' = 'hero') => render(
    <FoldDock folded={folded} onToggle={() => {}} label="Map" icon="Map" body={SCENE_STAGE_BODY_ID} text="Map">
      <SceneStage {...{ ...base(), combatIsActive: true }} variant={variant} />
    </FoldDock>,
  );
  it('folded: [data-fold-body] is hidden (the attribute); open: it is not; the head and the controls are never hidden', () => {
    const { container, rerender } = inDock(true);
    expect(container.querySelector('[data-fold-body]')).toHaveAttribute('hidden');
    expect(container.querySelector('[data-region="sceneStage"] [role="group"][data-focus-fallback]')).not.toHaveAttribute('hidden');
    rerender(
      <FoldDock folded={false} onToggle={() => {}} label="Map" icon="Map" body={SCENE_STAGE_BODY_ID} text="Map">
        <SceneStage {...{ ...base(), combatIsActive: true }} variant="hero" />
      </FoldDock>,
    );
    expect(container.querySelector('[data-fold-body]')).not.toHaveAttribute('hidden');
  });
  it('the handle is the stage\'s: after End combat, before the body', () => {
    const { container } = inDock(false);
    const handle = container.querySelector('button[aria-controls="' + SCENE_STAGE_BODY_ID + '"]') as HTMLElement;
    const end = Array.from(container.querySelectorAll('button')).find((b) => /End combat/.test(b.getAttribute('aria-label') ?? '')) as HTMLElement;
    expect(end.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(handle.compareDocumentPosition(container.querySelector('[data-fold-body]') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('outside any dock the body is never hidden and no handle is drawn (a stage used alone)', () => {
    const { container } = render(<SceneStage {...{ ...base(), combatIsActive: true }} variant="hero" />);
    expect(container.querySelector('[data-fold-body]')).not.toHaveAttribute('hidden');
    expect(container.querySelector('button[aria-controls]')).toBeNull();
  });
  it('a stage with no body (inline) inside a body dock has no slot: the dev guard throws (the registry never pairs them)', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => inDock(false, 'inline')).toThrow(/FoldHandleSlot/);
    spy.mockRestore();
  });
});
