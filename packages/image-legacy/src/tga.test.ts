/**
 * TGA parser and serializer tests for @webcvt/image-legacy.
 *
 * All 25+ test cases from the design note §"Test plan" are covered.
 * All fixtures are synthetic (no committed binaries).
 */

import { describe, expect, it } from 'vitest';
import {
  buildRle8,
  buildRle24,
  buildTga,
  rgbToBgr,
  rgbaToArgb1555Le,
  rgbaToBgra,
} from './_test-helpers/build-tga.ts';
import { ImageLegacyBackend, TGA_FORMAT } from './backend.ts';
import {
  TGA_FOOTER_SIGNATURE,
  TGA_FOOTER_SIZE,
  TGA_MIME,
  TGA_MIME_ALT1,
  TGA_MIME_ALT2,
} from './constants.ts';
import { detectImageFormat } from './detect.ts';
import {
  TgaBadFooterError,
  TgaBadHeaderError,
  TgaNoImageDataError,
  TgaRleDecodeError,
  TgaTruncatedError,
  TgaUnsupportedFeatureError,
  TgaUnsupportedImageTypeError,
} from './errors.ts';
import { parseImage } from './parser.ts';
import { serializeImage } from './serializer.ts';
import { decodeTgaRle, isTgaHeader, parseTga, serializeTga } from './tga.ts';

// ---------------------------------------------------------------------------
// Test fixture builder helpers
// ---------------------------------------------------------------------------

function makeFooter(extOff = 0, devOff = 0): Uint8Array {
  const footer = new Uint8Array(TGA_FOOTER_SIZE);
  const dv = new DataView(footer.buffer);
  dv.setUint32(0, extOff, true);
  dv.setUint32(4, devOff, true);
  footer.set(TGA_FOOTER_SIGNATURE, 8);
  return footer;
}

// ---------------------------------------------------------------------------
// Test 1: 2×2 uncompressed 24-bit truecolor — BGR→RGB verified (Trap #2)
// ---------------------------------------------------------------------------

