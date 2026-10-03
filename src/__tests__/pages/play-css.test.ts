/**
 * CSS-source regression tests for src/app/play/[sessionId]/Play.module.css.
 *
 * Follows the raw-text-assertion pattern established by
 * src/__tests__/globals-css.test.ts / codex-css.test.ts / dashboard-css.test.ts
 * — CSS Modules are identity-mocked under Jest and jsdom computes no real
 * layout, so neither `.grid`'s actual area assignment at a given viewport
 * nor a button's actual rendered box height is observable from an RTL test.
 *
 * TAV-PLAY-SHELL step 0 (plan §5 "Accessibility invariants currently
 * encoded only in comments"): pins A3 and A11 BEFORE step 2 touches
 * anything, per the step-0 job brief.
 *
 * TAV-PLAY-SHELL step 6b, commit C4 (build brief §6.3, §7 C4): A3 and
 * A11's own CSS shape changed as a DIRECT, prescribed consequence of this
 * commit's own instructions, rewritten here in the SAME commit (a third
 * pin-edit alongside the build brief's two named exceptions — C1's
 * mechanical rename and C4's own TopBar/I4 pins — flagged for review,
 * not snuck in):
 *   - A3: `.grid`'s `grid-template-areas` is now `var(--play-areas)` — a
 *     single data-driven declaration, not a hand-maintained literal
 *     repeated per breakpoint. The underlying invariant ("the safety
 *     banner has a mount point on every layout") still holds, pinned at
 *     the DATA layer instead: `safetyBanner` is placed (non-null area) in
 *     every row × moment by `play-preset-registry.test.ts`'s full-row pin
 *     and its own 🟡-3 literal `areas` pins.
 *   - A11 (rewritten again, A9d E4): the `.mobileTabs` display:none pin is
 *     replaced by the absence pin at the end of this file. E4 deletes the bar,
 *     the 880px pane switch and the Drawer's `visible`/`mobileTabFallback`
 *     second presentation. Named exception in E4's commit message.
 */
import fs from 'fs';
import path from 'path';

