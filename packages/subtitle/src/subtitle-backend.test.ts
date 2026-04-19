import type { FormatDescriptor } from '@webcvt/core';
import { describe, expect, it } from 'vitest';
import { SubtitleBackend, detectSubtitleFormat } from './subtitle-backend.ts';

// ---------------------------------------------------------------------------
// Format descriptors
// ---------------------------------------------------------------------------

const SRT_FMT: FormatDescriptor = {
  ext: 'srt',
  mime: 'application/x-subrip',
  category: 'subtitle',
  description: 'SubRip',
};

const VTT_FMT: FormatDescriptor = {
  ext: 'vtt',
  mime: 'text/vtt',
  category: 'subtitle',
  description: 'WebVTT',
};

const ASS_FMT: FormatDescriptor = {
  ext: 'ass',
  mime: 'text/x-ass',
  category: 'subtitle',
  description: 'Advanced SubStation Alpha',
};

const SSA_FMT: FormatDescriptor = {
  ext: 'ssa',
  mime: 'text/x-ssa',
  category: 'subtitle',
  description: 'SubStation Alpha',
};

const SUB_FMT: FormatDescriptor = {
  ext: 'sub',
  mime: 'text/x-microdvd',
  category: 'subtitle',
  description: 'MicroDVD',
};

const MPL_FMT: FormatDescriptor = {
  ext: 'mpl',
  mime: 'text/x-mpl2',
  category: 'subtitle',
  description: 'MPL2',
};

const IMAGE_FMT: FormatDescriptor = {
  ext: 'png',
  mime: 'image/png',
  category: 'image',
  description: 'PNG',
};

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:04,000 --> 00:00:06,000
Second cue

`;

const SAMPLE_VTT = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
Hello world

2
00:00:04.000 --> 00:00:06.000
Second cue

`;

