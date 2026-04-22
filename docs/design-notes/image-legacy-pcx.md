# image-legacy PCX design (fifth pass)

> PCX (PC Paintbrush / ZSoft) extension to `@catlabtech/webcvt-image-legacy`. Read
> `image-legacy.md` and `image-legacy-tga.md` first — PCX is spiritually
> closest to TGA (fixed header + RLE + optional palette block).
>
> Strictly clean-room per plan.md §11: ZSoft PCX File Format Technical
> Reference Manual (1991, version 5) only. NO porting from ImageMagick,
> GIMP, libpcx, stb_image, FreeImage, SDL_image, netpbm.

## Format overview

Fixed 128-byte header + per-scanline RLE pixel data + optional 769-byte
256-colour VGA palette at EOF (v5 only, detected via `0x0C` sentinel).
All multi-byte ints little-endian unconditionally. Multi-plane images
use PLANAR-per-scanline layout, NOT pixel-interleaved.

## Scope

### In scope (~400-600 LOC source)

- PCX versions 0, 2, 3, 4, 5 on parse; serialize always emits version 5
- Bit depths / plane combinations:
  - 1/1: 1-bit bilevel (EGA palette indices 0-1)
  - 2/1: 2-bit CGA (EGA indices 0-3)
  - 4/1: 4-bit EGA-packed
  - 1/4: 4-bit EGA-planar (four bit-planes combined)
  - 8/1: 8-bit indexed VGA (if footer present) or grayscale
  - 8/3: 24-bit truecolor (planar per scanline)
- 16-colour EGA palette in header (bytes 16-63)
- 256-colour VGA palette footer detection + round-trip
- RLE decode/encode per scanline

### Out of scope (deferred)

- 32-bit with alpha (NPlanes=4 + BPP=8) — rare custom encoders
- DCX (multi-page PCX for fax) — separate design note
- BPP=2,4 with NPlanes>1 — spec-legal but never observed

### Lossy round-trip policy

Serializer always emits: v5 header, RLE encoding, even recomputed
`bytesPerLine`, VGA palette footer if present. Normalisations flagged
in `PcxFile.normalisations`.

## Spec primer — 128-byte header

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 1 | Manufacturer | Must be `0x0A` |
| 1 | 1 | Version | 0, 2, 3, 4, or 5 |
| 2 | 1 | Encoding | Must be `1` (RLE) |
| 3 | 1 | BitsPerPixel | 1, 2, 4, or 8 per plane |
| 4 | 2 | Xmin | uint16 LE |
| 6 | 2 | Ymin | uint16 LE |
| 8 | 2 | Xmax | uint16 LE |
| 10 | 2 | Ymax | uint16 LE |
| 12 | 2 | HDpi | uint16 LE |
| 14 | 2 | VDpi | uint16 LE |
| 16 | 48 | EGA Palette | 16 × RGB triplets |
| 64 | 1 | Reserved | Preserve verbatim |
| 65 | 1 | NPlanes | 1, 3, or 4 |
| 66 | 2 | BytesPerLine | uint16 LE; MUST be even |
| 68 | 2 | PaletteInfo | 1=colour, 2=grayscale (advisory) |
| 70 | 2 | HScreenSize | uint16 LE |
| 72 | 2 | VScreenSize | uint16 LE |
| 74 | 54 | Reserved | Preserve verbatim |

Width = Xmax − Xmin + 1; Height = Ymax − Ymin + 1.

### RLE packet format (per byte stream)

- Byte with top 2 bits set (`b & 0xC0 == 0xC0`): RUN header
  - count = `b & 0x3F` (range 1..63, NOT biased)
  - Next byte is data; emit count times
- Else: literal byte; emit once

Max run length 63; no stream terminator.

### Scanline layout for NPlanes > 1

Per scanline: `[plane0 × BytesPerLine][plane1 × BytesPerLine]...[planeN-1 × BytesPerLine]`

NOT pixel-interleaved. For 24-bit truecolor:
```
[R0 R1 ... R(width-1) pad...][G0 G1 ... pad...][B0 B1 ... pad...]
```

### 256-colour VGA palette footer