describe('Play.module.css', () => {
  let css: string;

  beforeAll(() => {
    css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/play/[sessionId]/Play.module.css'),
      'utf8',
    );
  });

  /** Every `grid-template-areas: ...;` VALUE in the file, base rule and every
   *  @media override alike. Comments stripped first (C4: this file's own
   *  header comment now literally contains the string "grid-template-areas:"
   *  as prose, which the un-stripped regex would otherwise also match). */
  function allGridTemplateAreaValues(): string[] {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: string[] = [];
    const re = /grid-template-areas:\s*([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped))) out.push(m[1]);
    return out;
  }

  /** The full text of a `selector { ... }` block (brace-depth matched, so it
   *  is safe for an @media block whose body contains further nested rules). */
  function blockFrom(headerNeedle: string): string {
    const start = css.indexOf(headerNeedle);
    if (start === -1) throw new Error(`CSS fixture drifted: "${headerNeedle}" not found in Play.module.css`);
    const braceStart = css.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) return css.slice(start, i + 1);
      }
    }
    throw new Error(`unbalanced braces reading "${headerNeedle}"`);
  }

  describe('A3 — the X-card banner lives in a grid area every layout shows (C4: data-driven)', () => {
    it('.grid declares exactly one grid-template-areas, sourced from --play-areas (PlayShell sets it per row × moment)', () => {
      const values = allGridTemplateAreaValues();
      expect(values).toEqual(['var(--play-areas)']);
    });

    it('.xCardBanner collapses to zero footprint via :empty, never display:none/visibility:hidden (it stays in the a11y tree)', () => {
      // A9b Min-8: the old first assertion pinned `.xCardBanner { grid-area: banner }`,
      // which is dead CSS (the banner is a child of the safetyBanner SLOT, which owns the
      // grid area; a non-grid-item's grid-area does nothing). The live invariant is the
      // zero-footprint empty state below, and the slot's own collapse (.slot:empty rule).
      const bannerEmpty = blockFrom('.xCardBanner:empty {');
      expect(bannerEmpty).not.toMatch(/display:\s*none/);
      expect(bannerEmpty).not.toMatch(/visibility:\s*hidden/);
      expect(bannerEmpty).toMatch(/padding:\s*0/);
      expect(bannerEmpty).toMatch(/border:\s*none/);
      expect(bannerEmpty).toMatch(/margin-bottom:\s*0/);
    });
  });

  describe('A9b fix round 1 — slot footprint invariants (the browser half is capture-play --assert-layout)', () => {
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '');

    it('.slot is a containing block, so absolutely-positioned live regions cannot stretch the document (B3)', () => {
      expect(strip(blockFrom('.slot {'))).toMatch(/position:\s*relative/);
    });

    it('a slot whose only child renders nothing has no padding, and is never display:none (Imp-3, Iro zero footprint)', () => {
      const rule = blockFrom('.slot:empty,');
      expect(rule).toMatch(/\.slot:has\(> :only-child:empty\)/);
      expect(strip(rule)).toMatch(/padding:\s*0/);
      expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    });

    it('the out-of-flow rule for empty announcers is scoped to [data-tenant], so the story log itself (no data-tenant, :empty at zero rows) is never clipped (A9d 0b, Kage N1)', () => {
      const selectors = [...strip(css).matchAll(/([^{}]*\.slotStack[^{}]*)\{([^}]*)\}/g)]
        .filter((m) => /:empty/.test(m[1]));
      expect(selectors.length).toBeGreaterThan(0);
      for (const [, sel, body] of selectors) {
        // A9d F3: two named forms, each scoped to [data-tenant]: an empty tenant, and a tenant whose
        // only element children are hidden (the recap wrapper while its strip steps aside).
        const forms = sel.split(',').map((f) => f.trim());
        expect(forms).toEqual([
          '.slotStack > [data-tenant]:empty',
          '.slotStack > [data-tenant]:has(> [hidden]):not(:has(> :not([hidden])))',
        ]);
        expect(body).toMatch(/position:\s*absolute/);
      }
    });

    it('the hidden-children form requires AT LEAST ONE hidden child: a text-only tenant (turnStatus) has no element child and must stay in flow (A9d F3)', () => {
      // Without `:has(> [hidden])`, `:not(:has(> :not([hidden])))` is true of any tenant with no
      // element children, and the stack rule would clip its text to 1x1.
      expect(strip(css)).toMatch(/\.slotStack > \[data-tenant\]:has\(> \[hidden\]\):not\(:has\(> :not\(\[hidden\]\)\)\)/);
    });

    it('the X-card host wraps instead of overflowing, and the control stays a 44px target (Imp-5)', () => {
      const host = strip(blockFrom('.slot:has(> [data-tenant="safetyControls"]) {'));
      expect(host).toMatch(/flex-wrap:\s*wrap/);
      expect(strip(blockFrom('.safety button {'))).toMatch(/height:\s*44px/);
    });
  });

  describe('A9c-2 (Iro MINOR-5) — the X-card consequence copy is never hidden', () => {
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '');
    // Every rule body in the file that targets .safetyHint, narrow or not.
    const hintBodies = () =>
      [...strip(css).matchAll(/\.safetyHint\s*\{([^}]*)\}/g)].map((m) => m[1]);

    it('no .safetyHint rule uses the sr-only technique, display:none or visibility:hidden', () => {
      expect(hintBodies().length).toBeGreaterThan(0);
      for (const body of hintBodies()) {
        expect(body).not.toMatch(/clip:|display:\s*none|visibility:\s*hidden|width:\s*1px|position:\s*absolute/);
      }
    });

    it('below 560px the safety box wraps and the hint takes its own full-width line', () => {
      const narrow = strip(blockFrom('@container (max-width: 560px) {'));
      expect(narrow).toMatch(/\.safety\s*\{[^}]*flex-wrap:\s*wrap/);
      expect(narrow).toMatch(/\.safetyHint\s*\{[^}]*flex:\s*1 0 100%/);
    });
  });

  describe('A9d E3 — the shell lets the page scroll instead of clipping the block axis', () => {
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '');

    it('.grid clips x only: overflow-x:clip, overflow-y:visible, never the `overflow: hidden` shorthand', () => {
      const grid = strip(blockFrom('.grid {'));
      expect(grid).toMatch(/overflow-x:\s*clip/);
      expect(grid).toMatch(/overflow-y:\s*visible/);
      expect(grid).not.toMatch(/overflow:\s*hidden/);
    });

    // A9d-2 N5 (named exception: foldable-min). The stage's reflow minimum, `--play-foldable-min`, is deleted with the stage's fold; the 44px
    // handle floor stays. What pins the deletion: the last case of this describe (no foldable-min / reflow-min anywhere in the file).
    it('a slot whose dock is foldable keeps the 44px handle plus its block padding (the handle is never squeezed out)', () => {
      const rule = strip(blockFrom(".slot:has(> [data-foldable='true']) {"));
      expect(rule).toMatch(/min-height:\s*calc\(44px \+ 2 \* var\(--play-slot-edge, var\(--density-gap\)\)\)/);
      expect(rule).not.toMatch(/foldable-min/);
    });

    it('a raised safety banner yields ONLY the two --play-* row variables on .grid, to the row\'s BANNER floor (never 0 where the row has one), naming no layout (safety yield)', () => {
      // A9d-2 N5 (named exception: safety-yield): the selector gained `:not([data-fit='false'])`; the two declarations are unchanged.
      const rule = strip(blockFrom(".grid:not([data-fit='false']):has(> [data-region-slot='safetyBanner'] > :not(:empty)) {"));
      const decls = rule.slice(rule.indexOf('{') + 1, rule.lastIndexOf('}')).split(';').map((d) => d.trim()).filter(Boolean);
      expect(decls).toEqual(['--play-floor: var(--play-banner-floor, 0px)', '--play-optional: 0px']);
      expect(rule).not.toMatch(/data-layout|story|table|phone/i);
    });

    // A9d-2 N5 (named exception: safety-yield): the yield no longer sits inside a height @media. It is keyed on the shell's MEASURED fit
    // (`data-fit`), so it applies where the page fit before the banner came up and names no height at all (Kage A9d-1 I-4). The two cases
    // below replace the 701px pin and the reflow-minimum pin; what pins the behaviour in a browser is the harness's y:fitFlag, a:storyLog
    // on the banner cells at 430x740, and playshell.fit-flag (the stamp).
    it('the yield applies only where the page fit: the selector is :not([data-fit=\'false\']), it appears exactly once, and no height @media is left in the file', () => {
      const all = strip(css).match(/safetyBanner'\] > :not\(:empty\)\)/g) ?? [];
      expect(all).toHaveLength(1);
      expect(strip(css)).toMatch(/\.grid:not\(\[data-fit='false'\]\):has\(> \[data-region-slot='safetyBanner'\]/);
      expect(strip(css)).not.toMatch(/@media\s*\(\s*(?:min|max)-height/);
    });

    it('the stage\'s reflow minimum is deleted: no --play-foldable-min, no --play-foldable-reflow-min, no @media (max-height: 700px) (the stage is a whole band, one scene strip)', () => {
      expect(strip(css)).not.toMatch(/--play-foldable-min|--play-foldable-reflow-min/);
      expect(strip(css)).not.toMatch(/max-height:\s*700px/);
    });

    it('on /play only, the DOCUMENT turns off overscroll on the y axis (no pull-to-refresh); the story log is left alone so log-to-page chaining stays (Tora A9d-1 MAJOR-2)', () => {
      const rule = strip(blockFrom(':global(html):has(.grid) {'));
      expect(rule).toMatch(/overscroll-behavior-y:\s*none/);
      expect(rule).not.toMatch(/overscroll-behavior-x|overscroll-behavior:/);
      // The log is a nested scroller and keeps the default (chain): no overscroll rule on any ChatLog class.
      const chat = strip(fs.readFileSync(path.resolve(process.cwd(), 'src/components/ChatLog.module.css'), 'utf8'));
      expect(chat).not.toMatch(/overscroll-behavior/);
    });

    // A9d-2 N5 (named exception): the phone has no scene picture, so the stand-in no longer takes a direction and padding from the row; it
    // is the stacked box on every row that renders it. What pins the deletion: no --play-picture-* is read anywhere in the file.
    it('the scene picture\'s stand-in is the stacked box, and no --play-picture-* variable is read (the phone has no picture until step 12)', () => {
      const rule = strip(blockFrom('.scenePlaceholder {'));
      expect(rule).toMatch(/flex-direction:\s*column/);
      expect(rule).toMatch(/padding:\s*var\(--density-pad\)/);
      expect(strip(css)).not.toMatch(/--play-picture-/);
    });

    it('the Appearance dialog is bounded by the viewport and scrolls inside', () => {
      const tweaks = fs.readFileSync(path.resolve(process.cwd(), 'src/components/TweaksPanel.module.css'), 'utf8');
      const panel = strip(tweaks.slice(tweaks.indexOf('.panel {')));
      const body = panel.slice(0, panel.indexOf('}'));
      expect(body).toMatch(/max-height:\s*calc\(100dvh - 24px\)/);
      expect(body).toMatch(/overflow-y:\s*auto/);
    });
  });

  describe('A9d E5 — the action bar and the compact header fit a narrow slot (the browser half is capture-play --assert-layout: d / c / a on the phone cells)', () => {
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '');
    const composer = () =>
      strip(fs.readFileSync(path.resolve(process.cwd(), 'src/components/Composer.module.css'), 'utf8'));

    /** The `@container (max-width: 560px) { ... }` block of a stylesheet (brace-matched). */
    function containerBlock(text: string): string {
      const start = text.indexOf('@container (max-width: 560px) {');
      if (start === -1) throw new Error('no @container (max-width: 560px) block');
      let depth = 0;
      for (let i = text.indexOf('{', start); i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
      }
      throw new Error('unbalanced');
    }

    it('Composer.module.css: below 560px of slot the kicker is visually hidden (clip, not display:none: the group keeps aria-labelledby on it)', () => {
      const block = containerBlock(composer());
      // the STANDALONE rule (round 4 added `.rail[data-waiting] .railLabel` before it, which `.railLabel {` also matches as a substring)
      const label = block.slice(block.search(/\n\s*\.railLabel \{/));
      const decls = label.slice(0, label.indexOf('}'));
      expect(decls).toMatch(/clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
      expect(decls).toMatch(/position:\s*absolute/);
      expect(decls).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    });

    it('Composer.module.css: the verbs share one row, equal shares, icon over label, each still a 44px target', () => {
      const block = containerBlock(composer());
      expect(block).toMatch(/\.railBtns\s*\{[^}]*flex-wrap:\s*nowrap/);
      const action = block.slice(block.indexOf('.action {'));
      const decls = action.slice(0, action.indexOf('}'));
      expect(decls).toMatch(/flex:\s*1 1 0/);
      expect(decls).toMatch(/flex-direction:\s*column/);
      expect(decls).toMatch(/min-width:\s*44px/);
      // the 44px floor is the base rule's, and nothing in the narrow block lowers it
      expect(decls).not.toMatch(/min-height/);
      expect(composer()).toMatch(/\.action\s*\{[^}]*min-height:\s*44px/);
    });

    it('Play.module.css: in the same 560px query the rail takes the first row alone (basis 100%) so Cast + safety share the next', () => {
      const block = strip(containerBlock(css));
      expect(block).toMatch(
        /\.slot:has\(> \[data-tenant="safetyControls"\]\) > :not\(\[data-tenant\]\)\s*\{[^}]*flex:\s*1 0 100%/,
      );
    });

    it('Play.module.css: the narrow safety block is capped to the bar (max-width:100%), so its one-line max-content cannot overhang a 320px slot into the scroll clip', () => {
      const block = strip(containerBlock(css));
      expect(block).toMatch(/\.safety\s*\{[^}]*flex-wrap:\s*wrap;[^}]*max-width:\s*100%/);
    });

    it('a row that spends less per slot swaps padding for a transparent border (a scroller paints into its padding); the empty and overlay slots carry neither', () => {
      // THIS PIN IS THE ONLY GUARD (Kage A9d-1 S5): reverting the border to padding reds no real-page check at the tip (the
      // bands are measured by the harness, but nothing there paints a squeezed band's overflow into its padding). The effect was
      // measured once (the stage's "ROLL" label under the scene head at its minimum); it is not gated by a browser pass.
      const text = strip(css);
      const slot = text.slice(text.indexOf('.slot {'), text.indexOf('\n}', text.indexOf('.slot {')));
      expect(slot).toMatch(/padding-block:\s*var\(--play-slot-pad, var\(--density-gap\)\)/);
      expect(slot).toMatch(/border-block:\s*var\(--play-slot-edge, 0px\) solid transparent/);
      expect(slot).toMatch(/padding-inline:\s*var\(--play-slot-inline, var\(--density-pad\)\)/);
      expect(text).toMatch(/\.slot:has\(> :only-child:empty\)\s*\{[^}]*border-block-width:\s*0/);
      expect(text).toMatch(/\.slotOverlay\s*\{[^}]*border-block-width:\s*0/);
    });

    it('the compact header cannot outgrow its box: the head shrinks (min-width:0), the title wrapper takes the rest, the pill rides beside the title', () => {
      const text = strip(css);
      expect(text).toMatch(/\.topBarCompact \.sessionHead\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0/);
      expect(text).toMatch(/\.topBarCompact \.sessionTitleWrap\s*\{[^}]*min-width:\s*0/);
    });

    it('the compact header WRAPS BY ITSELF (A10 step 11 tail, S3; named exception: a `@media (max-width: 366px)` split with `order: 1` on the title was the hand-derived pin here): the head wraps and the title wrapper has a minimum basis in rem; no viewport width is named', () => {
      const text = strip(css);
      expect(text).not.toMatch(/@media\s*\(max-width:\s*366px\)/);
      expect(text).not.toMatch(/\.topBarCompact \.sessionTitleWrap\s*\{[^}]*order:\s*1/);
      expect(text).toMatch(/\.topBarCompact \.sessionHead\s*\{[^}]*flex-wrap:\s*wrap/);
      expect(text).toMatch(/\.topBarCompact \.sessionTitleWrap\s*\{[^}]*flex:\s*1 1 5rem/);
    });

    it('below 480px the pill stacks under the title and the AI-off pill stacks with it, its round lead clipped (A9d-1 lever 4); it is a viewport @media, never a container query on the content-sized Table bar', () => {
      const text = strip(css);
      const start = text.indexOf('@media (max-width: 480px) {');
      expect(start).toBeGreaterThan(-1);
      const rest = text.slice(start);
      expect(rest).toMatch(/\.topBarCompact \.sessionTitleWrap\s*\{[^}]*flex-direction:\s*column/);
      // A9d-1 lever 4 (named pin edit): the AI-off pill no longer takes a 100%-wide row of its own
      // (that made the header 102px against AI-on's 64px); it rides in the title wrapper, and only the
      // visible "round N · " lead is clipped
      expect(rest).not.toMatch(/\.topBarCompact \.aiOffStatus\s*\{[^}]*flex:\s*1 0 100%/);
      expect(rest).not.toMatch(/\.topBarCompact\s*\{[^}]*flex-wrap:\s*wrap/);
      expect(rest).toMatch(/\.topBarCompact \.pillRound\s*\{[^}]*clip:\s*rect\(0 0 0 0\)/);
      expect(text).not.toMatch(/\.topBarCompact\s*\{[^}]*container-type/);
    });
  });

  describe('A9d E4 — one drawer presentation: the mobile tab bar and the 880px pane switch are gone', () => {
    it('Play.module.css carries no width @media near the phone breakpoint, no .mobileTabs, no in-flow .journalPane / .showJournal (the phone layout is a data row; the breakpoint lives in breakpoints.ts)', () => {
      const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(bare).not.toMatch(/@media\s*\(\s*(?:min|max)-width:\s*(?:880|881)px/);
      expect(bare).not.toMatch(/\.mobileTabs\b/);
      expect(bare).not.toMatch(/\.journalPane\b|\.showJournal\b/);
    });

    it('the mobile-tab-bar debt: marker went with the bar (nothing is hidden-but-mounted any more)', () => {
      expect(css).not.toMatch(/debt:[^\n]*mobile tab bar/);
    });
  });
});

describe('SessionRecap.module.css — the phone strip is one line (A9d)', () => {
  it('the scene subtitle reads the row var --play-recap-sub and defaults to inline (dashboard, Story and Table keep it)', () => {
    const recapCss = fs.readFileSync(path.resolve(process.cwd(), 'src/components/SessionRecap.module.css'), 'utf8');
    const rule = recapCss.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.sub\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/display:\s*var\(--play-recap-sub,\s*inline\)/);
  });
});

