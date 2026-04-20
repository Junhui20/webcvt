# image-legacy TIFF design (second pass)

> Implementation reference for the TIFF extension to `@webcvt/image-legacy`.
> This is a SECOND-PASS extension to the package documented in
> [image-legacy.md](./image-legacy.md); read that note first for the
> shared package-level conventions (security caps, typed-error pattern,
> backend identity-within-format, all-synthetic test fixtures, no-streaming).
>
> Per `plan.md §11`, this implementation is **strictly clean-room**: write
> code from the TIFF 6.0 specification (Adobe, June 1992) and the linked
> Technical Notes only. **DO NOT consult libtiff, utif, tiff.js, tiff-js,
> geotiff.js, ImageMagick, GDAL, ExifTool, sharp, or any other extant TIFF
> implementation.**

## Format overview

TIFF (Tag Image File Format) is a container for tagged image data. A
TIFF file is an 8-byte header pointing at a chain of Image File
Directories (IFDs); each IFD is a flat array of typed `(tag, type,
count, value-or-offset)` entries describing one image (a "page"). Pixel
data lives in strips (or tiles, deferred) addressed by `StripOffsets[]`
and `StripByteCounts[]` IFD entries.

## Scope statement

**This is a SECOND-PASS extension for `image-legacy`. TIFF is added as a
sixth sibling format alongside the existing five (PBM/PGM/PPM/PFM/QOI),
inside the same package, using the same conventions.**

### In scope (TIFF second pass for `image-legacy`, ~700-1000 LOC source)

- **TIFF 6.0 baseline** (Adobe, 1992) — both byte orders: `II*\0`
  little-endian (`0x49 0x49 0x2A 0x00`) and `MM\0*` big-endian
  (`0x4D 0x4D 0x00 0x2A`).
- **Multi-IFD support** — return `pages: TiffPage[]`; cap chain at
  `MAX_PAGES`; detect cycles. **Serialization writes single-page only**
  (drops `pages[1..]` with normalisation flag).
- **Compression** (4 of 30+):
  - `1` (NONE)
  - `32773` (PackBits)
  - `5` (LZW post-6.0; with optional `Predictor=2`)
  - `8` / `32946` (DEFLATE / Adobe Deflate via `DecompressionStream('deflate')`).
    **Decision: defer DEFLATE to a follow-up commit** to keep `parseTiff` synchronous in
    the first commit. First commit throws `TiffUnsupportedFeatureError('compression-deflate-async')`.
- **Photometric**: 0 (WhiteIsZero), 1 (BlackIsZero), 2 (RGB), 3 (Palette).
- **Sample types**: 1, 4 (parse-only, unpacks to 8), 8, 16-bit unsigned.
- **Strip layout only** — no tiles.
- **PlanarConfiguration**: 1 (chunky); 2 (planar) parse-only.

### Out of scope (Phase 4.5+ third-pass, DEFERRED)

Tiles, 32-bit float, 64-bit, BigTIFF, CMYK/YCbCr/CIELab, CCITT fax,
JPEG-in-TIFF, LZW pre-6.0 "TIFF Bug 5", EXIF/GPS SubIFD parsing,
ICC profile parsing, XMP, multi-page SERIALIZATION, planar config 2
on serialize, 4-bit nibble pack on serialize, cross-format conversion.

### Lossy round-trip policy

The serializer is allowed to be **strictly more conservative than the
parser**. On serialize we always emit:
- Compression `1` (NONE) — even if input was LZW/DEFLATE
- `PlanarConfiguration=1` — even if input was planar
- `BitsPerSample=8` — even if input was 4-bit
- Single page — even if input had multiple IFDs
- Same byte order as input (preserved)

Surface via `TiffFile.normalisations: TiffNormalisation[]` so callers
can detect lossy round-trips. Byte-equivalent ONLY for canonical layout.

## Official references

- TIFF 6.0 Specification (Adobe, 1992-06-03)
- TIFF Technical Note 2 (Adobe, 1995) — LZW Predictor 2 clarification
- TIFF Technical Note 1 — multi-IFD chain semantics
- TIFF/EP (ISO 12234-2) — secondary cross-reference for LZW MSB-first
- RFC 1951 (DEFLATE), RFC 1950 (zlib container)
- PackBits — TIFF 6.0 §9 reproduction (originally Apple TN1023, 1985)
- WHATWG Compression Streams

## TIFF spec primer — file layout

