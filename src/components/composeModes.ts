/**
 * The composer's modes, ONE record per mode (A10 step 11 tail, S6; Sora's amendment 1.1, Aoi 11): the label, the placeholder at two lengths and the hint line the phone's mode menu shows
 * under the word. It was three records (`PLACEHOLDER`, `PLACEHOLDER_SHORT` and `DEFAULT_MODES`); a tenth mode is a row here, not a gesture or a branch.
 *
 * `placeholderShort` is 14 characters or fewer, so it fits the 122px of text the phone's field has at 360 wide (148 less its 24px of padding and 2px of border) at 16px; the long text is not lost,
 * it is the field's accessible DESCRIPTION wherever the short one is shown (Composer.tsx). The label is the word the Mode button and the menu show; the page's `availableModes` decides WHICH modes
 * a seat has and in what order (three for a player, two for a human DM), and this decides what each is called and says.
 */
export type ComposeMode = 'say' | 'act' | 'ooc' | 'dm_narration';

export interface ModeRecord {
  label: string;
  placeholderShort: string;
  placeholderLong: string;
  hint: string;
}

export const MODE_RECORD: Record<ComposeMode, ModeRecord> = {
  say: { label: 'Say', placeholderShort: 'Say something…', placeholderLong: 'Say something. Suzu will narrate back.', hint: 'Speak as your character' },
  act: { label: 'Act', placeholderShort: 'I sneak ahead…', placeholderLong: 'I climb the chimney quietly…', hint: 'Do something in the world' },
  ooc: { label: 'OOC', placeholderShort: 'To the table…', placeholderLong: 'Out-of-character. Visible to the table, not the world.', hint: 'To the table, not the world' },
  dm_narration: { label: 'Narrate', placeholderShort: 'Narrate…', placeholderLong: 'Narrate the scene as DM… (or speak as an NPC above)', hint: 'Narrate the scene as DM' },
};

/** The standard player set, in menu order, with the labels the tabs show. */
export const DEFAULT_MODES: [ComposeMode, string][] = [
  ['say', 'Say'],
  ['act', 'Act'],
  ['ooc', 'OOC'],
];