// A10 step 11 S2b (Sora's brief 3.2, Amendment F.2 / F.6): the stage's body, as CSS. jsdom lays nothing out, so the real pin is the harness's (m:stageBody,
// t:stage-body-holds, m:stageRest); these keep the source honest between runs.
describe('the stage\'s body (A10 S2b): the fill rule, the size container, the four 40px readers', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const play = read('src/app/play/[sessionId]/Play.module.css');
  const stage = read('src/app/play/[sessionId]/regions/SceneStage.module.css');
  const rule = (text: string, selector: string) => text.match(new RegExp(`${selector.replace(/[.[\]()>~'=^$*+?{}|\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  it('a region that sets data-slot-fill owns its edges: its slot drops the padding and stops being a scroller, by an attribute and not a region name', () => {
    const r = rule(play, '.slot:has(> [data-slot-fill])');
    expect(r).toMatch(/padding:\s*0/);
    expect(r).toMatch(/overflow:\s*visible/); // round 3: not `clip` (its focus rings); the slot is no scroller either way
    expect(play).not.toMatch(/data-slot-fill[^{]*sceneStage|sceneStage[^{]*data-slot-fill/);
  });

  it('the hero\'s slot does not clip (Iro MINOR-1, round 3): visible, so the scene line\'s focus rings (reach 4px from buttons 4px from the edge) are whole in every engine, and no engine-specific clip margin is left', () => {
    const r = rule(play, '.slot:has(> [data-slot-fill])');
    expect(r).toMatch(/overflow:\s*visible/);
    expect(r).not.toMatch(/overflow:\s*clip/);
    expect(r).not.toMatch(/overflow-clip-margin/);
    // the things that made clipping unnecessary: the body clips itself and is a size container; the scene line's tracks are whole
    expect(rule(stage, '.body')).toMatch(/overflow:\s*hidden/);
    expect(stage).toMatch(/grid-template-rows:\s*var\(--space-2\) minmax\(var\(--strip-half\), auto\)/);
  });

  it('the body is a SIZE container that fills the last row of the stage, hands the cell to the map\'s own property, and clips', () => {
    const r = rule(stage, '.body');
    expect(r).toMatch(/container-type:\s*size/);
    expect(r).toMatch(/grid-area:\s*body/);
    expect(r).toMatch(/overflow:\s*hidden/);
    expect(r).toMatch(/--tm-cell-size:\s*var\(--play-cell\)/);
    expect(rule(stage, '.hero')).toMatch(/minmax\(0,\s*1fr\);?\s*grid-template-areas/);
  });

  it('the body\'s min-height is its row\'s floor (A10 fix round F1): the track that sizes it and the box agree, and a row with no floor changes nothing', () => {
    expect(rule(stage, '.body')).toMatch(/min-height:\s*var\(--play-body-floor,\s*0px\)/);
    expect(rule(stage, '.body')).not.toMatch(/min-height:\s*0\s*;/);
  });

  it('the four readers each fall back to today\'s value (a row that sets none changes nothing)', () => {
    expect(rule(play, ".slot[data-overlay-edges~='top']")).toMatch(/margin-block-start:\s*var\(--play-overlay-reserve,\s*calc\(var\(--overlay-bar-h\)\s*\+\s*var\(--space-4\)\)\)/);
    expect(rule(play, '.slotOverlay')).toMatch(/max-width:\s*var\(--play-overlay-max,\s*calc\(100% - 2 \* var\(--space-4\)\)\)/);
    expect(rule(stage, '.hero')).toMatch(/--strip-edge:\s*var\(--play-slot-inline,\s*var\(--density-pad\)\)/);
    expect(rule(stage, '.hero')).toMatch(/grid-template-columns:\s*var\(--play-strip-start,\s*var\(--strip-edge\)\)/);
    expect(rule(stage, '.hero')).toMatch(/--strip-half:\s*max\(0px,\s*calc\(\(var\(--play-strip-min,\s*0px\)/);
  });
});

// A10 fix round F2 (Kage's Tavern 6, Miko's gap 6): the reduced-motion rule of Play.module.css, as source. It is a second path around the app-wide guard (its `debt:` marker says why
// and until when) and its SCOPE is the thing to keep: widened to `*` it would reach every page, removed the stage's stale frame returns. Neither was red anywhere in jest (the harness's
// t3-auto-combat-start and t1-picker legs catch the removal only; nothing caught the widening).
describe('the reduced-motion rule (A10 S2b): `transition: none` for the /play grid and its descendants, and nothing wider', () => {
  const raw = fs.readFileSync(path.resolve(process.cwd(), 'src/app/play/[sessionId]/Play.module.css'), 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((m) => m[1]);

  it('there is exactly one reduced-motion block, and it holds exactly one rule', () => {
    expect(blocks).toHaveLength(1);
    expect([...blocks[0].matchAll(/\{/g)]).toHaveLength(1);
  });

  it('its selectors are the grid, its descendants and their pseudo-elements: never `*` alone, never an element or the document', () => {
    const selectors = blocks[0].slice(0, blocks[0].indexOf('{')).split(',').map((x) => x.trim());
    expect(selectors).toEqual(['.grid', '.grid *', '.grid *::before', '.grid *::after']);
    for (const sel of selectors) expect(sel.startsWith('.grid')).toBe(true);
  });

  it('it declares `transition: none !important` and nothing else', () => {
    const body = blocks[0].slice(blocks[0].indexOf('{') + 1, blocks[0].lastIndexOf('}')).trim();
    expect(body).toBe('transition: none !important;');
  });

  it('it carries a `debt:` marker whose `until:` is the app-wide guard being fixed (the harvest lists it)', () => {
    const marker = raw.slice(raw.indexOf('debt: this rule is a second path'));
    expect(marker).toMatch(/ceiling:[^]*?until: the app-wide guard is fixed/);
    expect(marker.indexOf('until:')).toBeLessThan(marker.indexOf('@media (prefers-reduced-motion: reduce)'));
  });
});
