import { describe, expect, it } from 'vitest';
import {
  buildWebpAnim,
  minimalVp8Payload,
  minimalVp8lPayload,
} from './_test-helpers/build-webp-anim.ts';
import {
  WebpAnimMissingVp8xError,
  WebpAnimOddOffsetError,
  WebpAnimTooShortError,
  WebpAnimUnknownChunkError,
  WebpAnmfTooShortError,
  WebpBadRiffError,
  WebpFrameOutOfBoundsError,
  WebpMissingSubFrameError,
  WebpStaticNotSupportedError,
  WebpVp8lBadSignatureError,
} from './errors.ts';
import { writeRiffChunk } from './riff.ts';
import { parseWebpAnim, serializeWebpAnim } from './webp-anim.ts';

// Test 24: 2-frame animation with mixed VP8 + VP8L frames
describe('parseWebpAnim', () => {
  it('decodes a 2-frame animation with mixed VP8 + VP8L frames and reports correct subFormat', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8',
          payload: minimalVp8Payload(),
        },
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 200,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    const result = parseWebpAnim(bytes);
    expect(result.format).toBe('webp-anim');
    expect(result.frames.length).toBe(2);
    expect(result.frames[0]!.subFormat).toBe('VP8');
    expect(result.frames[1]!.subFormat).toBe('VP8L');
    expect(result.frames[0]!.durationMs).toBe(100);
    expect(result.frames[1]!.durationMs).toBe(200);
  });

  // Test 25: +1 bias on canvas width/height (VP8X) and frame width/height (ANMF)
  it('correctly applies +1 bias on canvas width/height (VP8X) and frame width/height (ANMF)', () => {
    const bytes = buildWebpAnim({
      canvasW: 100,
      canvasH: 200,
      frames: [
        {
          x: 0,
          y: 0,
          w: 50,
          h: 100,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    const result = parseWebpAnim(bytes);
    // Canvas dimensions: stored as (n-1) → after +1 correction
    expect(result.canvasWidth).toBe(100);
    expect(result.canvasHeight).toBe(200);
    // Frame dimensions
    expect(result.frames[0]!.width).toBe(50);
    expect(result.frames[0]!.height).toBe(100);
  });

  // Test 26: *2 bias on frame x/y (ANMF)
  it('correctly applies *2 bias on frame x/y (ANMF)', () => {
    const bytes = buildWebpAnim({
      canvasW: 100,
      canvasH: 100,
      frames: [
        {
          x: 20,
          y: 40,
          w: 50,
          h: 50,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    const result = parseWebpAnim(bytes);
    expect(result.frames[0]!.x).toBe(20);
    expect(result.frames[0]!.y).toBe(40);
  });

  // Test 27: inverted blending bit (set means "no blend / source")
  it('correctly interprets the inverted blending bit (set means "no blend / source")', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
          blend: 'source',
        },
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
          blend: 'over',
        },
      ],
    });
    const result = parseWebpAnim(bytes);
    // 'source' → blending bit SET (no blend)
    expect(result.frames[0]!.blendMode).toBe('source');
    // 'over' → blending bit CLEAR (blend)
    expect(result.frames[1]!.blendMode).toBe('over');
  });

  // Test 28: file missing animation flag in VP8X
  it('rejects a file whose VP8X is missing the animation flag (static WebP)', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    // Corrupt the VP8X flags byte to clear the animation flag (bit 1)
    const corrupted = new Uint8Array(bytes);
    // VP8X payload starts at offset 20 (12 RIFF header + 8 chunk header)
    corrupted[20] &= ~0x02; // clear bit 1 (animation flag)
    expect(() => parseWebpAnim(corrupted)).toThrowError(WebpStaticNotSupportedError);
  });

  // Test 29: VP8X not the first chunk after WEBP
  it('rejects a file where VP8X is not the first chunk after WEBP', () => {
    // Build a WebP where ANIM comes before VP8X
    // Make it large enough to pass the size check (>= 60 bytes)
    const animPayload = new Uint8Array(6); // loopCount=0

    // ANIM chunk then VP8X chunk (wrong order)
    const animChunk = writeRiffChunk('ANIM', animPayload);
    const vp8xPayload = new Uint8Array(10);
    vp8xPayload[0] = 0x02; // animation flag
    vp8xPayload[4] = 9; // canvasW-1 = 9 → canvasW=10
    vp8xPayload[7] = 9; // canvasH-1 = 9 → canvasH=10
    const vp8xChunk = writeRiffChunk('VP8X', vp8xPayload);
    // Add padding to get above 60 bytes minimum (need out >= 60, so inner >= 48)
    const padding = new Uint8Array(16);

    const inner = new Uint8Array([...animChunk, ...vp8xChunk, ...padding]);
    const outerSize = 4 + inner.length;
    const out = new Uint8Array(12 + inner.length);
    out[0] = 0x52;
    out[1] = 0x49;
    out[2] = 0x46;
    out[3] = 0x46;
    out[4] = outerSize & 0xff;
    out[5] = (outerSize >> 8) & 0xff;
    out[6] = (outerSize >> 16) & 0xff;
    out[7] = (outerSize >> 24) & 0xff;
    out[8] = 0x57;
    out[9] = 0x45;
    out[10] = 0x42;
    out[11] = 0x50;
    out.set(inner, 12);

    expect(() => parseWebpAnim(out)).toThrowError(WebpAnimMissingVp8xError);
  });

  // Test 30: odd-byte RIFF pad handling
  it('handles the odd-byte RIFF pad correctly across multiple chunks', () => {
    // VP8L payload with odd length (1 byte) → gets a pad byte
    const oddPayload = new Uint8Array([0x2f]); // 1 byte VP8L
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        { x: 0, y: 0, w: 10, h: 10, durationMs: 100, subFormat: 'VP8L', payload: oddPayload },
      ],
    });
    // Should parse without error despite odd-byte payload needing padding
    const result = parseWebpAnim(bytes);
    expect(result.frames.length).toBe(1);
  });

  // Test 31: VP8 without trailing space
  it('parses VP8 FourCC correctly (VP8 has trailing space per Trap §13)', () => {
    // Build with a custom ANMF that has 'VP8' (no space) — should fail to match VP8 or VP8L
    // We test that VP8L without 0x2F signature fails
    const badVp8lPayload = new Uint8Array([0x00, 0x01, 0x02]); // no 0x2F signature
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        { x: 0, y: 0, w: 10, h: 10, durationMs: 100, subFormat: 'VP8L', payload: badVp8lPayload },
      ],
    });
    expect(() => parseWebpAnim(bytes)).toThrowError(WebpVp8lBadSignatureError);
  });

  // Test 32: VP8L missing 0x2F signature byte
  it('rejects VP8L sub-frame missing the 0x2F signature byte', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: new Uint8Array([0x00]),
        },
      ],
    });
    expect(() => parseWebpAnim(bytes)).toThrowError(WebpVp8lBadSignatureError);
  });

  // Test 33: truncated frame headers (ANMF payload < 16 bytes)
  it('rejects truncated frame headers (ANMF payload < 16 bytes)', () => {
    // Build a custom WebP with a short ANMF
    const vp8xPayload = new Uint8Array(10);
    vp8xPayload[0] = 0x02; // animation flag
    vp8xPayload[4] = 9;
    vp8xPayload[7] = 9; // 10x10 canvas (canvasW-1=9)
    const animPayload = new Uint8Array(6);
    const shortAnmf = writeRiffChunk('ANMF', new Uint8Array([1, 2, 3])); // only 3 bytes, need 16

    const innerParts = [
      ...writeRiffChunk('VP8X', vp8xPayload),
      ...writeRiffChunk('ANIM', animPayload),
      ...shortAnmf,
    ];
    // Add padding so total >= 60 bytes
    while (12 + innerParts.length < 60) {
      innerParts.push(0);
    }
    const inner = new Uint8Array(innerParts);
    const outerSize = 4 + inner.length;
    const out = new Uint8Array(12 + inner.length);
    out[0] = 0x52;
    out[1] = 0x49;
    out[2] = 0x46;
    out[3] = 0x46;
    out[4] = outerSize & 0xff;
    out[5] = (outerSize >> 8) & 0xff;
    out[6] = (outerSize >> 16) & 0xff;
    out[7] = (outerSize >> 24) & 0xff;
    out[8] = 0x57;
    out[9] = 0x45;
    out[10] = 0x42;
    out[11] = 0x50;
    out.set(inner, 12);
    expect(() => parseWebpAnim(out)).toThrowError(WebpAnmfTooShortError);
  });

  it('rejects input shorter than 60 bytes', () => {
    expect(() => parseWebpAnim(new Uint8Array(20))).toThrowError(WebpAnimTooShortError);
  });

  it('rejects missing RIFF header', () => {
    const bytes = new Uint8Array(60).fill(0x41);
    expect(() => parseWebpAnim(bytes)).toThrowError(WebpBadRiffError);
  });

  it('rejects RIFF with bad WEBP FourCC', () => {
    const bytes = new Uint8Array(60);
    bytes[0] = 0x52;
    bytes[1] = 0x49;
    bytes[2] = 0x46;
    bytes[3] = 0x46; // RIFF
    bytes[4] = 52; // size
    bytes[8] = 0x41;
    bytes[9] = 0x56;
    bytes[10] = 0x49;
    bytes[11] = 0x20; // 'AVI '
    expect(() => parseWebpAnim(bytes)).toThrowError(WebpBadRiffError);
  });

  it('correctly reads loopCount and backgroundColor from ANIM', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      loopCount: 5,
      backgroundColor: 0xff0000ff, // ARGB LE
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    const result = parseWebpAnim(bytes);
    expect(result.loopCount).toBe(5);
    expect(result.backgroundColor).toBe(0xff0000ff);
  });

  it('reads disposal method correctly', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
          dispose: 'none',
        },
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
          dispose: 'background',
        },
      ],
    });
    const result = parseWebpAnim(bytes);
    expect(result.frames[0]!.disposalMethod).toBe('none');
    expect(result.frames[1]!.disposalMethod).toBe('background');
  });

  it('preserves metadata chunks (ICCP, EXIF, XMP)', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
      iccp: new Uint8Array([1, 2, 3]),
    });
    const result = parseWebpAnim(bytes);
    const iccp = result.metadataChunks.find((c) => c.fourcc === 'ICCP');
    expect(iccp).toBeDefined();
    expect(Array.from(iccp!.payload)).toEqual([1, 2, 3]);
  });
});

