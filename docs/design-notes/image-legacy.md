# image-legacy design

> Implementation reference for `@webcvt/image-legacy`. Write the code from
> this note plus the linked official specs. Do not consult competing
> implementations (sharp, pngjs, @phosphoricons/qoi, jimp, netpbm,
> imagemagick, libpng, qoiconv, tinyqoi) except for debugging
> spec-ambiguous edge cases.

## Format overview

Legacy bitmap formats live under one umbrella package because they share
the same browser-side runtime concerns: per-pixel sample decode of a
declared `width × height × channels` raster, `Uint8Array` /
`Uint16Array` / `Float32Array` typed-array allocation guarded by a
pixel-byte cap, and a parse-only / serialize-only contract with no
colour-space conversion, no filter chain, and no canvas rendering. Every
format here is bytes-in / typed-pixel-buffer-out and typed-pixel-
buffer-in / bytes-out — there is no progressive decode, no animation,
no ICC-profile interpretation, and no resampling. The package
complements `@webcvt/image-svg` (vector text) by handling the small,
spec-light raster formats that ride alongside modern PNG / JPEG /
WebP in real-world pipelines (AI-research dumps, retro-tooling
sidecars, hand-crafted test fixtures, screenshot tooling).

## Scope statement

**This note covers a FIRST-PASS implementation, not full legacy-bitmap
parity with libraries like sharp, ImageMagick, or netpbm.** The goal is
the smallest parser/serializer pair per format that can read and write
modern, well-formed inputs in **five formats only**: PBM, PGM, PPM,
PFM, and QOI. Every other format listed in `plan.md`'s original
13-format scope is deferred to Phase 4.5+. See "Out of scope
(DEFERRED)" below for the explicit deferred list.

**In scope (first pass for `image-legacy`, ~1,200 LOC):**

- **PBM** (Portable Bitmap, magic `P1` ASCII / `P4` binary): 1-bit-
  per-pixel monochrome bitmap. P4 packs 8 pixels per byte, MSB first,
  with each row padded to a whole byte boundary.
- **PGM** (Portable Graymap, magic `P2` ASCII / `P5` binary): single-
  channel grayscale. The header `maxval` token decides sample size:
  `maxval ≤ 255` → 1 byte/sample (`Uint8Array`); `maxval ≤ 65535` →
  2 bytes/sample big-endian (`Uint16Array`).
- **PPM** (Portable Pixmap, magic `P3` ASCII / `P6` binary): three-
  channel RGB interleaved. Same `maxval` rule as PGM, applied per
  sample (so a 16-bit RGB pixel is 6 bytes).
- **PFM** (Portable Float Map, magic `Pf` grayscale / `PF` RGB): 32-bit
  IEEE-754 float per sample, interleaved, **rows stored bottom-up**.
  Endianness encoded as the sign of the `scale` token after `width
  height` (positive → big-endian, negative → little-endian; the
  absolute value is a display-scale hint we round-trip verbatim).
- **QOI** (Quite OK Image, magic `qoif`): RGB or RGBA 8-bit raster
  compressed via a tiny opcode set (`QOI_OP_RGB`, `QOI_OP_RGBA`,
  `QOI_OP_INDEX`, `QOI_OP_DIFF`, `QOI_OP_LUMA`, `QOI_OP_RUN`)
  terminated by an 8-byte end marker `00 00 00 00 00 00 00 01`.
- Public API surfaces: `parsePbm`, `serializePbm`, `parsePgm`,
  `serializePgm`, `parsePpm`, `serializePpm`, `parsePfm`,
  `serializePfm`, `parseQoi`, `serializeQoi`, plus top-level dispatch
  `parseImage(input, format)` over the discriminated union and
  `serializeImage(file)` that switches on `file.format`. A small
  `detectImageFormat(input)` helper sniffs the first 4 bytes — the
  Netpbm magics (`P1`–`P6`, `Pf`, `PF`) and QOI's `qoif` are byte-
  disjoint, so disambiguation is unambiguous.
- Round-trip parse → serialize **byte-equivalent** for the binary
  Netpbm variants (P4/P5/P6) and QOI when the header-derived
  parameters are unchanged. ASCII Netpbm (P1/P2/P3) round-trips to a
  canonical re-emission (single space between tokens, single LF row
  separator), so it is **semantic** equivalence only.

**Out of scope (Phase 4.5+, DEFERRED):**

- **TIFF** (Tag Image File Format) — multi-IFD, LZW / PackBits /
  Deflate / JPEG-in-TIFF compression, planar vs. chunky, tile vs.
  strip layouts, and 100+ optional tags. An order of magnitude more
  spec surface than every format in this note combined; deferred to
  its own design note and likely its own package.
- **TGA** (Truevision Targa) — uncompressed and palette variants are
  approachable, but RLE TGA + the optional footer / extension area
  push it past first-pass scope. Deferred.
- **PCX** (PC Paintbrush) — RLE encoding plus optional 256-colour
  palette block at file end. Deferred.
- **XBM** (X BitMap) — bitmap encoded as a fragment of C source code
  (`#define`, `static unsigned char foo_bits[] = { 0x00, ... }`). The
  parser is a tiny C lexer; deferred because it doesn't share
  primitives with the other four.
- **XPM** (X PixMap) — pixmap encoded as a C string-array literal with
  per-pixel-character palette. Same lexer-shaped concern as XBM.
  Deferred.
