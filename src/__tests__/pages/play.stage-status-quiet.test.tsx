/**
 * B8c-3 M2 (Iro ruling 1, the harness's board-line-quiet leg): writing the scene line mutates NOTHING inside the status node's live region once the line is up. Found by the real
 * mount: every re-render of the stage rebuilt the status node's icon (`Icon` handed React a new `{ __html }` object each render, and React re-applies `innerHTML` for a new object), a
 * `childList` mutation in a `role="status"` node on every square the user arrowed over. `Icon` now holds the object stable.
 * Mutation seen red: `dangerouslySetInnerHTML={{ __html: paths }}` back in Icon.tsx -> "the icon's markup is not rebuilt" goes red (3 svg childList mutations per line written).
 */
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useRef, useState } from 'react';
import SceneStage, { useStageLine } from '@/app/play/[sessionId]/regions/SceneStage';
import Icon from '@/components/Icon';

function Writer() {
  const set = useStageLine();
  const [n, setN] = useState(0);
  return <button type="button" onClick={() => { set(`line ${n}`); setN(n + 1); }}>write</button>;
}

function Stage() {
  const head = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const begin = useRef<HTMLButtonElement>(null);
  return (
    <aside data-region-slot="sceneStage">
      <SceneStage
        sceneName="x" objective={null} sceneHeadRef={head} combatIsActive activeEncounterId={null} sceneHasEncounter={false} combatBusy={false} endCombatBtnRef={end}
        outcomeChooserOpen={false} setOutcomeChooserOpen={() => {}} lastOpenerRef={opener} allHostilesDown={false} anyMonsterDown={false} onEndCombat={() => {}} beginCombatRef={begin}
        onBeginEncounter={() => {}} talking={false} sessionLocked={false} rollBusy={false} round={2} variant="hero"
      >
        <Writer />
      </SceneStage>
    </aside>
  );
}

const flush = () => new Promise<void>((r) => setTimeout(r, 20));

describe('the status node is quiet while the line changes', () => {
  it('after the line is first up, five more writes mutate nothing inside the status node: no child added or removed, no text changed, no attribute', async () => {
    render(<Stage />);
    act(() => { screen.getByRole('button', { name: 'write' }).click(); }); // the line appears; the status takes its clipped class once
    const status = document.querySelector('[role="status"]') as HTMLElement;
    const seen: string[] = [];
    const observer = new MutationObserver((rs) => rs.forEach((r) => seen.push(`${r.type} ${(r.target as Element).tagName}`)));
    observer.observe(status, { subtree: true, childList: true, attributes: true, characterData: true });
    for (let i = 0; i < 5; i++) act(() => { screen.getByRole('button', { name: 'write' }).click(); });
    await flush();
    observer.disconnect();
    expect(seen).toEqual([]);
  });

  it('the icon\'s markup is not rebuilt by a re-render with the same name (a stable object for dangerouslySetInnerHTML)', async () => {
    const { rerender, container } = render(<Icon name="Sword" size={13} />);
    const svg = container.querySelector('svg') as SVGElement;
    const first = svg.firstChild;
    const seen: string[] = [];
    const observer = new MutationObserver((rs) => rs.forEach((r) => seen.push(r.type)));
    observer.observe(svg, { childList: true, subtree: true });
    rerender(<Icon name="Sword" size={13} />);
    rerender(<Icon name="Sword" size={13} />);
    await flush();
    observer.disconnect();
    expect(seen).toEqual([]);
    expect(svg.firstChild).toBe(first);
    // and a different icon DOES change it
    rerender(<Icon name="Skull" size={13} />);
    expect(svg.firstChild).not.toBe(first);
  });
});