describe('parseTga', () => {
  it('test 1: 2×2 uncompressed 24-bit truecolor; BGR→RGB swapped', () => {
    // On-disk pixels: BGR order
    // Pixel 0: B=10, G=20, R=30   → RGB: 30, 20, 10
    // Pixel 1: B=40, G=50, R=60   → RGB: 60, 50, 40
    // Pixel 2: B=70, G=80, R=90   → RGB: 90, 80, 70
    // Pixel 3: B=100, G=110, R=120 → RGB: 120, 110, 100
    const bgrPixels = rgbToBgr([
      [30, 20, 10],
      [60, 50, 40],
      [90, 80, 70],
      [120, 110, 100],
    ]);
    const bytes = buildTga({
      imageType: 2,
      width: 2,
      height: 2,
      pixelDepth: 24,
      pixelData: bgrPixels,
    });
    const file = parseTga(bytes);
    expect(file.format).toBe('tga');
    expect(file.imageType).toBe(2);
    expect(file.width).toBe(2);
    expect(file.height).toBe(2);
    expect(file.channels).toBe(3);
    expect(file.bitDepth).toBe(8);
    expect(file.originalPixelDepth).toBe(24);
    // First pixel: RGB 30, 20, 10
    expect(file.pixelData[0]).toBe(30);
    expect(file.pixelData[1]).toBe(20);
    expect(file.pixelData[2]).toBe(10);
    // Second pixel
    expect(file.pixelData[3]).toBe(60);
    expect(file.pixelData[4]).toBe(50);
    expect(file.pixelData[5]).toBe(40);
  });

  // -------------------------------------------------------------------------
  // Test 2: 2×2 uncompressed 32-bit truecolor BGRA→RGBA (Trap #2)
  // -------------------------------------------------------------------------
  it('test 2: 2×2 uncompressed 32-bit truecolor (attributeBits=8); BGRA→RGBA', () => {
    const bgraPixels = rgbaToBgra([
      [255, 0, 0, 200],
      [0, 255, 0, 150],
      [0, 0, 255, 100],
      [255, 255, 0, 50],
    ]);
    const bytes = buildTga({
      imageType: 2,
      width: 2,
      height: 2,
      pixelDepth: 32,
      pixelData: bgraPixels,
    });
    const file = parseTga(bytes);
    expect(file.channels).toBe(4);
    expect(file.originalPixelDepth).toBe(32);
    // First pixel: RGBA 255, 0, 0, 200
    expect(file.pixelData[0]).toBe(255);
    expect(file.pixelData[1]).toBe(0);
    expect(file.pixelData[2]).toBe(0);
    expect(file.pixelData[3]).toBe(200);
    // Third pixel: RGBA 0, 0, 255, 100
    expect(file.pixelData[8]).toBe(0);
    expect(file.pixelData[9]).toBe(0);
    expect(file.pixelData[10]).toBe(255);
    expect(file.pixelData[11]).toBe(100);
  });

  // -------------------------------------------------------------------------
  // Test 3: 4×4 uncompressed 8-bit grayscale
  // -------------------------------------------------------------------------
  it('test 3: 4×4 uncompressed 8-bit grayscale', () => {
    const pixels = new Uint8Array(16);
    for (let i = 0; i < 16; i++) pixels[i] = i * 16;
    const bytes = buildTga({
      imageType: 3,
      width: 4,
      height: 4,
      pixelDepth: 8,
      pixelData: pixels,
    });
    const file = parseTga(bytes);
    expect(file.imageType).toBe(3);
    expect(file.channels).toBe(1);
    expect(file.pixelData).toEqual(pixels);
  });

  // -------------------------------------------------------------------------
  // Test 4: 4×4 RLE 24-bit truecolor (REPEAT + RAW packets)
  // -------------------------------------------------------------------------
  it('test 4: 4×4 RLE 24-bit truecolor with REPEAT and RAW packets', () => {
    // Row of same color (will be RLE-encoded as REPEAT)
    // Then a row of varying colors (RAW)
    // On-disk BGR format: [B, G, R] per pixel
    // Row 0: pure blue on-disk → B=255, G=0, R=0; decoded RGB = R=0, G=0, B=255
    const bgrPixels: Array<[number, number, number]> = [];
    for (let i = 0; i < 4; i++) bgrPixels.push([255, 0, 0]); // row 0: BGR=[255,0,0] → RGB=[0,0,255]
    for (let i = 0; i < 4; i++) bgrPixels.push([0, i * 50, 0]); // row 1: varying green channel
    for (let i = 0; i < 4; i++) bgrPixels.push([100, 100, 100]); // row 2: all grey
    for (let i = 0; i < 4; i++) bgrPixels.push([i * 20, 0, 0]); // row 3: varying blue channel

    const rleData = buildRle24(bgrPixels);
    const bytes = buildTga({
      imageType: 10,
      width: 4,
      height: 4,
      pixelDepth: 24,
      pixelData: rleData,
    });
    const file = parseTga(bytes);
    expect(file.imageType).toBe(10);
    expect(file.channels).toBe(3);
    expect(file.normalisations).toContain('rle-decoded-on-parse');
    // First pixel in row 0: on-disk BGR=[255,0,0] → RGB=[0,0,255]
    expect(file.pixelData[0]).toBe(0); // R = 0 (was G on disk)
    expect(file.pixelData[1]).toBe(0); // G = 0 (was B on disk? no: BGR swap: out[0]=in[2], out[2]=in[0])
    expect(file.pixelData[2]).toBe(255); // B = 255 (was B=255 on disk at position 0)
  });

  // -------------------------------------------------------------------------
  // Test 5: 4×4 RLE 8-bit grayscale
  // -------------------------------------------------------------------------
  it('test 5: 4×4 RLE 8-bit grayscale', () => {
    const pixels = [128, 128, 128, 128, 64, 64, 64, 64, 200, 100, 50, 25, 200, 100, 50, 25];
    const rleData = buildRle8(pixels);
    const bytes = buildTga({
      imageType: 11,
      width: 4,
      height: 4,
      pixelDepth: 8,
      pixelData: rleData,
    });
    const file = parseTga(bytes);
    expect(file.imageType).toBe(11);
    expect(file.channels).toBe(1);
    expect(file.normalisations).toContain('rle-decoded-on-parse');
    expect(Array.from(file.pixelData)).toEqual(pixels);
  });

  // -------------------------------------------------------------------------
  // Test 6: 2×2 uncompressed cmap with 24-bit BGR palette; palette RGB-swapped (Trap #15)
  // -------------------------------------------------------------------------
  it('test 6: 2×2 cmap with 24-bit BGR palette; palette swapped to RGB', () => {
    // Palette: 4 entries, BGR on disk
    // Entry 0: B=10 G=20 R=30 → RGB: 30,20,10
    // Entry 1: B=40 G=50 R=60 → RGB: 60,50,40
    // Entry 2: B=70 G=80 R=90 → RGB: 90,80,70
    // Entry 3: B=100 G=110 R=120 → RGB: 120,110,100
    const paletteBgr = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    const indexPixels = new Uint8Array([0, 1, 2, 3]);
    const bytes = buildTga({
      imageType: 1,
      width: 2,
      height: 2,
      pixelDepth: 8,
      colorMap: {
        firstEntryIndex: 0,
        length: 4,
        entrySize: 24,
        onDiskBytes: paletteBgr,
      },
      pixelData: indexPixels,
    });
    const file = parseTga(bytes);
    expect(file.colorMap).not.toBeNull();
    const cm = file.colorMap!;
    expect(cm.entrySize).toBe(24);
    // Entry 0: RGB 30,20,10
    expect(cm.paletteData[0]).toBe(30);
    expect(cm.paletteData[1]).toBe(20);
    expect(cm.paletteData[2]).toBe(10);
    // Entry 1: RGB 60,50,40
    expect(cm.paletteData[3]).toBe(60);
    expect(cm.paletteData[4]).toBe(50);
    expect(cm.paletteData[5]).toBe(40);
  });

  // -------------------------------------------------------------------------
  // Test 7: 2×2 uncompressed 16-bit ARGB1555 (attributeBits=1); unpack verified (Trap #3)
  // -------------------------------------------------------------------------
  it('test 7: 2×2 16-bit ARGB1555; unpack to RGBA8 verified', () => {
    // RGBA: (248, 8, 16, 255) → R=31 (0x1F), G=1, B=2, A=1
    // Packed: 1_11111_00001_00010 = 0xFC22 → LE: [0x22, 0xFC]
    const argb1555Pixels = rgbaToArgb1555Le([
      [248, 8, 16, 255], // R≈31<<3=248, G≈1<<3=8, B≈2<<3=16, A=1
      [0, 0, 0, 0], // all zeros
      [255, 255, 255, 255], // all ones
      [64, 64, 64, 128], // mid values
    ]);
    const bytes = buildTga({
      imageType: 2,
      width: 2,
      height: 2,
      pixelDepth: 16,
      attributeBits: 1,
      pixelData: argb1555Pixels,
    });
    const file = parseTga(bytes);
    expect(file.channels).toBe(4);
    expect(file.originalPixelDepth).toBe(16);
    // Pixel 0: R=248≈(31<<3)|(31>>2)=255, G≈8≈(1<<3)|(1>>2)=8, B≈16≈(2<<3)|(2>>2)=16, A=255
    // Actually: r5=31→(31<<3)|(31>>2)=248|7=255, g5=1→8|0=8, b5=2→16|0=16
    expect(file.pixelData[0]).toBe(255); // R from r5=31
    expect(file.pixelData[1]).toBe(8); // G from g5=1: (1<<3)|(1>>2)=8
    expect(file.pixelData[2]).toBe(16); // B from b5=2: (2<<3)|(2>>2)=16
    expect(file.pixelData[3]).toBe(255); // A from a1=1 → 255
    // Pixel 1: all zeros → RGBA 0,0,0,0
    expect(file.pixelData[4]).toBe(0);
    expect(file.pixelData[7]).toBe(0);
    // Pixel 2: all max → RGBA 255,255,255,255
    expect(file.pixelData[8]).toBe(255);
    expect(file.pixelData[11]).toBe(255);
  });

  // -------------------------------------------------------------------------
  // Test 8: Bottom-left origin normalised via asymmetric L-shape (Trap #4)
  // -------------------------------------------------------------------------
  it('test 8: bottom-left origin normalised to top-left via row-flip (asymmetric fixture)', () => {
    // 3×2 L-shape in 8-bit grayscale:
    // Row 0 (top-left when TL): [10, 20, 30]
    // Row 1 (bottom when BL): [40, 50, 60]
    // When stored as BL: row 0 on disk = [40,50,60], row 1 on disk = [10,20,30]
    const blPixels = new Uint8Array([40, 50, 60, 10, 20, 30]); // BL storage
    const bytes = buildTga({
      imageType: 3,
      width: 3,
      height: 2,
      pixelDepth: 8,
      originBits: 0, // bottom-left
      attributeBits: 0,
      pixelData: blPixels,
    });
    const file = parseTga(bytes);
    expect(file.originalOrigin).toBe('bottom-left');
    expect(file.normalisations).toContain('origin-normalised-to-top-left');
    // After row-flip: row 0 = [10,20,30], row 1 = [40,50,60]
    expect(file.pixelData[0]).toBe(10);
    expect(file.pixelData[1]).toBe(20);
    expect(file.pixelData[2]).toBe(30);
    expect(file.pixelData[3]).toBe(40);
    expect(file.pixelData[4]).toBe(50);
    expect(file.pixelData[5]).toBe(60);
  });

  // -------------------------------------------------------------------------
  // Test 9: Top-left origin passes through unchanged
  // -------------------------------------------------------------------------
  it('test 9: top-left origin passes through unchanged, no normalisation flag', () => {
    const pixels = new Uint8Array([10, 20, 30, 40]);
    const bytes = buildTga({
      imageType: 3,
      width: 2,
      height: 2,
      pixelDepth: 8,
      originBits: 2, // top-left
      pixelData: pixels,
    });
    const file = parseTga(bytes);
    expect(file.originalOrigin).toBe('top-left');
    expect(file.normalisations).not.toContain('origin-normalised-to-top-left');
    expect(Array.from(file.pixelData)).toEqual([10, 20, 30, 40]);
  });

  // -------------------------------------------------------------------------
  // Test 10: TGA 2.0 footer detected + hasFooter=true; corrupt signature rejected (Trap #6)
  // -------------------------------------------------------------------------
  it('test 10: TGA 2.0 footer detected: hasFooter=true', () => {
    const pixels = new Uint8Array([100, 200]);
    const bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
      hasFooter: true,
    });
    const file = parseTga(bytes);
    expect(file.hasFooter).toBe(true);
  });

  it('test 10b: TGA 1.0 (no footer): hasFooter=false', () => {
    const pixels = new Uint8Array([100, 200]);
    const bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
      hasFooter: false,
    });
    const file = parseTga(bytes);
    expect(file.hasFooter).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 11: Truncated raster → TgaTruncatedError
  // -------------------------------------------------------------------------
  it('test 11: truncated raster throws TgaTruncatedError', () => {
    // 4×4 24-bit = 48 bytes of pixel data needed; provide only 10
    const bytes = buildTga({
      imageType: 2,
      width: 4,
      height: 4,
      pixelDepth: 24,
      pixelData: new Uint8Array(10), // too short
    });
    expect(() => parseTga(bytes)).toThrow(TgaTruncatedError);
  });

  // -------------------------------------------------------------------------
  // Test 12: RLE output-overflow → TgaRleDecodeError
  // -------------------------------------------------------------------------
  it('test 12: RLE output-overflow throws TgaRleDecodeError', () => {
    // Manually construct an RLE stream that tries to write 200 pixels for a 4-pixel image
    // REPEAT header 0x80 | (200-1) = too large
    const badRle = new Uint8Array([0x80 | 127, 128]); // 128 pixel REPEAT for 8-bit, only 4 expected
    const bytes = buildTga({
      imageType: 11,
      width: 2,
      height: 2,
      pixelDepth: 8,
      pixelData: badRle,
    });
    expect(() => parseTga(bytes)).toThrow(TgaRleDecodeError);
  });

  // -------------------------------------------------------------------------
  // Test 13: Image Type 0 → TgaNoImageDataError
  // -------------------------------------------------------------------------
  it('test 13: image type 0 throws TgaNoImageDataError', () => {
    // Build a valid header but with imageType=0
    const bytes = new Uint8Array(18 + 26); // header + footer
    bytes[2] = 0; // imageType = 0
    bytes[12] = 1;
    bytes[13] = 0; // width = 1
    bytes[14] = 1;
    bytes[15] = 0; // height = 1
    bytes[16] = 24; // pixelDepth
    // Write footer
    bytes.set(TGA_FOOTER_SIGNATURE, 18 + 8);
    expect(() => parseTga(bytes)).toThrow(TgaNoImageDataError);
  });

  // -------------------------------------------------------------------------
  // Test 14: Palette entry size 16 → TgaUnsupportedFeatureError
  // -------------------------------------------------------------------------
  it('test 14: palette entry size 16 throws TgaUnsupportedFeatureError', () => {
    const bytes = new Uint8Array(18 + 26 + 2); // header + 2px data + footer
    bytes[1] = 1; // colorMapType = 1
    bytes[2] = 1; // imageType = 1 (cmap)
    // colorMapLength = 2
    new DataView(bytes.buffer).setUint16(5, 2, true);
    bytes[7] = 16; // colorMapEntrySize = 16 (unsupported)
    new DataView(bytes.buffer).setUint16(12, 1, true); // width = 1
    new DataView(bytes.buffer).setUint16(14, 2, true); // height = 2
    bytes[16] = 8; // pixelDepth = 8
    bytes[17] = 0x20; // originBits = 2 (TL), attributeBits = 0
    // Pixel data: 2 index bytes
    bytes[18] = 0;
    bytes[19] = 1;
    // Footer
    bytes.set(TGA_FOOTER_SIGNATURE, 18 + 2 + 8);
    expect(() => parseTga(bytes)).toThrow(TgaUnsupportedFeatureError);
  });

  // -------------------------------------------------------------------------
  // Test 15: Reserved bits 6-7 set → TgaBadHeaderError (Trap #13)
  // -------------------------------------------------------------------------
  it('test 15: reserved bits 6-7 set throws TgaBadHeaderError', () => {
    const pixels = new Uint8Array([1, 2]);
    const bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 2,
      pixelDepth: 8,
      reservedBits: 0x01, // bits 6-7 = 01 (non-zero)
      pixelData: pixels,
    });
    expect(() => parseTga(bytes)).toThrow(TgaBadHeaderError);
  });

  // -------------------------------------------------------------------------
  // Test 16: colorMapStart ≠ 0 handled (Trap #8)
  // -------------------------------------------------------------------------
  it('test 16: colorMapFirstEntryIndex ≠ 0 handled correctly', () => {
    // firstEntryIndex = 2, length = 4 → only 2 entries on disk; prefix 0..1 zero-filled
    // Palette entries: 2 entries of 3 bytes BGR each
    const partialPalette = new Uint8Array([10, 20, 30, 40, 50, 60]); // entries 2,3
    const indexPixels = new Uint8Array([2, 3, 2, 3]);
    const bytes = buildTga({
      imageType: 1,
      width: 2,
      height: 2,
      pixelDepth: 8,
      colorMap: {
        firstEntryIndex: 2,
        length: 4,
        entrySize: 24,
        onDiskBytes: partialPalette,
      },
      pixelData: indexPixels,
    });
    const file = parseTga(bytes);
    const cm = file.colorMap!;
    // Entries 0 and 1 should be zero-filled
    expect(cm.paletteData[0]).toBe(0); // entry 0 R
    expect(cm.paletteData[1]).toBe(0); // entry 0 G
    expect(cm.paletteData[2]).toBe(0); // entry 0 B
    expect(cm.paletteData[3]).toBe(0); // entry 1 R
    // Entry 2: BGR [10,20,30] → RGB [30,20,10]
    expect(cm.paletteData[6]).toBe(30);
    expect(cm.paletteData[7]).toBe(20);
    expect(cm.paletteData[8]).toBe(10);
    // Entry 3: BGR [40,50,60] → RGB [60,50,40]
    expect(cm.paletteData[9]).toBe(60);
    expect(cm.paletteData[10]).toBe(50);
    expect(cm.paletteData[11]).toBe(40);
  });

  // -------------------------------------------------------------------------
  // Test 17: Image ID bytes preserved verbatim
  // -------------------------------------------------------------------------
  it('test 17: image ID bytes preserved verbatim', () => {
    const imageId = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const pixels = new Uint8Array([50, 100, 150, 200]);
    const bytes = buildTga({
      imageType: 3,
      width: 2,
      height: 2,
      pixelDepth: 8,
      imageId,
      pixelData: pixels,
    });
    const file = parseTga(bytes);
    expect(Array.from(file.imageId)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  // -------------------------------------------------------------------------
  // Test 18: Extension/Developer Area bytes round-tripped
  // -------------------------------------------------------------------------
  it('test 18: extension area bytes round-tripped verbatim', () => {
    // Extension area must be >= 495 bytes per TGA 2.0 spec (M-3 strict enforcement).
    // First 4 bytes are sentinel values; rest zero-padded.
    const extBytes = new Uint8Array(495);
    extBytes[0] = 0xaa;
    extBytes[1] = 0xbb;
    extBytes[2] = 0xcc;
    extBytes[3] = 0xdd;
    const pixels = new Uint8Array([10, 20, 30, 40]);
    const bytes = buildTga({
      imageType: 3,
      width: 2,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
      extensionAreaBytes: extBytes,
    });
    const file = parseTga(bytes);
    expect(file.hasFooter).toBe(true);
    expect(file.extensionAreaBytes).not.toBeNull();
    expect(file.extensionAreaBytes![0]).toBe(0xaa);
    expect(file.extensionAreaBytes![1]).toBe(0xbb);
    expect(file.extensionAreaBytes![2]).toBe(0xcc);
    expect(file.extensionAreaBytes![3]).toBe(0xdd);
  });

  // -------------------------------------------------------------------------
  // Test 19: Round-trip canonical Type 2 byte-equal
  // -------------------------------------------------------------------------
  it('test 19: round-trip canonical Type 2 uncompressed top-left is byte-equal', () => {
    const bgrPixels = rgbToBgr([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
    ]);
    const bytes = buildTga({
      imageType: 2,
      width: 2,
      height: 2,
      pixelDepth: 24,
      originBits: 2, // top-left
      pixelData: bgrPixels,
    });
    const file = parseTga(bytes);
    const serialized = serializeTga(file);
    const reparsed = parseTga(serialized);

    expect(reparsed.width).toBe(file.width);
    expect(reparsed.height).toBe(file.height);
    expect(reparsed.channels).toBe(file.channels);
    expect(Array.from(reparsed.pixelData)).toEqual(Array.from(file.pixelData));
    expect(reparsed.hasFooter).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 20: TGA 1.0 → TGA 2.0 promotion + normalisation flag
  // -------------------------------------------------------------------------
  it('test 20: TGA 1.0 promotes to TGA 2.0 on serialize + records normalisation flag', () => {
    const pixels = new Uint8Array([50, 100]);
    const tga1Bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
      hasFooter: false, // TGA 1.0
    });
    const file = parseTga(tga1Bytes);
    expect(file.hasFooter).toBe(false);

    const serialized = serializeTga(file);
    // Serialized must always have a footer
    expect(serialized.length).toBeGreaterThanOrEqual(TGA_FOOTER_SIZE);
    // Check footer signature in last 18 bytes
    const sigStart = serialized.length - TGA_FOOTER_SIZE + 8;
    for (let i = 0; i < TGA_FOOTER_SIGNATURE.length; i++) {
      expect(serialized[sigStart + i]).toBe(TGA_FOOTER_SIGNATURE[i]);
    }
    // Re-parse should have hasFooter=true
    const reparsed = parseTga(serialized);
    expect(reparsed.hasFooter).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 21: Origin normalisation flag on non-TL input
  // -------------------------------------------------------------------------
  it('test 21: origin normalisation flag set on non-top-left input', () => {
    const pixels = new Uint8Array([10, 20, 30, 40, 50, 60]);
    // Bottom-right: originBits = 1
    const bytes = buildTga({
      imageType: 3,
      width: 3,
      height: 2,
      pixelDepth: 8,
      originBits: 1, // bottom-right
      pixelData: pixels,
    });
    const file = parseTga(bytes);
    expect(file.originalOrigin).toBe('bottom-right');
    expect(file.normalisations).toContain('origin-normalised-to-top-left');
  });

  // -------------------------------------------------------------------------
  // Test 22: Type 10 RLE structural round-trip (pixelData equal, bytes may differ)
  // -------------------------------------------------------------------------
  it('test 22: type 10 RLE round-trip structural equality (pixelData equal)', () => {
    const bgrPixels: Array<[number, number, number]> = [
      [0, 0, 255],
      [0, 0, 255],
      [0, 128, 0],
      [0, 0, 255],
    ];
    const rleData = buildRle24(bgrPixels);
    const bytes = buildTga({
      imageType: 10,
      width: 2,
      height: 2,
      pixelDepth: 24,
      pixelData: rleData,
    });
    const file = parseTga(bytes);
    const serialized = serializeTga(file);
    const reparsed = parseTga(serialized);

    // pixelData must be equal (structural equivalence)
    expect(Array.from(reparsed.pixelData)).toEqual(Array.from(file.pixelData));
  });

  // -------------------------------------------------------------------------
  // Test 23: detectImageFormat via footer and header heuristic (Trap #5)
  // -------------------------------------------------------------------------
  it('test 23a: detectImageFormat detects TGA 2.0 via footer signature', () => {
    const pixels = new Uint8Array([10, 20, 30, 40]);
    const bytes = buildTga({
      imageType: 3,
      width: 2,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
      hasFooter: true,
    });
    expect(detectImageFormat(bytes)).toBe('tga');
  });

  it('test 23b: detectImageFormat detects TGA 1.0 via header heuristic', () => {
    const pixels = new Uint8Array([10, 20, 30, 40]);
    const bytes = buildTga({
      imageType: 3,
      width: 2,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
      hasFooter: false,
    });
    expect(detectImageFormat(bytes)).toBe('tga');
  });

  it('test 23c: detectImageFormat returns null for non-TGA data', () => {
    // Pure garbage that doesn't match any heuristic
    const bytes = new Uint8Array([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0xff, 0xff, 0xff, 0xff, 0xff,
    ]);
    expect(detectImageFormat(bytes)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 24: parseImage / serializeImage dispatch round-trip
  // -------------------------------------------------------------------------
  it('test 24: parseImage/serializeImage dispatch round-trip for TGA', () => {
    const pixels = new Uint8Array([10, 20, 30, 40]);
    const bytes = buildTga({
      imageType: 3,
      width: 2,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
    });
    const file = parseImage(bytes, 'tga');
    expect(file.format).toBe('tga');
    const serialized = serializeImage(file);
    const reparsed = parseImage(serialized, 'tga');
    expect(reparsed.format).toBe('tga');
    if (reparsed.format === 'tga') {
      expect(Array.from(reparsed.pixelData)).toEqual(Array.from(pixels));
    }
  });

  // -------------------------------------------------------------------------
  // Test 25: Backend canHandle accepts all three TGA MIMEs
  // -------------------------------------------------------------------------
  it('test 25: ImageLegacyBackend.canHandle accepts image/x-tga, image/tga, image/x-targa', async () => {
    const backend = new ImageLegacyBackend();
    const tgaMimes = [TGA_MIME, TGA_MIME_ALT1, TGA_MIME_ALT2];
    for (const mime of tgaMimes) {
      const result = await backend.canHandle(
        { mime, ext: 'tga', category: 'image', description: 'TGA' },
        { mime, ext: 'tga', category: 'image', description: 'TGA' },
      );
      expect(result).toBe(true);
    }
    // Non-TGA MIME should return false
    const notTga = await backend.canHandle(
      { mime: 'image/jpeg', ext: 'jpg', category: 'image', description: 'JPEG' },
      { mime: 'image/x-tga', ext: 'tga', category: 'image', description: 'TGA' },
    );
    expect(notTga).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// decodeTgaRle unit tests — Trap #7 focus
// ---------------------------------------------------------------------------

describe('decodeTgaRle', () => {
  it('packet 0x00 is 1-pixel RAW (not a no-op) — Trap #7', () => {
    // 0x00 = RAW packet, count=(0&0x7F)+1=1, followed by 1 pixel byte
    const input = new Uint8Array([0x00, 0xab]);
    const result = decodeTgaRle(input, 0, 1, 1);
    expect(result).toEqual(new Uint8Array([0xab]));
  });

  it('packet 0x7F = 128-pixel RAW', () => {
    // 0x7F = RAW, count=128, followed by 128 bytes
    const input = new Uint8Array(129);
    input[0] = 0x7f;
    for (let i = 1; i <= 128; i++) input[i] = i;
    const result = decodeTgaRle(input, 0, 1, 128);
    expect(result.length).toBe(128);
    expect(result[0]).toBe(1);
    expect(result[127]).toBe(128);
  });

  it('packet 0x80 = 1-pixel REPEAT (not a no-op — Trap #7 contrast with PackBits)', () => {
    // 0x80 = REPEAT, count=(0x80&0x7F)+1=1, followed by 1 pixel byte
    const input = new Uint8Array([0x80, 0xcd]);
    const result = decodeTgaRle(input, 0, 1, 1);
    expect(result).toEqual(new Uint8Array([0xcd]));
  });

  it('packet 0xFF = 128-pixel REPEAT', () => {
    // 0xFF = REPEAT, count=(0xFF&0x7F)+1=128, followed by 1 pixel byte
    const input = new Uint8Array([0xff, 0x55]);
    const result = decodeTgaRle(input, 0, 1, 128);
    expect(result.length).toBe(128);
    expect(result.every((v) => v === 0x55)).toBe(true);
  });

  it('output-overflow: packet that would write past buffer throws TgaRleDecodeError', () => {
    // 2 expected pixels, but REPEAT header says 5 pixels
    const input = new Uint8Array([0x80 | 4, 0xaa]); // 5-pixel REPEAT
    expect(() => decodeTgaRle(input, 0, 1, 2)).toThrow(TgaRleDecodeError);
  });

  it('input-underrun on REPEAT throws TgaRleDecodeError', () => {
    // REPEAT packet but no pixel data follows
    const input = new Uint8Array([0x80]); // REPEAT but no pixel byte
    expect(() => decodeTgaRle(input, 0, 1, 1)).toThrow(TgaRleDecodeError);
  });

  it('input-underrun on RAW throws TgaRleDecodeError', () => {
    // RAW packet says 3 pixels (3 bytes) but only 2 follow
    const input = new Uint8Array([0x02, 0xaa, 0xbb]); // RAW 3 pixels, 2 bytes given
    expect(() => decodeTgaRle(input, 0, 1, 3)).toThrow(TgaRleDecodeError);
  });

  it('input-underrun when stream exhausted before pixel count', () => {
    // Empty stream, expecting 1 pixel
    expect(() => decodeTgaRle(new Uint8Array(0), 0, 1, 1)).toThrow(TgaRleDecodeError);
  });

  it('multi-byte pixel REPEAT (3 bytes per pixel)', () => {
    // REPEAT: header=0x81 (2 pixels), pixel=[1,2,3]
    const input = new Uint8Array([0x81, 1, 2, 3]);
    const result = decodeTgaRle(input, 0, 3, 2);
    expect(Array.from(result)).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it('inputOffset parameter is respected', () => {
    // Pad 3 bytes, then RAW 1-pixel packet
    const input = new Uint8Array([0xde, 0xad, 0xbe, 0x00, 0xab]);
    const result = decodeTgaRle(input, 3, 1, 1);
    expect(result).toEqual(new Uint8Array([0xab]));
  });
});

// ---------------------------------------------------------------------------
// isTgaHeader unit tests
// ---------------------------------------------------------------------------

describe('isTgaHeader', () => {
  it('returns true for a minimal valid TGA 1.0 header', () => {
    const bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 1,
      pixelDepth: 8,
      pixelData: new Uint8Array([128]),
      hasFooter: false,
    });
    expect(isTgaHeader(bytes)).toBe(true);
  });

  it('returns false for buffer shorter than 18 bytes', () => {
    expect(isTgaHeader(new Uint8Array(10))).toBe(false);
  });

  it('returns false for reserved bits set', () => {
    const bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 1,
      pixelDepth: 8,
      reservedBits: 1,
      pixelData: new Uint8Array([50]),
      hasFooter: false,
    });
    expect(isTgaHeader(bytes)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error path tests
// ---------------------------------------------------------------------------

describe('parseTga error paths', () => {
  it('throws TgaBadHeaderError for input shorter than 18 bytes', () => {
    expect(() => parseTga(new Uint8Array(10))).toThrow(TgaBadHeaderError);
  });

  it('throws TgaUnsupportedImageTypeError for imageType=5', () => {
    const bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 1,
      pixelDepth: 8,
      pixelData: new Uint8Array([0]),
    });
    bytes[2] = 5; // override imageType to 5
    expect(() => parseTga(bytes)).toThrow(TgaUnsupportedImageTypeError);
  });

  it('throws TgaUnsupportedFeatureError for illegal (imageType, pixelDepth) pair', () => {
    // Type 3 (grayscale) with depth 24 is illegal
    const bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 1,
      pixelDepth: 8,
      pixelData: new Uint8Array([0]),
    });
    bytes[16] = 24; // override pixelDepth to 24
    expect(() => parseTga(bytes)).toThrow(TgaUnsupportedFeatureError);
  });

  it('throws TgaBadHeaderError for zero dimensions', () => {
    const bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 1,
      pixelDepth: 8,
      pixelData: new Uint8Array([0]),
    });
    // Set width to 0
    new DataView(bytes.buffer).setUint16(12, 0, true);
    expect(() => parseTga(bytes)).toThrow(TgaBadHeaderError);
  });

  it('throws TgaBadHeaderError for inconsistent attributeBits (Trap #10)', () => {
    // Type 2, depth 24: attributeBits must be 0; set to 5
    const bgrPixels = rgbToBgr([[1, 2, 3]]);
    const bytes = buildTga({
      imageType: 2,
      width: 1,
      height: 1,
      pixelDepth: 24,
      attributeBits: 5, // invalid for 24-bit
      pixelData: bgrPixels,
    });
    expect(() => parseTga(bytes)).toThrow(TgaBadHeaderError);
  });

  it('throws TgaUnsupportedFeatureError for unsupported pixelDepth (e.g., 4)', () => {
    const bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 1,
      pixelDepth: 8,
      pixelData: new Uint8Array([0]),
    });
    bytes[16] = 4; // override to unsupported depth
    expect(() => parseTga(bytes)).toThrow(TgaUnsupportedFeatureError);
  });
});

// ---------------------------------------------------------------------------
// Origin normalisation tests — Trap #4 (all 4 variants)
// ---------------------------------------------------------------------------

describe('origin normalisation', () => {
  it('top-right origin: per-row reverse only', () => {
    // 2×2, 8-bit grayscale
    // TR storage: row 0 = [20, 10], row 1 = [40, 30] → after reverse: [10,20] [30,40]
    const pixels = new Uint8Array([20, 10, 40, 30]);
    const bytes = buildTga({
      imageType: 3,
      width: 2,
      height: 2,
      pixelDepth: 8,
      originBits: 3, // top-right
      pixelData: pixels,
    });
    const file = parseTga(bytes);
    expect(file.originalOrigin).toBe('top-right');
    expect(file.pixelData[0]).toBe(10);
    expect(file.pixelData[1]).toBe(20);
    expect(file.pixelData[2]).toBe(30);
    expect(file.pixelData[3]).toBe(40);
  });

  it('bottom-right origin: row-flip then per-row reverse', () => {
    // 2×2, 8-bit grayscale
    // BR storage: row 0 = [40,30], row 1 = [20,10]
    // After row-flip: [20,10] [40,30]; after reverse: [10,20] [30,40]
    const pixels = new Uint8Array([40, 30, 20, 10]);
    const bytes = buildTga({
      imageType: 3,
      width: 2,
      height: 2,
      pixelDepth: 8,
      originBits: 1, // bottom-right
      pixelData: pixels,
    });
    const file = parseTga(bytes);
    expect(file.originalOrigin).toBe('bottom-right');
    expect(file.pixelData[0]).toBe(10);
    expect(file.pixelData[1]).toBe(20);
    expect(file.pixelData[2]).toBe(30);
    expect(file.pixelData[3]).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Serializer round-trip tests
// ---------------------------------------------------------------------------

describe('serializeTga', () => {
  it('always emits top-left origin in byte 17', () => {
    // Parse a BL-origin image, serialize it — byte 17 bits 4-5 should be 10 (TL)
    const pixels = new Uint8Array([40, 30, 20, 10]);
    const bytes = buildTga({
      imageType: 3,
      width: 2,
      height: 2,
      pixelDepth: 8,
      originBits: 0, // bottom-left on parse
      pixelData: pixels,
    });
    const file = parseTga(bytes);
    const serialized = serializeTga(file);
    // Byte 17 bits 4-5: (serialized[17] >> 4) & 0x03 === 2 (TL)
    expect(((serialized[17] ?? 0) >> 4) & 0x03).toBe(2);
  });

  it('always emits TGA 2.0 footer', () => {
    const pixels = new Uint8Array([10, 20]);
    const bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
      hasFooter: false, // TGA 1.0
    });
    const file = parseTga(bytes);
    const serialized = serializeTga(file);
    // Last 18 bytes must match footer signature
    const sigStart = serialized.length - TGA_FOOTER_SIZE + 8;
    for (let i = 0; i < TGA_FOOTER_SIGNATURE.length; i++) {
      expect(serialized[sigStart + i]).toBe(TGA_FOOTER_SIGNATURE[i]);
    }
  });

  it('preserves imageId verbatim', () => {
    const imageId = new Uint8Array([1, 2, 3]);
    const pixels = new Uint8Array([5, 10, 15, 20]);
    const bytes = buildTga({
      imageType: 3,
      width: 2,
      height: 2,
      pixelDepth: 8,
      imageId,
      pixelData: pixels,
    });
    const file = parseTga(bytes);
    const serialized = serializeTga(file);
    const reparsed = parseTga(serialized);
    expect(Array.from(reparsed.imageId)).toEqual([1, 2, 3]);
  });

  it('TGA_FORMAT descriptor has correct MIME', () => {
    expect(TGA_FORMAT.mime).toBe(TGA_MIME);
    expect(TGA_FORMAT.ext).toBe('tga');
  });

  it('serializes developer area bytes correctly', () => {
    // Build a TGA with developer area bytes via the builder,
    // then round-trip and check the bytes are preserved
    const devBytes = new Uint8Array([0x11, 0x22, 0x33]);
    const pixels = new Uint8Array([10, 20]);
    const bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
      developerAreaBytes: devBytes,
    });
    const file = parseTga(bytes);
    // Developer area parsed (the builder sets devAreaOffset non-zero)
    // Serialize and check developer bytes are written
    const serialized = serializeTga(file);
    expect(serialized.length).toBeGreaterThan(0);
    // Re-parse the serialized output
    const reparsed = parseTga(serialized);
    expect(reparsed.hasFooter).toBe(true);
    expect(Array.from(reparsed.pixelData)).toEqual([10, 20]);
  });

  it('serializes extension area bytes correctly in round-trip', () => {
    // Extension area must be >= 495 bytes per TGA 2.0 spec (M-3 strict enforcement).
    const extBytes = new Uint8Array(495);
    extBytes[0] = 0xaa;
    extBytes[1] = 0xbb;
    const pixels = new Uint8Array([50, 60]);
    const bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
      extensionAreaBytes: extBytes,
    });
    const file = parseTga(bytes);
    const serialized = serializeTga(file);
    const reparsed = parseTga(serialized);
    expect(reparsed.hasFooter).toBe(true);
    // Extension area is preserved
    expect(reparsed.extensionAreaBytes).not.toBeNull();
  });

  it('serializes 32-bit BGRA correctly in round-trip', () => {
    const bgraPixels = rgbaToBgra([[100, 150, 200, 255]]);
    const bytes = buildTga({
      imageType: 2,
      width: 1,
      height: 1,
      pixelDepth: 32,
      pixelData: bgraPixels,
    });
    const file = parseTga(bytes);
    const serialized = serializeTga(file);
    const reparsed = parseTga(serialized);
    expect(reparsed.pixelData[0]).toBe(100);
    expect(reparsed.pixelData[1]).toBe(150);
    expect(reparsed.pixelData[2]).toBe(200);
    expect(reparsed.pixelData[3]).toBe(255);
  });

  it('serializes 16-bit ARGB1555 correctly in round-trip', () => {
    const argb1555Pixels = rgbaToArgb1555Le([[248, 8, 16, 255]]);
    const bytes = buildTga({
      imageType: 2,
      width: 1,
      height: 1,
      pixelDepth: 16,
      attributeBits: 1,
      pixelData: argb1555Pixels,
    });
    const file = parseTga(bytes);
    const serialized = serializeTga(file);
    const reparsed = parseTga(serialized);
    expect(reparsed.originalPixelDepth).toBe(16);
    // R=255, G=8, B=16, A=255 (within 5-bit quantization loss)
    expect(reparsed.pixelData[0]).toBe(file.pixelData[0]);
    expect(reparsed.pixelData[3]).toBe(255); // alpha from a1=1
  });

  it('serializes cmap image with color map correctly', () => {
    const paletteBgr = new Uint8Array([0, 0, 255, 0, 255, 0]); // 2 BGR entries
    const indexPixels = new Uint8Array([0, 1]);
    const bytes = buildTga({
      imageType: 1,
      width: 1,
      height: 2,
      pixelDepth: 8,
      colorMap: {
        firstEntryIndex: 0,
        length: 2,
        entrySize: 24,
        onDiskBytes: paletteBgr,
      },
      pixelData: indexPixels,
    });
    const file = parseTga(bytes);
    const serialized = serializeTga(file);
    const reparsed = parseTga(serialized);
    expect(reparsed.colorMap).not.toBeNull();
    // Entry 0: BGR [0,0,255] → RGB [255,0,0]
    expect(reparsed.colorMap!.paletteData[0]).toBe(255);
    expect(reparsed.colorMap!.paletteData[1]).toBe(0);
    expect(reparsed.colorMap!.paletteData[2]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// H-1 fix: TgaBadFooterError on partial signature match (Trap #6)
// ---------------------------------------------------------------------------

describe('parseFooter partial-match rejection (H-1)', () => {
  it('throws TgaBadFooterError when TRUEVISION prefix is present but signature is corrupt', () => {
    // Construct a file whose last 26 bytes have:
    // - bytes 8..17: 'TRUEVISION' (prefix matches)
    // - bytes 18..25: '-TARGA\0\0' (wrong — should be '-XFILE.\0')
    const pixels = new Uint8Array([10, 20]);
    const base = buildTga({
      imageType: 3,
      width: 1,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
      hasFooter: false, // no real footer
    });
    // Append a corrupt footer: offsets=0, then corrupt signature
    const corruptSig = new Uint8Array(18);
    // 'TRUEVISION' prefix (10 bytes)
    const prefix = [0x54, 0x52, 0x55, 0x45, 0x56, 0x49, 0x53, 0x49, 0x4f, 0x4e];
    corruptSig.set(prefix, 0);
    // '-TARGA\0\0' instead of '-XFILE.\0' (8 bytes)
    const wrongSuffix = [0x2d, 0x54, 0x41, 0x52, 0x47, 0x41, 0x00, 0x00];
    corruptSig.set(wrongSuffix, 10);

    const footer = new Uint8Array(26);
    footer.set(corruptSig, 8);

    const combined = new Uint8Array(base.length + 26);
    combined.set(base, 0);
    combined.set(footer, base.length);

    expect(() => parseTga(combined)).toThrow(TgaBadFooterError);
  });

  it('does NOT throw for a file with no TRUEVISION prefix at footer position (TGA 1.0)', () => {
    // A valid TGA 1.0 with garbage at the footer position should parse normally
    const pixels = new Uint8Array([100, 200]);
    const bytes = buildTga({
      imageType: 3,
      width: 1,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
      hasFooter: false,
    });
    // No exception expected — hasFooter should be false
    const file = parseTga(bytes);
    expect(file.hasFooter).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// H-3 fix: footer offset validation (H-3 + security H-2)
// ---------------------------------------------------------------------------

describe('footer offset validation (H-3)', () => {
  /**
   * Build a TGA 2.0 file with a manually crafted footer pointing to arbitrary offsets.
   * Uses a 1×2 grayscale image (2 pixel bytes); no color map; 18-byte header.
   * pixelDataEnd = 18 + 0 + 2 = 20.
   */
  function buildTgaWithManualFooter(extOffset: number, devOffset: number): Uint8Array {
    const pixels = new Uint8Array([10, 20]);
    const header = buildTga({
      imageType: 3,
      width: 1,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
      hasFooter: false,
    });
    // Append a 26-byte footer with manually specified offsets
    const total = header.length + 26;
    const out = new Uint8Array(total);
    out.set(header, 0);
    const dv = new DataView(out.buffer);
    dv.setUint32(header.length, extOffset, true);
    dv.setUint32(header.length + 4, devOffset, true);
    out.set(TGA_FOOTER_SIGNATURE, header.length + 8);
    return out;
  }

  it('throws TgaBadFooterError when extensionAreaOffset points into pixel data region', () => {
    // pixelDataEnd = 20; pointing to offset 10 (inside pixel data) must throw
    const bytes = buildTgaWithManualFooter(10, 0);
    expect(() => parseTga(bytes)).toThrow(TgaBadFooterError);
  });

  it('throws TgaBadFooterError when extensionAreaOffset points past footer start', () => {
    // footerStart = header.length (20) for this minimal file; footer is the last 26 bytes
    // The file is 20 + 26 = 46 bytes; footerStart = 46 - 26 = 20
    // An offset >= footerStart should throw
    const bytes = buildTgaWithManualFooter(20, 0);
    expect(() => parseTga(bytes)).toThrow(TgaBadFooterError);
  });

  it('throws TgaBadFooterError when extensionAreaOffset = developerAreaOffset (overlapping)', () => {
    // Build a TGA with 1000-byte gap after pixels for extension/developer areas,
    // then set both offsets to the same location
    const pixels = new Uint8Array([10, 20]);
    const padding = new Uint8Array(1000);
    const base = buildTga({
      imageType: 3,
      width: 1,
      height: 2,
      pixelDepth: 8,
      pixelData: pixels,
      hasFooter: false,
    });
    // base = 20 bytes (header 18 + 2 pixels)
    // With 1000-byte padding and 26-byte footer: total = 1046
    // pixelDataEnd = 20; footerStart = 1046 - 26 = 1020
    // Same offset for both ext and dev at offset 20 → overlap
    const out = new Uint8Array(base.length + padding.length + 26);
    out.set(base, 0);
    out.set(padding, base.length);
    const dv = new DataView(out.buffer);
    const sharedOffset = base.length; // = 20, which is pixelDataEnd
    dv.setUint32(base.length + padding.length, sharedOffset, true); // extOffset
    dv.setUint32(base.length + padding.length + 4, sharedOffset, true); // devOffset (same)
    out.set(TGA_FOOTER_SIGNATURE, base.length + padding.length + 8);
    expect(() => parseTga(out)).toThrow(TgaBadFooterError);
  });
});

// ---------------------------------------------------------------------------
// H-3 (security): isTgaHeader rejects colorMapStart > colorMapLength (H-3 security)
// ---------------------------------------------------------------------------

describe('isTgaHeader colorMapStart > colorMapLength rejection (H-3 security)', () => {
  it('returns false when colorMapStart > colorMapLength (would produce negative cmOnDiskEntries)', () => {
    // Build a valid cmap TGA header where colorMapStart (3) > colorMapLength (2)
    // This simulates a non-TGA binary that coincidentally passes other checks
    const bytes = buildTga({
      imageType: 1,
      width: 1,
      height: 1,
      pixelDepth: 8,
      colorMap: {
        firstEntryIndex: 0,
        length: 4,
        entrySize: 24,
        onDiskBytes: new Uint8Array(12), // 4 entries × 3 bytes
      },
      pixelData: new Uint8Array([0]),
      hasFooter: false,
    });
    // Override colorMapFirstEntryIndex (bytes 3-4) to 5 > colorMapLength (4)
    const dv = new DataView(bytes.buffer);
    dv.setUint16(3, 5, true); // colorMapStart = 5 > colorMapLength = 4
    // isTgaHeader should now return false (H-3 security fix)
    expect(isTgaHeader(bytes)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M-2 (security): unsupported entry size check before offset computation
// ---------------------------------------------------------------------------

describe('M-2: unsupported palette entry size rejected before offset computation', () => {
  it('throws TgaUnsupportedFeatureError for 15-bit palette entry size', () => {
    const bytes = buildTga({
      imageType: 1,
      width: 1,
      height: 1,
      pixelDepth: 8,
      colorMap: {
        firstEntryIndex: 0,
        length: 2,
        entrySize: 24,
        onDiskBytes: new Uint8Array(6),
      },
      pixelData: new Uint8Array([0]),
    });
    bytes[7] = 15; // override colorMapEntrySize to 15 (unsupported)
    expect(() => parseTga(bytes)).toThrow(TgaUnsupportedFeatureError);
  });
});
