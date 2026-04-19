import { describe, expect, it } from 'vitest';
import { SubtitleParseError, parseSrt, serializeSrt } from './srt.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASIC_SRT = `1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:00:05,000 --> 00:00:07,000
Second cue

`;

const CRLF_SRT = BASIC_SRT.replace(/\n/g, '\r\n');
const BOM_SRT = `\uFEFF${BASIC_SRT}`;

const MULTILINE_SRT = `1
00:00:01,000 --> 00:00:03,000
Line one
Line two
Line three

`;

const HTML_SRT = `1
00:00:01,000 --> 00:00:04,000
<i>Italic text</i>

2
00:00:05,000 --> 00:00:07,000
<b>Bold</b> and <u>underline</u>

3
00:00:08,000 --> 00:00:10,000
<font color="#ff0000">Red text</font>

`;

const SPEAKER_SRT = `1
00:00:01,000 --> 00:00:03,000
JOHN: Hello there

`;

// ---------------------------------------------------------------------------
// parseSrt
// ---------------------------------------------------------------------------

describe('parseSrt', () => {
  it('parses a basic two-cue SRT', () => {
    const track = parseSrt(BASIC_SRT);
    expect(track.cues).toHaveLength(2);
    expect(track.cues[0]).toMatchObject({
      id: '1',
      startMs: 1000,
      endMs: 3500,
      text: 'Hello world',
    });
    expect(track.cues[1]).toMatchObject({
      id: '2',
      startMs: 5000,
      endMs: 7000,
      text: 'Second cue',
    });
  });

  it('handles CRLF line endings', () => {
    const track = parseSrt(CRLF_SRT);
    expect(track.cues).toHaveLength(2);
    expect(track.cues[0]?.text).toBe('Hello world');
  });

  it('strips UTF-8 BOM', () => {
    const track = parseSrt(BOM_SRT);
    expect(track.cues).toHaveLength(2);
  });

  it('returns empty track for empty input', () => {
    const track = parseSrt('');
    expect(track.cues).toHaveLength(0);
  });

  it('returns empty track for whitespace-only input', () => {
    const track = parseSrt('   \n\n\n  ');
    expect(track.cues).toHaveLength(0);
  });

  it('handles single cue', () => {
    const track = parseSrt('1\n00:00:00,000 --> 00:00:01,000\nHi\n');
    expect(track.cues).toHaveLength(1);
    expect(track.cues[0]?.text).toBe('Hi');
  });

  it('parses multi-line cue text', () => {
    const track = parseSrt(MULTILINE_SRT);
    expect(track.cues[0]?.text).toBe('Line one\nLine two\nLine three');
  });

  it('strips <i>, <b>, <u> HTML tags', () => {
    const track = parseSrt(HTML_SRT);
    expect(track.cues[0]?.text).toBe('Italic text');
    expect(track.cues[1]?.text).toBe('Bold and underline');
    expect(track.cues[2]?.text).toBe('Red text');
  });

  it('preserves speaker labels in text', () => {
    const track = parseSrt(SPEAKER_SRT);
    expect(track.cues[0]?.text).toBe('JOHN: Hello there');
  });

  it('parses timestamps with dot separator (lenient)', () => {
    const track = parseSrt('1\n00:00:01.500 --> 00:00:02.000\nDot sep\n');
    expect(track.cues[0]?.startMs).toBe(1500);
  });

  it('throws SubtitleParseError on invalid timestamp', () => {
    expect(() => parseSrt('1\n00:00:INVALID --> 00:00:02,000\nText\n')).toThrow(SubtitleParseError);
  });

  it('throws SubtitleParseError when timing line is missing after sequence', () => {
    expect(() => parseSrt('1\nNot a timing line\n')).toThrow(SubtitleParseError);
  });

  it('handles hours > 99 in timestamps', () => {
    const track = parseSrt('1\n100:00:00,000 --> 100:01:00,000\nFar future\n');
    expect(track.cues[0]?.startMs).toBe(100 * 3_600_000);
  });
});

// ---------------------------------------------------------------------------
// serializeSrt
// ---------------------------------------------------------------------------

describe('serializeSrt', () => {
  it('returns empty string for empty track', () => {
    expect(serializeSrt({ cues: [] })).toBe('');
  });

  it('serializes cues with sequential 1-based numbering', () => {
    const track = parseSrt(BASIC_SRT);
    const out = serializeSrt(track);
    expect(out).toContain('1\n');
    expect(out).toContain('2\n');
  });

  it('formats timestamps as HH:MM:SS,mmm', () => {
    const track = parseSrt(BASIC_SRT);
    const out = serializeSrt(track);
    expect(out).toContain('00:00:01,000 --> 00:00:03,500');
  });

  it('separates cue blocks with blank lines', () => {
    const track = parseSrt(BASIC_SRT);
    const out = serializeSrt(track);
    expect(out).toMatch(/\n\n/);
  });

  it('renumbers cues from 1 regardless of original id', () => {
    const track = parseSrt('99\n00:00:01,000 --> 00:00:02,000\nText\n');
    const out = serializeSrt(track);
    expect(out.startsWith('1\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('SRT round-trip', () => {
  it('round-trips basic cues faithfully', () => {
    const original = parseSrt(BASIC_SRT);
    const serialized = serializeSrt(original);
    const reparsed = parseSrt(serialized);
    expect(reparsed.cues).toHaveLength(original.cues.length);
    for (let i = 0; i < original.cues.length; i++) {
      expect(reparsed.cues[i]?.startMs).toBe(original.cues[i]?.startMs);
      expect(reparsed.cues[i]?.endMs).toBe(original.cues[i]?.endMs);
      expect(reparsed.cues[i]?.text).toBe(original.cues[i]?.text);
    }
  });

  it('round-trips multiline cue text', () => {
    const original = parseSrt(MULTILINE_SRT);
    const reparsed = parseSrt(serializeSrt(original));
    expect(reparsed.cues[0]?.text).toBe(original.cues[0]?.text);
  });
});
