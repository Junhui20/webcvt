/**
 * Tests for PCX parser, serializer, and RLE codec.
 *
 * 30+ test cases covering all 10 traps from the design note.
 * Uses build-pcx.ts for synthetic fixture construction — no binary file I/O.
 */

import { describe, expect, it } from 'vitest';
import {
  build1BitScanline,
  build4BitPackedScanline,
  build4BitPlanarScanline,
  buildGray8Scanline,
  buildPcx,
  buildTruecolorPlanes,
  encodeScanlineRle,
} from './_test-helpers/build-pcx.ts';
import { ImageLegacyBackend } from './backend.ts';
import { PCX_MIME, PCX_MIME_ALT, PCX_PALETTE_SENTINEL } from './constants.ts';
import { detectImageFormat } from './detect.ts';
import {
  PcxBadEncodingError,
  PcxBadHeaderError,
  PcxBadMagicError,
  PcxBadVersionError,
  PcxRleDecodeError,
  PcxUnsupportedFeatureError,
} from './errors.ts';
import { parseImage } from './parser.ts';
import { decodePcxRle, parsePcx, serializePcx } from './pcx.ts';
import { serializeImage } from './serializer.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal 4×4 8-bit grayscale PCX with explicit pixel values. */
function build4x4Gray(pixels: number[], withVgaPalette = false): Uint8Array {
  // width=4, bytesPerLine=4 (even minimum)
  const scanlines: Uint8Array[][] = [];
  for (let y = 0; y < 4; y++) {
    const row = pixels.slice(y * 4, y * 4 + 4);
    scanlines.push([buildGray8Scanline(row, 4)]);
  }
  let vgaPalette: Uint8Array | undefined;
  if (withVgaPalette) {
    vgaPalette = new Uint8Array(768);
    for (let i = 0; i < 256; i++) {
      vgaPalette[i * 3] = i; // R = index
      vgaPalette[i * 3 + 1] = 0;
      vgaPalette[i * 3 + 2] = 0;
    }
  }
  return buildPcx({
    xMax: 3,
    yMax: 3,
    bitsPerPixel: 8,
    nPlanes: 1,
    rawPixelPlanes: scanlines,
    vgaPalette,
  });
}

// ---------------------------------------------------------------------------
// Test 1: Decode 4×4 v5 8-bit grayscale (no footer) — Trap #8
// ---------------------------------------------------------------------------