Present iff version==5 AND fileLength≥128+769 AND byte at
fileLength−769 equals `0x0C`. Following 768 bytes are RGB triplets
(NOT BGR — unlike TGA).

## File map

New:
- `pcx.ts` (~400 LOC) — header + RLE + planar de/interleave + footer
- `_test-helpers/build-pcx.ts` (~120 LOC) — fixture builder

Modified:
- `errors.ts` — 6 new typed errors
- `constants.ts` — PCX_MAGIC, sentinel, sizes
- `detect.ts` — magic byte sniff
- `parser.ts`/`serializer.ts` — dispatch
- `backend.ts` — MIME registry (`image/x-pcx`, `image/pcx`)
- `index.ts` — re-exports
- `core/formats.ts` — format entry

## Type definitions

```ts
export type PcxVersion = 0 | 2 | 3 | 4 | 5;
export type PcxBitsPerPixel = 1 | 2 | 4 | 8;
export type PcxNPlanes = 1 | 3 | 4;

export type PcxKind =
  | '1bit-bilevel'
  | '2bit-cga'
  | '4bit-ega-packed'
  | '4bit-ega-planar'
  | '8bit-indexed-vga'
  | '8bit-grayscale'
  | '24bit-truecolor';

export type PcxNormalisation =
  | 'rle-decoded-on-parse'
  | 'planar-deinterleaved-to-packed-rgb'
  | 'bytesperline-pad-bytes-stripped'
  | 'version-promoted-to-5-on-serialize';

export interface PcxFile {
  format: 'pcx';
  version: PcxVersion;
  kind: PcxKind;
  width: number;
  height: number;
  channels: 1 | 3;
  bitDepth: 8;

  originalBitsPerPixel: PcxBitsPerPixel;
  originalNPlanes: PcxNPlanes;

  /** Top-down row-major packed:
   *  - 1/2/4-bit and 8-bit-indexed/grayscale: 1 byte per pixel
   *  - 24-bit truecolor: 3 bytes per pixel, interleaved RGB */
  pixelData: Uint8Array;

  /** 48 bytes, always present. */
  egaPalette: Uint8Array;
  /** 768 bytes iff v5 with footer; null otherwise. */
  vgaPalette: Uint8Array | null;

  xMin: number;
  yMin: number;
  hDpi: number;
  vDpi: number;
  paletteInfo: number;
  hScreenSize: number;
  vScreenSize: number;
  reservedByte64: number;
  reserved54: Uint8Array;

  normalisations: PcxNormalisation[];
}

export function parsePcx(input: Uint8Array): PcxFile;
export function serializePcx(file: PcxFile): Uint8Array;
```

## Typed errors

| Class | Code | Thrown when |
|---|---|---|
| `PcxBadMagicError` | `PCX_BAD_MAGIC` | Byte 0 ≠ 0x0A |
| `PcxBadVersionError` | `PCX_BAD_VERSION` | Byte 1 ∉ {0,2,3,4,5} |
| `PcxBadEncodingError` | `PCX_BAD_ENCODING` | Byte 2 ≠ 1 |
| `PcxBadHeaderError` | `PCX_BAD_HEADER` | Xmax<Xmin; Ymax<Ymin; BytesPerLine odd/too-small |
| `PcxUnsupportedFeatureError` | `PCX_UNSUPPORTED_FEATURE` | Invalid BPP/NPlanes combination |
| `PcxRleDecodeError` | `PCX_RLE_DECODE` | Input underrun; output overflow |

## Trap list

1. **All multi-byte ints little-endian unconditionally.** No byte-order
   flag. Use `DataView.getUint16(off, true)`.

2. **Width = Xmax − Xmin + 1** (NOT Xmax). Xmin/Ymin frequently non-zero.
   Validate `Xmax ≥ Xmin` BEFORE subtraction to avoid uint16 wrap.
   Reject width/height = 0.

3. **BytesPerLine may be GREATER than `ceil(width × BPP / 8)`.** Spec
   requires even. Trailing pad bytes per plane per scanline — DISCARD
   on decode. Serializer recomputes:
   ```ts
   const min = Math.ceil((width * bitsPerPixel) / 8);
   const bytesPerLine = min + (min & 1); // round up to even
   ```

