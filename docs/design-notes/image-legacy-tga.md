# image-legacy TGA design (third pass)

> Implementation reference for the TGA (Truevision Targa) extension to
> `@webcvt/image-legacy`. Third-pass extension; read
> [image-legacy.md](./image-legacy.md) and
> [image-legacy-tiff.md](./image-legacy-tiff.md) first for the shared
> package-level conventions.
>
> Per `plan.md §11`, strictly clean-room: write code from the Truevision
> TGA File Format Specification Version 2.0 (1989) only. **DO NOT consult
> libtga, stb_image, ImageMagick, GIMP's file-tga, FreeImage, DevIL,
> SDL_image, or any other extant TGA implementation.**

## Format overview

TGA is a flat, header-driven raster container with optional run-length
compression and an optional file-end footer that distinguishes "TGA 2.0"
from "TGA 1.0". Layout: fixed 18-byte header → optional Image ID →
optional Color Map → image data → (TGA 2.0 only) optional Developer
Area + Extension Area → 26-byte footer.

**Key traps**: all multi-byte ints are little-endian unconditionally
(NO byte-order flag like TIFF). Pixels stored BGR/BGRA NOT RGB/RGBA.
Image origin has 4 variants, bottom-left is the LEGACY default. TGA 1.0
has NO magic bytes; TGA 2.0 has the signature at the END of the file.

## Scope statement

### In scope (TGA third pass, ~500-700 LOC source)

- TGA 1.0 and TGA 2.0 both accepted on parse; serialize always emits TGA 2.0
- All 5 baseline image types: 1 (cmap), 2 (truecolor), 3 (grayscale),
  9 (RLE cmap), 10 (RLE truecolor), 11 (RLE grayscale)
- Type 0 rejected with `TgaNoImageDataError`
- Pixel depths: 8-bit grayscale; 16-bit (5/5/5/1 ARGB); 24-bit BGR; 32-bit BGRA
- Image origin normalised to top-left on parse; always top-left on serialize
- Optional Image ID (0..255 bytes) round-tripped verbatim
- Color Map: 24-bit or 32-bit entries only; 15/16-bit entries deferred
- TGA 2.0 footer detection + round-trip; Extension/Developer areas
  preserved as opaque bytes

### Out of scope (later passes)

- Extension Area subfield parsing (Software ID, Author Name, Comments,
  Date/Time, Postage Stamp, Color Correction Table, Scan Line Table, etc.)
- Developer Area subfield parsing
- 15/16-bit color map entries
- Image types 32/33 (Huffman/Delta/RLE colour-mapped — rare 1989 variant)
- Cross-format conversion

### Lossy round-trip policy

Serializer always emits:
- top-left origin
- TGA 2.0 footer (even if input was 1.0)
- Extension/Developer Area bytes preserved verbatim if captured; else offsets=0
- Image ID preserved verbatim

Lossy conversions surfaced via `TgaFile.normalisations` array.

## Spec primer — file layout

```
+------------------------------+   offset 0
| 18-byte header               |
+------------------------------+   offset 18
| Image ID (0..255 bytes)      |   length = header[0]
+------------------------------+
| Color Map (palette)          |   present if header[1] == 1
+------------------------------+
| Image Data (raw or RLE)      |
+------------------------------+
| Developer Area (TGA 2.0)     |   optional
+------------------------------+
| Extension Area (TGA 2.0)     |   optional
+------------------------------+   offset = fileLength - 26
| 26-byte footer (TGA 2.0)     |   present iff signature matches at EOF
+------------------------------+
```

