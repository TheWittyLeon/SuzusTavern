'use client';

import { forwardRef } from 'react';
import type { Participant } from '@/lib/api/types';
import ChatLog, { type ChatLogHandle, type LogRow } from '@/components/ChatLog';

/**
 * TAV-PLAY-SHELL step 3 — pure region extraction (decomposition plan §2.3:
 * "StoryLog | survives as-is: ChatLog"). ChatLog itself is untouched and
 * already self-contained; this is a thin forwardRef wrapper so the region
 * boundary exists as its own file/name, matching the other six regions,
 * without changing ChatLog's own imperative-handle contract (page.tsx's
 * `chatLogRef.current?.scrollToBottom(...)` calls keep working unchanged —
 * the ref forwards straight through).
 *
 * I4 (Kage-CR/Miko-QA, 2026-09-21 review): `data-region="storyLog"` now
 * reaches ChatLog's actual root via a purely additive optional prop on
 * ChatLog itself (`'data-region'?: string`, ChatLog.tsx) rather than an
 * extra wrapping `<div>` — no DOM change, no new node, ChatLog's own
 * `role="log"` node carries the marker directly. ChatLog is used nowhere
 * outside `/play` (verified), so this costs its other callers/tests
 * nothing — the prop is undefined-by-default and every existing usage is
 * unaffected.
 */
export interface StoryLogProps {
  rows: LogRow[];
  thinking?: boolean;
  thinkingLabel?: string;
  participants?: Participant[];
}

const StoryLog = forwardRef<ChatLogHandle, StoryLogProps>(function StoryLog(
  { rows, thinking, thinkingLabel, participants },
  ref,
) {
  return (
    <ChatLog
      ref={ref}
      rows={rows}
      thinking={thinking}
      thinkingLabel={thinkingLabel}
      participants={participants}
      data-region="storyLog"
    />
  );
});

export default StoryLog;
