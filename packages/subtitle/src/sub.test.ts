import { describe, it, expect } from 'vitest';
import { parseSub, serializeSub, VobSubError, DEFAULT_FPS } from './sub.ts';
import { SubtitleParseError } from './srt.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASIC_SUB = `{0}{0}23.976
{573}{610}Hello world
{650}{720}Second cue
`;

const MULTILINE_SUB = `{0}{0}23.976
{100}{200}Line one|Line two
`;

const NO_FPS_HEADER_SUB = `{100}{200}Hello
{300}{400}World
`;

const STYLE_TAG_SUB = `{0}{0}23.976
{100}{200}{Y:i}Italic text
`;

// VobSub magic: first 4 bytes 0x00 0x00 0x01 0xBA
const VOBSUB_BYTES = '\x00\x00\x01\xba' + 'some binary data';

// ---------------------------------------------------------------------------
// parseSub
// ---------------------------------------------------------------------------

describe('parseSub', () => {
  it('parses basic MicroDVD with FPS header', () => {
    const track = parseSub(BASIC_SUB);
    expect(track.cues).toHaveLength(2);
    expect(track.cues[0]!.text).toBe('Hello world');
    expect(track.cues[1]!.text).toBe('Second cue');
  });

  it('converts frames to milliseconds using FPS', () => {
    const track = parseSub(BASIC_SUB);
    // frame 573 @ 23.976fps → Math.round(573/23.976*1000) = 23899ms
    expect(track.cues[0]!.startMs).toBe(Math.round((573 / 23.976) * 1000));
  });

  it('reads embedded FPS from {0}{0} header', () => {
    const track = parseSub(BASIC_SUB);
    expect(track.metadata?.['fps']).toBe('23.976');
  });

  it('uses default FPS when no header present', () => {
    const track = parseSub(NO_FPS_HEADER_SUB);
    expect(track.cues).toHaveLength(2);
    expect(track.metadata?.['fps']).toBe(String(DEFAULT_FPS));
  });

  it('uses provided FPS argument', () => {
    const track = parseSub(NO_FPS_HEADER_SUB, 25);
    expect(track.cues[0]!.startMs).toBe(Math.round((100 / 25) * 1000));
  });

  it('splits pipe-separated text into newlines', () => {
    const track = parseSub(MULTILINE_SUB);
    expect(track.cues[0]!.text).toBe('Line one\nLine two');
  });

  it('strips style tags {Y:...} from text', () => {
    const track = parseSub(STYLE_TAG_SUB);
    expect(track.cues[0]!.text).toBe('Italic text');
  });

  it('handles empty input', () => {
    const track = parseSub('');
    expect(track.cues).toHaveLength(0);
  });

  it('handles single cue', () => {
    const track = parseSub('{100}{200}Single\n');
    expect(track.cues).toHaveLength(1);
    expect(track.cues[0]!.text).toBe('Single');
  });

  it('handles BOM', () => {
    const track = parseSub('\uFEFF' + BASIC_SUB);
    expect(track.cues).toHaveLength(2);
  });

  it('handles CRLF line endings', () => {
    const track = parseSub(BASIC_SUB.replace(/\n/g, '\r\n'));
    expect(track.cues).toHaveLength(2);
  });

  it('throws VobSubError for binary VobSub content', () => {
    expect(() => parseSub(VOBSUB_BYTES)).toThrow(VobSubError);
  });

  it('VobSubError has actionable message mentioning MPEG-PS', () => {
    try {
      parseSub(VOBSUB_BYTES);
    } catch (e) {
      expect((e as Error).message).toContain('MPEG-PS');
    }
  });

  it('VobSubError has VOBSUB_NOT_SUPPORTED code', () => {
    try {
      parseSub(VOBSUB_BYTES);
    } catch (e) {
      expect((e as VobSubError).code).toBe('VOBSUB_NOT_SUPPORTED');
    }
  });
});

// ---------------------------------------------------------------------------
// serializeSub
// ---------------------------------------------------------------------------

describe('serializeSub', () => {
  it('includes FPS header as first line', () => {
    const track = parseSub(BASIC_SUB);
    const out = serializeSub(track);
    expect(out.startsWith('{0}{0}')).toBe(true);
    expect(out).toContain('23.976');
  });

  it('formats cues as {frame}{frame}text', () => {
    const track = parseSub(BASIC_SUB);
    const out = serializeSub(track);
    expect(out).toContain('{573}{610}Hello world');
  });

  it('serializes multi-line text with pipe separator', () => {
    const track = parseSub(MULTILINE_SUB);
    const out = serializeSub(track);
    expect(out).toContain('Line one|Line two');
  });

  it('uses provided fps argument over metadata fps', () => {
    const track = parseSub(BASIC_SUB);
    const out = serializeSub(track, 25);
    expect(out).toContain('{0}{0}25');
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('MicroDVD round-trip', () => {
  it('round-trips frames faithfully (within rounding tolerance)', () => {
    const original = parseSub(BASIC_SUB);
    const reparsed = parseSub(serializeSub(original));
    expect(reparsed.cues).toHaveLength(original.cues.length);
    for (let i = 0; i < original.cues.length; i++) {
      // Frame→ms→frame conversions may differ by ±1ms due to rounding.
      expect(Math.abs(reparsed.cues[i]!.startMs - original.cues[i]!.startMs)).toBeLessThanOrEqual(1);
      expect(Math.abs(reparsed.cues[i]!.endMs - original.cues[i]!.endMs)).toBeLessThanOrEqual(1);
      expect(reparsed.cues[i]!.text).toBe(original.cues[i]!.text);
    }
  });

  it('round-trips multiline text', () => {
    const original = parseSub(MULTILINE_SUB);
    const reparsed = parseSub(serializeSub(original));
    expect(reparsed.cues[0]!.text).toBe('Line one\nLine two');
  });
});
