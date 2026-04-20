# image-legacy ICNS design

> Apple Icon Image format — IFF-style multi-resolution icon container.
> Read image-legacy.md + image-legacy-tiff.md first (chunk-walker +
> PackBits reuse).
>
> Clean-room per plan.md §11: Apple Icon Composer Guide + TN2166 +
> Wikipedia tabular summary only. NO porting from libicns, icnsify,
> icnsutil, node-icns, ImageMagick coders/icon.c, Darwin CoreServices.

## Scope

### In scope (~500-900 LOC source)

Header: 8 bytes = FourCC `'icns'` (0x69636E73) + uint32 BE totalSize.

Elements: FourCC + uint32 BE size + payload. Walk from offset 8.

Supported types:
- `ICN#` (32×32×1-bit + mask, 256 bytes)
- `is32` + `s8mk` (16×16 PackBits RGB + uncompressed 8-bit alpha)
- `il32` + `l8mk` (32×32)
- `ih32` + `h8mk` (48×48)
- `it32` + `t8mk` (128×128 with 4-byte zero prefix before PackBits!)
- `ic07`..`ic14` — PNG/JPEG2000 payload returned as raw bytes
- `TOC ` — parsed but discarded on decode; regenerated on serialize

Decode: list of `IcnsIcon` — kind `'mono-1bit-mask'` or
`'lowres-packbits'` carries decoded RGBA pixelData; kind
`'highres-encoded'` carries raw payloadBytes + subFormat 'png'|'jpeg2000'.

Serialize: canonical form. Only PNG-bearing `ic08`/`ic09`/`ic10` emitted.
Everything else dropped with normalisation flag.

### Out of scope

- PackBits ENCODE (low-res emit deferred)
- `icon` classic (no mask)
- `info`/`name`/`sbtp`/etc. → preserved as opaque blobs
- Retina variant inference
- PNG/JPEG2000 decode (lives in image-canvas/backend-wasm)
- Thumbnail selection
- Cross-format conversion
- Streaming

## Type definitions

```ts
export type IcnsIconKind = 'mono-1bit-mask' | 'lowres-packbits' | 'highres-encoded';
export type IcnsHighResSubFormat = 'png' | 'jpeg2000';
export type IcnsFourCC = string; // 4 ASCII bytes including trailing space

export interface IcnsOpaqueElement {
  type: IcnsFourCC;
  rawBytes: Uint8Array;
}

export interface IcnsIcon {
  type: IcnsFourCC;
  kind: IcnsIconKind;
  pixelSize: number;
  subFormat?: IcnsHighResSubFormat;
  pixelData: Uint8Array | null;      // non-null for mono/lowres
  payloadBytes: Uint8Array | null;   // non-null for highres-encoded
}

export type IcnsNormalisation =
  | 'lowres-element-dropped'
  | 'classic-icon-dropped'
  | 'highres-jpeg2000-dropped'
  | 'retina-variant-dropped'
  | 'toc-regenerated'
  | 'opaque-element-preserved';

export interface IcnsFile {
  format: 'icns';
  declaredTotalSize: number;
  icons: IcnsIcon[];
  otherElements: IcnsOpaqueElement[];
  normalisations: IcnsNormalisation[];
}

export function parseIcns(input: Uint8Array): IcnsFile;
export function serializeIcns(file: IcnsFile): Uint8Array;
```

## Typed errors (7)

| Class | Code |
|---|---|
| `IcnsBadMagicError` | `ICNS_BAD_MAGIC` |
| `IcnsBadHeaderSizeError` | `ICNS_BAD_HEADER_SIZE` |
| `IcnsBadElementError` | `ICNS_BAD_ELEMENT` |
| `IcnsTooManyElementsError` | `ICNS_TOO_MANY_ELEMENTS` |
| `IcnsUnsupportedFeatureError` | `ICNS_UNSUPPORTED_FEATURE` |
| `IcnsPackBitsDecodeError` | `ICNS_PACKBITS_DECODE` |
| `IcnsMaskSizeMismatchError` | `ICNS_MASK_SIZE_MISMATCH` |

All extend the existing base image error class.

## Trap list

1. **`it32` has 4-byte zero prefix BEFORE PackBits data.** Unique to
   128×128. Skip before decoding RGB planes.

2. **RGB channels packed SEQUENTIALLY (not interleaved).** Low-res
   elements: PackBits-R, then PackBits-G, then PackBits-B, each
   producing exactly `width*height` output bytes. Run PackBits THREE
   times per element. Treating whole payload as one stream produces
   garbage colours.