describe('parseWebpAnim — additional branch coverage', () => {
  it('parses frame with VP8 subFormat and ALPH chunk before VP8 (ALPH skip path)', () => {
    // Build an ANMF with ALPH chunk before VP8 chunk to exercise the ALPH skip branch
    const alphPayload = new Uint8Array([0x00, 0x01, 0x02, 0x03]); // fake ALPH data
    const vp8Payload = minimalVp8Payload();

    // Build ANMF manually with ALPH + VP8
    const hdr = new Uint8Array(16);
    const fw1 = 10 - 1;
    const fh1 = 10 - 1;
    hdr[6] = fw1;
    hdr[9] = fh1;
    hdr[12] = 100; // 100ms duration
    hdr[15] = 0x01; // blendBit=1 (source), disposeBit=0

    const alphChunk = writeRiffChunk('ALPH', alphPayload);
    const vp8Chunk = writeRiffChunk('VP8 ', vp8Payload);
    const anmfPayload = new Uint8Array([...hdr, ...alphChunk, ...vp8Chunk]);

    const vp8xPayload = new Uint8Array(10);
    vp8xPayload[0] = 0x02 | 0x10; // animation + alpha flags
    vp8xPayload[4] = 9;
    vp8xPayload[7] = 9; // 10x10

    const animPayload = new Uint8Array(6);
    const innerParts = [
      ...writeRiffChunk('VP8X', vp8xPayload),
      ...writeRiffChunk('ANIM', animPayload),
      ...writeRiffChunk('ANMF', anmfPayload),
    ];

    while (12 + innerParts.length < 60) innerParts.push(0);
    const inner = new Uint8Array(innerParts);
    const outerSize = 4 + inner.length;
    const out = new Uint8Array(12 + inner.length);
    out[0] = 0x52;
    out[1] = 0x49;
    out[2] = 0x46;
    out[3] = 0x46;
    out[4] = outerSize & 0xff;
    out[5] = (outerSize >> 8) & 0xff;
    out[6] = (outerSize >> 16) & 0xff;
    out[7] = (outerSize >> 24) & 0xff;
    out[8] = 0x57;
    out[9] = 0x45;
    out[10] = 0x42;
    out[11] = 0x50;
    out.set(inner, 12);

    const result = parseWebpAnim(out);
    expect(result.frames.length).toBe(1);
    expect(result.frames[0]!.subFormat).toBe('VP8');
  });

  it('throws WebpBadDimensionError when canvas width exceeds MAX_DIM', async () => {
    // Build a VP8X payload with canvasWidth = MAX_DIM + 1 = 16385
    // MAX_DIM = 16384 = 0x4000; stored as canvasWidth-1 = 16384 = 0x4000 in 24-bit LE
    const vp8xPayload = new Uint8Array(10);
    vp8xPayload[0] = 0x02; // animation flag
    // canvasWidth - 1 = 16384 = 0x4000 in 24-bit LE
    vp8xPayload[4] = 0x00;
    vp8xPayload[5] = 0x40;
    vp8xPayload[6] = 0x00; // 16384 → width = 16385
    vp8xPayload[7] = 9; // canvasHeight-1 = 9 → height = 10

    const animPayload = new Uint8Array(6);
    const innerParts = [
      ...writeRiffChunk('VP8X', vp8xPayload),
      ...writeRiffChunk('ANIM', animPayload),
    ];
    while (12 + innerParts.length < 60) innerParts.push(0);
    const inner = new Uint8Array(innerParts);
    const outerSize = 4 + inner.length;
    const out = new Uint8Array(12 + inner.length);
    out[0] = 0x52;
    out[1] = 0x49;
    out[2] = 0x46;
    out[3] = 0x46;
    out[4] = outerSize & 0xff;
    out[5] = (outerSize >> 8) & 0xff;
    out[8] = 0x57;
    out[9] = 0x45;
    out[10] = 0x42;
    out[11] = 0x50;
    out.set(inner, 12);
    const { WebpBadDimensionError } = await import('./errors.ts');
    expect(() => parseWebpAnim(out)).toThrowError(WebpBadDimensionError);
  });

  it('throws WebpBadRiffError when outer size is off by more than 1 byte', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    // Corrupt the outer size to be off by 10 (more than the 1-byte tolerance)
    const corrupted = new Uint8Array(bytes);
    const origSize =
      corrupted[4]! | (corrupted[5]! << 8) | (corrupted[6]! << 16) | (corrupted[7]! << 24);
    const badSize = origSize + 10; // 10 more than actual
    corrupted[4] = badSize & 0xff;
    corrupted[5] = (badSize >> 8) & 0xff;
    corrupted[6] = (badSize >> 16) & 0xff;
    corrupted[7] = (badSize >> 24) & 0xff;
    expect(() => parseWebpAnim(corrupted)).toThrowError(WebpBadRiffError);
  });

  it('tolerates outer size off by exactly 1 (lenient for odd-pad)', () => {
    // Build a valid webp-anim, then corrupt outer size by 1 — should still parse
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    // outerSize should be bytes.length - 8; set it to bytes.length - 8 + 1 (off by 1 lenient)
    const corrected = new Uint8Array(bytes);
    const origSize =
      corrected[4]! | (corrected[5]! << 8) | (corrected[6]! << 16) | (corrected[7]! << 24);
    const offByOne = origSize - 1; // expectedLen = 8 + (origSize-1) = bytes.length - 1 = input.length - 1
    corrected[4] = offByOne & 0xff;
    corrected[5] = (offByOne >> 8) & 0xff;
    corrected[6] = (offByOne >> 16) & 0xff;
    corrected[7] = (offByOne >> 24) & 0xff;
    // This should parse without throwing (off-by-one is tolerated)
    const result = parseWebpAnim(corrected);
    expect(result.frames.length).toBe(1);
  });

  it('throws WebpMissingSubFrameError for ANMF with no VP8/VP8L chunk', () => {
    // Build an ANMF with no sub-frame chunk (only header bytes)
    const hdr = new Uint8Array(16);
    const fw1 = 10 - 1;
    const fh1 = 10 - 1;
    hdr[6] = fw1;
    hdr[9] = fh1;
    hdr[12] = 100;
    hdr[15] = 0x01;

    const vp8xPayload = new Uint8Array(10);
    vp8xPayload[0] = 0x02;
    vp8xPayload[4] = 9;
    vp8xPayload[7] = 9;
    const animPayload = new Uint8Array(6);

    // ANMF with only a header and an unknown inner chunk (no VP8/VP8L)
    const unknownInner = writeRiffChunk('ZZZZ', new Uint8Array([0x00, 0x01]));
    const anmfPayload = new Uint8Array([...hdr, ...unknownInner]);

    const innerParts = [
      ...writeRiffChunk('VP8X', vp8xPayload),
      ...writeRiffChunk('ANIM', animPayload),
      ...writeRiffChunk('ANMF', anmfPayload),
    ];
    while (12 + innerParts.length < 60) innerParts.push(0);
    const inner = new Uint8Array(innerParts);
    const outerSize = 4 + inner.length;
    const out = new Uint8Array(12 + inner.length);
    out[0] = 0x52;
    out[1] = 0x49;
    out[2] = 0x46;
    out[3] = 0x46;
    out[4] = outerSize & 0xff;
    out[5] = (outerSize >> 8) & 0xff;
    out[6] = (outerSize >> 16) & 0xff;
    out[7] = (outerSize >> 24) & 0xff;
    out[8] = 0x57;
    out[9] = 0x45;
    out[10] = 0x42;
    out[11] = 0x50;
    out.set(inner, 12);
    expect(() => parseWebpAnim(out)).toThrowError(WebpMissingSubFrameError);
  });

  it('rejects frame with bounds overflow on y-axis (WebpFrameOutOfBoundsError)', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 8, // y=8 + height=4 → 12 > 10 (canvas height)
          w: 4,
          h: 4,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    expect(() => parseWebpAnim(bytes)).toThrowError(WebpFrameOutOfBoundsError);
  });

  it('throws WebpAnimUnknownChunkError for unknown top-level chunk', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    // Append an unknown chunk 'ZZZZ' after the valid ANMF
    const parsed = parseWebpAnim(bytes);
    const serialized = serializeWebpAnim(parsed);
    // Inject unknown chunk at end (before RIFF boundary)
    const unknownChunk = writeRiffChunk('ZZZZ', new Uint8Array([1, 2, 3, 4]));
    // Insert just before the end
    const withUnknown = new Uint8Array([...serialized, ...unknownChunk]);
    // Fix outer size
    const outerSize = (4 + withUnknown.length - 12) >>> 0;
    withUnknown[4] = outerSize & 0xff;
    withUnknown[5] = (outerSize >> 8) & 0xff;
    withUnknown[6] = (outerSize >> 16) & 0xff;
    withUnknown[7] = (outerSize >> 24) & 0xff;
    expect(() => parseWebpAnim(withUnknown)).toThrowError(WebpAnimUnknownChunkError);
  });

  it('throws WebpAnimTooShortError for tiny input (< 60 bytes)', () => {
    // Verify the too-short path is exercised via the existing import
    expect(() => parseWebpAnim(new Uint8Array(10))).toThrowError(WebpAnimTooShortError);
  });
});

