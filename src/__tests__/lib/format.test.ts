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
  it('adversarial: suffix is non-empty even when Math.random() returns 0 (degenerate case)', () => {
    // HARDENED: the impl pads before slicing, so even the degenerate
    // Math.random()===0 case ("0".slice(2)==='') yields a full 4-char suffix
    // instead of a trailing hyphen ("base-").
    const realRandom = Math.random;
    try {
      Math.random = () => 0;
      const ch = uniqueChannelFromName('The Cave');
      expect(ch).toMatch(/^the_cave-[a-z0-9]{4}$/);
      expect(ch.endsWith('-')).toBe(false);
    } finally {
      Math.random = realRandom;
    }
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
  it('adversarial: very long name (>80 chars) does not crash — renders raw', () => {
    // The engine Pydantic schema enforces max_length=80 on new creates.
    // A legacy row could hypothetically have a longer stored name.
    // sessionTitle must never throw or return blank.
    const longName = 'A'.repeat(300);
    const result = sessionTitle({ name: longName, channel: 'aaa-1234' });
    expect(result).toBe(longName); // renders raw, no truncation in the util
    expect(result.length).toBe(300);
  });
  it('adversarial: name with HTML/script chars does not crash (XSS is React\'s job)', () => {
    // sessionTitle is a pure string function; sanitization is the renderer's responsibility.
    // This test just confirms it does not throw and returns the raw string.
    const xssName = '<script>alert(1)</script>';
    const result = sessionTitle({ name: xssName, channel: 'safe-chan' });
    expect(result).toBe(xssName);
  });
  it('adversarial: name that trims to empty string falls back (e.g. all whitespace)', () => {
    expect(sessionTitle({ name: '     ', channel: 'hollow_tide' })).toBe('Hollow Tide');
  });
  it('adversarial: name that trims to equal the channel slug falls back to titleize', () => {
    // Edge: name=' the_hollow_tide_cave ' trims to 'the_hollow_tide_cave' which equals channel.
    // The guard (n !== session.channel after trim) correctly catches this.
    expect(
      sessionTitle({ name: ' the_hollow_tide_cave ', channel: 'the_hollow_tide_cave' })
    ).toBe('The Hollow Tide Cave');
  });
});