### 18-byte header

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 1 | ID Length | 0..255 |
| 1 | 1 | Color Map Type | 0=none, 1=present |
| 2 | 1 | Image Type | 0=none, 1=cmap, 2=truecolor, 3=grayscale, 9=RLEcmap, 10=RLEtruecolor, 11=RLEgrayscale |
| 3 | 2 | Color Map First Entry Index | uint16 LE (Trap #8) |
| 5 | 2 | Color Map Length | uint16 LE |
| 7 | 1 | Color Map Entry Size | 15, 16, 24, or 32 |
| 8 | 2 | X-origin | uint16 LE |
| 10 | 2 | Y-origin | uint16 LE |
| 12 | 2 | Image Width | uint16 LE |
| 14 | 2 | Image Height | uint16 LE |
| 16 | 1 | Pixel Depth | 8, 16, 24, or 32 |
| 17 | 1 | Image Descriptor | bits 0-3: alpha bits; bits 4-5: origin; bits 6-7: reserved (must be 0) |

### 26-byte TGA 2.0 footer

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | Extension Area Offset (uint32 LE; 0 = absent) |
| 4 | 4 | Developer Directory Offset (uint32 LE; 0 = absent) |
| 8 | 18 | Signature `TRUEVISION-XFILE.\0` |

### RLE packet format

1-byte header:
- Bit 7 = 1 (REPEAT): count = (header & 0x7F) + 1, followed by ONE pixel repeated count times
- Bit 7 = 0 (RAW): count = (header & 0x7F) + 1, followed by count literal pixels

## File map

New files:
- **`tga.ts`** (~450 LOC) — header parse/build, color-map, raw-pixel,
  RLE decode/encode, BGR↔RGB swap, origin normalisation, footer.
- **`_test-helpers/build-tga.ts`** (~120 LOC) — synthetic fixture builder.

Additions to existing:
- `errors.ts` — 7 new typed errors
- `constants.ts` — `TGA_MIME`, `TGA_FOOTER_SIGNATURE`, `TGA_HEADER_SIZE`,
  `TGA_FOOTER_SIZE`, `MAX_RLE_EXPANSION_RATIO`
- `detect.ts` — footer-first + header-heuristic
- `parser.ts` / `serializer.ts` — dispatch case
- `backend.ts` — MIME entries (`image/x-tga`, `image/tga`, `image/x-targa`)
- `index.ts` — re-exports

## Type definitions

```ts
export type TgaImageType = 1 | 2 | 3 | 9 | 10 | 11;
export type TgaPixelDepth = 8 | 16 | 24 | 32;
export type TgaOrigin = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
export type TgaColorMapEntrySize = 24 | 32;

export interface TgaColorMap {
  firstEntryIndex: number;
  length: number;
  entrySize: TgaColorMapEntrySize;
  /** Decoded RGB or RGBA, NOT BGR/BGRA. Prefix [0, firstEntryIndex) zero-filled. */
  paletteData: Uint8Array;
}

export type TgaNormalisation =
  | 'origin-normalised-to-top-left'
  | 'rle-decoded-on-parse'
  | 'tga-1-promoted-to-tga-2-on-serialize';

export interface TgaFile {
  format: 'tga';
  imageType: TgaImageType;
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  bitDepth: 8;
  originalPixelDepth: TgaPixelDepth;
  originalOrigin: TgaOrigin;
  /** Top-left row-major, RGB/RGBA interleaved. */
  pixelData: Uint8Array;
  colorMap: TgaColorMap | null;
  imageId: Uint8Array;
  xOrigin: number;
  yOrigin: number;
  attributeBits: 0 | 1 | 8;
  hasFooter: boolean;
  extensionAreaBytes: Uint8Array | null;
  developerAreaBytes: Uint8Array | null;
  normalisations: TgaNormalisation[];
}

export function parseTga(input: Uint8Array): TgaFile;
export function serializeTga(file: TgaFile): Uint8Array;
```

## Typed errors

| Class | Code | Thrown when |
|---|---|---|
| `TgaBadHeaderError` | `TGA_BAD_HEADER` | Header < 18 bytes; reserved bits 6-7 set; dimensions zero |
| `TgaUnsupportedImageTypeError` | `TGA_UNSUPPORTED_IMAGE_TYPE` | Image Type not in {1,2,3,9,10,11} |
| `TgaNoImageDataError` | `TGA_NO_IMAGE_DATA` | Image Type = 0 |
| `TgaUnsupportedFeatureError` | `TGA_UNSUPPORTED_FEATURE` | Palette 15/16-bit; type 32/33; pixel-depth mismatch |
| `TgaTruncatedError` | `TGA_TRUNCATED` | Raster bytes exceed input; RLE stops short |
| `TgaRleDecodeError` | `TGA_RLE_DECODE` | RLE would write past output; input underrun |
| `TgaBadFooterError` | `TGA_BAD_FOOTER` | Last 26 bytes match signature substring but malformed |

## Trap list

1. **All multi-byte ints are little-endian unconditionally.** No
   byte-order flag. Use `DataView.getUint16(off, true)` and
   `getUint32(off, true)`.

2. **TGA stores BGR/BGRA, NOT RGB/RGBA.** 24-bit: on-disk byte order
   per pixel is `B,G,R`. 32-bit: `B,G,R,A`. Swap on read, swap on write.
   Applies to both uncompressed AND RLE-expanded data.

3. **16-bit is 5/5/5/1 ARGB packed little-endian.** Not 5/6/5 RGB.
   Layout MSB to LSB: `A | RRRRR | GGGGG | BBBBB`.
   Expand each 5-bit channel: `(c5 << 3) | (c5 >> 2)`.

4. **Image origin — bottom-left is LEGACY default.** Bits 4-5 of byte 17:
   00=BL (legacy), 01=BR, 10=TL (modern), 11=TR. Normalise on parse:
   - BL → row-flip
   - BR → row-flip + per-row reverse
   - TL → no-op
   - TR → per-row reverse
   Serialize always emits TL. **Use asymmetric test fixtures** (L-shape
   not checkerboard) to catch regressions.

5. **TGA 1.0 has NO magic bytes — detection is structural.** Strategy:
   (1) if last 18 bytes match `TRUEVISION-XFILE.\0` → TGA 2.0, fast path
   (2) else header sanity check: colorMapType ∈ {0,1}, imageType ∈
   {0,1,2,3,9,10,11}, pixelDepth ∈ {8,16,24,32}, reserved bits 6-7 = 0,
   dimensions ≥ 1, raster fits in remaining input
   (3) else null.

6. **Footer signature is exactly 18 bytes**: `TRUEVISION-XFILE.\0` —
   16 ASCII chars + dot `.` (0x2E) + NUL (0x00). Every byte counts.
   Partial matches → `TgaBadFooterError`.

7. **RLE packet math**:
   - REPEAT (bit 7 = 1): count = (header & 0x7F) + 1, range 1..128,
     followed by ONE pixel written count times
   - RAW (bit 7 = 0): count = (header & 0x7F) + 1, range 1..128,
     followed by count literal pixels
   - Packet header 0x00 is a 1-pixel RAW, NOT a no-op (differs from PackBits!)
   - No stream terminator — stop at expected pixel count

8. **Color Map First Entry Index can be non-zero.** On-disk map block
   length is `(colorMapLength - firstEntryIndex) * bytesPerEntry`,
   NOT `colorMapLength * bytesPerEntry`. Parser zero-fills indices
   [0, firstEntryIndex) in the decoded `paletteData`.

9. **Not every (imageType, pixelDepth) pair is legal:**
   - Type 1: depth 8 only
   - Type 2: depth ∈ {16, 24, 32}
   - Type 3: depth 8 only
   - Types 9/10/11 mirror 1/2/3
   Reject other combinations with `TgaUnsupportedFeatureError`.

10. **attributeBits must be consistent**: byte 17 bits 0-3:
    - depth 24: must be 0
    - depth 32: must be 8
    - depth 16: 0 or 1
    - 8-bit (grayscale or indexed): 0
    Other → `TgaBadHeaderError`.

11. **RLE packets MAY cross scanline boundaries** in real files (spec
    forbids it but many encoders violate). Decoder operates on full
    raster as one byte stream. Still validates exact width×height pixels.

12. **RLE cap is by absolute output size, not ratio.** Pre-allocate
    `width × height × bytesPerPixel` buffer; reject any packet that
    writes past it. Exact bound, not heuristic.

13. **Header byte 17 bits 6-7 are reserved and MUST be zero.** Non-zero
    → `TgaBadHeaderError`. Stricter than TIFF's tag handling because
    the field is explicitly reserved.

14. **Image ID length 0 means no ID block.** Color map (if any) then
    starts at offset 18.

15. **Color Map data also BGR/BGRA.** 24-bit palette entries are `B,G,R`
    on disk; 32-bit are `B,G,R,A`. Swap to RGB/RGBA on parse.

## Security caps

```ts
export const TGA_MIME = 'image/x-tga';
export const TGA_FOOTER_SIGNATURE = new Uint8Array([
  0x54, 0x52, 0x55, 0x45, 0x56, 0x49, 0x53, 0x49, 0x4F, 0x4E,  // 'TRUEVISI ON'
  0x2D, 0x58, 0x46, 0x49, 0x4C, 0x45,                          // '-XFILE'
  0x2E, 0x00,                                                  // '.\0'
]);
export const TGA_HEADER_SIZE = 18;
export const TGA_FOOTER_SIZE = 26;
export const MAX_RLE_EXPANSION_RATIO = 128;  // documentary
```

Pre-existing `MAX_INPUT_BYTES`, `MAX_PIXELS`, `MAX_PIXEL_BYTES`, `MAX_DIM`
apply unchanged. No new global cap needed — RLE decoder uses pre-allocated
output buffer bounds as expansion guard.

**Allocation order**:
1. Validate input size
2. Read header (no allocation)
3. Validate dimensions + pixel count + pixel bytes caps
4. ONLY THEN allocate output `Uint8Array`
5. Decode into pre-allocated buffer with bounds checks

## Parser algorithm

1. Validate input.length ≥ TGA_HEADER_SIZE and ≤ MAX_INPUT_BYTES
2. Read 18-byte header via DataView (all LE)
3. Validate imageType ∈ {1,2,3,9,10,11}; 0 → `TgaNoImageDataError`;
   32/33 → `TgaUnsupportedFeatureError`
4. Validate (imageType, pixelDepth) legal pair (Trap #9)
5. Validate attributeBits consistent (Trap #10)
6. Validate reserved bits (Trap #13)
7. Validate dimensions + pixel caps
8. Compute offsets: imageId, colorMap, pixelData
9. Slice Image ID
10. Parse Color Map with BGR-to-RGB swap + zero-fill prefix (Trap #8, #15)
11. Decode pixel data into pre-allocated output buffer:
    - Types 1/2/3: raw byte copy with BGR→RGB swap + 16-bit unpack
    - Types 9/10/11: RLE expand + BGR→RGB swap + 16-bit unpack
12. Apply origin normalisation (Trap #4)
13. Parse footer (Trap #5, #6): if last 18 bytes match signature,
    read offsets and slice extension/developer area bytes
14. Build normalisations array
15. Return TgaFile

## RLE decoder pseudocode

```ts
function decodeTgaRle(
  input: Uint8Array,
  inputOffset: number,
  bytesPerPixel: 1 | 2 | 3 | 4,
  expectedPixels: number,
): Uint8Array {
  const out = new Uint8Array(expectedPixels * bytesPerPixel);
  let src = inputOffset;
  let dst = 0;
  while (dst < out.length) {
    if (src >= input.length) throw new TgaRleDecodeError('input-underrun');
    const header = input[src++];
    const count = (header & 0x7F) + 1;
    const isRepeat = (header & 0x80) !== 0;
    const writeBytes = count * bytesPerPixel;
    if (dst + writeBytes > out.length) {
      throw new TgaRleDecodeError('output-overflow');
    }
    if (isRepeat) {
      if (src + bytesPerPixel > input.length) {
        throw new TgaRleDecodeError('input-underrun');
      }
      for (let i = 0; i < count; i++) {
        for (let b = 0; b < bytesPerPixel; b++) {
          out[dst + i * bytesPerPixel + b] = input[src + b];
        }
      }
      src += bytesPerPixel;
    } else {
      if (src + writeBytes > input.length) {
        throw new TgaRleDecodeError('input-underrun');
      }
      out.set(input.subarray(src, src + writeBytes), dst);
      src += writeBytes;
    }
    dst += writeBytes;
  }
  return out;
}
```

BGR-to-RGB swap and 16-bit ARGB1555 unpack happen in a separate post-pass
over the contiguous decoded byte stream.

## Serializer algorithm

1. Build 18-byte header; always top-left origin (Trap #4)
2. Append imageId
3. Emit color map with RGB→BGR swap + skip firstEntryIndex prefix
4. Emit pixel data:
   - Types 1/2/3: raw with RGB→BGR swap, 16-bit ARGB1555 re-pack
   - Types 9/10/11: greedy RLE re-encode (NOT byte-equal round-trip)
5. If extension/developer area bytes captured: emit at fresh offsets
6. Always emit TGA 2.0 footer with current offsets + canonical signature
7. If `hasFooter === false` on parse: add `'tga-1-promoted-to-tga-2-on-serialize'`

Round-trip contract:
- Canonical layout (top-left, uncompressed, no extension area): byte-equal
- RLE: structural equivalence only (encoder byte stream differs)
- Extension/Developer areas preserved verbatim

## Test plan (25+ fixtures)

1. 2×2 uncompressed 24-bit truecolor; BGR→RGB verified
2. 2×2 uncompressed 32-bit truecolor (attributeBits=8); BGRA→RGBA verified
3. 4×4 uncompressed 8-bit grayscale
4. 4×4 RLE 24-bit truecolor (REPEAT 0xFF + RAW 0x00 packets)
5. 4×4 RLE 8-bit grayscale
6. 2×2 uncompressed cmap with 24-bit BGR palette; palette RGB-swapped
7. 2×2 uncompressed 16-bit ARGB1555 (attributeBits=1); unpack verified
8. Bottom-left origin normalised via asymmetric L-shape (Trap #4)
9. Top-left origin passes through unchanged
10. TGA 2.0 footer detected + hasFooter=true; corrupt signature rejected
11. Truncated raster → TgaTruncatedError
12. RLE output-overflow → TgaRleDecodeError
13. Image Type 0 → TgaNoImageDataError
14. Palette entry size 16 → TgaUnsupportedFeatureError
15. Reserved bits 6-7 set → TgaBadHeaderError
16. colorMapStart ≠ 0 handled (Trap #8)
17. Image ID bytes preserved verbatim
18. Extension/Developer Area bytes round-tripped
19. Round-trip canonical Type 2 byte-equal
20. TGA 1.0 → TGA 2.0 promotion + normalisation flag
21. Origin normalisation flag on non-TL input
22. Type 10 RLE structural round-trip (pixelData equal, bytes differ)
23. detectImageFormat via footer; via header heuristic; null for non-TGA
24. parseImage / serializeImage dispatch round-trip
25. Backend canHandle accepts image/x-tga, image/tga, image/x-targa

Per-helper tests on `decodeTgaRle`: packet 0x00 (1-pixel RAW), 0x7F
(128-pixel RAW), 0x80 (1-pixel REPEAT, NOT no-op — Trap #7 contrast
with PackBits!), 0xFF (128-pixel REPEAT), output-overflow boundaries.

## LOC budget

| File | LOC est. |
|---|---|
| tga.ts | 450 |
| _test-helpers/build-tga.ts | 120 |
| Additions to errors.ts (7 new classes) | 60 |
| Additions to constants.ts | 25 |
| Additions to detect.ts | 35 |
| Additions to parser/serializer/backend/index | 30 |
| **TGA source subtotal** | **~720** |
| tga.test.ts (25+ tests) | 320 |
| **TGA tests subtotal** | **~320** |
| **TGA total addition** | **~1040** |