```
+----------------------+   offset 0
| 8-byte image header  |
+----------------------+
|   pixel data,        |
|   tag value blobs,   |
|   IFDs in any order  |
+----------------------+
```

### Image header (8 bytes)

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 2 | Byte order | `0x4949` (II) = LE; `0x4D4D` (MM) = BE |
| 2 | 2 | Magic | `42` in file's byte order; BigTIFF uses 43 |
| 4 | 4 | First IFD offset | uint32, byte-order-aware |

### IFD layout

```
uint16 entryCount
12-byte entry [0]
12-byte entry [1]
...
12-byte entry [N-1]
uint32 nextIFDOffset (0=end)
```

Each 12-byte entry: `tag(u16) | type(u16) | count(u32) | value-or-offset(4)`.

The "value-or-offset" rule (Trap #2): if `Type`-size × `Count` ≤ 4 bytes,
value is INLINE in entry's last 4 bytes (left-aligned, byte-order-aware).
Otherwise those 4 bytes are a uint32 offset into the file.

### TIFF baseline data types (12)

| Code | Name | Size | Description |
|---|---|---|---|
| 1 | BYTE | 1 | uint8 |
| 2 | ASCII | 1 | 7-bit ASCII NUL-terminated |
| 3 | SHORT | 2 | uint16 |
| 4 | LONG | 4 | uint32 |
| 5 | RATIONAL | 8 | two LONGs |
| 6 | SBYTE | 1 | int8 |
| 7 | UNDEFINED | 1 | opaque |
| 8 | SSHORT | 2 | int16 |
| 9 | SLONG | 4 | int32 |
| 10 | SRATIONAL | 8 | two SLONGs |
| 11 | FLOAT | 4 | IEEE-754 single |
| 12 | DOUBLE | 8 | IEEE-754 double |

### Baseline tags MUST handle

| Tag | Name | Type | Required? | Default |
|---|---|---|---|---|
| 256 | ImageWidth | SHORT/LONG | required | — |
| 257 | ImageLength | SHORT/LONG | required | — |
| 258 | BitsPerSample | SHORT[] | required for >1bpp | `[1]` |
| 259 | Compression | SHORT | required | `1` |
| 262 | PhotometricInterpretation | SHORT | required | — |
| 273 | StripOffsets | SHORT/LONG[] | required | — |
| 277 | SamplesPerPixel | SHORT | required for RGB/Palette | `1` |
| 278 | RowsPerStrip | SHORT/LONG | recommended | `2^32 − 1` |
| 279 | StripByteCounts | SHORT/LONG[] | required | — |
| 282 | XResolution | RATIONAL | recommended | `72/1` |
| 283 | YResolution | RATIONAL | recommended | `72/1` |
| 284 | PlanarConfiguration | SHORT | recommended | `1` |
| 296 | ResolutionUnit | SHORT | recommended | `2` |
| 305 | Software | ASCII | optional | preserved opaque |
| 306 | DateTime | ASCII | optional | preserved opaque |
| 317 | Predictor | SHORT (1/2) | LZW only | `1` |
| 320 | ColorMap | SHORT, count = 3·2^N | required for Photometric=3 | — |
| 338 | ExtraSamples | SHORT | optional | preserved opaque |
| 339 | SampleFormat | SHORT (1/2/3) | optional | `1` |

Tags we don't recognise → preserved as `OtherTag { tag, type, rawBytes }`.

## File map

New files:
- **`tiff.ts`** (~500 LOC)
- **`tiff-lzw.ts`** (~200 LOC)
- **`_test-helpers/build-tiff.ts`** (~150 LOC)

Additions to existing:
- `errors.ts` — 8 new typed errors
- `constants.ts` — `TIFF_MIME`, `TIFF_LE_MAGIC`, `TIFF_BE_MAGIC`,
  `MAX_PAGES`, `MAX_IFD_ENTRIES`, `MAX_LZW_EXPANSION_RATIO`,
  `MAX_DECOMPRESSED_STRIP_BYTES`
- `detect.ts` — extend union; add 4-byte magic match
- `parser.ts` — extend union; add dispatch case
- `serializer.ts` — add dispatch case
- `backend.ts` — add `TIFF_MIME` + `TIFF_FORMAT`
- `index.ts` — re-export

## Type definitions

```ts
export type TiffByteOrder = 'little' | 'big';
export type TiffPhotometric = 0 | 1 | 2 | 3;
export type TiffCompression = 1 | 5 | 8 | 32773 | 32946;
export type TiffPredictor = 1 | 2;
export type TiffPlanarConfig = 1 | 2;

export interface TiffOpaqueTag {
  tag: number;
  type: number;
  count: number;
  rawBytes: Uint8Array;
}

export interface TiffPage {
  width: number;
  height: number;
  photometric: TiffPhotometric;
  samplesPerPixel: number;
  bitsPerSample: number;
  compression: TiffCompression;
  predictor: TiffPredictor;
  planarConfig: TiffPlanarConfig;
  pixelData: Uint8Array | Uint16Array;
  palette?: Uint16Array;
  otherTags: TiffOpaqueTag[];
}

export type TiffNormalisation =
  | 'compression-dropped-to-none'
  | 'planar-flattened-to-chunky'
  | 'bits-per-sample-promoted-to-8'
  | 'multi-page-truncated-to-first';

export interface TiffFile {
  format: 'tiff';
  byteOrder: TiffByteOrder;
  pages: TiffPage[];
  normalisations: TiffNormalisation[];
}

export function parseTiff(input: Uint8Array): TiffFile;
export function serializeTiff(file: TiffFile): Uint8Array;
```

## Typed errors (additions to `errors.ts`)

| Class | Code | Thrown when |
|---|---|---|
| `TiffBadMagicError` | `TIFF_BAD_MAGIC` | First 4 bytes are not II*\0 or MM\0* |
| `TiffUnsupportedFeatureError` | `TIFF_UNSUPPORTED_FEATURE` | BigTIFF, tiles, JPEG-in-TIFF, CMYK/YCbCr, CCITT, etc. |
| `TiffBadIfdError` | `TIFF_BAD_IFD` | IFD declares > MAX_IFD_ENTRIES; offset past EOF |
| `TiffCircularIfdError` | `TIFF_CIRCULAR_IFD` | NextIFDOffset chain revisits prior offset |
| `TiffTooManyPagesError` | `TIFF_TOO_MANY_PAGES` | Page count > MAX_PAGES |
| `TiffBadTagValueError` | `TIFF_BAD_TAG_VALUE` | Required tag missing/wrong type |
| `TiffPackBitsDecodeError` | `TIFF_PACKBITS_DECODE` | Wrong byte count or runs past end |
| `TiffLzwDecodeError` | `TIFF_LZW_DECODE` | Invalid code, code before ClearCode, expansion exceeds cap |
| `TiffDeflateDecodeError` | `TIFF_DEFLATE_DECODE` | DecompressionStream rejects or output exceeds cap |

## Trap list

1. **Byte order is sticky and total.** Governs EVERY multi-byte read
   including IFD entry count, every entry's tag/type/count/value-or-offset,
   `NextIFDOffset`, AND values at external offsets. Magic `42` is itself
   byte-order-sensitive (`2A 00` LE vs `00 2A` BE).

2. **Inline value-or-offset is left-aligned, byte-order-aware.** Bytes [8..11]
   hold value INLINE if total on-disk size ≤ 4 bytes, else they hold a uint32
   offset. Left-aligned: low-address bytes hold the data, high-address bytes
   are unused/zero. A SHORT (2 bytes) value lives in [8..9] with [10..11] zero.
   We do NOT validate the unused bytes (some encoders write garbage).

3. **Type-size × count → inline vs. external.** Cap is byte-count product:
   - BYTE/SBYTE/UNDEFINED (1) inline if count ≤ 4
   - ASCII (1) inline if count ≤ 4
   - SHORT/SSHORT (2) inline if count ≤ 2
   - LONG/SLONG/FLOAT (4) inline if count ≤ 1
   - RATIONAL/SRATIONAL/DOUBLE (8) NEVER inline

4. **`StripOffsets` and `StripByteCounts` types vary per file.** Both can be
   SHORT or LONG; the IFD entry's Type field tells us which. Old scanner output
   uses SHORT; modern multi-MB images use LONG.

5. **`RowsPerStrip` default = 2^32 − 1.** When absent, "the entire image is
   one strip". MUST clamp to ImageLength before computing strip counts.

6. **`StripsPerImage = ceil(ImageLength / RowsPerStrip)`** with the clamp.
   Must equal `StripOffsets.length` (chunky) or `StripsPerImage * SamplesPerPixel`
   (planar).

7. **PackBits header byte is signed int8.** Read uint8, convert: `n = byte > 127 ? byte - 256 : byte`.
   - `n ∈ [0, 127]`: copy n+1 bytes literal
   - `n ∈ [-127, -1]`: repeat next byte (1-n) times
   - `n === -128`: NO-OP, do not consume next byte

8. **PackBits ends when destination buffer is full.** No end marker; stop on
   output count, not input exhaustion. Conversely, if PackBits would read past
   end of source BEFORE producing enough output → corrupt file, throw.

9. **TIFF LZW codes are MSB-first within each byte.** GIF LZW is LSB-first;
   TIFF LZW is MSB-first. Confused parsers cribbed from GIF decoder produce garbage.

10. **TIFF LZW dictionary growth boundary is 510, not 511.** Post-6.0
    "TIFF Bug 5" correction. Width transitions:
    - codes 0..510 use 9 bits
    - codes 511..1022 use 10 bits
    - codes 1023..2046 use 11 bits
    - codes 2047..4094 use 12 bits
    - dictionary full at 4094 → continue 12-bit until ClearCode

11. **LZW ClearCode (256) resets dictionary AND code width to 9.** EOIcode (257)
    terminates. Codes < 256 are single-byte literals. Codes ≥ 258 are dictionary
    lookups. KwKwK case (code = next-to-be-allocated): emit `prev + prev[0]`.

12. **Predictor 2 (horizontal differencing) is per-sample, per-row, applied
    AFTER decompression.** Decoder prefix-sums each row, per channel, modulo
    sample type. Stride between same-channel samples = `samplesPerPixel`.
    For 16-bit, modulo `2^16`; predictor operates on post-byte-order-decoded
    sample value.

13. **Cap IFD chain length AND detect cycles.** Track every IFD start offset
    in `Set<number>`, reject revisits with `TiffCircularIfdError`. Cap chain
    at `MAX_PAGES = 1024`.

14. **Cap IFD entry count at parse time.** 16-bit count permits 65535 entries
    = 786420 bytes. Cap at `MAX_IFD_ENTRIES = 4096`.

15. **Photometric WhiteIsZero (0) inverts grayscale.** 0 = white, max = black.
    We do NOT invert in decode pipeline — buffer carries raw on-disk samples
    and `photometric` field tells consumers how to interpret. This is opposite
    to PFM (which DOES normalise row order on parse).

16. **`ColorMap` for Photometric=3 has 3·2^N entries, NOT 3·N.** Layout:
    "all R values for indices 0..2^N−1, then all G, then all B" — NOT interleaved.
    Each value is uint16 in [0, 65535]. 8-bit indexed → 3·256 = 768 SHORT values.
    Treating as interleaved RGB shifts G/B channels.

17. **`SamplesPerPixel` and `BitsPerSample[]` count must match.** Reject
    heterogeneous bit depths like `[5, 6, 5]` for RGB565 with `TiffUnsupportedFeatureError`.

18. **DEFLATE compression code 8 ≡ 32946.** Both mean RFC 1950 zlib-wrapped
    DEFLATE. Parser accepts both interchangeably.

## Security caps

```ts
export const MAX_PAGES = 1024;
export const MAX_IFD_ENTRIES = 4096;
export const MAX_LZW_EXPANSION_RATIO = 1024;
export const MAX_DECOMPRESSED_STRIP_BYTES = 256 * 1024 * 1024;
export const TIFF_MIME = 'image/tiff';
export const TIFF_LE_MAGIC = new Uint8Array([0x49, 0x49, 0x2A, 0x00]);
export const TIFF_BE_MAGIC = new Uint8Array([0x4D, 0x4D, 0x00, 0x2A]);
```

Pre-existing `MAX_INPUT_BYTES`, `MAX_PIXELS`, `MAX_PIXEL_BYTES`, `MAX_DIM`
apply per page.

## Parser algorithm — top level

1. Validate input size against `MAX_INPUT_BYTES`.
2. Read 8-byte header. Match LE/BE magic; else `TiffBadMagicError`.
3. Construct `DataView` and `read16(off)`/`read32(off)` closures.
4. Read `firstIfdOffset = read32(4)`. Validate ≥ 8 and within bounds.
5. **Walk IFD chain**:
   - `seen = new Set<number>()`, `pages: TiffPage[] = []`, `nextOffset = firstIfdOffset`.
   - Loop:
     - If `nextOffset === 0`, stop.
     - If `seen.has(nextOffset)`, throw `TiffCircularIfdError`.
     - If `pages.length >= MAX_PAGES`, throw `TiffTooManyPagesError`.
     - `seen.add(nextOffset)`.
     - Parse one IFD: `entryCount = read16(nextOffset)`, validate ≤ MAX_IFD_ENTRIES,
       read 12-byte entries into `Map<tag, RawEntry>`, then
       `nextOffset = read32(nextOffset + 2 + entryCount * 12)`.
     - Build TiffPage from entry map; push.
6. Return `{ format: 'tiff', byteOrder, pages, normalisations: [] }`.

## Per-page decode

1. Read required tags. Missing → `TiffBadTagValueError`.
2. Reject early on unsupported features (tiles, photometric not in {0,1,2,3},
   compression not in {1, 5, 32773, 8, 32946}, SampleFormat ≠ 1).
3. Read tags with defaults.
4. Validate cross-field invariants per Trap #17.
5. Validate pixel caps.
6. For each strip: read raw bytes, decompress per compression code,
   concatenate.
7. Apply byte order for 16-bit samples.
8. Apply Predictor 2 if declared (Trap #12).
9. Unpack BitsPerSample 1 or 4 → 8.
10. Read ColorMap if Photometric=3 (Trap #16).
11. Collect remaining tags as `otherTags`.
12. Return assembled TiffPage.

## Compression codecs

### PackBits

```ts
export function packBitsDecode(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let src = 0, dst = 0;
  while (dst < expected) {
    if (src >= input.length) throw new TiffPackBitsDecodeError(/* ... */);
    const headerByte = input[src++];
    const n = headerByte > 127 ? headerByte - 256 : headerByte;
    if (n === -128) continue;
    if (n >= 0) {
      const len = n + 1;
      if (src + len > input.length || dst + len > expected) {
        throw new TiffPackBitsDecodeError(/* ... */);
      }
      out.set(input.subarray(src, src + len), dst);
      src += len; dst += len;
    } else {
      const len = 1 - n;
      if (src >= input.length || dst + len > expected) {
        throw new TiffPackBitsDecodeError(/* ... */);
      }
      out.fill(input[src], dst, dst + len);
      src += 1; dst += len;
    }
  }
  return out;
}
```

### LZW (`tiff-lzw.ts`)

`lzwDecode(input)` implements post-6.0 MSB-first variable-width LZW
(Traps #9, #10, #11). Dictionary is `Uint8Array[]` length 4096; ClearCode
resets dict AND code width to 9; EOIcode terminates. Output expansion
guarded by `MAX_LZW_EXPANSION_RATIO`.

`lzwEncode` is **not implemented** in second pass.

### DEFLATE

**Decision**: defer to follow-up. First commit throws
`TiffUnsupportedFeatureError('compression-deflate-async')` for codes
8/32946 to keep `parseTiff` synchronous.

## Serializer algorithm

1. If `pages.length > 1`, push `'multi-page-truncated-to-first'`. Use `pages[0]`.
2. If `compression !== 1`, push `'compression-dropped-to-none'`.
3. If `planarConfig !== 1`, push `'planar-flattened-to-chunky'`.
4. If `bitsPerSample === 4`, push `'bits-per-sample-promoted-to-8'`.
5. Compute per-row bytes.
6. Build IFD entries. Always emitted: ImageWidth, ImageLength, BitsPerSample,
   Compression(1), Photometric, SamplesPerPixel, RowsPerStrip(=height),
   StripOffsets, StripByteCounts, PlanarConfiguration(1), XResolution(72/1),
   YResolution(72/1), ResolutionUnit(2). + ColorMap if Photometric=3.
   + `otherTags` appended verbatim.
7. Layout: 8-byte header → pixel data (single strip) → IFD → external value blobs.
8. For each entry, decide inline vs. external using Trap #3 rule.
9. Return assembled Uint8Array.

## Top-level dispatch and detection

`detect.ts` extends `ImageFormat` union with `'tiff'`; adds 4-byte magic match
for both byte orders.

`parser.ts`/`serializer.ts` add `case 'tiff'`.
`backend.ts` adds `[TIFF_MIME, 'tiff']` and `TIFF_FORMAT`.
`index.ts` re-exports.

## Backend integration

No structural change. MIME-to-format table grows by one entry. canHandle
remains identity-within-format. convert remains parse → serialize.
Lossy-round-trip diagnostics surface via `TiffFile.normalisations`.

## Fixture strategy

All fixtures inline via `_test-helpers/build-tiff.ts`. NO committed binaries.

```ts
interface BuildTiffPage {
  width: number;
  height: number;
  photometric: 0 | 1 | 2 | 3;
  samplesPerPixel: number;
  bitsPerSample: number;
  compression: 1 | 5 | 32773;
  predictor?: 1 | 2;
  pixelData: Uint8Array;
  palette?: Uint16Array;
  extraTags?: Array<{ tag: number; type: number; values: number[] | string }>;
}

export function buildTiff(opts: {
  byteOrder: 'little' | 'big';
  pages: BuildTiffPage[];
}): Uint8Array;
```

## Test plan (minimum 15 fixtures)

1. parseTiff decodes 2×2 LE RGB 8-bit chunky NONE
2. parseTiff decodes 2×2 BE RGB 8-bit chunky NONE (same pixels as #1)
3. parseTiff decodes 1×1 8-bit grayscale (Photometric=1)
4. parseTiff decodes 9×1 1-bit bilevel (Photometric=0 WhiteIsZero) unpacked
5. parseTiff decodes 4×4 PackBits 8-bit grayscale matches NONE reference
6. parseTiff handles PackBits header byte 0x80 as NO-OP (Trap #7)
7. parseTiff decodes 4×4 LZW 8-bit grayscale (no predictor)
8. parseTiff decodes 4×4 LZW 8-bit RGB with Predictor=2 (chunky stride)
9. parseTiff decodes 2×2 16-bit grayscale BE (Trap #1 + 16-bit byte swap)
10. parseTiff decodes 2×2 8-bit indexed (Photometric=3) palette as 3·256 SHORT (Trap #16)
11. parseTiff decodes 2-page TIFF and returns pages.length === 2
12. parseTiff rejects BigTIFF magic with TiffUnsupportedFeatureError 'bigtiff'
13. parseTiff rejects tile-based TIFF with TiffUnsupportedFeatureError 'tiles'
14. parseTiff rejects circular IFD chain with TiffCircularIfdError
15. parseTiff rejects IFD declaring 65535 entries with TiffBadIfdError
16. parseTiff rejects truncated IFD (NextIFDOffset past EOF)
17. parseTiff rejects Photometric=5 (CMYK) with TiffUnsupportedFeatureError 'photometric-5'
18. parseTiff applies StripsPerImage = ceil(height / RowsPerStrip)
19. parseTiff defaults RowsPerStrip to height when tag absent (Trap #5)
20. parseTiff reads StripOffsets typed as SHORT (Trap #4)
21. serializeTiff round-trips 2×2 RGB 8-bit canonical TIFF byte-equal
22. serializeTiff drops compression to NONE on PackBits input + records normalisation
23. serializeTiff truncates to first page on multi-page input + records normalisation
24. parseTiff caps page count at MAX_PAGES (1024)
25. parseTiff caps LZW expansion at MAX_LZW_EXPANSION_RATIO
26. parseTiff rejects width × height × samplesPerPixel × bytesPerSample > MAX_PIXEL_BYTES
27. detectImageFormat distinguishes II*\0 and MM\0* as 'tiff' but not II+\0 (BigTIFF)
28. parseImage('tiff') and serializeImage round-trip preserve discriminated union
29. ImageLegacyBackend.canHandle returns true for image/tiff → image/tiff

`packBitsDecode` and `lzwDecode` get focused unit tests, especially Trap #10
dictionary-growth-at-510 boundary.

## Dependencies

- `DecompressionStream('deflate')` (deferred; first commit rejects compression 8/32946).
- Hand-rolled LZW (~200 LOC).
- Hand-rolled PackBits (~40 LOC inside `tiff.ts`).
- No NPM dependencies.

## LOC budget

| File | LOC est. |
|---|---|
| tiff.ts | 500 |
| tiff-lzw.ts | 200 |
| _test-helpers/build-tiff.ts | 150 |
| Additions to errors.ts | 80 |
| Additions to constants.ts | 30 |
| Additions to detect.ts/parser.ts/serializer.ts/backend.ts/index.ts | 50 |
| **TIFF source subtotal** | **~1010** |
| tiff.test.ts (29+ tests) | 350 |
| tiff-lzw.test.ts | 80 |
| **TIFF tests subtotal** | **~430** |
| **TIFF total addition** | **~1440** |
