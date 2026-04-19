import { describe, expect, it } from 'vitest';
import { parseAss, serializeAss } from './ass.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASIC_ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 480

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello world
Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,Second cue
`;

const ASS_WITH_TAGS = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\an8}{\\pos(320,240)}Positioned text
`;

const ASS_MULTILINE = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Line one\\NLine two
`;

const ASS_WITH_CUSTOM_STYLE = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Times New Roman,28,&H0000FFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,2,8,10,10,10,1
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Title,,0,0,0,,Styled cue
`;

// ---------------------------------------------------------------------------
// parseAss
// ---------------------------------------------------------------------------

describe('parseAss', () => {
  it('parses basic ASS with two dialogue lines', () => {
    const track = parseAss(BASIC_ASS);
    expect(track.cues).toHaveLength(2);
    expect(track.cues[0]?.startMs).toBe(1000);
    expect(track.cues[0]?.endMs).toBe(3500);
    expect(track.cues[0]?.text).toBe('Hello world');
  });

  it('strips override tags {\\...} from text', () => {
    const track = parseAss(ASS_WITH_TAGS);
    expect(track.cues[0]?.text).toBe('Positioned text');
  });

  it('converts \\N soft break to \\n in text', () => {
    const track = parseAss(ASS_MULTILINE);
    expect(track.cues[0]?.text).toBe('Line one\nLine two');
  });

  it('stores Script Info fields in metadata', () => {
    const track = parseAss(BASIC_ASS);
    expect(track.metadata?.PlayResX).toBe('640');
    expect(track.metadata?.PlayResY).toBe('480');
  });

  it('preserves raw style block in metadata for round-trip', () => {
    const track = parseAss(BASIC_ASS);
    expect(track.metadata?.__assStyles__).toBeDefined();
  });

  it('parses style properties onto cue.style', () => {
    const track = parseAss(BASIC_ASS);
    expect(track.cues[0]?.style?.fontName).toBe('Arial');
    expect(track.cues[0]?.style?.fontSize).toBe(20);
  });

  it('applies named style properties', () => {
    const track = parseAss(ASS_WITH_CUSTOM_STYLE);
    expect(track.cues[0]?.style?.fontName).toBe('Times New Roman');
    expect(track.cues[0]?.style?.bold).toBe(true);
    expect(track.cues[0]?.style?.alignment).toBe(8);
  });

  it('handles empty input gracefully', () => {
    const track = parseAss('');
    expect(track.cues).toHaveLength(0);
  });

  it('handles BOM', () => {
    const track = parseAss(`\uFEFF${BASIC_ASS}`);
    expect(track.cues).toHaveLength(2);
  });

  it('handles CRLF line endings', () => {
    const track = parseAss(BASIC_ASS.replace(/\n/g, '\r\n'));
    expect(track.cues).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// serializeAss
// ---------------------------------------------------------------------------

describe('serializeAss', () => {
  it('emits [Script Info] section', () => {
    const track = parseAss(BASIC_ASS);
    const out = serializeAss(track);
    expect(out).toContain('[Script Info]');
    expect(out).toContain('ScriptType: v4.00+');
  });

  it('emits [V4+ Styles] section', () => {
    const track = parseAss(BASIC_ASS);
    const out = serializeAss(track);
    expect(out).toContain('[V4+ Styles]');
  });

  it('emits [Events] section with Dialogue lines', () => {
    const track = parseAss(BASIC_ASS);
    const out = serializeAss(track);
    expect(out).toContain('[Events]');
    expect(out).toContain('Dialogue:');
  });

  it('formats timestamps as H:MM:SS.cc', () => {
    const track = parseAss(BASIC_ASS);
    const out = serializeAss(track);
    expect(out).toContain('0:00:01.00');
  });

  it('converts \\n back to \\N in dialogue text', () => {
    const track = parseAss(ASS_MULTILINE);
    const out = serializeAss(track);
    expect(out).toContain('\\N');
  });

  it('re-emits preserved style block verbatim', () => {
    const track = parseAss(ASS_WITH_CUSTOM_STYLE);
    const out = serializeAss(track);
    expect(out).toContain('Times New Roman');
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('ASS round-trip', () => {
  it('round-trips text content faithfully', () => {
    const original = parseAss(BASIC_ASS);
    const reparsed = parseAss(serializeAss(original));
    expect(reparsed.cues).toHaveLength(original.cues.length);
    for (let i = 0; i < original.cues.length; i++) {
      expect(reparsed.cues[i]?.startMs).toBe(original.cues[i]?.startMs);
      expect(reparsed.cues[i]?.endMs).toBe(original.cues[i]?.endMs);
      expect(reparsed.cues[i]?.text).toBe(original.cues[i]?.text);
    }
  });

  it('round-trips multi-line text', () => {
    const original = parseAss(ASS_MULTILINE);
    const reparsed = parseAss(serializeAss(original));
    expect(reparsed.cues[0]?.text).toBe('Line one\nLine two');
  });

  it('round-trips custom style data', () => {
    const original = parseAss(ASS_WITH_CUSTOM_STYLE);
    const reparsed = parseAss(serializeAss(original));
    expect(reparsed.cues[0]?.style?.fontName).toBe('Times New Roman');
  });
});
