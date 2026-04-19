import { describe, expect, it } from 'vitest';
import { parseSsa, serializeSsa } from './ssa.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASIC_SSA = `[Script Info]
ScriptType: v4.00
PlayResX: 640
PlayResY: 480

[V4 Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding
Style: Default,Arial,20,65535,65535,65535,0,-1,0,1,2,2,2,10,10,10,0,0

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello from SSA
Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,Second SSA cue
`;

// ---------------------------------------------------------------------------
// parseSsa
// ---------------------------------------------------------------------------

describe('parseSsa', () => {
  it('parses basic SSA with two dialogue lines', () => {
    const track = parseSsa(BASIC_SSA);
    expect(track.cues).toHaveLength(2);
    expect(track.cues[0]?.text).toBe('Hello from SSA');
    expect(track.cues[0]?.startMs).toBe(1000);
    expect(track.cues[0]?.endMs).toBe(3500);
  });

  it('reads [V4 Styles] section (not V4+)', () => {
    const track = parseSsa(BASIC_SSA);
    // Styles should have been parsed (cueStyle present on cue).
    expect(track.cues[0]?.style).toBeDefined();
  });

  it('stores Script Info in metadata', () => {
    const track = parseSsa(BASIC_SSA);
    expect(track.metadata?.PlayResX).toBe('640');
  });

  it('preserves style block for round-trip', () => {
    const track = parseSsa(BASIC_SSA);
    expect(track.metadata?.__assStyles__).toBeDefined();
  });

  it('handles empty input', () => {
    const track = parseSsa('');
    expect(track.cues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// serializeSsa
// ---------------------------------------------------------------------------

describe('serializeSsa', () => {
  it('emits ScriptType: v4.00 (without +)', () => {
    const track = parseSsa(BASIC_SSA);
    const out = serializeSsa(track);
    expect(out).toContain('ScriptType: v4.00');
    expect(out).not.toContain('ScriptType: v4.00+');
  });

  it('emits [V4 Styles] section heading', () => {
    const track = parseSsa(BASIC_SSA);
    const out = serializeSsa(track);
    expect(out).toContain('[V4 Styles]');
  });

  it('emits dialogue lines', () => {
    const track = parseSsa(BASIC_SSA);
    const out = serializeSsa(track);
    expect(out).toContain('Dialogue:');
    expect(out).toContain('Hello from SSA');
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('SSA round-trip', () => {
  it('round-trips text faithfully', () => {
    const original = parseSsa(BASIC_SSA);
    const reparsed = parseSsa(serializeSsa(original));
    expect(reparsed.cues).toHaveLength(original.cues.length);
    for (let i = 0; i < original.cues.length; i++) {
      expect(reparsed.cues[i]?.startMs).toBe(original.cues[i]?.startMs);
      expect(reparsed.cues[i]?.endMs).toBe(original.cues[i]?.endMs);
      expect(reparsed.cues[i]?.text).toBe(original.cues[i]?.text);
    }
  });
});