4. **Scanline layout is PLANAR per scanline for NPlanes > 1.** NOT
   pixel-interleaved. For RGB:
   ```
   scanline = [R_bytes][G_bytes][B_bytes]
   pixel(c,i) = { R: scan[0*BPL + c], G: scan[1*BPL + c], B: scan[2*BPL + c] }
   ```
   4-bit EGA-planar (1/4): bit `(7 - c%8)` of byte `c/8` across 4 planes
   combines into 4-bit EGA index.

5. **RLE count byte: top 2 bits set (0xC0..0xFF), low 6 bits = count 1-63.**
   Count NOT biased by 1. Max count is 63 (NOT 128 like TGA, NOT 255).
   **Any byte >= 0xC0 must be wrapped as 1-count RUN on encode even as
   single pixel** — literal bytes in [0xC0..0xFF] collide with RUN
   header. Asymmetric trap specific to PCX; missing this corrupts any
   image with bytes in high quarter of value range.

6. **RLE runs MUST NOT cross scanline boundaries per spec** (but real
   encoders violate). Decoder walks full body as one byte stream
   (max compat). Encoder resets RLE state at each scanline boundary.
   Byte-equal round-trip NOT guaranteed for RLE; structural equality only.

7. **256-colour palette footer detection is TAIL SCAN.** Only the byte
   at EXACTLY `fileLength − 769` being `0x0C` counts. Do NOT scan body
   for `0x0C`. RLE decoder stops when expected bytes emitted, NOT at
   EOF — any gap between last RLE byte consumed and footer is ignored.

8. **(BPP=8, NPlanes=1) is AMBIGUOUS without footer.** Footer present =
   8-bit indexed VGA; footer absent = 8-bit grayscale. `PaletteInfo` is
   advisory; the footer's presence is the sole signal.

9. **1-bit bilevel uses EGA palette[0..1], NOT hard-coded black/white.**
   PC Paintbrush often shipped 1-bit files with non-default palette
   (e.g. dark blue + white). Decoders that hard-code black/white lose
   the original colors. We store indices in pixelData and surface the
   EGA palette; consumers do the lookup.

10. **Not every (BPP, NPlanes) pair is legal.** Supported:
    (1,1), (2,1), (4,1), (1,4), (8,1), (8,3). Others → typed error.

## Security caps

```ts
export const PCX_MAGIC = 0x0A;
export const PCX_ENCODING_RLE = 0x01;
export const PCX_PALETTE_SENTINEL = 0x0C;
export const PCX_HEADER_SIZE = 128;
export const PCX_PALETTE_FOOTER_SIZE = 769;
export const PCX_EGA_PALETTE_SIZE = 48;
export const PCX_VGA_PALETTE_SIZE = 768;
export const PCX_MAX_RUN = 63;
```

Pre-existing `MAX_INPUT_BYTES`, `MAX_DIM`, `MAX_PIXELS`, `MAX_PIXEL_BYTES`
apply unchanged. RLE guard = pre-allocated output buffer size (exact,
not ratio).

**Allocation order**:
1. Validate input size
2. Parse header (no alloc)
3. Validate magic/version/encoding/(BPP,NPlanes) combination
4. Validate dimensions + pixel caps
5. Validate BytesPerLine even + ≥ minimum
6. ONLY THEN allocate raw-raster `height × NPlanes × BytesPerLine`
7. Allocate output `pixelData`
8. Decode + de-planarise + strip pad

## Parser algorithm

