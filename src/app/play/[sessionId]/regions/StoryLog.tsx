'use client';

import type { Participant } from '@/lib/api/types';
import ChatLog, { type LogRow } from '@/components/ChatLog';

/**
 * TAV-PLAY-SHELL step 3 — pure region extraction (decomposition plan §2.3:
 * "StoryLog | survives as-is: ChatLog"). ChatLog itself is untouched and
 * already self-contained; this is a thin wrapper so the region boundary exists
 * as its own file/name, matching the other six regions. (It forwarded ChatLog's
 * imperative `scrollToBottom` handle until A9d-2: its only caller was the
 * mobile-tab re-pin that E4 deleted, so the handle, the ref and the forwarding
 * went with it.)
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

export default function StoryLog({ rows, thinking, thinkingLabel, participants }: StoryLogProps) {
  return (
    <ChatLog
      rows={rows}
      thinking={thinking}
      thinkingLabel={thinkingLabel}
      participants={participants}
      data-region="storyLog"
    />
  );
}
