/**
 * @jest-environment node
 *
 * Lane G QA (Miko), item 2 -- the heal and the mount must stay ONE row builder. A behavioural test proves
 * parity today (play.heal-row-builder.qa.test.tsx); this is the cheap guard against a future edit quietly
 * re-forking the loop in either place. Source scan, read-only, paths resolved from this file (not from cwd).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const play = (rel: string) => readFileSync(path.resolve(__dirname, '../../app/play/[sessionId]', rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('one history-row builder', () => {
  const page = stripComments(play('page.tsx'));
  const events = stripComments(play('hooks/useSessionEvents.ts'));
  const builder = stripComments(play('historyRows.ts'));

  it('the mount (page.tsx) and the heal (useSessionEvents.ts) both call buildHistoryRows', () => {
    expect(page).toMatch(/buildHistoryRows\(/);
    expect(events).toMatch(/buildHistoryRows\(/);
  });

  it('neither caller builds opening rows itself: the read-aloud / marker vocabulary lives in the builder alone', () => {
    for (const src of [page, events]) {
      expect(src).not.toMatch(/read_aloud/);
      expect(src).not.toMatch(/buildReadAloudBlock/);
      expect(src).not.toMatch(/ · opening —/);
    }
    expect(page).not.toMatch(/eventToLogRow/); // the mount's per-event mapping moved with the loop
  });

  it('the builder is where the opening block is built', () => {
    expect(builder).toMatch(/read_aloud/);
    expect(builder).toMatch(/opening_narrated/);
    expect(builder).toMatch(/eventToLogRow/);
  });

  it('live-row ids can never collide with history ids: the page\'s own appender uses the r<n> scheme, history rows ev<seq>', () => {
    const transcript = stripComments(readFileSync(path.resolve(__dirname, '../../app/play/[sessionId]/hooks/useTranscript.ts'), 'utf8'));
    expect(transcript).toMatch(/id: `r\$\{/);
    const rehydration = stripComments(readFileSync(path.resolve(__dirname, '../../lib/rehydration.ts'), 'utf8'));
    expect(rehydration).toMatch(/const id = `ev\$\{/);
  });
});