const SAMPLE_ASS = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello world
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,Second cue
`;

const SAMPLE_SUB = `{0}{0}23.976
{24}{72}Hello world
{96}{144}Second cue
`;

const SAMPLE_MPL = `[10][30]Hello world
[40][60]Second cue
`;

// ---------------------------------------------------------------------------
// Helper: make a typed Blob
// ---------------------------------------------------------------------------

function makeBlob(text: string, mime: string): Blob {
  return new Blob([text], { type: mime });
}

const NO_OP_OPTIONS = { format: 'srt' as const };

// ---------------------------------------------------------------------------
// detectSubtitleFormat
// ---------------------------------------------------------------------------

describe('detectSubtitleFormat', () => {
  it('detects VTT by WEBVTT header', () => {
    expect(detectSubtitleFormat('WEBVTT\n\n')).toBe('text/vtt');
  });

  it('detects ASS by [Script Info] + ScriptType v4.00+', () => {
    expect(detectSubtitleFormat('[Script Info]\nScriptType: v4.00+\n')).toBe('text/x-ass');
  });

  it('detects SSA by [Script Info] + ScriptType v4.00', () => {
    expect(detectSubtitleFormat('[Script Info]\nScriptType: v4.00\n')).toBe('text/x-ssa');
  });

  it('detects MicroDVD by {frame}{frame} pattern', () => {
    expect(detectSubtitleFormat('{100}{200}Hello\n')).toBe('text/x-microdvd');
  });

  it('detects MPL2 by [ds][ds] pattern', () => {
    expect(detectSubtitleFormat('[100][200]Hello\n')).toBe('text/x-mpl2');
  });

  it('detects SRT by timestamp pattern', () => {
    expect(detectSubtitleFormat('1\n00:00:01,000 --> 00:00:02,000\nText\n')).toBe(
      'application/x-subrip',
    );
  });

  it('returns undefined for unknown format', () => {
    expect(detectSubtitleFormat('random text without patterns')).toBeUndefined();
  });

  it('handles BOM-prefixed VTT', () => {
    expect(detectSubtitleFormat('\uFEFFWEBVTT\n')).toBe('text/vtt');
  });
});

// ---------------------------------------------------------------------------
// SubtitleBackend.canHandle
// ---------------------------------------------------------------------------

describe('SubtitleBackend.canHandle', () => {
  const backend = new SubtitleBackend();

  it('accepts SRT → VTT', async () => {
    expect(await backend.canHandle(SRT_FMT, VTT_FMT)).toBe(true);
  });

  it('accepts ASS → SRT', async () => {
    expect(await backend.canHandle(ASS_FMT, SRT_FMT)).toBe(true);
  });

  it('accepts any subtitle ↔ subtitle pair', async () => {
    const fmts = [SRT_FMT, VTT_FMT, ASS_FMT, SSA_FMT, SUB_FMT, MPL_FMT];
    for (const inp of fmts) {
      for (const out of fmts) {
        expect(await backend.canHandle(inp, out)).toBe(true);
      }
    }
  });

  it('rejects image input', async () => {
    expect(await backend.canHandle(IMAGE_FMT, VTT_FMT)).toBe(false);
  });

  it('rejects image output', async () => {
    expect(await backend.canHandle(SRT_FMT, IMAGE_FMT)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SubtitleBackend.convert
// ---------------------------------------------------------------------------

describe('SubtitleBackend.convert — SRT → VTT', () => {
  const backend = new SubtitleBackend();

  it('converts SRT to VTT', async () => {
    const blob = makeBlob(SAMPLE_SRT, 'application/x-subrip');
    const result = await backend.convert(blob, VTT_FMT, NO_OP_OPTIONS);
    const text = await result.blob.text();
    expect(text.startsWith('WEBVTT')).toBe(true);
    expect(text).toContain('Hello world');
  });

  it('result has correct format descriptor', async () => {
    const blob = makeBlob(SAMPLE_SRT, 'application/x-subrip');
    const result = await backend.convert(blob, VTT_FMT, NO_OP_OPTIONS);
    expect(result.format.mime).toBe('text/vtt');
  });

  it('result.backend is "subtitle"', async () => {
    const blob = makeBlob(SAMPLE_SRT, 'application/x-subrip');
    const result = await backend.convert(blob, VTT_FMT, NO_OP_OPTIONS);
    expect(result.backend).toBe('subtitle');
  });

  it('result.durationMs is non-negative', async () => {
    const blob = makeBlob(SAMPLE_SRT, 'application/x-subrip');
    const result = await backend.convert(blob, VTT_FMT, NO_OP_OPTIONS);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('SubtitleBackend.convert — VTT → SRT', () => {
  const backend = new SubtitleBackend();

  it('converts VTT to SRT preserving cue text', async () => {
    const blob = makeBlob(SAMPLE_VTT, 'text/vtt');
    const result = await backend.convert(blob, SRT_FMT, NO_OP_OPTIONS);
    const text = await result.blob.text();
    expect(text).toContain('00:00:01,000 --> 00:00:03,000');
    expect(text).toContain('Hello world');
  });
});

describe('SubtitleBackend.convert — ASS → SRT', () => {
  const backend = new SubtitleBackend();

  it('converts ASS to SRT', async () => {
    const blob = makeBlob(SAMPLE_ASS, 'text/x-ass');
    const result = await backend.convert(blob, SRT_FMT, NO_OP_OPTIONS);
    const text = await result.blob.text();
    expect(text).toContain('Hello world');
    expect(text).toContain('-->');
  });
});

describe('SubtitleBackend.convert — SRT → ASS', () => {
  const backend = new SubtitleBackend();

  it('converts SRT to ASS with Script Info header', async () => {
    const blob = makeBlob(SAMPLE_SRT, 'application/x-subrip');
    const result = await backend.convert(blob, ASS_FMT, NO_OP_OPTIONS);
    const text = await result.blob.text();
    expect(text).toContain('[Script Info]');
    expect(text).toContain('Hello world');
  });
});

describe('SubtitleBackend.convert — auto-detect format', () => {
  const backend = new SubtitleBackend();

  it('detects SRT when Blob.type is empty', async () => {
    const blob = makeBlob(SAMPLE_SRT, '');
    const result = await backend.convert(blob, VTT_FMT, NO_OP_OPTIONS);
    const text = await result.blob.text();
    expect(text.startsWith('WEBVTT')).toBe(true);
  });

  it('detects MicroDVD by content', async () => {
    const blob = makeBlob(SAMPLE_SUB, '');
    const result = await backend.convert(blob, SRT_FMT, NO_OP_OPTIONS);
    const text = await result.blob.text();
    expect(text).toContain('-->');
  });

  it('detects MPL2 by content', async () => {
    const blob = makeBlob(SAMPLE_MPL, '');
    const result = await backend.convert(blob, SRT_FMT, NO_OP_OPTIONS);
    const text = await result.blob.text();
    expect(text).toContain('-->');
  });
});

describe('SubtitleBackend.convert — progress callback', () => {
  const backend = new SubtitleBackend();

  it('calls onProgress at least once', async () => {
    const calls: number[] = [];
    const blob = makeBlob(SAMPLE_SRT, 'application/x-subrip');
    await backend.convert(blob, VTT_FMT, {
      format: 'vtt',
      onProgress: (e) => calls.push(e.percent),
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1]).toBe(100);
  });
});

describe('SubtitleBackend.convert — error handling', () => {
  const backend = new SubtitleBackend();

  it('throws UnsupportedFormatError for image output', async () => {
    const blob = makeBlob(SAMPLE_SRT, 'application/x-subrip');
    await expect(backend.convert(blob, IMAGE_FMT, NO_OP_OPTIONS)).rejects.toThrow();
  });

  it('throws WebcvtError when format cannot be detected', async () => {
    const blob = makeBlob('random unrecognized content here', '');
    await expect(backend.convert(blob, VTT_FMT, NO_OP_OPTIONS)).rejects.toThrow();
  });
});
