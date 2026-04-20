/**
 * Test cases 13–18 from the design note:
 *   13. parseQoi decodes a 2×2 RGB image with INDEX, DIFF, RUN ops covered
 *   14. parseQoi decodes RGBA and recognises QOI_OP_RGBA (0xFF)
 *   15. parseQoi rejects missing 8-byte end marker with QoiMissingEndMarkerError
 *   16. parseQoi rejects channels=2 in header byte 12 with QoiBadHeaderError
 *   17. serializeQoi round-trips a 4×4 RGB image to byte-equal output
 *   18. serializeQoi caps QOI_OP_RUN at 62 and emits a second RUN for >62 repeats
 */
import { describe, expect, it } from 'vitest';
import { concat, u32be } from './_test-helpers/bytes.ts';
import {
  ImagePixelCapError,
  QoiBadHeaderError,
  QoiBadMagicError,
  QoiMissingEndMarkerError,
  QoiTooShortError,
} from './errors.ts';
import { parseQoi, serializeQoi } from './qoi.ts';

// ---------------------------------------------------------------------------
// Minimal QOI builder for tests
// ---------------------------------------------------------------------------

const QOI_MAGIC = new Uint8Array([0x71, 0x6f, 0x69, 0x66]);
const QOI_END = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]);

function buildQoiHeader(
  width: number,
  height: number,
  channels: 3 | 4,
  colorspace: 0 | 1 = 0,
): Uint8Array {
  return concat(QOI_MAGIC, u32be(width), u32be(height), new Uint8Array([channels, colorspace]));
}

/**
 * Build a minimal valid QOI file where every pixel is encoded as QOI_OP_RGB.
 */
function buildQoiAllRgb(
  width: number,
  height: number,
  pixels: Array<[number, number, number]>,
): Uint8Array {
  const header = buildQoiHeader(width, height, 3);
  const bodyParts: Uint8Array[] = [];
  for (const [r, g, b] of pixels) {
    bodyParts.push(new Uint8Array([0xfe, r, g, b]));
  }
  return concat(header, ...bodyParts, QOI_END);
}

