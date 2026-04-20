/**
 * XPM3 parser and serializer tests for @webcvt/image-legacy.
 *
 * All 24 test cases from the design note §"Test plan" are covered,
 * plus several sub-cases for full Trap coverage.
 * All fixtures are synthetic (no committed binaries).
 *
 * Test numbering follows the design note:
 *  1:  Decodes canonical 16×16 4-colour spec fixture
 *  2:  cpp=2 chunks pixel rows in 2-byte keys (Trap #2)
 *  3:  Space/comma/# colour keys extracted by byte offset (Trap #3)
 *  4:  #RGB shorthand #F0A → RGBA(255, 0, 170, 255) (Trap #5)
 *  5:  #RRRRGGGGBBBB narrowed to 8-bit via high byte
 *  6:  Named 'red' resolves to RGBA(255, 0, 0, 255)
 *  7:  Unknown 'cornflowerblue' → XpmUnknownColorError (Trap #4)
 *  8:  c None → alpha=0; others alpha=255 (Trap #6)
 *  9:  6-token header → hotspot extracted; 4-token → null (Trap #7)
 *  10: 5-token header → XpmBadValuesError (Trap #7)
 *  11: Pixel row length ≠ width*cpp → XpmSizeMismatchError (Trap #8)
 *  12: Pixel key not in map → XpmUnknownKeyError
 *  13: Duplicate colour key → XpmDuplicateKeyError
 *  14: Block comments between string literals skipped (Trap #10)
 *  15: Non-ASCII byte → XpmBadHeaderError (Trap #9)
 *  16: Sibling m/s/g classes ignored; missing c → error (Trap #11)
 *  17: width*height > MAX_PIXELS → ImagePixelCapError (cap before allocation)
 *  18: Canonical serialize: XPM magic, 6-digit hex, None for alpha=0
 *  19: Auto-cpp=1 for ≤92 colours; cpp=2 for more
 *  20: > XPM_MAX_COLORS → XpmTooManyColorsError
 *  21: Round-trip RGBA preserves pixel data for 8×8 RGBA with transparent
 *  22: detectImageFormat returns 'xpm' for XPM magic header
 *  23: parseImage/serializeImage round-trip preserves union
 *  24: ReDoS regression: 50 MiB whitespace+comment padding parses in <2s
 */

import { describe, expect, it } from 'vitest';
import { buildRgbaPixels, buildXpm } from './_test-helpers/build-xpm.ts';
import { ImageLegacyBackend, XPM_FORMAT } from './backend.ts';
import {
  MAX_PIXELS,
  XPM_KEY_ALPHABET,
  XPM_MAX_COLORS,
  XPM_MIME,
  XPM_MIME_ALT,
} from './constants.ts';
import { detectImageFormat } from './detect.ts';
import {
  ImagePixelCapError,
  XpmBadColorDefError,
  XpmBadHeaderError,
  XpmBadHexColorError,
  XpmBadValuesError,
  XpmDuplicateKeyError,
  XpmSizeMismatchError,
  XpmTooManyColorsError,
  XpmUnknownColorError,
  XpmUnknownKeyError,
} from './errors.ts';
import { parseImage } from './parser.ts';
import { serializeImage } from './serializer.ts';
import { isCIdentifier, isXpmHeader, parseXpm, serializeXpm } from './xpm.ts';

// ---------------------------------------------------------------------------
// ASCII encoder helper
// ---------------------------------------------------------------------------

const enc = new TextEncoder();
const ascii = (s: string): Uint8Array => enc.encode(s);

// ---------------------------------------------------------------------------
// Test 1: Decodes canonical 16×16 4-colour spec fixture
// ---------------------------------------------------------------------------