3. **`ic07`-`ic14` carry PNG OR JPEG2000.** Detect via magic:
   - PNG: first 8 bytes = `89 50 4E 47 0D 0A 1A 0A`
   - JP2: first 12 bytes = `00 00 00 0C 6A 50 20 20 0D 0A 87 0A`
   Neither → `IcnsUnsupportedFeatureError('highres-unknown-signature')`.

4. **`ICN#` is exactly 128 bytes bitmap + 128 bytes mask = 256 bytes**
   (element size 264 including record header). Reject other sizes.

5. **Masks are UNCOMPRESSED 8-bit alpha.** Expected: 256/1024/2304/16384
   bytes for 16²/32²/48²/128². No PackBits. Size mismatch → typed error.

6. **`TOC ` (trailing space!) is OPTIONAL.** Parse for cross-check only;
   discard on decode; regenerate fresh on serialize with
   `'toc-regenerated'` flag.

7. **Total size in header MUST match input.length.** Tolerate `0`
   (unknown); non-zero mismatch → `IcnsBadHeaderSizeError`. On
   serialize, always write accurate size.

8. **PackBits decoder IDENTICAL to TIFF's** (same TN1023 algorithm with
   0x80 NO-OP). Reuse `packBitsDecode` from `tiff.ts` via a
   `{output, consumed}` variant (or a consumption-aware wrapper) since
   ICNS needs to advance past each channel's PackBits stream.

9. **FourCC comparison byte-exact including trailing spaces.** Store
   and compare 4-byte ASCII substrings; never `.trim()`.

10. **Element size counts the 8-byte record header.** Payload length =
    `elementSize - 8`. Advance `offset += elementSize`.

11. **Mask pairing is convention, not enforced.** `is32` with no matching
    `s8mk` → tolerate, alpha = 255 default. Orphan `s8mk` → diagnostic,
    no icon emitted.

12. **Pixel-size inferred from FourCC** via static lookup table
    (`is32`→16, `il32`→32, `ih32`→48, `it32`→128, etc.). No explicit
    width/height field in element record.

13. **Big-endian EVERYWHERE.** All uint32 reads use
    `DataView.getUint32(off, false)`. No LE mode.

14. **Opaque elements preserve bytes via `.slice()` (copy, not view).**
    Input Uint8Array may be reused by caller.

## Security caps

```ts
export const ICNS_MIME = 'image/icns';
export const ICNS_MIME_ALT = 'image/x-icns';
export const ICNS_MAGIC = new Uint8Array([0x69, 0x63, 0x6e, 0x73]);
export const ICNS_HEADER_SIZE = 8;
export const ICNS_TOC_FOURCC = 'TOC ';
export const MAX_ICNS_ELEMENTS = 64;
export const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
export const JP2_SIGNATURE = new Uint8Array([
  0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
]);
```

Pre-existing `MAX_INPUT_BYTES`, `MAX_PIXELS`, `MAX_PIXEL_BYTES`,
`MAX_DIM` apply. Per-icon RGBA byte count validated against
`MAX_PIXEL_BYTES` BEFORE allocation.

## Parser algorithm

1. Validate `input.length ≤ MAX_INPUT_BYTES` + `≥ ICNS_HEADER_SIZE`
2. Validate magic `input[0..3]` === ICNS_MAGIC
3. Read `declaredTotalSize = getUint32(4, false)`. If non-zero and
   ≠ `input.length` → `IcnsBadHeaderSizeError`.
4. Walk elements from offset 8 into `elementMap`:
   - Validate 8-byte header fits
   - Validate FourCC is printable ASCII
   - Validate `elementSize ≥ 8` and `offset + elementSize ≤ input.length`
   - Cap at MAX_ICNS_ELEMENTS
5. If `TOC ` present, cross-check its declared entries (validation only;
   discard on decode)
6. Decode recognised elements in first-seen order:
   - `ICN#` → `decodeIcnHash`
   - `is32/il32/ih32/it32` → `decodeLowresPackBits` (with matching mask)
   - `s8mk/l8mk/h8mk/t8mk` → consumed as part of RGB sibling (orphan → diagnostic)
   - `ic07-ic14` → sniff PNG/JP2 magic; return raw payload
   - `icon` → `IcnsUnsupportedFeatureError('icon-classic')`
   - Unknown → push to `otherElements` (verbatim `.slice()`)
7. Return `IcnsFile`

## Per-element decoders

### `decodeIcnHash` (ICN#)

1. Validate payload = 256 bytes
2. For each (y, x) in 0..31: extract `iconBit` + `maskBit` (MSB-first)
3. RGBA = iconBit === 1 ? (0,0,0) : (255,255,255); alpha = maskBit ? 255 : 0