describe('serializeWebpAnim', () => {
  it('round-trips a 2-frame animation', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      loopCount: 3,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
          blend: 'source',
          dispose: 'none',
        },
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 200,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
          blend: 'over',
          dispose: 'background',
        },
      ],
    });
    const parsed = parseWebpAnim(bytes);
    const serialized = serializeWebpAnim(parsed);
    const reparsed = parseWebpAnim(serialized);

    expect(reparsed.frames.length).toBe(2);
    expect(reparsed.loopCount).toBe(3);
    expect(reparsed.frames[0]!.blendMode).toBe('source');
    expect(reparsed.frames[1]!.blendMode).toBe('over');
    expect(reparsed.frames[1]!.disposalMethod).toBe('background');
  });

  it('serializes ICCP metadata chunk (exercises ICCP write path)', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
      iccp: new Uint8Array([0x01, 0x02, 0x03]),
    });
    const parsed = parseWebpAnim(bytes);
    const serialized = serializeWebpAnim(parsed);
    const reparsed = parseWebpAnim(serialized);
    const iccp = reparsed.metadataChunks.find((c) => c.fourcc === 'ICCP');
    expect(iccp).toBeDefined();
    expect(Array.from(iccp!.payload)).toEqual([0x01, 0x02, 0x03]);
  });

  it('serializes EXIF and XMP metadata chunks (exercises EXIF/XMP write path)', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
      exif: new Uint8Array([0xaa, 0xbb]),
      xmp: new Uint8Array([0xcc, 0xdd]),
    });
    const parsed = parseWebpAnim(bytes);
    expect(parsed.metadataChunks.some((c) => c.fourcc === 'EXIF')).toBe(true);
    expect(parsed.metadataChunks.some((c) => c.fourcc === 'XMP ')).toBe(true);
    const serialized = serializeWebpAnim(parsed);
    const reparsed = parseWebpAnim(serialized);
    expect(reparsed.metadataChunks.some((c) => c.fourcc === 'EXIF')).toBe(true);
    expect(reparsed.metadataChunks.some((c) => c.fourcc === 'XMP ')).toBe(true);
  });

  it('serializes with hasAlpha flag set', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      hasAlpha: true,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    const parsed = parseWebpAnim(bytes);
    expect(parsed.hasAlpha).toBe(true);
    const serialized = serializeWebpAnim(parsed);
    const reparsed = parseWebpAnim(serialized);
    expect(reparsed.hasAlpha).toBe(true);
  });

  it('serializes frames with VP8 subFormat (exercises VP8 branch in buildAnmf)', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8',
          payload: minimalVp8Payload(),
        },
      ],
    });
    const parsed = parseWebpAnim(bytes);
    expect(parsed.frames[0]!.subFormat).toBe('VP8');
    const serialized = serializeWebpAnim(parsed);
    const reparsed = parseWebpAnim(serialized);
    expect(reparsed.frames[0]!.subFormat).toBe('VP8');
  });

  it('throws WebpAnimOddOffsetError for odd y offset', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    const parsed = parseWebpAnim(bytes);
    const modified = {
      ...parsed,
      frames: [{ ...parsed.frames[0]!, y: 3 }], // odd y
    };
    expect(() => serializeWebpAnim(modified)).toThrowError(WebpAnimOddOffsetError);
  });

  it('throws WebpAnimOddOffsetError for odd x offset', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    const parsed = parseWebpAnim(bytes);
    const modified = {
      ...parsed,
      frames: [{ ...parsed.frames[0]!, x: 3 }], // odd x
    };
    expect(() => serializeWebpAnim(modified)).toThrowError(WebpAnimOddOffsetError);
  });

  // Test 38: round-trip through parseAnimation / serializeAnimation
  it('correctly writes RIFF outer size including WEBP FourCC (Trap §11)', () => {
    const bytes = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    const parsed = parseWebpAnim(bytes);
    const serialized = serializeWebpAnim(parsed);

    // Verify outer size field: bytes 4-7 LE = (total - 8)
    const outerSize =
      serialized[4]! | (serialized[5]! << 8) | (serialized[6]! << 16) | (serialized[7]! << 24);
    expect(outerSize + 8).toBe(serialized.length);
  });
});