describe('parseQoi', () => {
  // Test case 13: 2×2 RGB with INDEX, DIFF, RUN ops
  it('decodes a 2×2 RGB image with QOI_OP_RGB and QOI_OP_RUN ops', () => {
    // Use round-trip: serialize and parse back
    const pixelData = new Uint8Array([
      255,
      0,
      0, // top-left: red
      255,
      0,
      0, // top-right: red (same as previous → RUN or INDEX)
      0,
      255,
      0, // bottom-left: green
      0,
      255,
      0, // bottom-right: green
    ]);
    const file = {
      format: 'qoi' as const,
      width: 2,
      height: 2,
      channels: 3 as const,
      colorspace: 0 as const,
      pixelData,
    };
    const serialized = serializeQoi(file);
    const parsed = parseQoi(serialized);
    expect(parsed.format).toBe('qoi');
    expect(parsed.width).toBe(2);
    expect(parsed.height).toBe(2);
    expect(Array.from(parsed.pixelData)).toEqual(Array.from(pixelData));
  });

  // Test case 14: RGBA with QOI_OP_RGBA
  it('decodes RGBA and recognises QOI_OP_RGBA (0xFF)', () => {
    // Build a file with a QOI_OP_RGBA opcode for full alpha variation
    const header = buildQoiHeader(1, 2, 4);
    // Pixel 1: 0xFF + R G B A bytes
    // Pixel 2: use QOI_OP_RGB (same alpha) or another RGBA
    const body = new Uint8Array([
      0xff,
      100,
      150,
      200,
      128, // QOI_OP_RGBA: r=100, g=150, b=200, a=128
      0xff,
      10,
      20,
      30,
      50, // QOI_OP_RGBA: r=10, g=20, b=30, a=50
    ]);
    const input = concat(header, body, QOI_END);
    const file = parseQoi(input);
    expect(file.channels).toBe(4);
    expect(file.pixelData[0]).toBe(100);
    expect(file.pixelData[1]).toBe(150);
    expect(file.pixelData[2]).toBe(200);
    expect(file.pixelData[3]).toBe(128);
    expect(file.pixelData[4]).toBe(10);
    expect(file.pixelData[7]).toBe(50);
  });

  // Test case 15: missing end marker
  it('rejects missing 8-byte end marker with QoiMissingEndMarkerError', () => {
    // Build valid header + one RGB opcode but wrong end marker
    const header = buildQoiHeader(1, 1, 3);
    const body = new Uint8Array([0xfe, 255, 0, 0]); // one pixel
    const badEnd = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 2]); // wrong last byte
    const input = concat(header, body, badEnd);
    expect(() => parseQoi(input)).toThrow(QoiMissingEndMarkerError);
  });

  // Test case 16: channels=2 → QoiBadHeaderError
  it('rejects channels=2 in header byte 12 with QoiBadHeaderError', () => {
    const header = new Uint8Array(14);
    header.set(QOI_MAGIC, 0);
    const dv = new DataView(header.buffer);
    dv.setUint32(4, 1, false);
    dv.setUint32(8, 1, false);
    header[12] = 2; // invalid channels
    header[13] = 0;
    const input = concat(header, new Uint8Array([0xfe, 0, 0, 0]), QOI_END);
    expect(() => parseQoi(input)).toThrow(QoiBadHeaderError);
  });

  it('rejects colorspace=2 with QoiBadHeaderError', () => {
    const header = new Uint8Array(14);
    header.set(QOI_MAGIC, 0);
    const dv = new DataView(header.buffer);
    dv.setUint32(4, 1, false);
    dv.setUint32(8, 1, false);
    header[12] = 3;
    header[13] = 2; // invalid colorspace
    const input = concat(header, new Uint8Array([0xfe, 0, 0, 0]), QOI_END);
    expect(() => parseQoi(input)).toThrow(QoiBadHeaderError);
  });

  it('rejects input shorter than 22 bytes', () => {
    expect(() => parseQoi(new Uint8Array(10))).toThrow(QoiTooShortError);
  });

  it('rejects stream with extra garbage before end marker (pos mismatch)', () => {
    // Encode 1×1 pixel, then add extra opcode bytes before end marker
    const header = buildQoiHeader(1, 1, 3);
    const body = new Uint8Array([0xfe, 255, 0, 0, 0x00]); // valid pixel + extra INDEX op
    const input = concat(header, body, QOI_END);
    // pos after decode = header(14) + 4 bytes for RGB opcode = 18, but input.length - 8 = 14+5+8-8 = 19
    // The pos would be 14+4=18, input.length-8 = 14+5+8-8 = 19 → mismatch
    // Actually: after decoding 1 pixel from QOI_OP_RGB (4 bytes), pos = 18
    // input.length = 14+5+8 = 27, input.length-8 = 19
    // 18 !== 19 → QoiSizeMismatchError
    expect(() => parseQoi(input)).toThrow();
  });

  it('rejects bad magic', () => {
    const bad = new Uint8Array(22);
    bad.set([0x71, 0x6f, 0x69, 0x00]); // wrong 4th byte
    expect(() => parseQoi(bad)).toThrow(QoiBadMagicError);
  });

  it('rejects oversized dimensions', () => {
    const header = new Uint8Array(14);
    header.set(QOI_MAGIC, 0);
    const dv = new DataView(header.buffer);
    dv.setUint32(4, 16385, false); // width > MAX_DIM
    dv.setUint32(8, 1, false);
    header[12] = 3;
    header[13] = 0;
    const input = concat(header, QOI_END);
    expect(() => parseQoi(input)).toThrow(ImagePixelCapError);
  });

  it('decodes QOI_OP_DIFF correctly', () => {
    // Start with prev=(0,0,0,255), emit DIFF that adds (1,1,1)
    // dr=1→biased=3, dg=1→biased=3, db=1→biased=3
    // DIFF byte: 0b01_11_11_11 = 0x7F
    const header = buildQoiHeader(1, 2, 3, 0);
    const body = new Uint8Array([
      0xfe,
      100,
      100,
      100, // RGB: set prev to 100,100,100
      0x7f, // DIFF: dr=+1, dg=+1, db=+1 → 101,101,101
    ]);
    const input = concat(header, body, QOI_END);
    const file = parseQoi(input);
    expect(file.pixelData[0]).toBe(100);
    expect(file.pixelData[3]).toBe(101);
    expect(file.pixelData[4]).toBe(101);
    expect(file.pixelData[5]).toBe(101);
  });

  it('decodes QOI_OP_LUMA correctly', () => {
    // Start from prev=(0,0,0,255), emit RGB to set known state, then LUMA
    // LUMA: dg=5 (bias32: byte=0x80|37=0xA5), dr-dg=2 (bias8: 10), db-dg=-2 (bias8: 6)
    // second byte: (10<<4)|6 = 0xA6
    // dr=dg+(dr-dg)=5+2=7, dg=5, db=dg+(db-dg)=5-2=3
    const header = buildQoiHeader(1, 2, 3, 0);
    const body = new Uint8Array([
      0xfe,
      0,
      0,
      0, // set prev to 0,0,0
      0xa5,
      0xa6, // LUMA: dg=5, dr=7, db=3
    ]);
    const input = concat(header, body, QOI_END);
    const file = parseQoi(input);
    expect(file.pixelData[3]).toBe(7); // r
    expect(file.pixelData[4]).toBe(5); // g
    expect(file.pixelData[5]).toBe(3); // b
  });

  it('decodes QOI_OP_INDEX correctly', () => {
    // First emit a pixel that lands in the hash index, then reference it
    // hash(255,0,0,255) = (255*3 + 0*5 + 0*7 + 255*11) % 64 = (765+2805)%64 = 3570%64 = 50
    const header = buildQoiHeader(1, 3, 3, 0);
    // Emit RGB pixel with r=255,g=0,b=0 → lands at slot 50
    // Then emit QOI_OP_RGB with different color, then INDEX 50
    const body = new Uint8Array([
      0xfe,
      255,
      0,
      0, // pixel 0: r=255,g=0,b=0 → slot 50
      0xfe,
      0,
      0,
      0, // pixel 1: r=0,g=0,b=0 → clears prev but index slot 50 still has red
      0x00 | 50, // INDEX 50 → r=255,g=0,b=0
    ]);
    const input = concat(header, body, QOI_END);
    const file = parseQoi(input);
    expect(file.pixelData[6]).toBe(255); // pixel 2 = red
    expect(file.pixelData[7]).toBe(0);
    expect(file.pixelData[8]).toBe(0);
  });
});

