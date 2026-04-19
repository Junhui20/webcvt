import { describe, expect, it } from 'vitest';
import { parseMpl, serializeMpl } from './mpl.ts';
import { SubtitleParseError } from './srt.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASIC_MPL = `[10][35]Hello world
[50][70]Second cue
`;

const MULTILINE_MPL = `[10][35]Line one|Line two
`;

const ITALIC_MPL = `[10][35]/Italic text
[40][60]Normal|/Italic second line
`;

const BOM_MPL = `\uFEFF${BASIC_MPL}`;
const CRLF_MPL = BASIC_MPL.replace(/\n/g, '\r\n');

const COMMENT_MPL = `# This is a comment
[10][35]After comment
`;

// ---------------------------------------------------------------------------
// parseMpl
// ---------------------------------------------------------------------------

describe('parseMpl', () => {
  it('parses basic MPL2 with two cues', () => {
    const track = parseMpl(BASIC_MPL);
    expect(track.cues).toHaveLength(2);
    expect(track.cues[0]?.text).toBe('Hello world');
    expect(track.cues[1]?.text).toBe('Second cue');
  });

  it('converts deciseconds to milliseconds', () => {
    const track = parseMpl(BASIC_MPL);
    // [10] → 10 * 100 = 1000ms; [35] → 3500ms
    expect(track.cues[0]?.startMs).toBe(1000);
    expect(track.cues[0]?.endMs).toBe(3500);
  });

  it('converts pipe-separated segments to newlines', () => {
    const track = parseMpl(MULTILINE_MPL);
    expect(track.cues[0]?.text).toBe('Line one\nLine two');
  });

  it('strips leading / italic markers', () => {
    const track = parseMpl(ITALIC_MPL);
    expect(track.cues[0]?.text).toBe('Italic text');
    expect(track.cues[1]?.text).toBe('Normal\nItalic second line');
  });

  it('skips comment lines starting with #', () => {
    const track = parseMpl(COMMENT_MPL);
    expect(track.cues).toHaveLength(1);
    expect(track.cues[0]?.text).toBe('After comment');
  });

  it('handles BOM', () => {
    const track = parseMpl(BOM_MPL);
    expect(track.cues).toHaveLength(2);
  });

  it('handles CRLF line endings', () => {
    const track = parseMpl(CRLF_MPL);
    expect(track.cues).toHaveLength(2);
  });

  it('returns empty track for empty input', () => {
    const track = parseMpl('');
    expect(track.cues).toHaveLength(0);
  });

  it('returns empty track for whitespace-only input', () => {
    const track = parseMpl('   \n\n');
    expect(track.cues).toHaveLength(0);
  });

  it('handles single cue', () => {
    const track = parseMpl('[5][10]Single cue\n');
    expect(track.cues).toHaveLength(1);
    expect(track.cues[0]?.text).toBe('Single cue');
  });

  it('handles zero timestamps', () => {
    const track = parseMpl('[0][10]From zero\n');
    expect(track.cues[0]?.startMs).toBe(0);
    expect(track.cues[0]?.endMs).toBe(1000);
  });

  it('ignores non-matching lines without throwing', () => {
    const track = parseMpl('garbage line\n[10][20]Real cue\n');
    expect(track.cues).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// serializeMpl
// ---------------------------------------------------------------------------

describe('serializeMpl', () => {
  it('returns empty string for empty track', () => {
    expect(serializeMpl({ cues: [] })).toBe('');
  });

  it('formats cues as [ds][ds]text', () => {
    const track = parseMpl(BASIC_MPL);
    const out = serializeMpl(track);
    expect(out).toContain('[10][35]Hello world');
    expect(out).toContain('[50][70]Second cue');
  });

  it('serializes multiline text with pipe separator', () => {
    const track = parseMpl(MULTILINE_MPL);
    const out = serializeMpl(track);
    expect(out).toContain('[10][35]Line one|Line two');
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('MPL2 round-trip', () => {
  it('round-trips basic cues faithfully', () => {
    const original = parseMpl(BASIC_MPL);
    const reparsed = parseMpl(serializeMpl(original));
    expect(reparsed.cues).toHaveLength(original.cues.length);
    for (let i = 0; i < original.cues.length; i++) {
      expect(reparsed.cues[i]?.startMs).toBe(original.cues[i]?.startMs);
      expect(reparsed.cues[i]?.endMs).toBe(original.cues[i]?.endMs);
      expect(reparsed.cues[i]?.text).toBe(original.cues[i]?.text);
    }
  });

  it('round-trips multiline text', () => {
    const original = parseMpl(MULTILINE_MPL);
    const reparsed = parseMpl(serializeMpl(original));
    expect(reparsed.cues[0]?.text).toBe('Line one\nLine two');
  });
});