- **ICNS** (Apple Icon Image) — IFF-style container of multiple icon
  sub-images at varying resolutions and bit-depths, some PNG-encoded
  inside the container. Belongs in its own design note.
- **CUR** (Windows Cursor) — same on-disk shape as ICO with an added
  hotspot pair per directory entry. Belongs with ICO in a future
  `image-icon` package.
- **PNM** (Portable aNyMap) as a separate parse path — PNM is just the
  collective name for "P1 through P6" (and sometimes Pf/PF). We
  expose the family magic-byte detector under `detectImageFormat` and
  accept `'pnm'` as an input alias that routes to the appropriate
  per-magic parser.
- **Cross-format conversion** (PPM → QOI, PBM → PNG, etc.) — each
  format is parse/serialize-only within its own type. Conversion to
  PNG / JPEG / WebP belongs in a higher-level `@webcvt/convert`
  package using `OffscreenCanvas`, not here.
- **Colour-space interpretation**. Pixel values are returned as raw
  samples in their native bit depth; sRGB vs. linear vs. PFM scale-
  factor interpretation is the caller's job.
- **Streaming parse/serialize**. All operations are buffered: the
  whole input is read as a `Uint8Array`, the whole output is built as
  one `Uint8Array`. Streaming variants deferred.
- **In-place pixel transforms** (flip, rotate, channel swap). Not the
  responsibility of this package.

## Official references

- **Netpbm `pbm(5)` man page** — Portable Bitmap format definition,
  including the P1 / P4 magic numbers, header grammar, and the
  MSB-first 8-pixels-per-byte packing for P4:
  https://netpbm.sourceforge.net/doc/pbm.html
- **Netpbm `pgm(5)` man page** — Portable Graymap format definition,
  including P2 / P5 magics, the `maxval` token, and the big-endian
  2-byte sample rule for `maxval > 255`:
  https://netpbm.sourceforge.net/doc/pgm.html
- **Netpbm `ppm(5)` man page** — Portable Pixmap format definition,
  including P3 / P6 magics and the per-sample `maxval` rule applied
  to each of R, G, B:
  https://netpbm.sourceforge.net/doc/ppm.html
- **Netpbm `pnm(5)` man page** — Portable aNyMap collective wrapper
  describing the family magic-byte set:
  https://netpbm.sourceforge.net/doc/pnm.html
- **PFM informal specification** — Paul Debevec / Greg Ward's "PFM
  Specification" page is the de-facto reference; it documents the
  `Pf` / `PF` magics, the `width height` token, the signed `scale`
  token used both for endianness and as a display-scale hint, and
  the bottom-up row order. Also mirrored in the netpbm `pfm(5)`
  documentation as a community extension:
  https://www.pauldebevec.com/Research/HDR/PFM/
  https://netpbm.sourceforge.net/doc/pfm.html
- **QOI Specification 1.0 (2022-01-05)** — Dominic Szablewski. PDF
  hosted at qoiformat.org; defines the 14-byte header, the six
  opcodes (`QOI_OP_RGB`, `QOI_OP_RGBA`, `QOI_OP_INDEX`,
  `QOI_OP_DIFF`, `QOI_OP_LUMA`, `QOI_OP_RUN`), the running 64-slot
  hashed pixel index, and the 8-byte end marker:
  https://qoiformat.org/qoi-specification.pdf
- **W3C Encoding** — `TextDecoder('ascii')` is sufficient for Netpbm
  ASCII headers (the header alphabet is a strict subset of ASCII):
  https://encoding.spec.whatwg.org/
- **IEEE 754-2019** — referenced for PFM's 32-bit single-precision
  float sample interpretation:
  https://ieeexplore.ieee.org/document/8766229

## Netpbm family format primer (P1–P6)

A Netpbm file is a header followed by a raster. The header is an
ASCII-only sequence of whitespace-separated tokens: a 2-byte magic
number, then `width`, then `height`, then (for PGM/PPM/PFM) a
`maxval`. Tokens are separated by ANY ASCII whitespace (space, TAB,
CR, LF). Comments begin with `#` and run to the next LF; they may
appear between any two tokens, including between digits of a number's
column position (rare but legal). Exactly one whitespace byte
(typically LF) separates the last header token from the first raster
byte.

For the binary variants (P4/P5/P6) the raster is packed bytes:

- **P4 (PBM binary)**: 1 bit per pixel, MSB first within each byte.
  Each ROW is padded to a whole byte; the next row begins on the next
  byte. So a 9-wide bitmap takes 2 bytes per row (the second byte's
  low 7 bits are padding).
- **P5 (PGM binary)**: 1 byte per sample if `maxval ≤ 255`, else
  2 bytes per sample big-endian (`Uint16Array`). Samples are stored
  in row-major top-down order.
- **P6 (PPM binary)**: 1 or 2 bytes per sample (same `maxval` rule),
  three samples per pixel interleaved RGB, row-major top-down.

For the ASCII variants (P1/P2/P3) the raster is whitespace-separated
decimal numbers in the same order, with arbitrary whitespace between
samples (and `#` comments tolerated mid-raster, though we will not
emit them).

## PFM format primer

PFM borrows the Netpbm header shape but breaks several conventions:

- Magic is `Pf` (single-channel float) or `PF` (three-channel float).
- Header tokens: magic, `width`, `height`, `scale`. The `scale` is a
  signed decimal float. Its **sign** encodes endianness: positive →
  big-endian samples, negative → little-endian samples. Its
  **absolute value** is a display-scale hint (often `1.0`) which we
  preserve verbatim as `scaleAbs` for round-trip; we do not apply it
  to pixel values.
