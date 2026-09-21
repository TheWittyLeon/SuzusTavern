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
 * No wrapping element and no `data-region` attribute here, unlike the other
 * six regions: ChatLog takes a fixed prop list (no passthrough/className),
 * so the only way to carry `data-region` would be an extra wrapping `<div>`
 * around it — a real DOM change ("identical DOM... JSX only" is step 3's
 * hard constraint; ChatLog's own `role="log"` node stays the log's actual
 * root either way). Render-matrix coverage for this region (step 6) can key
 * off ChatLog's existing `role="log" aria-label="Story log"` instead.
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
    />
  );
});

export default StoryLog;