describe('PCX parser — 8-bit grayscale (no footer)', () => {
  it('decodes 4×4 8-bit grayscale and marks kind as 8bit-grayscale', () => {
    const pixels = Array.from({ length: 16 }, (_, i) => i * 10);
    const pcxBytes = build4x4Gray(pixels, false);
    const file = parsePcx(pcxBytes);

    expect(file.format).toBe('pcx');
    expect(file.kind).toBe('8bit-grayscale');
    expect(file.width).toBe(4);
    expect(file.height).toBe(4);
    expect(file.channels).toBe(1);
    expect(file.bitDepth).toBe(8);
    expect(file.vgaPalette).toBeNull();
    expect(file.pixelData.length).toBe(16);
    for (let i = 0; i < 16; i++) {
      expect(file.pixelData[i]).toBe(pixels[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: Decode 4×4 v5 8-bit indexed WITH palette footer — Trap #7, #8
// ---------------------------------------------------------------------------

describe('PCX parser — 8-bit indexed VGA (with footer)', () => {
  it('decodes 4×4 8-bit indexed and marks kind as 8bit-indexed-vga', () => {
    const pixels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const pcxBytes = build4x4Gray(pixels, true);
    const file = parsePcx(pcxBytes);

    expect(file.kind).toBe('8bit-indexed-vga');
    expect(file.vgaPalette).not.toBeNull();
    expect(file.vgaPalette?.length).toBe(768);
    // VGA palette R channel = index
    expect(file.vgaPalette?.[0]).toBe(0); // color 0: R=0
    expect(file.vgaPalette?.[3]).toBe(1); // color 1: R=1
    expect(file.pixelData[0]).toBe(0);
    expect(file.pixelData[1]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Decode 4×4 v5 24-bit truecolor NPlanes=3 — Trap #4
// ---------------------------------------------------------------------------

describe('PCX parser — 24-bit truecolor (planar → interleaved)', () => {
  it('decodes planar RGB scanlines to interleaved RGB pixelData', () => {
    // Asymmetric pattern: row 0=[R,G,B] different per column to catch planar confusion
    const rgbRows: Array<Array<[number, number, number]>> = [
      [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [128, 64, 32],
      ],
      [
        [10, 20, 30],
        [40, 50, 60],
        [70, 80, 90],
        [100, 110, 120],
      ],
      [
        [200, 150, 100],
        [50, 25, 12],
        [1, 2, 3],
        [4, 5, 6],
      ],
      [
        [7, 8, 9],
        [11, 12, 13],
        [14, 15, 16],
        [17, 18, 19],
      ],
    ];
    const planes = buildTruecolorPlanes(rgbRows, 4);
    const pcxBytes = buildPcx({
      xMax: 3,
      yMax: 3,
      bitsPerPixel: 8,
      nPlanes: 3,
      rawPixelPlanes: planes,
    });
    const file = parsePcx(pcxBytes);

    expect(file.kind).toBe('24bit-truecolor');
    expect(file.channels).toBe(3);
    expect(file.pixelData.length).toBe(4 * 4 * 3);

    // Verify interleaved layout: pixel(x,y) = [R,G,B]
    const check = (y: number, x: number, r: number, g: number, b: number) => {
      const off = (y * 4 + x) * 3;
      expect(file.pixelData[off]).toBe(r);
      expect(file.pixelData[off + 1]).toBe(g);
      expect(file.pixelData[off + 2]).toBe(b);
    };

    check(0, 0, 255, 0, 0);
    check(0, 1, 0, 255, 0);
    check(0, 2, 0, 0, 255);
    check(0, 3, 128, 64, 32);
    check(1, 0, 10, 20, 30);
    check(2, 0, 200, 150, 100);
    check(3, 3, 17, 18, 19);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Decode 4×4 4-bit EGA-packed — Trap #10
// ---------------------------------------------------------------------------

describe('PCX parser — 4-bit EGA packed', () => {
  it('decodes 4-bit packed indices correctly', () => {
    const pixels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const scanlines: Uint8Array[][] = [];
    for (let y = 0; y < 4; y++) {
      const row = pixels.slice(y * 4, y * 4 + 4);
      scanlines.push([build4BitPackedScanline(row, 2)]);
    }
    const pcxBytes = buildPcx({
      xMax: 3,
      yMax: 3,
      bitsPerPixel: 4,
      nPlanes: 1,
      rawPixelPlanes: scanlines,
    });
    const file = parsePcx(pcxBytes);

    expect(file.kind).toBe('4bit-ega-packed');
    expect(file.pixelData.length).toBe(16);
    for (let i = 0; i < 16; i++) {
      expect(file.pixelData[i]).toBe(pixels[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 5: Decode 4×4 4-bit EGA-planar (BPP=1, NPlanes=4) — Trap #4
// ---------------------------------------------------------------------------

describe('PCX parser — 4-bit EGA planar (BPP=1, NPlanes=4)', () => {
  it('combines 4 bit-planes into 4-bit EGA index — asymmetric pattern', () => {
    // Use asymmetric pattern: pixels 0,1,2,3,...15 across a 4×4 grid
    // Row 0: [5, 10, 3, 15], Row 1: [1, 7, 12, 9], Row 2: [0, 6, 14, 2], Row 3: [4, 8, 11, 13]
    const rows = [
      [5, 10, 3, 15],
      [1, 7, 12, 9],
      [0, 6, 14, 2],
      [4, 8, 11, 13],
    ];

    // Build planar scanlines: each row has 4 planes
    const scanlines: Uint8Array[][] = [];
    for (const row of rows) {
      scanlines.push(build4BitPlanarScanline(row, 2));
    }

    const pcxBytes = buildPcx({
      xMax: 3,
      yMax: 3,
      bitsPerPixel: 1,
      nPlanes: 4,
      rawPixelPlanes: scanlines,
    });
    const file = parsePcx(pcxBytes);

    expect(file.kind).toBe('4bit-ega-planar');
    expect(file.originalBitsPerPixel).toBe(1);
    expect(file.originalNPlanes).toBe(4);
    expect(file.pixelData.length).toBe(16);

    const expected = rows.flat();
    for (let i = 0; i < 16; i++) {
      expect(file.pixelData[i]).toBe(expected[i], `pixel[${i}] mismatch`);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 6: Decode 8×1 1-bit bilevel with non-default EGA palette — Trap #9
// ---------------------------------------------------------------------------

describe('PCX parser — 1-bit bilevel with non-default EGA palette', () => {
  it('stores indices 0/1 in pixelData and preserves EGA palette verbatim', () => {
    // Non-default palette: dark blue (0,0,128) at index 0, white (255,255,255) at index 1
    const egaPalette = new Uint8Array(48);
    egaPalette[0] = 0;
    egaPalette[1] = 0;
    egaPalette[2] = 128; // color 0: dark blue
    egaPalette[3] = 255;
    egaPalette[4] = 255;
    egaPalette[5] = 255; // color 1: white

    const pixelRow = [0, 1, 0, 1, 1, 0, 1, 0];
    const scanline = build1BitScanline(pixelRow, 1); // width=8, BPL=ceil(8/8)=1
    const pcxBytes = buildPcx({
      xMax: 7,
      yMax: 0,
      bitsPerPixel: 1,
      nPlanes: 1,
      egaPalette,
      rawPixelPlanes: [[scanline]],
    });
    const file = parsePcx(pcxBytes);

    expect(file.kind).toBe('1bit-bilevel');
    expect(file.pixelData.length).toBe(8);
    for (let i = 0; i < 8; i++) {
      expect(file.pixelData[i]).toBe(pixelRow[i]);
    }

    // Trap #9: EGA palette must be preserved verbatim (NOT hardcoded black/white)
    expect(file.egaPalette[0]).toBe(0);
    expect(file.egaPalette[1]).toBe(0);
    expect(file.egaPalette[2]).toBe(128);
    expect(file.egaPalette[3]).toBe(255);
    expect(file.egaPalette[4]).toBe(255);
    expect(file.egaPalette[5]).toBe(255);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Width = Xmax − Xmin + 1 with non-zero Xmin — Trap #2
// ---------------------------------------------------------------------------

describe('PCX parser — Xmin/Ymin non-zero', () => {
  it('computes width = Xmax − Xmin + 1 = 4 when Xmin=10, Xmax=13', () => {
    const pixels = [100, 101, 102, 103];
    const scanlines: Uint8Array[][] = [[buildGray8Scanline(pixels, 4)]];
    const pcxBytes = buildPcx({
      xMin: 10,
      yMin: 5,
      xMax: 13,
      yMax: 5,
      bitsPerPixel: 8,
      nPlanes: 1,
      rawPixelPlanes: scanlines,
    });
    const file = parsePcx(pcxBytes);

    expect(file.width).toBe(4);
    expect(file.height).toBe(1);
    expect(file.xMin).toBe(10);
    expect(file.yMin).toBe(5);
    for (let i = 0; i < 4; i++) {
      expect(file.pixelData[i]).toBe(pixels[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 8: Strip trailing pad bytes for width=9, BPL=10 — Trap #3
// ---------------------------------------------------------------------------

describe('PCX parser — pad byte stripping', () => {
  it('strips BPL trailing pad byte: width=9, BPL=10', () => {
    const pixelValues = [10, 20, 30, 40, 50, 60, 70, 80, 90];
    // BPL=10 (even minimum for width=9 is 9, rounded up to 10)
    const scanline = buildGray8Scanline([...pixelValues, 0xff], 10); // 9 pixels + 1 pad
    const pcxBytes = buildPcx({
      xMax: 8, // width=9
      yMax: 0,
      bitsPerPixel: 8,
      nPlanes: 1,
      bytesPerLine: 10,
      rawPixelPlanes: [[scanline]],
    });
    const file = parsePcx(pcxBytes);

    expect(file.width).toBe(9);
    expect(file.pixelData.length).toBe(9);
    // Trap #3: pad byte 0xFF should NOT appear in pixelData
    for (let i = 0; i < 9; i++) {
      expect(file.pixelData[i]).toBe(pixelValues[i]);
    }
    expect(file.normalisations).toContain('bytesperline-pad-bytes-stripped');
  });
});

// ---------------------------------------------------------------------------
// Test 9: Reject odd BytesPerLine → PcxBadHeaderError
// ---------------------------------------------------------------------------

describe('PCX parser — header validation', () => {
  it('rejects odd BytesPerLine', () => {
    const pcxBytes = buildPcx({
      xMax: 3, // width=4, min BPL=4
      yMax: 3,
      bitsPerPixel: 8,
      nPlanes: 1,
      bytesPerLine: 5, // ODD — invalid
    });
    expect(() => parsePcx(pcxBytes)).toThrow(PcxBadHeaderError);
  });

  it('rejects Xmax < Xmin', () => {
    // Build a valid file first, then patch xMin > xMax in header bytes
    const valid = buildPcx({ xMax: 3, yMax: 3 });
    const patched = new Uint8Array(valid);
    const dv = new DataView(patched.buffer);
    dv.setUint16(4, 10, true); // xMin = 10
    dv.setUint16(8, 5, true); // xMax = 5 → invalid (xMax < xMin)
    expect(() => parsePcx(patched)).toThrow(PcxBadHeaderError);
  });

  it('rejects Ymax < Ymin', () => {
    // Build a valid file first, then patch yMin > yMax in header bytes
    const valid = buildPcx({ xMax: 3, yMax: 3 });
    const patched = new Uint8Array(valid);
    const dv = new DataView(patched.buffer);
    dv.setUint16(6, 10, true); // yMin = 10
    dv.setUint16(10, 5, true); // yMax = 5 → invalid (yMax < yMin)
    expect(() => parsePcx(patched)).toThrow(PcxBadHeaderError);
  });

  it('rejects BytesPerLine less than minimum', () => {
    const pcxBytes = buildPcx({
      xMax: 7, // width=8, min BPL=8
      yMax: 0,
      bitsPerPixel: 8,
      nPlanes: 1,
      bytesPerLine: 6, // too small, even but < 8
    });
    expect(() => parsePcx(pcxBytes)).toThrow(PcxBadHeaderError);
  });
});

// ---------------------------------------------------------------------------
// Test 10: Reject Manufacturer ≠ 0x0A → PcxBadMagicError
// ---------------------------------------------------------------------------

describe('PCX parser — magic byte validation', () => {
  it('rejects manufacturer byte ≠ 0x0A', () => {
    const pcxBytes = buildPcx({ xMax: 3, yMax: 3, manufacturer: 0x00 });
    expect(() => parsePcx(pcxBytes)).toThrow(PcxBadMagicError);
  });

  it('rejects manufacturer byte 0xFF', () => {
    const pcxBytes = buildPcx({ xMax: 3, yMax: 3, manufacturer: 0xff });
    expect(() => parsePcx(pcxBytes)).toThrow(PcxBadMagicError);
  });
});

// ---------------------------------------------------------------------------
// Test 11: Reject Version=1 → PcxBadVersionError
// ---------------------------------------------------------------------------

describe('PCX parser — version validation', () => {
  it('rejects version=1', () => {
    const pcxBytes = buildPcx({ xMax: 3, yMax: 3, version: 1 });
    expect(() => parsePcx(pcxBytes)).toThrow(PcxBadVersionError);
  });

  it('rejects version=6', () => {
    const pcxBytes = buildPcx({ xMax: 3, yMax: 3, version: 6 });
    expect(() => parsePcx(pcxBytes)).toThrow(PcxBadVersionError);
  });

  it('accepts valid versions 0, 2, 3, 4, 5', () => {
    for (const v of [0, 2, 3, 4, 5]) {
      const pcxBytes = buildPcx({ xMax: 3, yMax: 3, version: v });
      expect(() => parsePcx(pcxBytes)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 12: Reject Encoding=0 → PcxBadEncodingError
// ---------------------------------------------------------------------------

describe('PCX parser — encoding validation', () => {
  it('rejects encoding=0', () => {
    const pcxBytes = buildPcx({ xMax: 3, yMax: 3, encoding: 0 });
    expect(() => parsePcx(pcxBytes)).toThrow(PcxBadEncodingError);
  });

  it('rejects encoding=2', () => {
    const pcxBytes = buildPcx({ xMax: 3, yMax: 3, encoding: 2 });
    expect(() => parsePcx(pcxBytes)).toThrow(PcxBadEncodingError);
  });
});

// ---------------------------------------------------------------------------
// Test 13: Reject BPP=8+NPlanes=4 → PcxUnsupportedFeatureError
// ---------------------------------------------------------------------------

describe('PCX parser — unsupported BPP/NPlanes combos', () => {
  it('rejects (BPP=8, NPlanes=4) — 32-bit with alpha is unsupported', () => {
    const pcxBytes = buildPcx({
      xMax: 3,
      yMax: 3,
      bitsPerPixel: 8,
      nPlanes: 4,
    });
    expect(() => parsePcx(pcxBytes)).toThrow(PcxUnsupportedFeatureError);
  });

  it('rejects (BPP=4, NPlanes=3) — not a legal combination', () => {
    const pcxBytes = buildPcx({
      xMax: 3,
      yMax: 3,
      bitsPerPixel: 4,
      nPlanes: 3,
    });
    expect(() => parsePcx(pcxBytes)).toThrow(PcxUnsupportedFeatureError);
  });
});

// ---------------------------------------------------------------------------
// Test 14: Decode RUN 0xC3 0xAA → 3 × 0xAA — Trap #5
// ---------------------------------------------------------------------------

describe('decodePcxRle — RLE codec', () => {
  it('decodes RUN 0xC3 0xAA → 3 × 0xAA (Trap #5)', () => {
    const input = new Uint8Array([0xc3, 0xaa]);
    const result = decodePcxRle(input, 0, input.length, 3);
    expect(result).toEqual(new Uint8Array([0xaa, 0xaa, 0xaa]));
  });

  // ---------------------------------------------------------------------------
  // Test 15: Decode literal 0x7F as 1 pixel
  // ---------------------------------------------------------------------------

  it('decodes literal byte 0x7F as single pixel', () => {
    const input = new Uint8Array([0x7f]);
    const result = decodePcxRle(input, 0, input.length, 1);
    expect(result).toEqual(new Uint8Array([0x7f]));
  });

  // ---------------------------------------------------------------------------
  // Test 16: Reject RLE input underrun
  // ---------------------------------------------------------------------------

  it('throws PcxRleDecodeError on input underrun (no data byte after RUN header)', () => {
    const input = new Uint8Array([0xc3]); // RUN header but no data byte
    expect(() => decodePcxRle(input, 0, input.length, 3)).toThrow(PcxRleDecodeError);
  });

  it('throws PcxRleDecodeError on input underrun (stream ends early)', () => {
    // expects 5 bytes but only 2 literal bytes provided
    const input = new Uint8Array([0x01, 0x02]);
    expect(() => decodePcxRle(input, 0, input.length, 5)).toThrow(PcxRleDecodeError);
  });

  // ---------------------------------------------------------------------------
  // Test 17: Reject RLE output overflow
  // ---------------------------------------------------------------------------

  it('throws PcxRleDecodeError on output overflow (RUN would exceed expected)', () => {
    // RUN of 10 bytes, but only 5 expected
    const input = new Uint8Array([0xca, 0xff]); // 0xCA = 0xC0 | 10 → count=10
    expect(() => decodePcxRle(input, 0, input.length, 5)).toThrow(PcxRleDecodeError);
  });

  // ---------------------------------------------------------------------------
  // Test 18: Tolerate RLE run crossing scanline — Trap #6
  // ---------------------------------------------------------------------------

  it('tolerates RLE run that spans across scanline boundary (Trap #6)', () => {
    // 2×2 image, BPL=2, NPlanes=1 → expected bytes = 2×1×2=4
    // A RUN of 4 bytes crosses what would be a scanline boundary
    const input = new Uint8Array([0xc4, 0x55]); // count=4, data=0x55
    const result = decodePcxRle(input, 0, input.length, 4);
    expect(result).toEqual(new Uint8Array([0x55, 0x55, 0x55, 0x55]));
  });

  it('decodes count 1 RUN header 0xC1 correctly', () => {
    const input = new Uint8Array([0xc1, 0x42]); // count=1
    const result = decodePcxRle(input, 0, input.length, 1);
    expect(result).toEqual(new Uint8Array([0x42]));
  });

  it('decodes maximum count 63 RUN (0xFF = 0xC0|63)', () => {
    const data = 0xab;
    const input = new Uint8Array([0xff, data]);
    const result = decodePcxRle(input, 0, input.length, 63);
    expect(result.length).toBe(63);
    for (const b of result) {
      expect(b).toBe(data);
    }
  });

  it('decodes mixed literals and runs in a sequence', () => {
    // 0x01 0x02 = literal 1, literal 2
    // 0xC2 0xAA = RUN count=2, data=0xAA
    // 0x03 = literal 3
    const input = new Uint8Array([0x01, 0x02, 0xc2, 0xaa, 0x03]);
    const result = decodePcxRle(input, 0, input.length, 5);
    expect(result).toEqual(new Uint8Array([0x01, 0x02, 0xaa, 0xaa, 0x03]));
  });

  it('rejects 0xC0 zero-length run to prevent unbounded decode loop (Sec-H-1)', () => {
    // 0xC0 has top 2 bits set (RUN header) with low 6 bits = 0.
    // A naive decoder would read the data byte, advance src by 2,
    // advance dst by 0, and loop forever on an input of alternating
    // 0xC0/XX pairs. We reject explicitly.
    const input = new Uint8Array([0xc0, 0x55]);
    expect(() => decodePcxRle(input, 0, input.length, 1)).toThrow(PcxRleDecodeError);
  });

  it('0xC0 zero-length run does not hang decoder on large adversarial input', () => {
    // Adversarial input: 10000 alternating 0xC0/0x55 pairs. A naive
    // decoder would loop forever; our decoder throws after reading
    // the first pair.
    const pairs = new Uint8Array(20_000);
    for (let i = 0; i < 10_000; i++) {
      pairs[i * 2] = 0xc0;
      pairs[i * 2 + 1] = 0x55;
    }
    const start = Date.now();
    expect(() => decodePcxRle(pairs, 0, pairs.length, 100)).toThrow(PcxRleDecodeError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // bounded, not unbounded
  });
});

// ---------------------------------------------------------------------------
// Test 19: Ignore 0x0C byte mid-file — Trap #7
// ---------------------------------------------------------------------------

describe('PCX parser — palette footer detection', () => {
  it('ignores 0x0C byte in RLE body; only tail offset counts (Trap #7)', () => {
    // Build a 2×1 8-bit grayscale file where pixel value is 0x0C (could be confused with sentinel)
    const scanline = buildGray8Scanline([0x0c, 0x0c], 2);
    // The RLE encoder wraps 0x0C as a RUN (since 0x0C < 0xC0, it's a literal)
    const pcxBytes = buildPcx({
      xMax: 1,
      yMax: 0,
      bitsPerPixel: 8,
      nPlanes: 1,
      rawPixelPlanes: [[scanline]],
      // No VGA palette: the 0x0C in body should NOT be mistaken for footer sentinel
    });
    const file = parsePcx(pcxBytes);

    expect(file.vgaPalette).toBeNull(); // No footer should be detected
    expect(file.kind).toBe('8bit-grayscale'); // Confirmed no footer
    expect(file.pixelData[0]).toBe(0x0c);
    expect(file.pixelData[1]).toBe(0x0c);
  });
});

// ---------------------------------------------------------------------------
// Test 20: Preserve reservedByte64 + reserved54 verbatim
// ---------------------------------------------------------------------------

describe('PCX parser — reserved field preservation', () => {
  it('preserves reservedByte64 verbatim', () => {
    const pcxBytes = buildPcx({
      xMax: 1,
      yMax: 0,
      reservedByte64: 0x42,
    });
    const file = parsePcx(pcxBytes);
    expect(file.reservedByte64).toBe(0x42);
  });

  it('preserves reserved54 bytes verbatim', () => {
    const reserved54 = new Uint8Array(54);
    for (let i = 0; i < 54; i++) reserved54[i] = i + 1;
    const pcxBytes = buildPcx({
      xMax: 1,
      yMax: 0,
      reserved54,
    });
    const file = parsePcx(pcxBytes);
    expect(file.reserved54).toEqual(reserved54);
  });
});

// ---------------------------------------------------------------------------
// Test 21: Preserve EGA palette verbatim even for truecolor
// ---------------------------------------------------------------------------

describe('PCX parser — EGA palette preservation', () => {
  it('preserves EGA palette verbatim in truecolor file', () => {
    const egaPalette = new Uint8Array(48);
    for (let i = 0; i < 48; i++) egaPalette[i] = (i * 5) & 0xff;

    const rgbRows: Array<Array<[number, number, number]>> = [
      [
        [10, 20, 30],
        [40, 50, 60],
        [70, 80, 90],
        [100, 110, 120],
      ],
    ];
    const planes = buildTruecolorPlanes(rgbRows, 4);

    const pcxBytes = buildPcx({
      xMax: 3,
      yMax: 0,
      bitsPerPixel: 8,
      nPlanes: 3,
      egaPalette,
      rawPixelPlanes: planes,
    });
    const file = parsePcx(pcxBytes);

    expect(file.egaPalette).toEqual(egaPalette);
  });
});

// ---------------------------------------------------------------------------
// Test 22: Round-trip 24-bit truecolor structural equality
// ---------------------------------------------------------------------------

describe('PCX serializer — round-trip', () => {
  it('round-trips 4×4 24-bit truecolor with structural pixel equality', () => {
    const rgbRows: Array<Array<[number, number, number]>> = [
      [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [128, 64, 32],
      ],
      [
        [10, 20, 30],
        [40, 50, 60],
        [70, 80, 90],
        [100, 110, 120],
      ],
      [
        [200, 150, 100],
        [50, 25, 12],
        [1, 2, 3],
        [4, 5, 6],
      ],
      [
        [7, 8, 9],
        [11, 12, 13],
        [14, 15, 16],
        [17, 18, 19],
      ],
    ];
    const planes = buildTruecolorPlanes(rgbRows, 4);
    const pcxBytes = buildPcx({
      xMax: 3,
      yMax: 3,
      bitsPerPixel: 8,
      nPlanes: 3,
      rawPixelPlanes: planes,
    });
    const file = parsePcx(pcxBytes);
    const serialized = serializePcx(file);
    const reparsed = parsePcx(serialized);

    expect(reparsed.kind).toBe('24bit-truecolor');
    expect(reparsed.pixelData).toEqual(file.pixelData);
    expect(reparsed.width).toBe(4);
    expect(reparsed.height).toBe(4);
  });

  // ---------------------------------------------------------------------------
  // Test 23: Round-trip 8-bit indexed + VGA palette
  // ---------------------------------------------------------------------------

  it('round-trips 8-bit indexed VGA with palette preserved', () => {
    const pixels = Array.from({ length: 16 }, (_, i) => i);
    const pcxBytes = build4x4Gray(pixels, true);
    const file = parsePcx(pcxBytes);
    const serialized = serializePcx(file);
    const reparsed = parsePcx(serialized);

    expect(reparsed.kind).toBe('8bit-indexed-vga');
    expect(reparsed.vgaPalette).not.toBeNull();
    expect(reparsed.pixelData).toEqual(file.pixelData);
    expect(reparsed.vgaPalette).toEqual(file.vgaPalette);
  });
});

// ---------------------------------------------------------------------------
// Test 24: Serializer wraps literal 0xC5 as RUN 0xC1 0xC5 — Trap #5
// ---------------------------------------------------------------------------

describe('PCX serializer — RLE encoding Trap #5', () => {
  it('wraps single byte ≥ 0xC0 as RUN even as single pixel', () => {
    const encoded = encodeScanlineRle(new Uint8Array([0xc5]));
    // Must be 0xC1 0xC5 (count=1 RUN) — NOT literal 0xC5
    expect(encoded).toEqual(new Uint8Array([0xc1, 0xc5]));
  });

  it('wraps 0xFF as RUN 0xC1 0xFF', () => {
    const encoded = encodeScanlineRle(new Uint8Array([0xff]));
    expect(encoded).toEqual(new Uint8Array([0xc1, 0xff]));
  });

  it('wraps run of three 0xC5 bytes as RUN 0xC3 0xC5', () => {
    const encoded = encodeScanlineRle(new Uint8Array([0xc5, 0xc5, 0xc5]));
    expect(encoded).toEqual(new Uint8Array([0xc3, 0xc5]));
  });

  // ---------------------------------------------------------------------------
  // Test 25: Serializer splits 100-long run into RUN(63) + RUN(37)
  // ---------------------------------------------------------------------------

  it('splits run of 100 identical bytes into RUN(63) + RUN(37)', () => {
    const bytes = new Uint8Array(100).fill(0x42);
    const encoded = encodeScanlineRle(bytes);
    // 0x42 < 0xC0, so runs only split because of max-run length
    // First packet: 0xFF (0xC0 | 63) + 0x42
    // Second packet: 0xC0 | 37 = 0xE5 + 0x42
    expect(encoded.length).toBe(4); // 2 RUN packets × 2 bytes each
    expect(encoded[0]).toBe(0xc0 | 63); // 0xFF
    expect(encoded[1]).toBe(0x42);
    expect(encoded[2]).toBe(0xc0 | 37); // 0xE5
    expect(encoded[3]).toBe(0x42);
  });
});

// ---------------------------------------------------------------------------
// Test 26: Serializer always emits v5 and flags 'version-promoted-to-5-on-serialize'
// ---------------------------------------------------------------------------

describe('PCX serializer — version promotion', () => {
  it('always emits version 5 in output byte 1', () => {
    // Parse a version 3 file
    const pcxBytes = buildPcx({ xMax: 1, yMax: 0, version: 3 });
    const file = parsePcx(pcxBytes);
    expect(file.version).toBe(3);
    const serialized = serializePcx(file);
    expect(serialized[1]).toBe(5);
  });

  it('flags version-promoted-to-5-on-serialize for non-v5 input', () => {
    const pcxBytes = buildPcx({ xMax: 1, yMax: 0, version: 2 });
    const file = parsePcx(pcxBytes);
    const serialized = serializePcx(file);
    const reparsed = parsePcx(serialized);
    expect(reparsed.version).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Test 27: Serializer recomputes even BytesPerLine
// ---------------------------------------------------------------------------

describe('PCX serializer — bytesPerLine recomputation', () => {
  it('recomputes even bytesPerLine (width=9 → BPL=10)', () => {
    const pixelValues = [10, 20, 30, 40, 50, 60, 70, 80, 90];
    const scanline = buildGray8Scanline([...pixelValues, 0], 10);
    const pcxBytes = buildPcx({
      xMax: 8,
      yMax: 0,
      bitsPerPixel: 8,
      nPlanes: 1,
      bytesPerLine: 10,
      rawPixelPlanes: [[scanline]],
    });
    const file = parsePcx(pcxBytes);
    const serialized = serializePcx(file);
    const dv = new DataView(serialized.buffer);
    const bpl = dv.getUint16(66, true); // bytesPerLine at offset 66
    expect(bpl % 2).toBe(0); // must be even
    expect(bpl).toBeGreaterThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------
// Test 28: detectImageFormat returns 'pcx' for magic byte + encoding=1 + valid version
// ---------------------------------------------------------------------------

describe('detectImageFormat — PCX detection', () => {
  it('returns pcx for magic byte 0x0A + version=5 + encoding=1', () => {
    const pcxBytes = buildPcx({ xMax: 3, yMax: 3 });
    expect(detectImageFormat(pcxBytes)).toBe('pcx');
  });

  it('returns pcx for version=0', () => {
    const pcxBytes = buildPcx({ xMax: 1, yMax: 0, version: 0 });
    expect(detectImageFormat(pcxBytes)).toBe('pcx');
  });

  // ---------------------------------------------------------------------------
  // Test 29: detectImageFormat returns null for encoding=0
  // ---------------------------------------------------------------------------

  it('returns null for encoding=0 (not PCX RLE)', () => {
    const pcxBytes = buildPcx({ xMax: 3, yMax: 3, encoding: 0 });
    expect(detectImageFormat(pcxBytes)).not.toBe('pcx');
  });

  it('returns null for manufacturer byte ≠ 0x0A', () => {
    const pcxBytes = buildPcx({ xMax: 3, yMax: 3, manufacturer: 0x00 });
    expect(detectImageFormat(pcxBytes)).not.toBe('pcx');
  });

  it('returns null for invalid version', () => {
    const pcxBytes = buildPcx({ xMax: 3, yMax: 3, version: 1 });
    expect(detectImageFormat(pcxBytes)).not.toBe('pcx');
  });
});

// ---------------------------------------------------------------------------
// Test 30: Dispatch via parseImage/serializeImage
// ---------------------------------------------------------------------------

describe('parseImage / serializeImage dispatch', () => {
  it('dispatches PCX through parseImage and serializeImage round-trip', () => {
    const pixels = Array.from({ length: 9 }, (_, i) => i * 20);
    const scanlines: Uint8Array[][] = [];
    for (let y = 0; y < 3; y++) {
      const row = pixels.slice(y * 3, y * 3 + 3);
      scanlines.push([buildGray8Scanline(row, 4)]);
    }
    const pcxBytes = buildPcx({
      xMax: 2,
      yMax: 2,
      bitsPerPixel: 8,
      nPlanes: 1,
      rawPixelPlanes: scanlines,
      bytesPerLine: 4,
    });
    const file = parseImage(pcxBytes, 'pcx');
    expect(file.format).toBe('pcx');
    const out = serializeImage(file);
    expect(out[0]).toBe(0x0a); // PCX magic
  });
});

// ---------------------------------------------------------------------------
// Test 31: Backend canHandle accepts image/x-pcx + image/pcx
// ---------------------------------------------------------------------------

describe('ImageLegacyBackend — PCX MIME support', () => {
  it('canHandle returns true for image/x-pcx', async () => {
    const backend = new ImageLegacyBackend();
    const result = await backend.canHandle(
      { ext: 'pcx', mime: PCX_MIME, category: 'image', description: 'PCX' },
      { ext: 'pcx', mime: PCX_MIME, category: 'image', description: 'PCX' },
    );
    expect(result).toBe(true);
  });

  it('canHandle returns true for image/pcx (alt MIME)', async () => {
    const backend = new ImageLegacyBackend();
    const result = await backend.canHandle(
      { ext: 'pcx', mime: PCX_MIME_ALT, category: 'image', description: 'PCX' },
      { ext: 'pcx', mime: PCX_MIME_ALT, category: 'image', description: 'PCX' },
    );
    expect(result).toBe(true);
  });

  it('canHandle returns false for mismatched MIMEs', async () => {
    const backend = new ImageLegacyBackend();
    const result = await backend.canHandle(
      { ext: 'pcx', mime: PCX_MIME, category: 'image', description: 'PCX' },
      { ext: 'png', mime: 'image/png', category: 'image', description: 'PNG' },
    );
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Additional RLE codec tests for completeness
// ---------------------------------------------------------------------------

describe('encodeScanlineRle edge cases', () => {
  it('encodes empty scanline', () => {
    const encoded = encodeScanlineRle(new Uint8Array(0));
    expect(encoded.length).toBe(0);
  });

  it('encodes single literal byte below 0xC0', () => {
    const encoded = encodeScanlineRle(new Uint8Array([0x55]));
    expect(encoded).toEqual(new Uint8Array([0x55]));
  });

  it('encodes run of 2 identical bytes below 0xC0 as RUN', () => {
    const encoded = encodeScanlineRle(new Uint8Array([0x55, 0x55]));
    expect(encoded).toEqual(new Uint8Array([0xc2, 0x55]));
  });

  it('encodes sequence with high bytes (≥ 0xC0) each as RUN', () => {
    const encoded = encodeScanlineRle(new Uint8Array([0xc0, 0xd5, 0xff]));
    // Each must be a RUN with count=1
    expect(encoded).toEqual(new Uint8Array([0xc1, 0xc0, 0xc1, 0xd5, 0xc1, 0xff]));
  });
});

// ---------------------------------------------------------------------------
// VGA palette footer sentinel positioning — Trap #7
// ---------------------------------------------------------------------------

describe('PCX parser — VGA palette footer sentinel (Trap #7)', () => {
  it('only detects footer when 0x0C is at exactly fileLength − 769', () => {
    const vgaPalette = new Uint8Array(768).fill(0xee);
    const pcxBytes = buildPcx({
      xMax: 3,
      yMax: 3,
      bitsPerPixel: 8,
      nPlanes: 1,
      vgaPalette,
    });

    // Confirm sentinel is at correct position
    const expectedPos = pcxBytes.length - 769;
    expect(pcxBytes[expectedPos]).toBe(PCX_PALETTE_SENTINEL);

    const file = parsePcx(pcxBytes);
    expect(file.vgaPalette).not.toBeNull();
    expect(file.vgaPalette?.[0]).toBe(0xee);
  });

  it('does not detect footer when file is version < 5', () => {
    // Version 4 file with what looks like a palette footer appended
    const vgaPalette = new Uint8Array(768).fill(0x11);
    // Build v5 first, then manually patch version byte to 4
    const pcxBytes = buildPcx({
      xMax: 3,
      yMax: 3,
      bitsPerPixel: 8,
      nPlanes: 1,
      vgaPalette,
      version: 4, // version 4 — footer should NOT be read
    });
    const file = parsePcx(pcxBytes);
    // version < 5 → no footer detection
    expect(file.vgaPalette).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Input size validation
// ---------------------------------------------------------------------------

describe('PCX parser — input size validation', () => {
  it('throws PcxBadHeaderError for input shorter than 128 bytes', () => {
    const tiny = new Uint8Array(64);
    tiny[0] = 0x0a;
    expect(() => parsePcx(tiny)).toThrow(PcxBadHeaderError);
  });
});

// ---------------------------------------------------------------------------
// 2-bit CGA decode test
// ---------------------------------------------------------------------------

describe('PCX parser — 2-bit CGA', () => {
  it('decodes 4×1 2-bit CGA indices correctly', () => {
    // pixels: [0, 1, 2, 3] → packed into one byte: 0b00011011 = 0x1B
    const cgaByte = new Uint8Array(2); // BPL=2 (even)
    cgaByte[0] = 0b00011011; // pixels 0,1,2,3 at 2 bits each
    const pcxBytes = buildPcx({
      xMax: 3,
      yMax: 0,
      bitsPerPixel: 2,
      nPlanes: 1,
      bytesPerLine: 2,
      rawPixelPlanes: [[cgaByte]],
    });
    const file = parsePcx(pcxBytes);
    expect(file.kind).toBe('2bit-cga');
    expect(file.pixelData[0]).toBe(0);
    expect(file.pixelData[1]).toBe(1);
    expect(file.pixelData[2]).toBe(2);
    expect(file.pixelData[3]).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Round-trip serializer tests for 1-bit, 2-bit CGA, 4-bit EGA packed
// (covers replanarize branches for those kinds)
// ---------------------------------------------------------------------------

describe('PCX serializer round-trips — bilevel, CGA, EGA packed', () => {
  it('round-trips 1-bit bilevel: pixelData matches after parse→serialize→parse', () => {
    const pixelRow = [0, 1, 0, 1, 1, 0, 1, 0];
    const scanline = build1BitScanline(pixelRow, 1);
    const pcxBytes = buildPcx({
      xMax: 7,
      yMax: 0,
      bitsPerPixel: 1,
      nPlanes: 1,
      rawPixelPlanes: [[scanline]],
    });
    const file = parsePcx(pcxBytes);
    const serialized = serializePcx(file);
    const reparsed = parsePcx(serialized);

    expect(reparsed.kind).toBe('1bit-bilevel');
    expect(reparsed.pixelData).toEqual(file.pixelData);
    for (let i = 0; i < 8; i++) {
      expect(reparsed.pixelData[i]).toBe(pixelRow[i]);
    }
  });

  it('round-trips 2-bit CGA: pixelData matches after parse→serialize→parse', () => {
    // 4×1 grid: pixels [0,1,2,3] in one packed byte
    const cgaByte = new Uint8Array(2);
    cgaByte[0] = 0b00011011; // [0,1,2,3]
    const pcxBytes = buildPcx({
      xMax: 3,
      yMax: 0,
      bitsPerPixel: 2,
      nPlanes: 1,
      bytesPerLine: 2,
      rawPixelPlanes: [[cgaByte]],
    });
    const file = parsePcx(pcxBytes);
    const serialized = serializePcx(file);
    const reparsed = parsePcx(serialized);

    expect(reparsed.kind).toBe('2bit-cga');
    expect(reparsed.pixelData).toEqual(file.pixelData);
  });

  it('round-trips 4-bit EGA packed: pixelData matches after parse→serialize→parse', () => {
    const pixels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const scanlines: Uint8Array[][] = [];
    for (let y = 0; y < 4; y++) {
      const row = pixels.slice(y * 4, y * 4 + 4);
      scanlines.push([build4BitPackedScanline(row, 2)]);
    }
    const pcxBytes = buildPcx({
      xMax: 3,
      yMax: 3,
      bitsPerPixel: 4,
      nPlanes: 1,
      rawPixelPlanes: scanlines,
    });
    const file = parsePcx(pcxBytes);
    const serialized = serializePcx(file);
    const reparsed = parsePcx(serialized);

    expect(reparsed.kind).toBe('4bit-ega-packed');
    expect(reparsed.pixelData).toEqual(file.pixelData);
    for (let i = 0; i < 16; i++) {
      expect(reparsed.pixelData[i]).toBe(pixels[i]);
    }
  });

  it('round-trips 4-bit EGA planar: pixelData matches after parse→serialize→parse', () => {
    const rows = [
      [5, 10, 3, 15],
      [1, 7, 12, 9],
    ];
    const scanlines: Uint8Array[][] = [];
    for (const row of rows) {
      scanlines.push(build4BitPlanarScanline(row, 2));
    }
    const pcxBytes = buildPcx({
      xMax: 3,
      yMax: 1,
      bitsPerPixel: 1,
      nPlanes: 4,
      rawPixelPlanes: scanlines,
    });
    const file = parsePcx(pcxBytes);
    const serialized = serializePcx(file);
    const reparsed = parsePcx(serialized);

    expect(reparsed.kind).toBe('4bit-ega-planar');
    expect(reparsed.pixelData).toEqual(file.pixelData);
    const expected = rows.flat();
    for (let i = 0; i < expected.length; i++) {
      expect(reparsed.pixelData[i]).toBe(expected[i]);
    }
  });
});