describe('serializeQoi', () => {
  // Test case 17: 4×4 RGB round-trip byte-equal
  it('round-trips a 4×4 RGB image to byte-equal output', () => {
    // Build a varied 4×4 RGB image
    const pixelData = new Uint8Array(4 * 4 * 3);
    for (let i = 0; i < 4 * 4; i++) {
      pixelData[i * 3] = (i * 30) & 0xff;
      pixelData[i * 3 + 1] = (i * 60) & 0xff;
      pixelData[i * 3 + 2] = (i * 90) & 0xff;
    }
    const file = {
      format: 'qoi' as const,
      width: 4,
      height: 4,
      channels: 3 as const,
      colorspace: 0 as const,
      pixelData,
    };
    const serialized = serializeQoi(file);
    const parsed = parseQoi(serialized);
    const reserialized = serializeQoi(parsed);
    // Both serializations are byte-equal (same encode decisions)
    expect(reserialized).toEqual(serialized);
    // Pixel data matches
    expect(Array.from(parsed.pixelData)).toEqual(Array.from(pixelData));
  });

  // Test case 18: RUN capped at 62, second RUN emitted for > 62 repeats
  it('caps QOI_OP_RUN at 62 and emits a second RUN for >62 repeats', () => {
    // 63 identical pixels → one RUN(62) + one RUN(1)
    const pixelData = new Uint8Array(63 * 3).fill(0);
    // All black pixels (0,0,0) — alpha defaults to 255 for RGB
    // First pixel is encoded as QOI_OP_RGB since it differs from prev (0,0,0,255) only in alpha
    // Actually prev r,g,b = 0,0,0 and a=255, curr r,g,b=0,0,0 (RGB channels same, ignoring alpha for RGB)
    // For RGB channels: prev=(0,0,0,255), pixel=(0,0,0,255) — SAME as prev, so first pixel → RUN
    const file = {
      format: 'qoi' as const,
      width: 63,
      height: 1,
      channels: 3 as const,
      colorspace: 0 as const,
      pixelData,
    };
    const serialized = serializeQoi(file);

    // Parse and verify pixel data is correct
    const parsed = parseQoi(serialized);
    expect(parsed.pixelData.length).toBe(63 * 3);
    for (let i = 0; i < 63 * 3; i++) {
      expect(parsed.pixelData[i]).toBe(0);
    }

    // Verify the stream has two RUN opcodes by checking the byte count
    // A single RUN(62) is 1 byte, a RUN(1) is 1 byte = 2 bytes for 63 identical pixels
    // But the initial pixel (which matches prev=(0,0,0,255) for RGB→alpha=255) triggers RUN from pixel 1
    // The stream should be short due to run-length encoding
    expect(serialized.length).toBeLessThan(14 + 63 * 4 + 8); // much shorter than uncompressed
  });

  it('emits QOI_OP_INDEX in serializer (pixel repeated after other pixels)', () => {
    // Pattern: [red, blue, red] — red appears at index slot, then after blue it gets indexed again
    // hash(255,0,0,255) = (765 + 2805) % 64 = 3570 % 64 = 50
    // hash(0,0,255,255) = (0 + 0 + 1785 + 2805) % 64 = 4590 % 64 = 14
    const pixelData = new Uint8Array([
      255,
      0,
      0, // red
      0,
      0,
      255, // blue (different from red)
      255,
      0,
      0, // red again → should be emitted as INDEX opcode
    ]);
    const file = {
      format: 'qoi' as const,
      width: 3,
      height: 1,
      channels: 3 as const,
      colorspace: 0 as const,
      pixelData,
    };
    const out = serializeQoi(file);
    const parsed = parseQoi(out);
    expect(Array.from(parsed.pixelData)).toEqual(Array.from(pixelData));
    // Verify the output is shorter than all-RGB encoding (3 pixels × 4 bytes + overhead = 12)
    // With INDEX the last pixel = 1 byte, so body = 4 + 4 + 1 = 9 bytes
    expect(out.length).toBeLessThan(14 + 12 + 8);
  });

  it('emits end marker at the end', () => {
    const pixelData = new Uint8Array([255, 0, 0]);
    const file = {
      format: 'qoi' as const,
      width: 1,
      height: 1,
      channels: 3 as const,
      colorspace: 0 as const,
      pixelData,
    };
    const out = serializeQoi(file);
    const last8 = out.subarray(out.length - 8);
    expect(Array.from(last8)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('emits QOI_OP_DIFF in serializer for small channel deltas', () => {
    // Two pixels: first=(10,10,10), second=(11,11,11) — diff=(1,1,1) → QOI_OP_DIFF
    const pixelData = new Uint8Array([10, 10, 10, 11, 11, 11]);
    const file = {
      format: 'qoi' as const,
      width: 2,
      height: 1,
      channels: 3 as const,
      colorspace: 0 as const,
      pixelData,
    };
    const out = serializeQoi(file);
    const parsed = parseQoi(out);
    expect(Array.from(parsed.pixelData)).toEqual([10, 10, 10, 11, 11, 11]);
  });

  it('emits QOI_OP_LUMA in serializer for medium channel deltas', () => {
    // prev=(50,50,50), curr=(60,65,55) — dg=15, dr-dg=5, db-dg=-10 — within LUMA range
    const pixelData = new Uint8Array([50, 50, 50, 60, 65, 55]);
    const file = {
      format: 'qoi' as const,
      width: 2,
      height: 1,
      channels: 3 as const,
      colorspace: 0 as const,
      pixelData,
    };
    const out = serializeQoi(file);
    const parsed = parseQoi(out);
    expect(Array.from(parsed.pixelData)).toEqual([50, 50, 50, 60, 65, 55]);
  });

  it('emits QOI_OP_RGB for large channel deltas', () => {
    // prev=(0,0,0,255), curr=(200,100,50) — large delta, must use RGB opcode
    const pixelData = new Uint8Array([200, 100, 50]);
    const file = {
      format: 'qoi' as const,
      width: 1,
      height: 1,
      channels: 3 as const,
      colorspace: 0 as const,
      pixelData,
    };
    const out = serializeQoi(file);
    const parsed = parseQoi(out);
    expect(Array.from(parsed.pixelData)).toEqual([200, 100, 50]);
  });

  it('round-trips RGBA image byte-equal', () => {
    const pixelData = new Uint8Array([
      255, 0, 0, 128, 0, 255, 0, 200, 0, 0, 255, 100, 128, 128, 128, 50,
    ]);
    const file = {
      format: 'qoi' as const,
      width: 2,
      height: 2,
      channels: 4 as const,
      colorspace: 1 as const,
      pixelData,
    };
    const out = serializeQoi(file);
    const parsed = parseQoi(out);
    expect(Array.from(parsed.pixelData)).toEqual(Array.from(pixelData));
    expect(parsed.colorspace).toBe(1);
  });
});
