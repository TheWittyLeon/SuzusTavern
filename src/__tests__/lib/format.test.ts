/**
 * @jest-environment node
 */
import { titleizeChannel, formatStarted } from '../../lib/format';
import { channelFromName } from '../../lib/sessionAnnotations';

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