1. Validate input size
2. Parse 128-byte header via DataView (all LE)
3. Validate magic (0x0A), version, encoding, BPP, NPlanes, combination
4. Compute width/height (Trap #2)
5. Validate BytesPerLine (Trap #3)
6. Validate dimension + pixel caps
7. Tail-check VGA palette footer (Trap #7); body end = fileLength − 769 or fileLength
8. Allocate raw-raster buffer
9. Walk RLE stream from offset 128 to body-end, fill raw-raster (Trap #5, #6)
10. Allocate pixelData
11. De-planarise + strip pad per scanline per Kind (Trap #4)
12. Slice egaPalette, reserved54, optional vgaPalette
13. Decide kind per (BPP, NPlanes, vgaPalette-presence) (Trap #8)
14. Build normalisations; return PcxFile

## RLE decoder pseudocode

```ts
function decodePcxRle(
  input: Uint8Array,
  inputOffset: number,
  inputEnd: number,
  expectedBytes: number,
): Uint8Array {
  const out = new Uint8Array(expectedBytes);
  let src = inputOffset;
  let dst = 0;
  while (dst < expectedBytes) {
    if (src >= inputEnd) throw new PcxRleDecodeError('input-underrun');
    const b = input[src++];
    if ((b & 0xC0) === 0xC0) {
      const count = b & 0x3F;
      if (src >= inputEnd) throw new PcxRleDecodeError('input-underrun');
      const data = input[src++];
      if (dst + count > expectedBytes) {
        throw new PcxRleDecodeError('output-overflow');
      }
      for (let i = 0; i < count; i++) out[dst + i] = data;
      dst += count;
    } else {
      out[dst++] = b;
    }
  }
  return out;
}
```

## Serializer algorithm

1. Recompute bytesPerLine = even minimum
2. Build 128-byte header; always v5
3. Re-planarise pixelData + zero-pad each scanline to bytesPerLine
4. RLE-encode each scanline:
   - Greedy run detection, max 63
   - Any byte ≥ 0xC0 must be RUN even as single pixel (Trap #5)
   - Reset state at scanline boundary (Trap #6)
5. Concat header + RLE body
6. If `vgaPalette !== null`: append `0x0C` + 768 palette bytes
7. Flag `'version-promoted-to-5-on-serialize'` if input version ≠ 5

## Test plan (30+ cases)

1. Decode 4×4 v5 8-bit grayscale (no footer)
2. Decode 4×4 v5 8-bit indexed WITH palette footer
3. Decode 4×4 v5 24-bit truecolor NPlanes=3; verify planar→interleaved
4. Decode 4×4 4-bit EGA-packed; apply palette indices
5. Decode 4×4 4-bit EGA-planar (BPP=1, NPlanes=4); combine bit-planes
6. Decode 8×1 1-bit bilevel with non-default EGA palette (Trap #9)
7. Width = Xmax−Xmin+1 with Xmin=10, Xmax=13 → width 4 (Trap #2)
8. Strip trailing pad bytes for width=9, BPL=10 (Trap #3)
9. Reject odd BytesPerLine → PcxBadHeaderError
10. Reject Manufacturer ≠ 0x0A → PcxBadMagicError
11. Reject Version=1 → PcxBadVersionError
12. Reject Encoding=0 → PcxBadEncodingError
13. Reject BPP=8+NPlanes=4 → PcxUnsupportedFeatureError
14. Decode RUN 0xC3 0xAA → 3 × 0xAA (Trap #5)
15. Decode literal 0x7F as 1 pixel
16. Reject RLE input underrun
17. Reject RLE output overflow
18. Tolerate RLE run crossing scanline (Trap #6)
19. Ignore 0x0C byte mid-file (only tail offset counts; Trap #7)
20. Preserve reservedByte64 + reserved54 verbatim
21. Preserve EGA palette verbatim even for truecolor
22. Round-trip 24-bit truecolor structural
23. Round-trip 8-bit indexed + VGA palette
24. Serializer wraps literal 0xC5 as RUN 0xC1 0xC5 (Trap #5)
25. Serializer splits 100-long run into RUN(63) + RUN(37)
26. Serializer always emits v5; flags 'version-promoted-to-5-on-serialize'
27. Serializer recomputes even BytesPerLine
28. `detectImageFormat` returns 'pcx' for magic byte + encoding=1 + version valid
29. `detectImageFormat` returns null for encoding=0
30. Dispatch via parseImage/serializeImage
31. Backend canHandle accepts image/x-pcx + image/pcx

## Dependencies

None beyond existing package machinery. No third-party libraries.

## LOC budget

| File | LOC |
|---|---|
| pcx.ts | 400 |
| _test-helpers/build-pcx.ts | 120 |
| errors.ts (6 classes) | 50 |
| constants.ts | 20 |
| detect.ts | 20 |
| parser/serializer/backend/index/core/formats | 30 |
| **Source subtotal** | **~640** |
| pcx.test.ts (30+ tests) | 300 |
| **Total addition** | **~940** |