- Samples are 32-bit IEEE-754 floats, stored in row-major **bottom-up**
  order: the FIRST 4 bytes after the header are the bottom-left
  pixel's first channel, not the top-left. This is the single most
  common bug in third-party PFM readers.
- No `maxval` — float samples are unbounded. PFM files commonly hold
  HDR data and have samples > 1.0 or < 0.0.

## QOI format primer

A QOI file is a 14-byte header followed by a stream of 8-bit opcodes
followed by an 8-byte end marker. The header layout:

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | Magic `qoif` (0x71 0x6F 0x69 0x66) |
| 4 | 4 | `width` (uint32 big-endian) |
| 8 | 4 | `height` (uint32 big-endian) |
| 12 | 1 | `channels` (3 = RGB, 4 = RGBA) |
| 13 | 1 | `colorspace` (0 = sRGB with linear alpha, 1 = all linear) |

Decoder state: a `previousPixel` initialised to `(0, 0, 0, 255)` and a
64-slot index of recently-seen pixels initialised to `(0, 0, 0, 0)`
(NOT `(0, 0, 0, 255)` — the alpha differs from `previousPixel`; this
is Trap #7).

The six opcodes (8 bits each):

| Opcode | Tag bits | Effect |
|---|---|---|
| `QOI_OP_RGB` | `11111110` (0xFE) | Next 3 bytes are R, G, B; alpha unchanged |
| `QOI_OP_RGBA` | `11111111` (0xFF) | Next 4 bytes are R, G, B, A |
| `QOI_OP_INDEX` | `00xxxxxx` | Emit `index[xxxxxx]` |
| `QOI_OP_DIFF` | `01xxxxxx` | dr/dg/db each in [-2..1], biased by 2; alpha unchanged |
| `QOI_OP_LUMA` | `10xxxxxx` | Next byte holds dr/db relative to dg, dg in [-32..31] biased by 32 |
| `QOI_OP_RUN` | `11xxxxxx` | Repeat previous pixel `(xxxxxx + 1)` times, range 1..62 (the values 63 and 64 are forbidden because the bit pattern collides with `QOI_OP_RGB` / `QOI_OP_RGBA`) |

Decoder dispatch order matters: check the 8-bit `QOI_OP_RGB` /
`QOI_OP_RGBA` patterns FIRST, only then fall through to the 2-bit
tag dispatch. The 8-byte end marker is `00 00 00 00 00 00 00 01`.

## Required structures for first pass

```ts
/** Netpbm magic numbers (binary or ASCII variant per format). */
type NetpbmMagic = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'Pf' | 'PF';

/** Discriminated tag for top-level dispatch. */
export type ImageFormat = 'pbm' | 'pgm' | 'ppm' | 'pfm' | 'qoi';

/** PBM: 1 bit per pixel. `pixelData[i]` is 0 or 1 in row-major top-down
 *  order. We unpack P4 to one byte per pixel for ergonomic access; the
 *  serializer re-packs to the on-disk MSB-first format. */
interface PbmFile {
  format: 'pbm';
  variant: 'ascii' | 'binary';   // P1 vs. P4 — preserved on round-trip
  width: number;
  height: number;
  channels: 1;
  bitDepth: 1;
  pixelData: Uint8Array;          // length = width * height
}

interface PgmFile {
  format: 'pgm';
  variant: 'ascii' | 'binary';   // P2 vs. P5
  width: number;
  height: number;
  channels: 1;
  bitDepth: 8 | 16;
  maxval: number;                 // 1..65535
  pixelData: Uint8Array | Uint16Array;
}

interface PpmFile {
  format: 'ppm';
  variant: 'ascii' | 'binary';   // P3 vs. P6
  width: number;
  height: number;
  channels: 3;
  bitDepth: 8 | 16;
  maxval: number;
  pixelData: Uint8Array | Uint16Array;  // interleaved RGB
}

interface PfmFile {
  format: 'pfm';
  width: number;
  height: number;
  channels: 1 | 3;                // 1 = Pf grayscale, 3 = PF RGB
  bitDepth: 32;
  /** Sign-encoded endianness (preserved on round-trip). */
  endianness: 'big' | 'little';
  /** Absolute value of the `scale` header token; default 1.0. */
  scaleAbs: number;
  /** Row-major TOP-DOWN floats, even though PFM stores bottom-up.
   *  The parser flips on read; the serializer flips on write. */
  pixelData: Float32Array;
}

interface QoiFile {
  format: 'qoi';
  width: number;
  height: number;
  channels: 3 | 4;
  /** 0 = sRGB with linear alpha; 1 = all linear. Round-tripped verbatim. */
  colorspace: 0 | 1;
  /** Decoded interleaved RGB or RGBA, row-major top-down. */
  pixelData: Uint8Array;
}

/** Discriminated union returned by the top-level dispatcher. */
export type ImageFile = PbmFile | PgmFile | PpmFile | PfmFile | QoiFile;

export function parsePbm(input: Uint8Array): PbmFile;
export function serializePbm(file: PbmFile): Uint8Array;

export function parsePgm(input: Uint8Array): PgmFile;
export function serializePgm(file: PgmFile): Uint8Array;

export function parsePpm(input: Uint8Array): PpmFile;
export function serializePpm(file: PpmFile): Uint8Array;

export function parsePfm(input: Uint8Array): PfmFile;
export function serializePfm(file: PfmFile): Uint8Array;

export function parseQoi(input: Uint8Array): QoiFile;
export function serializeQoi(file: QoiFile): Uint8Array;

export function parseImage(input: Uint8Array, format: ImageFormat): ImageFile;
export function serializeImage(file: ImageFile): Uint8Array;

/** First-4-bytes magic sniff. Returns null if no known magic matches.
 *  The Netpbm magics and QOI's `qoif` are byte-disjoint. */
export function detectImageFormat(input: Uint8Array): ImageFormat | null;
```

## Shared header reader — Netpbm

A single `readNetpbmHeader(bytes, offset)` helper feeds all four
Netpbm parsers. It tokenises the ASCII header byte-stream into a
sequence of decimal tokens, skipping any run of whitespace
(`0x09 0x0A 0x0D 0x20`) and any `#`-to-LF comment. It returns
`{ magic, width, height, maxval | null, headerEndOffset }` where
`headerEndOffset` is the byte position of the FIRST raster byte
(i.e. one past the single whitespace separator that follows the last
header token). For PBM there is no `maxval` (returned as `null`); for
PFM the third token is the signed `scale` float, parsed by a small
local float-from-ASCII routine (or `Number(...)` if we accept the JS
result — see Trap #4 for the sign-vs-magnitude split).

## Parser algorithm — PBM

1. **Validate input size**: `input.length <= MAX_INPUT_BYTES`. Else
   throw `ImageInputTooLargeError`.
2. **Read header** with the shared Netpbm reader. Magic must be `P1`
   or `P4`; else throw `PbmBadMagicError`.
3. **Validate dimensions**: `width >= 1`, `height >= 1`, `width *
   height <= MAX_PIXELS`, and the implied raster byte length (see
   below) plus header length `<= MAX_PIXEL_BYTES`. Else throw
   `ImagePixelCapError`.
4. **Allocate** `pixelData = new Uint8Array(width * height)`.
5. **For P1 (ASCII)**: walk the post-header bytes; for each non-
   whitespace byte that is `0x30` (`'0'`) or `0x31` (`'1'`), write
   the value to `pixelData[i++]`. Reject any other non-whitespace
   byte with `PbmBadAsciiByteError`. Reject if `i !== width *
   height` at end of input.
6. **For P4 (binary)**: per-row stride is `Math.ceil(width / 8)`
   bytes (Trap #3). For each row `r in 0..height-1`, for each
   column `c in 0..width-1`, read bit `(7 - (c % 8))` of byte
   `headerEndOffset + r * stride + Math.floor(c / 8)`, write to
   `pixelData[r * width + c]`. Validate that the input contains
   exactly `header + height * stride` bytes (allow a trailing LF for
   tooling tolerance, see Trap #6).
7. Return `{ format: 'pbm', variant, width, height, channels: 1,
   bitDepth: 1, pixelData }`.

## Serializer algorithm — PBM

1. Build header string `${variant === 'ascii' ? 'P1' : 'P4'}\n
   ${width} ${height}\n` (single LF separators; no comments).
2. Encode header via `new TextEncoder().encode(...)`.
3. For ASCII (P1): for each pixel, append `'0'` or `'1'` followed by
   a single space (Netpbm spec recommends ≤70-char lines but does
   not require it; we emit one row per line with values
   space-separated for readability).
4. For binary (P4): allocate `body = new Uint8Array(height * stride)`
   where `stride = Math.ceil(width / 8)`; for each pixel, set the
   appropriate bit MSB-first; concat with the header.
5. Return the combined `Uint8Array`.

## Parser algorithm — PGM

1. Validate input size. Read header with shared Netpbm reader. Magic
   must be `P2` or `P5`. Else throw `PgmBadMagicError`.
2. Validate `maxval`: integer in `[1, 65535]`. Else throw
   `PgmBadMaxvalError`. (Trap #2.)
3. Decide `bitDepth`: `maxval <= 255` → 8, else 16.
4. Validate dimensions and pixel-byte cap as in PBM.
5. **Allocate** `bitDepth === 8 ? new Uint8Array(...) : new
   Uint16Array(...)` of length `width * height`.
6. **For P2 (ASCII)**: tokenise post-header bytes as decimal integers
   separated by whitespace; reject `> maxval` with
   `PgmSampleOutOfRangeError`; write to `pixelData[i++]`. Reject if
   final `i !== width * height`.
7. **For P5 (binary)**:
   - If `bitDepth === 8`, copy `width * height` bytes from
     `headerEndOffset` into the typed array (no endianness concern).
   - If `bitDepth === 16`, read pairs of bytes BIG-ENDIAN (Trap #2)
     into the `Uint16Array`. Use a `DataView` over the input buffer
     and `getUint16(off, /*littleEndian=*/false)` per sample. Reject
     samples `> maxval` with `PgmSampleOutOfRangeError`.
8. Return the file record.

## Serializer algorithm — PGM

1. Build header `"P2\n"` or `"P5\n"`, then `"${width} ${height}\n
   ${maxval}\n"`.
2. For P2: emit decimal samples space-separated, one row per line.
3. For P5 with `bitDepth === 8`: copy `pixelData` (a `Uint8Array`)
   directly after the header.
4. For P5 with `bitDepth === 16`: write each `Uint16` BIG-ENDIAN via
   `DataView.setUint16(off, sample, false)`.
5. Return the combined buffer.

## Parser algorithm — PPM

Same as PGM except: magic must be `P3`/`P6`; `channels = 3`; pixel-
data length is `width * height * 3`; ASCII tokens come in groups of
three (R, G, B). Binary P6 with `bitDepth === 16` reads 6 bytes per
pixel, three big-endian samples.

## Serializer algorithm — PPM

Same as PGM except headers are `"P3"` / `"P6"` and the body is
3-channel interleaved.

## Parser algorithm — PFM

1. Validate input size. Read header with the shared Netpbm reader,
   but the third post-dimension token is the signed `scale` float
   instead of an integer `maxval`. Magic must be `Pf` or `PF`. Else
   throw `PfmBadMagicError`. (Trap #4.)
2. Parse `scale` via `Number(token)`. Reject `NaN`, `±Infinity`, or
   `0` (a zero scale is malformed because the sign is undefined) with
   `PfmBadScaleError`. Set `endianness = scale < 0 ? 'little' :
   'big'`, `scaleAbs = Math.abs(scale)`.
3. Set `channels = magic === 'PF' ? 3 : 1`.
4. Validate dimensions and pixel-byte cap. Each sample is 4 bytes;
   total = `width * height * channels * 4`.
5. Allocate `pixelData = new Float32Array(width * height *
   channels)`.
6. **Read floats with row flip** (Trap #5):
   - For each ON-DISK row `srcRow in 0..height-1` (which corresponds
     to OUTPUT row `dstRow = height - 1 - srcRow`):
     - For each pixel column `c in 0..width-1`, for each channel
       `k in 0..channels-1`:
       - Read 4 bytes at `off = headerEndOffset + (srcRow * width +
         c) * channels * 4 + k * 4`.
       - Use `DataView.getFloat32(off, /*littleEndian=*/endianness ===
         'little')`.
       - Write to `pixelData[(dstRow * width + c) * channels + k]`.
7. Return the file record.

## Serializer algorithm — PFM

1. Build header: `"${magic}\n${width} ${height}\n${signedScale}\n"`
   where `magic = channels === 3 ? 'PF' : 'Pf'` and `signedScale =
   (endianness === 'little' ? -1 : 1) * scaleAbs` formatted as a
   minimal-precision decimal (e.g. `'1'` not `'1.000000'`).
2. Allocate body buffer `body = new Uint8Array(width * height *
   channels * 4)`. Write floats with the inverse row flip:
   `srcRow = height - 1 - dstRow` from the in-memory top-down array.
   Use `DataView.setFloat32(off, value, /*littleEndian=*/endianness
   === 'little')`.
3. Concat header + body.

## Parser algorithm — QOI

1. Validate input size. Require `input.length >= 14 + 8` (header +
   end marker). Else throw `QoiTooShortError`.
2. Validate magic: bytes 0..3 must be `0x71 0x6F 0x69 0x66`. Else
   throw `QoiBadMagicError`.
3. Read header via `DataView`: `width = getUint32(4, false)`,
   `height = getUint32(8, false)`, `channels = bytes[12]`,
   `colorspace = bytes[13]`.
4. Validate `channels in {3, 4}` and `colorspace in {0, 1}` (Trap
   #11). Else throw `QoiBadHeaderError`.
5. Validate dimensions and pixel-byte cap (`width * height *
   channels <= MAX_PIXEL_BYTES`).
6. **Validate end marker** (Trap #6): bytes
   `[input.length - 8 .. input.length - 1]` must equal
   `[0,0,0,0,0,0,0,1]`. Else throw `QoiMissingEndMarkerError`.
7. Allocate `pixelData = new Uint8Array(width * height * channels)`.
   Initialise decoder state: `r,g,b = 0`, `a = 255`, `index =
   new Uint8Array(64 * 4)` (all zeros — alpha included; Trap #7),
   `pos = 14`, `dst = 0`.
8. **Loop while `dst < pixelData.length`**:
   - `byte = input[pos++]`.
   - If `byte === 0xFE` (`QOI_OP_RGB`): `r = input[pos++]; g =
     input[pos++]; b = input[pos++];` (alpha unchanged).
   - Else if `byte === 0xFF` (`QOI_OP_RGBA`): `r,g,b,a` from next 4
     bytes.
   - Else look at `byte >> 6`:
     - `0` (`QOI_OP_INDEX`): `i = byte & 0x3F`; `r,g,b,a =
       index[i*4..i*4+3]`.
     - `1` (`QOI_OP_DIFF`): `dr = ((byte >> 4) & 3) - 2; dg = ((byte
       >> 2) & 3) - 2; db = (byte & 3) - 2; r = (r + dr) & 0xFF;`
       same for g, b. (Trap #8.)
     - `2` (`QOI_OP_LUMA`): `dg = (byte & 0x3F) - 32; second =
       input[pos++]; dr = ((second >> 4) & 0x0F) - 8 + dg; db =
       (second & 0x0F) - 8 + dg; r = (r + dr) & 0xFF;` etc.
     - `3` (`QOI_OP_RUN`): `runLen = (byte & 0x3F) + 1` (range 1..62
       — values 63/64 forbidden because they collide with the 8-bit
       `0xFE` / `0xFF` opcodes; Trap #8).
   - Update `index[((r*3 + g*5 + b*7 + a*11) & 0x3F) * 4 ..]` with
     the four channels (Trap #7).
   - For non-RUN ops, write `r,g,b` (and `a` if `channels === 4`) to
     `pixelData[dst..]`; advance `dst`.
   - For RUN, write the previous pixel `runLen` times.
9. Validate `dst === pixelData.length` and `pos === input.length - 8`
   at end. Else throw `QoiSizeMismatchError`.
10. Return the file record.

## Serializer algorithm — QOI

1. Allocate `out` as a growable `Uint8Array` (start at `14 + width *
   height * (channels + 1) + 8`, the maximum possible body size, and
   slice at end). Write the 14-byte header.
2. Initialise encoder state mirroring the decoder: `prev = (0,0,0,
   255)`, `index = new Uint8Array(64 * 4)`, `runLen = 0`.
3. For each pixel `i in 0..(width * height - 1)`:
   - Read current `r,g,b,a` from `pixelData[i*channels..]` (alpha
     defaults to 255 if `channels === 3`).
   - If equal to `prev`, increment `runLen`; if `runLen === 62`,
     emit `QOI_OP_RUN` byte `0xC0 | (62 - 1)` and reset `runLen = 0`;
     continue.
   - If `runLen > 0`, emit pending RUN op `0xC0 | (runLen - 1)`,
     reset.
   - Compute hash slot; if `index[slot] === current`, emit
     `QOI_OP_INDEX` byte `0x00 | slot`. Skip below opcodes.
   - Else update `index[slot] = current`. Then:
     - If `a !== prev.a`, emit `QOI_OP_RGBA`.
     - Else compute `dr/dg/db` modulo 256 in signed -128..127 range.
       If all in -2..1 range, emit `QOI_OP_DIFF`.
     - Else if `dg in -32..31`, `dr - dg` in -8..7, `db - dg` in
       -8..7, emit `QOI_OP_LUMA`.
     - Else emit `QOI_OP_RGB`.
   - Set `prev = current`.
4. After the loop, flush any pending RUN.
5. Append the 8-byte end marker `00 00 00 00 00 00 00 01`.
6. Slice `out` to actual length and return.

## Top-level dispatch and detection

`parseImage(input, format)` switches on `format` and returns the
appropriate `ImageFile`. `serializeImage(file)` switches on
`file.format`. `detectImageFormat(input)` reads the first 4 bytes and
returns `'qoi'` for `qoif`, `'pbm'` for `P1`/`P4`, `'pgm'` for
`P2`/`P5`, `'ppm'` for `P3`/`P6`, `'pfm'` for `Pf`/`PF`, and `null`
otherwise. Detection is exposed for callers who want it but is NOT
applied automatically inside `parseImage` — the caller passes the
format hint explicitly to defend against magic-byte coincidences in
truncated inputs.

## Backend integration

`ImageLegacyBackend` (in `backend.ts`) implements the `@webcvt/core`
backend interface. `canHandle(input, hint)` returns `true` only when
`hint.format` is one of the five formats above (or when
`detectImageFormat(input)` matches AND no conflicting hint is
provided). The backend is identity-within-format: `decode` returns
the parsed `ImageFile`; `encode` returns the serialized
`Uint8Array`. There is no fallback chain inside this package.

## Fixture strategy

Mostly all-synthetic in-test, like `data-text` and `archive-zip` —
test inputs are inline byte arrays built with small helpers. We may
commit two minimal example fixtures under `tests/fixtures/image/`
(`2x2-rgb.ppm`, ~30 bytes; `2x2-rgb.qoi`, ~30 bytes) for sanity-check
round-trip parity tests against an external known-good byte sequence.
Helpers to add:

- `tests/helpers/bytes.ts` — `ascii(s: string) => Uint8Array`,
  `concat(...parts: Uint8Array[]) => Uint8Array`, `u32be(n: number)
  => Uint8Array`, `f32be(n: number) => Uint8Array`. ~40 LOC.
- `tests/helpers/build-netpbm.ts` — `pbm(width, height, bits:
  number[]): Uint8Array` and friends to construct on-disk byte
  sequences for parser tests. ~80 LOC.

Round-trip tests use `serializeXxx` output as input to `parseXxx` and
assert structural equality (and byte equality for binary variants).

## Test plan

1. `parsePbm decodes a 4×2 P1 ASCII bitmap`
2. `parsePbm decodes a 9×1 P4 binary bitmap with row padding (2-byte stride)`
3. `parsePbm rejects P1 with non-0/1 ASCII byte`
4. `parsePgm decodes a 2×2 P5 8-bit grayscale`
5. `parsePgm decodes a 2×2 P5 16-bit big-endian grayscale (maxval=65535)`
6. `parsePgm rejects sample > maxval with PgmSampleOutOfRangeError`
7. `parsePgm strips header # comment between width and height tokens`
8. `parsePpm decodes a 2×2 P6 8-bit RGB and round-trips byte-equal`
9. `parsePpm decodes a 2×2 P6 16-bit big-endian RGB`
10. `parsePfm decodes a 2×2 PF big-endian RGB float and FLIPS rows top-down`
11. `parsePfm decodes a 2×2 Pf little-endian grayscale (negative scale)`
12. `parsePfm round-trips signed scale (e.g. -1.5) byte-equal`
13. `parseQoi decodes a 2×2 RGB image with INDEX, DIFF, RUN ops covered`
14. `parseQoi decodes RGBA and recognises QOI_OP_RGBA (0xFF)`
15. `parseQoi rejects missing 8-byte end marker with QoiMissingEndMarkerError`
16. `parseQoi rejects channels=2 in header byte 12 with QoiBadHeaderError`
17. `serializeQoi round-trips a 4×4 RGB image to byte-equal output`
18. `serializeQoi caps QOI_OP_RUN at 62 and emits a second RUN for >62 repeats`
19. `parseImage rejects width × height × bytes-per-pixel > MAX_PIXEL_BYTES`
20. `detectImageFormat distinguishes qoif, P1..P6, Pf, PF magics`
21. `serializeImage / parseImage round-trip preserves discriminated union for all 5 formats`

## Known traps

1. **Netpbm whitespace and comments mid-header**: header tokens
   (magic, width, height, maxval) are separated by ANY ASCII
   whitespace including LF/CR/TAB. Comments begin with `#` and run
   to the next LF. Comments are legal BETWEEN tokens at any position
   — naive parsers that split on the first LF lose the maxval. Our
   shared `readNetpbmHeader` walks bytes one at a time, treating any
   `0x09 / 0x0A / 0x0D / 0x20` as a separator and dropping anything
   from `0x23` (`#`) up to (but not including) the next `0x0A`.
2. **Netpbm 16-bit big-endian samples**: PGM and PPM with `maxval >
   255` use TWO bytes per sample, BIG-ENDIAN (high byte first). This
   contradicts the modern "little-endian everywhere" intuition — the
   netpbm spec was written when SGI / Sun / PowerPC dominated. Use a
   `DataView` with `getUint16(off, /*littleEndian=*/false)`. Reject
   `maxval` outside `[1, 65535]` early.
3. **PBM (P4) row-byte padding**: P4 packs 8 pixels per byte, MSB
   first within each byte, with each ROW padded to a whole byte
   boundary. So a 9-pixel-wide bitmap occupies 2 bytes per row, with
   the second byte's low 7 bits as padding (the spec says "should be
   zero" but readers must IGNORE them — the parser must not validate
   padding bits). Forgetting the padding alignment shifts every row
   after the first; the result is a sheared image.
4. **PFM scale token sign-vs-magnitude**: the third post-dimension
   token is a signed decimal float, e.g. `-1.0` or `+2.5`. The SIGN
   determines endianness (positive → big-endian, negative → little-
   endian) and the absolute value is a display-scale hint we round-
   trip as `scaleAbs`. A token of `0` is malformed because sign is
   undefined; reject with `PfmBadScaleError`. `Number('+1.5')`
   correctly returns `1.5` in JavaScript, but `Number('+inf')`
   returns `NaN`, so the explicit `Number.isFinite` and `value !==
   0` guards are essential.
5. **PFM bottom-up row order**: PFM stores rows from BOTTOM to TOP.
   The first 4 bytes after the header are the bottom-left pixel's
   first channel. Every other Netpbm format stores rows top-down. We
   normalise to top-down on parse and re-flip on serialize so
   downstream consumers (Canvas, ImageData) see the natural
   orientation. The cost is one row-flip pass per direction, O(N).
   Forgetting this flip produces a vertically mirrored image, which
   often goes unnoticed in symmetric test fixtures — always include
   an asymmetric test image (e.g. a single bright pixel at known
   `(x, y)`) in PFM tests.
6. **QOI 8-byte end marker `00 00 00 00 00 00 00 01`**: QOI's pixel
   stream has no length prefix and no per-pixel boundary marker; the
   reader knows it has hit the end ONLY by reaching the byte
   sequence `00 00 00 00 00 00 00 01` at the end of the file. The
   serializer MUST append it; the parser MUST validate it before
   trusting the stream. Without it, a truncated file would either
   over-decode or wrap around. We validate the marker BEFORE the
   decode loop (cheap tail comparison) AND we assert that
   `pos === input.length - 8` after the loop (catches the case where
   the loop stopped early at `dst === pixelData.length` while
   garbage opcodes preceded the marker).
7. **QOI hash table init and update**: the 64-slot index of recently
   seen pixels is initialised to all-zeros — that is `(r=0, g=0, b=0,
   a=0)` for every slot, NOT `(0,0,0,255)` like `previousPixel`.
   This asymmetry is in the spec (PDF section "Index"). The hash is
   `(r*3 + g*5 + b*7 + a*11) % 64` and the index is updated on
   EVERY pixel emission (including `QOI_OP_INDEX` lookups, which are
   no-ops because the slot already contains the same pixel). Init
   to the wrong constants causes the very first `QOI_OP_INDEX`-
   referenced pixel of the stream to decode wrong.
8. **QOI opcode dispatch order**: 8-bit `QOI_OP_RGB` (0xFE) and
   `QOI_OP_RGBA` (0xFF) MUST be checked before the 2-bit tag
   dispatch, because their top 2 bits are `11` which would otherwise
   match `QOI_OP_RUN`. As a consequence, `QOI_OP_RUN` lengths are
   limited to `1..62` (encoded as `bias - 1`, so byte values
   `0xC0..0xFD`); the bit patterns `0xFE` and `0xFF` are reserved
   for the 8-bit opcodes. The serializer must split runs longer than
   62 into multiple RUN ops.
9. **Input-size cap before allocation**: bitmap data is large.
   PPM 16-bit RGB at 8000×8000 = 384 MB. Cap input length to
   `MAX_INPUT_BYTES = 200 MiB`; reject any image declaring
   `width > 16384` or `height > 16384` or `width * height >
   MAX_PIXELS`; reject any image whose declared raster byte length
   exceeds `MAX_PIXEL_BYTES = 1 GiB`. ALL three checks happen
   BEFORE the typed-array allocation.
10. **Memory-amplification via tiny header**: a 30-byte PBM header
    can declare `width=8000 height=8000`, requesting an 8 MB
    allocation. A naïve parser that allocates first and validates
    later is a DoS sink. Validate `width * height * bytesPerPixel
    <= MAX_PIXEL_BYTES` BEFORE calling `new Uint8Array` /
    `Uint16Array` / `Float32Array`.
11. **QOI header byte 12 / byte 13 validation**: byte 12 is
    `channels` and MUST be 3 or 4. Byte 13 is `colorspace` and MUST
    be 0 or 1. Some encoders emit `colorspace = 0` always (sRGB-
    with-linear-alpha is the conservative default); others emit 1.
    We round-trip whatever was on disk, but reject any other value
    with `QoiBadHeaderError` so corrupted files surface early. An
    over-permissive parser here passes garbage through to downstream
    Canvas code.
12. **PNM as alias only**: some tools call the family "PNM"
    (Portable aNyMap) collectively. We do NOT add a `parsePnm`
    function — `parseImage(input, 'pnm')` is rejected at the type
    level (the union does not include `'pnm'`). Instead,
    `detectImageFormat` accepts the family magics and returns the
    specific `pbm` / `pgm` / `ppm` / `pfm` variant, and the caller
    routes to the matching parser. This avoids two code paths for
    the same bytes.

## Security caps

- **Input cap**: 200 MiB (`MAX_INPUT_BYTES = 200 * 1024 * 1024`).
  Larger is suspicious or accidentally a video file. Checked at the
  `Uint8Array.length` boundary before any parse.
- **Pixel-count cap**: `MAX_PIXELS = 16384 * 16384` (~268M pixels).
  Rejects pathological dimension declarations.
- **Pixel-byte cap**: `MAX_PIXEL_BYTES = 1024 * 1024 * 1024` (1 GiB).
  Sanity check on `width * height * channels * bytesPerSample`
  before any allocation. Belt-and-braces with the pixel cap.
- **Per-format dimension cap**: `MAX_DIM = 16384` (independent
  width and height limit). Defends against `width = 2^31 - 1`
  declared in headers.
- **Allocation order**: ALL caps validated BEFORE `new
  Uint8Array(...)` / `new Uint16Array(...)` / `new Float32Array(...)`
  is called. A failed cap throws a typed error and never allocates.
- **Strict parsers**: malformed magic, malformed maxval, malformed
  PFM scale, malformed QOI channels/colorspace, missing QOI end
  marker, out-of-range PGM/PPM samples, non-`0`/`1` PBM ASCII bytes
  all throw typed per-format errors. No silent acceptance.
- **No format auto-detection inside `parseImage`**: caller must pass
  `format` explicitly. `detectImageFormat` is a separate, opt-in
  helper. This avoids silent corruption from misclassified inputs.

## LOC budget breakdown

| File | LOC est. |
|---|---|
| `netpbm.ts` (shared header reader + 4 sub-format dispatchers + ASCII/binary variants for P1..P6) | 350 |
| `pfm.ts` (PFM-specific parser/serializer with row-flip, signed-scale, endianness) | 120 |
| `qoi.ts` (header validate + opcode decoder + opcode encoder + hash index + end-marker validation) | 250 |
| `detect.ts` (`detectImageFormat` magic-byte sniff over first 4 bytes) | 40 |
| `parser.ts` (top-level dispatch by format hint, returns `ImageFile`) | 60 |
| `serializer.ts` (top-level dispatch by `file.format`) | 40 |
| `backend.ts` (`ImageLegacyBackend` implementing `@webcvt/core` backend; identity-within-format) | 100 |
| `errors.ts` (typed errors per format) | 80 |
| `constants.ts` (size/pixel/dim caps, magic numbers, QOI opcode constants, QOI end marker bytes) | 40 |
| `index.ts` (public re-exports) | 40 |
| **total** | **~1120** |
| tests | ~500 |

## Implementation references (for the published README)

This package is implemented from the netpbm `pbm(5)`, `pgm(5)`,
`ppm(5)`, `pnm(5)`, and `pfm(5)` man pages, the Paul Debevec / Greg
Ward PFM specification page, and the QOI Specification 1.0 PDF
(qoiformat.org). UTF-8 / ASCII decoding for Netpbm headers uses the
WHATWG Encoding spec via the browser-native `TextDecoder('ascii')`
interface; binary sample reads use `DataView` with explicit
endianness flags. No code was copied from sharp, pngjs,
@phosphoricons/qoi, jimp, netpbm, ImageMagick, libpng, qoiconv, or
tinyqoi. PFM bottom-up row order is normalised to top-down on parse
and re-flipped on serialize so downstream consumers see consistent
orientation across all five formats. QOI's 8-byte end marker is
validated before the decode loop and the byte-position invariant
`pos === input.length - 8` is asserted after, defending against
truncated and over-padded streams. Two minimal binary fixtures
(`2x2-rgb.ppm`, `2x2-rgb.qoi`) are committed under
`tests/fixtures/image/` for byte-equal round-trip parity; all other
test inputs are constructed inline via helpers in
`tests/helpers/bytes.ts` and `tests/helpers/build-netpbm.ts`. TIFF,
TGA, PCX, XBM, XPM, ICNS, CUR are deferred to Phase 4.5+ under
separate design notes (TIFF likely as its own package).
