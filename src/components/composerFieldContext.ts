'use client';
import { createContext, type RefObject } from 'react';

/**
 * What the composer knows about its own row, for the tools it hosts (the Roll control): whether a press on them keeps the field's focus (the phone's `line` row: the soft keyboard stays up) and the
 * field's ref. A context and not a prop the page fills in (tail fix, Kage file-it 2): the composer already decides this for Send, so no caller names the variant to decide it for the tools.
 */
export interface ComposerFieldContextValue {
  keepFieldFocus: boolean;
  fieldRef: RefObject<HTMLTextAreaElement | null> | undefined;
}
export const ComposerFieldContext = createContext<ComposerFieldContextValue>({ keepFieldFocus: false, fieldRef: undefined });