### `decodeLowresPackBits`

1. Look up `dim` from FourCC
2. If FourCC === 'it32', skip 4 zero bytes (Trap #1)
3. Decode R plane via `packBitsDecodeConsume(input, cursor, remaining, pixelCount)` → advance cursor
4. Decode G plane
5. Decode B plane
6. Look up matching mask (Trap #11 tolerance)
7. Assemble RGBA: `(R, G, B, alpha)` per pixel

### `decodeHighres` (ic07-ic14)

1. Pixel size from FourCC lookup
2. Sniff PNG or JP2 magic → `subFormat`
3. Return `{kind: 'highres-encoded', payloadBytes: payload.slice()}`

## Serializer

1. Filter icons: keep only `kind === 'highres-encoded' && subFormat === 'png'
   && type ∈ {'ic08', 'ic09', 'ic10'}`. Everything else dropped with flag.
2. Build records:
   - TOC first (FourCC `'TOC '` + N×8 payload)
   - Each emittable icon
   - Each opaque element verbatim
3. Compute total size
4. Allocate + write: magic, totalSize, TOC record, elements
5. Always flag `'toc-regenerated'`

## Dispatch + detection

`detect.ts`: add `hasPrefix(input, ICNS_MAGIC)` → return 'icns'.
`parser.ts`/`serializer.ts`: add dispatch case.
`backend.ts`: add ICNS_MIME + ICNS_MIME_ALT.
`core/formats.ts`: `{ ext: 'icns', mime: 'image/icns', category: 'image', description: 'Apple Icon Image' }`.

## Fixture strategy

All-synthetic via `_test-helpers/build-icns.ts`:
- `buildIcns({ elements })` — concatenates FourCC + size + payload
- `buildIcnHashPayload(bitmap, mask)` — packs 1-bit planes
- `packBitsEncode(plane)` — test-only greedy encoder
- `buildLowresPayload({fourCC, r, g, b})` — handles `it32` prefix
- `buildMaskPayload(alpha)` — returns bytes verbatim
- `tinyPng()` — minimal 1×1 PNG for `ic08`+ tests

## Test plan (20+)

1. Minimal: header + TOC + ic08(PNG) → parses
2. First 4 bytes ≠ 'icns' → IcnsBadMagicError
3. totalSize ≠ input.length → IcnsBadHeaderSizeError
4. totalSize = 0 tolerated (Trap #7)
5. ICN# 32×32 mono + mask → 32×32 RGBA with black/white + alpha
6. is32+s8mk decoded with correct sequential-channel output (Trap #2)
7. it32+t8mk 4-byte zero prefix skipped (Trap #1)
8. ic09 PNG signature → subFormat='png'
9. ic10 JP2 signature → subFormat='jpeg2000'
10. ic07 with neither sig → IcnsUnsupportedFeatureError
11. 'icon' classic → IcnsUnsupportedFeatureError('icon-classic')
12. Element past EOF → IcnsBadElementError
13. Element size < 8 → IcnsBadElementError
14. > MAX_ICNS_ELEMENTS → IcnsTooManyElementsError
15. l8mk wrong length → IcnsMaskSizeMismatchError
16. Orphan 'info' preserved as IcnsOpaqueElement
17. Orphan is32 (no mask) → alpha=255 fallback
18. Element order preserved
19. serializeIcns: header + TOC + ic08 PNG byte-equal canonical
20. Lowres dropped → 'lowres-element-dropped' flag
21. ICN# dropped → 'classic-icon-dropped' flag
22. JP2 highres dropped → 'highres-jpeg2000-dropped' flag
23. Retina variants dropped → 'retina-variant-dropped' flag
24. Always 'toc-regenerated' flag
25. Opaque info preserved → 'opaque-element-preserved' flag
26. Header totalSize recomputed = output.length
27. detectImageFormat returns 'icns'
28. parseImage/serializeImage preserve union
29. canHandle image/icns → image/icns = true

## Dependencies

- PackBits decoder: reused from tiff.ts via consumption-aware variant
- No PNG/JPEG2000 decode (raw bytes returned)
- No NPM dependencies

## LOC budget

| File | LOC |
|---|---|
| icns.ts | 450 |
| icns-packbits.ts | 80 |
| _test-helpers/build-icns.ts | 150 |
| errors.ts additions (7 classes) | 70 |
| constants.ts additions | 50 |
| detect/parser/serializer/backend/index/core/formats additions | 75 |
| **Source total** | **~875** |
| icns.test.ts | 300 |
| **Grand total** | **~1175** |
