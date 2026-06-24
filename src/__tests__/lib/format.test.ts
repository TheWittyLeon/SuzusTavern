/**
 * @jest-environment node
 */
import { titleizeChannel, sessionTitle, formatStarted } from '../../lib/format';
import { channelFromName, uniqueChannelFromName } from '../../lib/sessionAnnotations';

describe('titleizeChannel', () => {
  it('title-cases underscore/hyphen channels', () => {
    expect(titleizeChannel('hollow_tide')).toBe('Hollow Tide');
    expect(titleizeChannel('cinder-quarry')).toBe('Cinder Quarry');
    expect(titleizeChannel('leon')).toBe('Leon');
  });
  it('strips a leading # and falls back on empty', () => {
    expect(titleizeChannel('#leon')).toBe('Leon');
    expect(titleizeChannel('')).toBe('Untitled table');
    expect(titleizeChannel(null)).toBe('Untitled table');
  });
});

describe('formatStarted', () => {
  it('parses ISO + Postgres space-separated timestamps', () => {
    expect(formatStarted('2026-06-16T00:00:00')).not.toBe('');
    expect(formatStarted('2026-06-16 12:30:00')).not.toBe('');
  });
  it('returns "" on unparseable / empty input', () => {
    expect(formatStarted('')).toBe('');
    expect(formatStarted(null)).toBe('');
    expect(formatStarted('not a date')).toBe('');
  });
});

describe('channelFromName', () => {
  it('slugifies to lowercase underscores', () => {
    expect(channelFromName('The Hollow Tide Cave')).toBe('the_hollow_tide_cave');
    expect(channelFromName('  Wine of the Court!  ')).toBe('wine_of_the_court');
  });
  it('never returns an empty channel', () => {
    expect(channelFromName('!!!')).toBe('table');
    expect(channelFromName('')).toBe('table');
  });
});

describe('uniqueChannelFromName', () => {
  it('produces a slug with a 4-char [a-z0-9] suffix separated by a hyphen', () => {
    const ch = uniqueChannelFromName('The Hollow Tide Cave');
    expect(ch).toMatch(/^the_hollow_tide_cave-[a-z0-9]{4}$/);
  });
  it('two calls with the same name produce different channels (collision resistance)', () => {
    const a = uniqueChannelFromName('The Hollow Tide Cave');
    const b = uniqueChannelFromName('The Hollow Tide Cave');
    // P(collision) ≈ 3e-7 for one pair — essentially never in CI.
    expect(a).not.toBe(b);
  });
  it('falls back to "table" base slug for unsluggable names', () => {
    const ch = uniqueChannelFromName('!!!');
    expect(ch).toMatch(/^table-[a-z0-9]{4}$/);
  });
});

describe('sessionTitle', () => {
  it('returns the human name when present and different from the channel slug', () => {
    expect(sessionTitle({ name: 'The Hollow Tide Cave', channel: 'the_hollow_tide_cave-9f3a' }))
      .toBe('The Hollow Tide Cave');
  });
  it('falls back to titleizeChannel when name is absent', () => {
    expect(sessionTitle({ channel: 'hollow_tide' })).toBe('Hollow Tide');
    expect(sessionTitle({ channel: 'leon' })).toBe('Leon');
  });
  it('falls back to titleizeChannel when name equals the channel (legacy/bot row)', () => {
    // Bot creates sessions where name == channel == the twitch login slug.
    expect(sessionTitle({ name: 'leon', channel: 'leon' })).toBe('Leon');
    expect(sessionTitle({ name: 'the_hollow_tide_cave', channel: 'the_hollow_tide_cave' }))
      .toBe('The Hollow Tide Cave');
  });
  it('falls back when name is an empty string or whitespace', () => {
    expect(sessionTitle({ name: '', channel: 'hollow_tide' })).toBe('Hollow Tide');
    expect(sessionTitle({ name: '   ', channel: 'hollow_tide' })).toBe('Hollow Tide');
  });
  it('falls back when channel is absent (no session data)', () => {
    expect(sessionTitle({})).toBe('Untitled table');
  });
});
