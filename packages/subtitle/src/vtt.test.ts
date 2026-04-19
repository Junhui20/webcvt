import { describe, expect, it } from 'vitest';
import { SubtitleParseError } from './srt.ts';
import { parseVtt, serializeVtt } from './vtt.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASIC_VTT = `WEBVTT

1
00:00:01.000 --> 00:00:03.500
Hello world

2
00:00:05.000 --> 00:00:07.000
Second cue

`;

const VTT_WITH_SETTINGS = `WEBVTT

intro
00:00:01.000 --> 00:00:03.000 align:center position:50%
Centered text

bottom
00:00:04.000 --> 00:00:06.000 line:90% align:start
Bottom aligned

`;

const VTT_WITH_NOTES = `WEBVTT

NOTE This is a comment block
that spans multiple lines

1
00:00:01.000 --> 00:00:02.000
Test

`;

const VTT_NO_IDS = `WEBVTT

00:00:01.000 --> 00:00:02.000
No ID cue

`;

const VTT_SHORT_TS = `WEBVTT

00:01.000 --> 00:02.000
Short timestamp

`;

const CRLF_VTT = BASIC_VTT.replace(/\n/g, '\r\n');
const BOM_VTT = `\uFEFF${BASIC_VTT}`;

// ---------------------------------------------------------------------------
// parseVtt
// ---------------------------------------------------------------------------

describe('parseVtt', () => {
  it('parses basic VTT with two cues', () => {
    const track = parseVtt(BASIC_VTT);
    expect(track.cues).toHaveLength(2);
    expect(track.cues[0]?.startMs).toBe(1000);
    expect(track.cues[0]?.endMs).toBe(3500);
    expect(track.cues[0]?.text).toBe('Hello world');
  });

  it('throws SubtitleParseError without WEBVTT header', () => {
    expect(() => parseVtt('1\n00:00:01.000 --> 00:00:02.000\nText\n')).toThrow(SubtitleParseError);
  });

  it('throws SubtitleParseError on empty string', () => {
    expect(() => parseVtt('')).toThrow(SubtitleParseError);
  });

  it('handles CRLF line endings', () => {
    const track = parseVtt(CRLF_VTT);
    expect(track.cues).toHaveLength(2);
  });

  it('strips UTF-8 BOM', () => {
    const track = parseVtt(BOM_VTT);
    expect(track.cues).toHaveLength(2);
  });

  it('parses cue settings and stores them in id', () => {
    const track = parseVtt(VTT_WITH_SETTINGS);
    expect(track.cues).toHaveLength(2);
    const raw = JSON.parse(track.cues[0]?.id ?? '{}') as { settings: { align: string } };
    expect(raw.settings.align).toBe('center');
    expect(raw.settings.position).toBe('50%');
  });

  it('skips NOTE blocks', () => {
    const track = parseVtt(VTT_WITH_NOTES);
    expect(track.cues).toHaveLength(1);
    expect(track.cues[0]?.text).toBe('Test');
  });

  it('parses cues without IDs', () => {
    const track = parseVtt(VTT_NO_IDS);
    expect(track.cues).toHaveLength(1);
    expect(track.cues[0]?.text).toBe('No ID cue');
  });

  it('parses short (MM:SS.mmm) timestamps', () => {
    const track = parseVtt(VTT_SHORT_TS);
    expect(track.cues[0]?.startMs).toBe(1000);
    expect(track.cues[0]?.endMs).toBe(2000);
  });

  it('returns empty cues for WEBVTT with no cues', () => {
    const track = parseVtt('WEBVTT\n\n');
    expect(track.cues).toHaveLength(0);
  });

  it('strips VTT markup tags from text', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Speaker>Hello <b>world</b>\n\n';
    const track = parseVtt(vtt);
    expect(track.cues[0]?.text).toBe('Hello world');
  });
});

// ---------------------------------------------------------------------------
// serializeVtt
// ---------------------------------------------------------------------------

describe('serializeVtt', () => {
  it('starts with WEBVTT header', () => {
    const out = serializeVtt({ cues: [] });
    expect(out.startsWith('WEBVTT')).toBe(true);
  });

  it('serializes empty track to just header', () => {
    const out = serializeVtt({ cues: [] });
    expect(out).toBe('WEBVTT\n\n');
  });

  it('formats timestamps as HH:MM:SS.mmm', () => {
    const track = parseVtt(BASIC_VTT);
    const out = serializeVtt(track);
    expect(out).toContain('00:00:01.000 --> 00:00:03.500');
  });

  it('preserves cue settings on round-trip', () => {
    const track = parseVtt(VTT_WITH_SETTINGS);
    const out = serializeVtt(track);
    expect(out).toContain('align:center');
    expect(out).toContain('position:50%');
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('VTT round-trip', () => {
  it('round-trips basic VTT faithfully', () => {
    const original = parseVtt(BASIC_VTT);
    const reparsed = parseVtt(serializeVtt(original));
    expect(reparsed.cues).toHaveLength(original.cues.length);
    for (let i = 0; i < original.cues.length; i++) {
      expect(reparsed.cues[i]?.startMs).toBe(original.cues[i]?.startMs);
      expect(reparsed.cues[i]?.endMs).toBe(original.cues[i]?.endMs);
      expect(reparsed.cues[i]?.text).toBe(original.cues[i]?.text);
    }
  });

  it('round-trips cue settings', () => {
    const original = parseVtt(VTT_WITH_SETTINGS);
    const reparsed = parseVtt(serializeVtt(original));
    const raw = JSON.parse(reparsed.cues[0]?.id ?? '{}') as { settings: { align: string } };
    expect(raw.settings.align).toBe('center');
  });
});