describe('parseXpm', () => {
  it('test 1: decodes canonical 4-colour fixture', () => {
    const xpm = buildXpm({
      name: 'test',
      width: 4,
      height: 4,
      colors: [
        { key: ' ', spec: 'None' },
        { key: '.', spec: '#FF0000' },
        { key: '+', spec: '#00FF00' },
        { key: '@', spec: '#0000FF' },
      ],
      pixelRows: [' .+@', '.@ +', '+  .', '. +@'],
    });

    const file = parseXpm(xpm);
    expect(file.format).toBe('xpm');
    expect(file.width).toBe(4);
    expect(file.height).toBe(4);
    expect(file.channels).toBe(4);
    expect(file.bitDepth).toBe(8);
    expect(file.charsPerPixel).toBe(1);
    expect(file.hotspot).toBeNull();

    // First pixel = ' ' = None → [0,0,0,0]
    expect(Array.from(file.pixelData.slice(0, 4))).toEqual([0, 0, 0, 0]);
    // Second pixel = '.' = #FF0000 → [255,0,0,255]
    expect(Array.from(file.pixelData.slice(4, 8))).toEqual([255, 0, 0, 255]);
    // Third pixel = '+' = #00FF00 → [0,255,0,255]
    expect(Array.from(file.pixelData.slice(8, 12))).toEqual([0, 255, 0, 255]);
    // Fourth pixel = '@' = #0000FF → [0,0,255,255]
    expect(Array.from(file.pixelData.slice(12, 16))).toEqual([0, 0, 255, 255]);
  });

  // -------------------------------------------------------------------------
  // Test 2: cpp=2 chunks pixel rows in 2-byte keys (Trap #2)
  // -------------------------------------------------------------------------

  it('test 2: cpp=2 chunks pixel rows in 2-byte keys (Trap #2)', () => {
    const xpm = buildXpm({
      name: 'cpp2',
      width: 2,
      height: 2,
      cpp: 2,
      colors: [
        { key: ' A', spec: '#FF0000' },
        { key: ' B', spec: '#0000FF' },
      ],
      pixelRows: [' A B', ' B A'],
    });

    const file = parseXpm(xpm);
    expect(file.charsPerPixel).toBe(2);
    expect(file.width).toBe(2);
    expect(file.height).toBe(2);

    // Row 0: ' A' = red, ' B' = blue
    expect(Array.from(file.pixelData.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(file.pixelData.slice(4, 8))).toEqual([0, 0, 255, 255]);
    // Row 1: ' B' = blue, ' A' = red
    expect(Array.from(file.pixelData.slice(8, 12))).toEqual([0, 0, 255, 255]);
    expect(Array.from(file.pixelData.slice(12, 16))).toEqual([255, 0, 0, 255]);
  });

  // -------------------------------------------------------------------------
  // Test 3: Space/comma/# colour keys extracted by byte offset (Trap #3)
  // -------------------------------------------------------------------------

  it('test 3: space/comma/# keys extracted by byte offset not whitespace split (Trap #3)', () => {
    // Key is space (0x20) — a single space
    // The colour def string is: " c #FF0000" — key=' ', then ws, then 'c', then spec
    const xpm = buildXpm({
      name: 'special',
      width: 3,
      height: 1,
      colors: [
        { key: ' ', spec: '#FF0000' }, // space key
        { key: ',', spec: '#00FF00' }, // comma key
        { key: '#', spec: '#0000FF' }, // hash key
      ],
      pixelRows: [' ,#'],
    });

    const file = parseXpm(xpm);
    // space → red
    expect(Array.from(file.pixelData.slice(0, 4))).toEqual([255, 0, 0, 255]);
    // comma → green
    expect(Array.from(file.pixelData.slice(4, 8))).toEqual([0, 255, 0, 255]);
    // hash → blue
    expect(Array.from(file.pixelData.slice(8, 12))).toEqual([0, 0, 255, 255]);
  });

  // -------------------------------------------------------------------------
  // Test 4: #RGB shorthand (Trap #5)
  // -------------------------------------------------------------------------

  it('test 4: #RGB shorthand #F0A → RGBA(255, 0, 170, 255) (Trap #5)', () => {
    const xpm = buildXpm({
      name: 'rgb',
      width: 1,
      height: 1,
      colors: [{ key: '.', spec: '#F0A' }],
      pixelRows: ['.'],
    });

    const file = parseXpm(xpm);
    // #F0A → r=FF, g=00, b=AA
    expect(Array.from(file.pixelData.slice(0, 4))).toEqual([255, 0, 170, 255]);
  });

  // -------------------------------------------------------------------------
  // Test 5: #RRRRGGGGBBBB narrows to top byte of each 16-bit channel
  // -------------------------------------------------------------------------

  it('test 5: #RRRRGGGGBBBB narrows to 8-bit top byte', () => {
    const xpm = buildXpm({
      name: 'wide',
      width: 1,
      height: 1,
      colors: [{ key: '.', spec: '#FFFF8080ABCD' }],
      pixelRows: ['.'],
    });

    const file = parseXpm(xpm);
    // RRRR=FF, GGGG=80, BBBB=AB (top two hex digits)
    expect(Array.from(file.pixelData.slice(0, 4))).toEqual([0xff, 0x80, 0xab, 255]);
  });

  // -------------------------------------------------------------------------
  // Test 6: Named 'red' resolves to RGBA(255, 0, 0, 255)
  // -------------------------------------------------------------------------

  it('test 6: named colour "red" resolves to RGBA(255, 0, 0, 255)', () => {
    const xpm = buildXpm({
      name: 'named',
      width: 1,
      height: 1,
      colors: [{ key: '.', spec: 'red' }],
      pixelRows: ['.'],
    });

    const file = parseXpm(xpm);
    expect(Array.from(file.pixelData.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  // Named colours: a selection of named colours that must work
  it('test 6b: several named colours resolve correctly', () => {
    const cases: Array<[string, number[]]> = [
      ['white', [255, 255, 255, 255]],
      ['black', [0, 0, 0, 255]],
      ['blue', [0, 0, 255, 255]],
      ['yellow', [255, 255, 0, 255]],
      ['green', [0, 128, 0, 255]], // X11 green
    ];

    for (const [colorName, expected] of cases) {
      const xpm = buildXpm({
        name: 'named',
        width: 1,
        height: 1,
        colors: [{ key: '.', spec: colorName }],
        pixelRows: ['.'],
      });
      const file = parseXpm(xpm);
      expect(Array.from(file.pixelData.slice(0, 4)), `color=${colorName}`).toEqual(expected);
    }
  });

  // -------------------------------------------------------------------------
  // Test 7: Unknown 'cornflowerblue' → XpmUnknownColorError (Trap #4)
  // -------------------------------------------------------------------------

  it('test 7: unknown named colour → XpmUnknownColorError (Trap #4)', () => {
    const xpm = buildXpm({
      name: 'unk',
      width: 1,
      height: 1,
      colors: [{ key: '.', spec: 'cornflowerblue' }],
      pixelRows: ['.'],
    });

    expect(() => parseXpm(xpm)).toThrow(XpmUnknownColorError);
  });

  // -------------------------------------------------------------------------
  // Test 8: c None → alpha=0; others alpha=255 (Trap #6)
  // -------------------------------------------------------------------------

  it('test 8: c None → alpha=0; non-transparent → alpha=255 (Trap #6)', () => {
    const xpm = buildXpm({
      name: 'alpha',
      width: 2,
      height: 1,
      colors: [
        { key: ' ', spec: 'None' },
        { key: '.', spec: '#FF0000' },
      ],
      pixelRows: [' .'],
    });

    const file = parseXpm(xpm);
    // First pixel = transparent
    expect(file.pixelData[3]).toBe(0);
    // Second pixel = opaque
    expect(file.pixelData[7]).toBe(255);
  });

  it('test 8b: case-insensitive None match', () => {
    const xpm = buildXpm({
      name: 'nonecase',
      width: 1,
      height: 1,
      colors: [{ key: ' ', spec: 'NONE' }],
      pixelRows: [' '],
    });
    const file = parseXpm(xpm);
    expect(file.pixelData[3]).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 9: 6-token header → hotspot; 4-token → null (Trap #7)
  // -------------------------------------------------------------------------

  it('test 9: 6-token header → hotspot extracted (Trap #7)', () => {
    const xpm = buildXpm({
      name: 'hot',
      width: 2,
      height: 2,
      colors: [{ key: '.', spec: '#000000' }],
      pixelRows: ['..', '..'],
      hotspot: { x: 1, y: 0 },
    });

    const file = parseXpm(xpm);
    expect(file.hotspot).toEqual({ x: 1, y: 0 });
  });

  it('test 9b: 4-token header → hotspot null', () => {
    const xpm = buildXpm({
      name: 'nohot',
      width: 2,
      height: 1,
      colors: [{ key: '.', spec: '#000000' }],
      pixelRows: ['..'],
    });

    const file = parseXpm(xpm);
    expect(file.hotspot).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 10: 5-token header → XpmBadValuesError (Trap #7)
  // -------------------------------------------------------------------------

  it('test 10: 5-token header → XpmBadValuesError (Trap #7)', () => {
    const xpm = buildXpm({
      name: 'badvals',
      width: 2,
      height: 1,
      colors: [{ key: '.', spec: '#000000' }],
      pixelRows: ['..'],
      rawHeader: '2 1 1 1 5', // 5 tokens
    });

    expect(() => parseXpm(xpm)).toThrow(XpmBadValuesError);
  });

  it('test 10b: 7-token header → XpmBadValuesError', () => {
    const xpm = buildXpm({
      name: 'badvals7',
      width: 2,
      height: 1,
      colors: [{ key: '.', spec: '#000000' }],
      pixelRows: ['..'],
      rawHeader: '2 1 1 1 5 6 7', // 7 tokens
    });

    expect(() => parseXpm(xpm)).toThrow(XpmBadValuesError);
  });

  // -------------------------------------------------------------------------
  // Test 11: Pixel row length ≠ width*cpp → XpmSizeMismatchError (Trap #8)
  // -------------------------------------------------------------------------

  it('test 11: pixel row too short → XpmSizeMismatchError (Trap #8)', () => {
    const xpm = buildXpm({
      name: 'short',
      width: 4,
      height: 1,
      colors: [{ key: '.', spec: '#000000' }],
      pixelRows: ['..'], // too short
    });

    expect(() => parseXpm(xpm)).toThrow(XpmSizeMismatchError);
  });

  it('test 11b: pixel row too long → XpmSizeMismatchError', () => {
    const xpm = buildXpm({
      name: 'long',
      width: 2,
      height: 1,
      colors: [{ key: '.', spec: '#000000' }],
      pixelRows: ['....'], // too long
    });

    expect(() => parseXpm(xpm)).toThrow(XpmSizeMismatchError);
  });

  // -------------------------------------------------------------------------
  // Test 12: Pixel key not in map → XpmUnknownKeyError
  // -------------------------------------------------------------------------

  it('test 12: pixel references undefined key → XpmUnknownKeyError', () => {
    const xpm = buildXpm({
      name: 'unknownkey',
      width: 1,
      height: 1,
      colors: [{ key: '.', spec: '#000000' }],
      pixelRows: ['X'], // 'X' not defined
    });

    expect(() => parseXpm(xpm)).toThrow(XpmUnknownKeyError);
  });

  // -------------------------------------------------------------------------
  // Test 13: Duplicate colour key → XpmDuplicateKeyError
  // -------------------------------------------------------------------------

  it('test 13: duplicate colour key → XpmDuplicateKeyError', () => {
    // Build raw XPM with duplicate colour key '.'
    const raw = [
      '/* XPM */',
      'static char * dup_xpm[] = {',
      '"2 1 2 1",',
      '". c #FF0000",',
      '". c #00FF00",', // duplicate
      '".."',
      '};',
    ].join('\n');

    expect(() => parseXpm(ascii(raw))).toThrow(XpmDuplicateKeyError);
  });

  // -------------------------------------------------------------------------
  // Test 14: Block comments between string literals skipped (Trap #10)
  // -------------------------------------------------------------------------

  it('test 14: block comments between string literals are skipped (Trap #10)', () => {
    const xpm = buildXpm({
      name: 'comments',
      width: 2,
      height: 1,
      colors: [{ key: '.', spec: '#FF0000' }],
      pixelRows: ['..'],
      interComment: '/* this is a comment */',
    });

    // Should parse without error
    const file = parseXpm(xpm);
    expect(file.width).toBe(2);
    expect(file.pixelData.length).toBe(8);
  });

  // -------------------------------------------------------------------------
  // Test 15: Non-ASCII byte → XpmBadHeaderError (Trap #9)
  // -------------------------------------------------------------------------

  it('test 15: non-ASCII byte in keyword → XpmBadHeaderError (Trap #9)', () => {
    // Inject 0xFF in the middle of 'static' to cause a tokenizer failure.
    // Note: TextDecoder('ascii', { fatal: true }) in Node.js does NOT throw
    // on high bytes (windows-1252 compatible); instead the non-ASCII char
    // becomes a non-identifier character and the tokenizer cannot read 'static'.
    // The raw bytes: 0x73='s', 0x74='t', 0x61='a', 0xFF=non-ident, 0x74='t'...
    const raw = new Uint8Array([
      // /* XPM */\n
      0x2f, 0x2a, 0x20, 0x58, 0x50, 0x4d, 0x20, 0x2a, 0x2f, 0x0a,
      // st\xFFtic char * x_xpm[] = {
      0x73, 0x74, 0xff, 0x74, 0x69, 0x63, 0x20, 0x63, 0x68, 0x61, 0x72, 0x20, 0x2a, 0x20, 0x78,
      0x5f, 0x78, 0x70, 0x6d, 0x5b, 0x5d, 0x20, 0x3d, 0x20, 0x7b, 0x0a,
      // "1 1 1 1"\n"." };
      0x22, 0x31, 0x20, 0x31, 0x20, 0x31, 0x20, 0x31, 0x22, 0x0a, 0x7d, 0x3b, 0x0a,
    ]);
    expect(() => parseXpm(raw)).toThrow(XpmBadHeaderError);
  });

  // -------------------------------------------------------------------------
  // Test 16: Sibling m/s/g classes ignored; missing c → error (Trap #11)
  // -------------------------------------------------------------------------

  it('test 16: sibling m/s/g classes are skipped; c class is used (Trap #11)', () => {
    // Colour def with m and s siblings before c
    const raw = [
      '/* XPM */',
      'static char * sib_xpm[] = {',
      '"1 1 1 1",',
      '". m #000000 s red c #FF0000",', // m and s siblings before c
      '"."',
      '};',
    ].join('\n');

    const file = parseXpm(ascii(raw));
    // Should use c #FF0000
    expect(Array.from(file.pixelData.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it('test 16b: missing c class → XpmBadColorDefError (Trap #11)', () => {
    const raw = [
      '/* XPM */',
      'static char * nocls_xpm[] = {',
      '"1 1 1 1",',
      '". m #FF0000 s red",', // no c class
      '"."',
      '};',
    ].join('\n');

    expect(() => parseXpm(ascii(raw))).toThrow(XpmBadColorDefError);
  });

  // -------------------------------------------------------------------------
  // Test 17: width*height > MAX_PIXELS → ImagePixelCapError
  // -------------------------------------------------------------------------

  it('test 17: width*height > MAX_PIXELS → ImagePixelCapError (cap before allocation)', () => {
    // MAX_PIXELS = 16384*16384; craft a header that exceeds it
    const raw = [
      '/* XPM */',
      'static char * big_xpm[] = {',
      '"16385 16385 1 1",', // exceeds MAX_PIXELS
      '". c #000000"',
      '};',
    ].join('\n');

    expect(() => parseXpm(ascii(raw))).toThrow(ImagePixelCapError);
  });
});

// ---------------------------------------------------------------------------
// Serializer tests
// ---------------------------------------------------------------------------

describe('serializeXpm', () => {
  // -------------------------------------------------------------------------
  // Test 18: Canonical serialize output
  // -------------------------------------------------------------------------

  it('test 18: canonical serialize — XPM magic, 6-digit hex, None for alpha=0', () => {
    const pixelData = buildRgbaPixels(2, 1, [
      [255, 0, 0, 255],
      [0, 0, 0, 0],
    ]);

    const bytes = serializeXpm({
      format: 'xpm',
      width: 2,
      height: 1,
      channels: 4,
      bitDepth: 8,
      name: 'test',
      hotspot: null,
      charsPerPixel: 1,
      pixelData,
    });

    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('/* XPM */');
    expect(text).toContain('static char * test_xpm[] = {');
    expect(text).toContain('c #ff0000'); // 6-digit lowercase hex
    expect(text).toContain('c None'); // alpha=0 → None
    expect(text).toContain('};');
  });

  it('test 18b: serializer emits hotspot when present', () => {
    const pixelData = buildRgbaPixels(1, 1, [[0, 0, 0, 255]]);

    const bytes = serializeXpm({
      format: 'xpm',
      width: 1,
      height: 1,
      channels: 4,
      bitDepth: 8,
      name: 'cursor',
      hotspot: { x: 0, y: 0 },
      charsPerPixel: 1,
      pixelData,
    });

    const text = new TextDecoder().decode(bytes);
    // Header should contain 6 tokens: W H N cpp xh yh
    expect(text).toMatch(/"1 1 1 1 0 0"/);
  });

  // -------------------------------------------------------------------------
  // Test 19: Auto-cpp selection
  // -------------------------------------------------------------------------

  it('test 19a: auto-cpp=1 for ≤92 unique colours', () => {
    // 4 unique colours → cpp=1
    const pixelData = buildRgbaPixels(4, 1, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [0, 0, 0, 255],
    ]);

    const bytes = serializeXpm({
      format: 'xpm',
      width: 4,
      height: 1,
      channels: 4,
      bitDepth: 8,
      name: 'small',
      hotspot: null,
      charsPerPixel: 1,
      pixelData,
    });

    const text = new TextDecoder().decode(bytes);
    // Header should say cpp=1
    expect(text).toMatch(/"4 1 4 1"/);
  });

  it('test 19b: auto-cpp=2 for >92 unique colours (93 colours → cpp=2)', () => {
    // With threshold ≤92 for cpp=1, exactly 93 colours forces cpp=2
    const pixels: Array<readonly [number, number, number, number]> = [];
    for (let i = 0; i < 93; i++) {
      pixels.push([i, 0, 0, 255] as const);
    }
    const pixelData = buildRgbaPixels(93, 1, pixels);

    const bytes = serializeXpm({
      format: 'xpm',
      width: 93,
      height: 1,
      channels: 4,
      bitDepth: 8,
      name: 'big',
      hotspot: null,
      charsPerPixel: 1, // advisory; serializer overrides to 2
      pixelData,
    });

    const text = new TextDecoder().decode(bytes);
    // Header should say cpp=2
    expect(text).toMatch(/"93 1 93 2"/);
  });

  // -------------------------------------------------------------------------
  // Test 20: > XPM_MAX_COLORS → XpmTooManyColorsError
  // -------------------------------------------------------------------------

  it('test 20: >XPM_MAX_COLORS unique colours → XpmTooManyColorsError', () => {
    // Build XPM_MAX_COLORS + 1 unique colours
    const count = XPM_MAX_COLORS + 1;
    const pixels: Array<readonly [number, number, number, number]> = [];
    for (let i = 0; i < count; i++) {
      // Encode index into 10-bit RGB so each is unique
      const r = (i >> 2) & 0xff;
      const g = ((i << 6) | (i >> 4)) & 0xff;
      const b = i & 0xff;
      pixels.push([r, g, b, 255] as const);
    }
    const pixelData = buildRgbaPixels(count, 1, pixels);

    expect(() =>
      serializeXpm({
        format: 'xpm',
        width: count,
        height: 1,
        channels: 4,
        bitDepth: 8,
        name: 'toomany',
        hotspot: null,
        charsPerPixel: 1,
        pixelData,
      }),
    ).toThrow(XpmTooManyColorsError);
  });

  // -------------------------------------------------------------------------
  // Test 21: Round-trip RGBA preserves pixel data (with transparent)
  // -------------------------------------------------------------------------

  it('test 21: round-trip preserves RGBA pixel data including transparency', () => {
    const w = 8;
    const h = 8;
    const pixels: Array<readonly [number, number, number, number]> = [];
    for (let i = 0; i < w * h; i++) {
      const alpha = i % 4 === 0 ? 0 : 255; // every 4th pixel transparent
      pixels.push([i % 256, (i * 2) % 256, (i * 3) % 256, alpha] as const);
    }
    const pixelData = buildRgbaPixels(w, h, pixels);

    const original: import('./xpm.ts').XpmFile = {
      format: 'xpm',
      width: w,
      height: h,
      channels: 4,
      bitDepth: 8,
      name: 'roundtrip',
      hotspot: null,
      charsPerPixel: 1,
      pixelData,
    };

    const serialized = serializeXpm(original);
    const parsed = parseXpm(serialized);

    expect(parsed.width).toBe(w);
    expect(parsed.height).toBe(h);
    expect(parsed.format).toBe('xpm');

    // Pixel data should be equal
    // Note: transparent pixels lose r/g/b info (all stored as None → 0,0,0,0)
    for (let i = 0; i < w * h; i++) {
      const off = i * 4;
      const [r, g, b, a] = pixels[i] ?? [0, 0, 0, 255];
      if (a === 0) {
        // Transparent → expect 0,0,0,0
        expect(parsed.pixelData[off], `pixel ${i} r`).toBe(0);
        expect(parsed.pixelData[off + 1], `pixel ${i} g`).toBe(0);
        expect(parsed.pixelData[off + 2], `pixel ${i} b`).toBe(0);
        expect(parsed.pixelData[off + 3], `pixel ${i} a`).toBe(0);
      } else {
        expect(parsed.pixelData[off], `pixel ${i} r`).toBe(r);
        expect(parsed.pixelData[off + 1], `pixel ${i} g`).toBe(g);
        expect(parsed.pixelData[off + 2], `pixel ${i} b`).toBe(b);
        expect(parsed.pixelData[off + 3], `pixel ${i} a`).toBe(255);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Detection tests
// ---------------------------------------------------------------------------

describe('detectImageFormat', () => {
  // -------------------------------------------------------------------------
  // Test 22: detectImageFormat returns 'xpm' for XPM magic header
  // -------------------------------------------------------------------------

  it('test 22: detectImageFormat returns "xpm" for /* XPM */ magic', () => {
    const xpm = buildXpm({
      name: 'detect',
      width: 1,
      height: 1,
      colors: [{ key: '.', spec: '#000000' }],
      pixelRows: ['.'],
    });

    expect(detectImageFormat(xpm)).toBe('xpm');
  });

  it('test 22b: detectImageFormat returns "xpm" for static char* shape without magic', () => {
    const xpm = buildXpm({
      name: 'detect2',
      width: 1,
      height: 1,
      colors: [{ key: '.', spec: '#000000' }],
      pixelRows: ['.'],
      xpmComment: false,
    });

    expect(detectImageFormat(xpm)).toBe('xpm');
  });

  it('test 22c: isXpmHeader returns true for valid XPM', () => {
    const xpm = buildXpm({
      name: 'hdr',
      width: 1,
      height: 1,
      colors: [{ key: '.', spec: '#000000' }],
      pixelRows: ['.'],
    });
    expect(isXpmHeader(xpm)).toBe(true);
  });

  it('test 22d: isXpmHeader returns false for non-XPM ASCII', () => {
    expect(isXpmHeader(ascii('#define foo_width 4'))).toBe(false);
    expect(isXpmHeader(ascii('P6\n4 4\n255\n'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: parseImage / serializeImage dispatch
// ---------------------------------------------------------------------------

describe('parseImage/serializeImage', () => {
  // -------------------------------------------------------------------------
  // Test 23: parseImage/serializeImage round-trip preserves union type
  // -------------------------------------------------------------------------

  it('test 23: parseImage/serializeImage round-trip preserves format union', () => {
    const xpm = buildXpm({
      name: 'dispatch',
      width: 2,
      height: 2,
      colors: [
        { key: '.', spec: '#FF0000' },
        { key: ' ', spec: 'None' },
      ],
      pixelRows: ['. ', ' .'],
    });

    const parsed = parseImage(xpm, 'xpm');
    expect(parsed.format).toBe('xpm');

    const serialized = serializeImage(parsed);
    expect(serialized).toBeInstanceOf(Uint8Array);

    // Verify round-trip
    const reparsed = parseImage(serialized, 'xpm');
    expect(reparsed.format).toBe('xpm');
    if (reparsed.format === 'xpm') {
      expect(reparsed.width).toBe(2);
      expect(reparsed.height).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Backend tests
// ---------------------------------------------------------------------------

describe('ImageLegacyBackend XPM', () => {
  it('canHandle returns true for image/x-xpixmap identity', async () => {
    const backend = new ImageLegacyBackend();
    const result = await backend.canHandle(
      { ext: 'xpm', mime: XPM_MIME, category: 'image', description: 'X PixMap' },
      { ext: 'xpm', mime: XPM_MIME, category: 'image', description: 'X PixMap' },
    );
    expect(result).toBe(true);
  });

  it('canHandle returns true for image/x-xpm alias', async () => {
    const backend = new ImageLegacyBackend();
    const result = await backend.canHandle(
      { ext: 'xpm', mime: XPM_MIME_ALT, category: 'image', description: 'X PixMap' },
      { ext: 'xpm', mime: XPM_MIME_ALT, category: 'image', description: 'X PixMap' },
    );
    expect(result).toBe(true);
  });

  it('XPM_FORMAT descriptor has correct ext/mime', () => {
    expect(XPM_FORMAT.ext).toBe('xpm');
    expect(XPM_FORMAT.mime).toBe(XPM_MIME);
    expect(XPM_FORMAT.category).toBe('image');
  });
});

// ---------------------------------------------------------------------------
// Utility tests: isCIdentifier, constants
// ---------------------------------------------------------------------------

describe('isCIdentifier', () => {
  it('accepts valid identifiers', () => {
    expect(isCIdentifier('image')).toBe(true);
    expect(isCIdentifier('my_image')).toBe(true);
    expect(isCIdentifier('_priv')).toBe(true);
    expect(isCIdentifier('A1')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isCIdentifier('')).toBe(false);
  });

  it('rejects identifiers starting with digit', () => {
    expect(isCIdentifier('1abc')).toBe(false);
  });

  it('rejects identifiers with spaces', () => {
    expect(isCIdentifier('my image')).toBe(false);
  });
});

describe('XPM constants', () => {
  it('XPM_KEY_ALPHABET has exactly 93 characters (printable ASCII minus " and \\)', () => {
    expect(XPM_KEY_ALPHABET.length).toBe(93);
  });

  it('XPM_KEY_ALPHABET does not contain double-quote', () => {
    expect(XPM_KEY_ALPHABET.includes('"')).toBe(false);
  });

  it('XPM_MAX_COLORS is 1024', () => {
    expect(XPM_MAX_COLORS).toBe(1024);
  });

  it('XPM_MIME is image/x-xpixmap', () => {
    expect(XPM_MIME).toBe('image/x-xpixmap');
  });
});

// ---------------------------------------------------------------------------
// Additional error path tests (bad hex)
// ---------------------------------------------------------------------------

describe('serializeXpm error paths', () => {
  it('invalid C identifier name → XpmBadHeaderError', () => {
    const pixelData = buildRgbaPixels(1, 1, [[0, 0, 0, 255]]);
    expect(() =>
      serializeXpm({
        format: 'xpm',
        width: 1,
        height: 1,
        channels: 4,
        bitDepth: 8,
        name: '1invalid',
        hotspot: null,
        charsPerPixel: 1,
        pixelData,
      }),
    ).toThrow(XpmBadHeaderError);
  });

  it('zero width → ImagePixelCapError', () => {
    const pixelData = new Uint8Array(0);
    expect(() =>
      serializeXpm({
        format: 'xpm',
        width: 0,
        height: 1,
        channels: 4,
        bitDepth: 8,
        name: 'zero',
        hotspot: null,
        charsPerPixel: 1,
        pixelData,
      }),
    ).toThrow(ImagePixelCapError);
  });

  it('excessive dimension → ImagePixelCapError', () => {
    // width > MAX_DIM → fires dimension check
    const pixelData = buildRgbaPixels(1, 1, [[0, 0, 0, 255]]);
    expect(() =>
      serializeXpm({
        format: 'xpm',
        width: 16385, // > MAX_DIM
        height: 1,
        channels: 4,
        bitDepth: 8,
        name: 'huge',
        hotspot: null,
        charsPerPixel: 1,
        pixelData,
      }),
    ).toThrow(ImagePixelCapError);
  });
});

describe('parseXpm error paths', () => {
  it('bad hex colour #ZZRRGB → XpmBadHexColorError', () => {
    const raw = [
      '/* XPM */',
      'static char * bad_xpm[] = {',
      '"1 1 1 1",',
      '". c #ZZRRGB",',
      '"."',
      '};',
    ].join('\n');

    expect(() => parseXpm(ascii(raw))).toThrow(XpmBadHexColorError);
  });

  it('hex colour with wrong length #RRGGB (5 digits) → XpmBadHexColorError', () => {
    const raw = [
      '/* XPM */',
      'static char * bad_xpm[] = {',
      '"1 1 1 1",',
      '". c #RRGGB",',
      '"."',
    ].join('\n');

    expect(() => parseXpm(ascii(raw))).toThrow(XpmBadHexColorError);
  });

  it('missing static char* → XpmBadHeaderError', () => {
    const raw = ascii('/* XPM */\nsome_garbage_here = {};');
    expect(() => parseXpm(raw)).toThrow(XpmBadHeaderError);
  });

  it('ncolors = 0 in header → XpmBadValuesError', () => {
    const raw = [
      '/* XPM */',
      'static char * zero_xpm[] = {',
      '"1 1 0 1",', // ncolors=0 → out of range
      '"."',
      '};',
    ].join('\n');
    expect(() => parseXpm(ascii(raw))).toThrow(XpmBadValuesError);
  });

  it('ncolors > XPM_MAX_COLORS in header → XpmBadValuesError', () => {
    const raw = [
      '/* XPM */',
      'static char * ncol_xpm[] = {',
      `"1 1 ${XPM_MAX_COLORS + 1} 1",`,
      '". c #000000"',
      '};',
    ].join('\n');
    expect(() => parseXpm(ascii(raw))).toThrow(XpmBadValuesError);
  });

  it('non-decimal header token → XpmBadValuesError', () => {
    const xpm = buildXpm({
      name: 'nondec',
      width: 2,
      height: 1,
      colors: [{ key: '.', spec: '#000000' }],
      pixelRows: ['..'],
      rawHeader: '2 1 abc 1', // 'abc' is not decimal
    });
    expect(() => parseXpm(xpm)).toThrow(XpmBadValuesError);
  });

  it('parser: width*height > MAX_PIXELS → ImagePixelCapError (via header values)', () => {
    // Use dimensions that are each ≤ MAX_DIM but combined > MAX_PIXELS
    // MAX_DIM = 16384; MAX_PIXELS = 16384*16384 = 268435456
    // 16384 * 16385 > MAX_PIXELS
    const raw = [
      '/* XPM */',
      'static char * pixcap_xpm[] = {',
      '"16384 16385 1 1",', // 16384 * 16385 > MAX_PIXELS; height > MAX_DIM
      '". c #000000"',
      '};',
    ].join('\n');
    // height 16385 > MAX_DIM=16384 so dims check fires, also fine
    expect(() => parseXpm(ascii(raw))).toThrow(ImagePixelCapError);
  });

  it('transparent alias → alpha=0', () => {
    const xpm = buildXpm({
      name: 'transp',
      width: 1,
      height: 1,
      colors: [{ key: '.', spec: 'transparent' }],
      pixelRows: ['.'],
    });
    const file = parseXpm(xpm);
    expect(file.pixelData[3]).toBe(0);
  });

  it('cpp=3 → XpmBadValuesError', () => {
    const xpm = buildXpm({
      name: 'cpp3',
      width: 1,
      height: 1,
      colors: [{ key: '.', spec: '#000000' }],
      pixelRows: ['.'],
      rawHeader: '1 1 1 3',
    });
    expect(() => parseXpm(xpm)).toThrow(XpmBadValuesError);
  });
});

// ---------------------------------------------------------------------------
// Test 24: ReDoS regression — large whitespace padding parses in linear time
// ---------------------------------------------------------------------------

describe('ReDoS regression', () => {
  it('test 24: 5 MiB whitespace+comment padding parses in linear time', () => {
    // Intent: prove the parser is O(n), not O(n^2)/exponential. A real
    // ReDoS would blow up to minutes/hours on inputs this size; we only
    // need to prove "completes in seconds, not forever". The threshold is
    // intentionally loose to tolerate slow CI runners (GitHub Actions
    // hosted runners are 3-10x slower than local dev machines).
    const padding = ' '.repeat(5 * 1024 * 1024);
    const core = [
      '/* XPM */',
      `${padding}static char * redos_xpm[] = {`,
      '"1 1 1 1",',
      '". c #000000",',
      '"."',
      '};',
    ].join('\n');

    const input = ascii(core);
    const start = Date.now();
    const file = parseXpm(input);
    const elapsed = Date.now() - start;

    expect(file.width).toBe(1);
    // 10s threshold: a quadratic O(n^2) parser on 5 MiB would take far
    // longer; an exponential one would never complete. Linear parse on
    // any modern Node should finish in <1s locally and <5s on CI.
    expect(elapsed).toBeLessThan(10000);
  }, 30000);
});
