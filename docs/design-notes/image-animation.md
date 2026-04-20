# image-animation design

> Implementation reference for `@webcvt/image-animation`. Write the code from
> this note plus the linked official specs. Do not consult competing
> implementations (giflib, libpng+APNG patch, libwebp, libavcodec/libavformat,
> ImageMagick, gif.js, omggif, upng-js, apng-js, sharp, libgd) except for
> debugging spec-ambiguous edge cases. Per `plan.md §11` clean-room policy:
> spec-only implementation. No GPL/LGPL code may be ported. MPL-2.0 reference
> material (e.g. Mediabunny) may be studied during a discrete "study phase"
> with a 24-hour cooldown before writing.

## Format overview

Animated bitmap formats live under one umbrella package because they share
the same browser-side runtime concerns: a CONTAINER walk that yields
per-frame pixel-byte slices plus disposal/blend/timing metadata, **without
decoding the actual pixel payload of every frame in this package**. GIF is
the exception — its LZW pixel stream is small, tightly coupled to the
container, and trivially decodable in <300 LOC, so we own GIF pixel decode
end-to-end. APNG and animated WebP defer their per-frame pixel decode to
`@webcvt/backend-wasm` (libwebp / a stripped PNG decoder) — this package
only parses the container, validates the chunk structure, and yields the
frame's raw payload bytes with enough metadata that a downstream decoder
can produce RGBA from a `fdAT` zlib stream or a VP8/VP8L bitstream. This
split mirrors the design used in `@webcvt/container-mp4` (parse boxes here,
decode samples in WebCodecs) and keeps this package tractable at ~3,000
LOC.

The package complements `@webcvt/image-legacy` (static raster formats) and
`@webcvt/image-svg` (vector). It is the final Phase 4 image package.

## Scope statement

**This note covers a FIRST-PASS implementation, not full animated-image
parity with libraries like sharp, ImageMagick, libwebp, or apng-js.** The
goal is the smallest container parser/serializer per format that can read
and write modern, well-formed animated inputs in **three formats only**:
GIF, APNG, and animated WebP. GIF is the only format whose pixel payload
is decoded inside this package; APNG and animated WebP yield raw payload
bytes for downstream decoding. See "Out of scope (DEFERRED)" below for the
explicit deferred list.

**In scope (first pass for `image-animation`, ~3,000 LOC):**

- **GIF** (magic `GIF87a` or `GIF89a`): full container walk + LZW pixel
  decode + per-frame Graphics Control Extension (GCE) parsing + Application
  Extension (`NETSCAPE2.0` for loop count) + interlaced raster
  de-interlacing. Both static (single-image) GIFs and animated (multi-image)
  GIFs are returned through the same `GifFile` type with a `frames` array
  of length ≥ 1. Local Color Tables, Global Color Tables, and transparent
  index resolution are all in scope. We OWN GIF pixel decoding end-to-end.
- **APNG** (PNG with `acTL`/`fcTL`/`fdAT` chunks): container walk over
  the PNG chunk stream, recognition of animation chunks, validation of
  the `sequence_number` invariant across all `fcTL`+`fdAT` chunks,
  identification of whether the default IDAT image is the first animation
  frame (controlled by `fcTL` placement). The per-frame zlib-compressed
  IDAT/fdAT pixel streams are RETURNED AS RAW BYTES with frame metadata
  (`{ x, y, width, height, delayNum, delayDen, disposeOp, blendOp,
  payloadBytes }`); pixel decode is deferred to `backend-wasm`. We do NOT
  decode `IDAT` or `fdAT` here — we provide the zlib-compressed slice
  ready for `DecompressionStream('deflate')` downstream.
- **Animated WebP** (RIFF container with `VP8X` header bearing the ANIM
  flag, optional `ICCP`, `ANIM` for loop+bgcolor, sequence of `ANMF` per
  frame, optional `EXIF`/`XMP`): RIFF chunk walk, validation that `VP8X`
  is the first chunk after `WEBP` FourCC, parsing of `ANIM` and per-frame
  `ANMF` headers, identification of the per-frame VP8 (lossy) or VP8L
  (lossless) sub-frame chunk inside each `ANMF`. Per-frame pixel decode
  is OUT OF SCOPE: we yield the VP8/VP8L sub-frame as raw bytes plus
  `{ x, y, width, height, durationMs, disposalMethod, blendingMethod,
  subFormat: 'VP8' | 'VP8L', payloadBytes }`. Static WebP (single VP8 or
  VP8L without the ANIM flag) is detected and rejected — handled by a
  future `@webcvt/image-webp` package or by `backend-wasm`.
- Public API surfaces: `parseGif`, `serializeGif`, `parseApng`,
  `serializeApng`, `parseWebpAnim`, `serializeWebpAnim`, plus top-level
  dispatch `parseAnimation(input, format)` over the discriminated union
  and `serializeAnimation(file)` that switches on `file.format`. A small
  `detectAnimationFormat(input)` helper sniffs magic bytes — GIF's
  `GIF8(7|9)a`, PNG's `89 50 4E 47 0D 0A 1A 0A`, and RIFF's `RIFF....WEBP`
  are byte-disjoint.
- **Frame iteration API**: every parsed file exposes a synchronous
  `frames: AnimationFrame[]` array on the result. Each `AnimationFrame`
  has `{ index, x, y, width, height, durationMs, disposalMethod,
  blendMode, pixelData?, payloadBytes? }`. For GIF, `pixelData` is set
  (decoded RGBA `Uint8Array`). For APNG/WebP-anim, `payloadBytes` is set
  (raw zlib- or VP8/VP8L-encoded) plus `subFormat`. Consumers who need
  RGBA from APNG/WebP-anim wire `payloadBytes` into the appropriate
  decoder via `@webcvt/backend-wasm`.
- Round-trip parse → serialize **byte-equivalent** for APNG and animated
  WebP when chunks are not reordered (we preserve the original chunk
  sequence). For GIF, byte-equivalent if and only if the LZW
  re-compression produces the same opcode stream — which it generally
  does NOT, because LZW dictionary growth depends on encoder heuristics
  (eager vs. lazy table reset). GIF round-trips are therefore
  **semantic-equivalent** only (same decoded pixels per frame).

**Out of scope (Phase 4.5+, DEFERRED):**

- **Static GIF87a-only optimisation**: GIF87a never animates (the spec
  predates the multi-image extension). We accept GIF87a but only ever
  produce single-frame `frames` arrays; we do not provide a stripped-down
  static-GIF path. Callers who want the first frame just read
  `file.frames[0]`.
- **Animated AVIF**: AVIF stores image sequences inside the
  ISO-BMFF container as multiple `iref`-linked items + an `ImageGrid`
  derivation. Belongs in a future `@webcvt/image-avif` package that
  shares ISO-BMFF box-parsing primitives with `@webcvt/container-mp4`.
- **Animated JPEG (Motion JPEG / MJPEG-as-image)**: MJPEG-in-AVI streams
  are video, not images. The `image/jpeg` MIME never carries animation —
  there is no standard "animated JPEG" format. Out of scope by definition.
- **APNG `IDAT`-only fallback rendering**: per spec, a renderer that does
  NOT understand `acTL` MUST display the `IDAT` image as a static PNG.
  Producing a backwards-compatible IDAT image when SERIALIZING an APNG
  whose first animation frame is not the IDAT image is non-trivial
  (requires us to encode a default frame from arbitrary `fdAT` content);
  we DEFERRED this. First-pass serializer demands that the IDAT image
  EQUAL the first animation frame's pixel content (`fcTL.sequence_number
  = 0` referring to the IDAT). Asymmetric APNGs (hidden first frame)
  parse correctly but cannot be serialized.
- **WebP VP8 / VP8L per-frame pixel decode**: the VP8 lossy bitstream
  (RFC 6386) is ~600 pages of normative text and a ~30K LOC reference
  decoder. The VP8L lossless bitstream (~80 pages) is smaller but still
  out of first-pass scope. Deferred to `@webcvt/backend-wasm` (libwebp
  via WASM). This package returns the VP8/VP8L sub-frame as raw bytes
  with the sub-format tag.
- **APNG / WebP-anim ICC profile interpretation**: ICC chunks (PNG
  `iCCP`, WebP `ICCP`) round-trip verbatim but are not parsed.
- **APNG `tRNS` / `PLTE` chunk interaction with animation**: indexed-
  colour APNGs are extremely rare. We parse and round-trip the chunks
  but do not validate that per-frame `fdAT` payloads remain consistent
  with the palette.
- **Streaming parse / serialize**: all operations are buffered. A 4K
  animated WebP could be 100+ MiB; the cap (200 MiB) prevents abuse but
  the whole input is still loaded as a `Uint8Array`. Streaming variants
  deferred.
- **Frame compositing onto a canvas**: this package yields per-frame
  metadata + pixel bytes; the actual `disposalMethod` / `blendMode`
  composite-onto-prior-canvas operation is the responsibility of a
  future `@webcvt/image-render` package. We document the rules
  exhaustively (Trap §5, §6, §11) so that consumer can implement
  composite correctly.
- **GIF89a Plain Text Extension** (block label `0x01`): obscure
  text-rendering extension; we tolerate (skip) the chunk on parse and
  do not emit on serialize.
- **GIF Comment Extension** (block label `0xFE`): likewise, we tolerate
  and skip on parse; pass-through preserved as `commentBlocks: string[]`
  on the file record but not emitted unless explicitly populated by a
  caller before serialize.
- **WebP `EXIF` / `XMP` metadata**: round-tripped as opaque byte slices
  (`metadataChunks: { fourcc, payload }[]`) without parsing.
- **Cross-format conversion** (GIF → APNG, APNG → animated WebP, etc.):
  belongs in a higher-level `@webcvt/convert` package using the
  per-frame iteration APIs here as input.

## Official references

- **GIF89a Specification** (CompuServe, 31 July 1990) — defines the
  GIF87a and GIF89a magic blocks, Logical Screen Descriptor, Global /
  Local Color Tables, Image Descriptor, Graphics Control Extension
  (`0x21 0xF9`), Application Extension (`0x21 0xFF`), Plain Text
  Extension (`0x21 0x01`), Comment Extension (`0x21 0xFE`), trailer
  (`0x3B`), and the LZW pixel encoding (variable-bit-width codes,
  CLEAR / End-Of-Information sentinels):
  https://www.w3.org/Graphics/GIF/spec-gif89a.txt
- **NETSCAPE2.0 Application Extension** (informal but ubiquitous) —
  defines the loop-count sub-block: 11-byte identifier `NETSCAPE2.0`
  followed by a 3-byte sub-block `01 LL LL` where `LL LL` is a uint16
  little-endian loop count (0 = infinite, 1..65535 = explicit count):
  https://web.archive.org/web/19990418091434/http://members.aol.com/royalef/gifabout.htm
- **APNG Specification** (Mozilla, current revision) — defines the three
  animation chunks `acTL` (animation control), `fcTL` (frame control),
  `fdAT` (frame data), the `sequence_number` invariant, the
  `dispose_op` and `blend_op` enumerations, and the rule that the
  default `IDAT` image MAY be the first animation frame (controlled by
  `fcTL` placement): https://wiki.mozilla.org/APNG_Specification
- **PNG Specification** (W3C, Third Edition, 2023) — chunk grammar
  (length / type / data / CRC-32), critical vs. ancillary distinction,
  zlib-wrapped Deflate (RFC 1950 + RFC 1951) for IDAT/fdAT payloads:
  https://www.w3.org/TR/png/
- **WebP Container Specification** (Google, current) — RIFF container
  layout, FourCC chunks `VP8X` (extended file), `ANIM` (animation
  parameters), `ANMF` (animation frame), `VP8` (lossy frame), `VP8L`
  (lossless frame), `ICCP`, `EXIF`, `XMP`. Bit-packing of the `VP8X`
  flags byte and the `ANMF` per-frame flags byte:
  https://developers.google.com/speed/webp/docs/riff_container
- **WebP Lossy Bitstream** (RFC 6386) — referenced for the 3-byte VP8
  frame tag (which we read for the `key_frame` flag and the show-frame
  flag) but the rest is out of scope:
  https://www.rfc-editor.org/rfc/rfc6386
- **WebP Lossless Bitstream** (Google) — referenced for the VP8L 1-byte
  signature (`0x2F`) and the 4-byte image-size header:
  https://developers.google.com/speed/webp/docs/webp_lossless_bitstream_specification
- **RIFF specification** (Microsoft / IBM, 1991) — defines the FourCC
  + 4-byte little-endian size + payload + optional pad-byte chunk
  layout used by WebP. The outer `RIFF` chunk size field excludes the
  8-byte `RIFF` + size header itself but INCLUDES the 4-byte `WEBP`
  FourCC (Trap §11):
  https://learn.microsoft.com/en-us/windows/win32/xaudio2/resource-interchange-file-format--riff-
- **W3C Compression Streams** — `DecompressionStream('deflate')` is
  required for APNG zlib payloads and (in the consumer) for WebP
  lossless payloads:
  https://wicg.github.io/compression/
- **IETF RFC 1950** — ZLIB wrapper format (APNG `IDAT`/`fdAT` are
  zlib-wrapped, NOT raw deflate; trap covered in §3):
  https://www.rfc-editor.org/rfc/rfc1950

## GIF format primer

A GIF file is a 6-byte signature (`GIF87a` or `GIF89a`) + Logical Screen
Descriptor (LSD) + optional Global Color Table (GCT) + a sequence of
data blocks + trailer (`0x3B`). Data blocks are either Image Descriptors
(introduced by `0x2C`, contain a frame's pixel data) or Extension Blocks
(introduced by `0x21`, sub-divided by an extension label byte: `0xF9`
GCE, `0xFF` Application, `0x01` Plain Text, `0xFE` Comment).

The Logical Screen Descriptor is exactly 7 bytes:

| Offset | Size | Field |
|---|---|---|
| 0 | 2 | Logical screen width (uint16 little-endian) |
| 2 | 2 | Logical screen height (uint16 little-endian) |
| 4 | 1 | Packed: GCT-flag (bit 7) \| colour-resolution (bits 6-4) \| sort-flag (bit 3) \| GCT-size (bits 2-0, encodes `2^(N+1)` entries) |
| 5 | 1 | Background colour index |
| 6 | 1 | Pixel aspect ratio |

The Image Descriptor is 10 bytes:

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | `0x2C` Image Separator |
| 1 | 2 | Frame left position (uint16 LE) |
| 3 | 2 | Frame top position (uint16 LE) |
| 5 | 2 | Frame width (uint16 LE) |
| 7 | 2 | Frame height (uint16 LE) |
| 9 | 1 | Packed: LCT-flag (7) \| interlace-flag (6) \| sort-flag (5) \| reserved (4-3) \| LCT-size (2-0) |

Followed by an optional Local Color Table (if LCT-flag set) of
`3 * 2^(LCT-size+1)` bytes, then the LZW-compressed pixel data. The
pixel data starts with a 1-byte `LZW Minimum Code Size` (typically 8
for 8-bit-indexed images, but as low as 2), then a sequence of
**sub-blocks**: each sub-block is a 1-byte length `1..255` followed by
that many bytes of compressed data. The sub-block list terminates with
a zero-length sub-block (`0x00`).

The Graphics Control Extension is 8 bytes total (always immediately
precedes an Image Descriptor it qualifies):

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | `0x21` Extension Introducer |
| 1 | 1 | `0xF9` GCE label |
| 2 | 1 | `0x04` block size |
| 3 | 1 | Packed: reserved (7-5) \| disposal-method (4-2) \| user-input (1) \| transparent-flag (0) |
| 4 | 2 | Delay time, hundredths of a second (uint16 LE) |
| 6 | 1 | Transparent colour index |
| 7 | 1 | `0x00` block terminator |

Disposal methods: `0` = no disposal specified, `1` = do not dispose
(leave frame in place), `2` = restore to background colour, `3` =
restore to previous (undo this frame). Delay time of 0 is rendered
"as fast as possible" by browsers; in practice browsers floor to ~10
hundredths (~100 ms) for delays < 2 hundredths (Trap §4).

## GIF LZW primer

GIF's LZW is a variable-bit-width compressor on a code dictionary
that grows from `2^(minCodeSize+1)` initial entries up to 4096
(12-bit codes max). The first `2^minCodeSize` entries are the
"trivial" single-symbol codes (one per index in the colour table).
Two reserved codes follow: **CLEAR** at value `2^minCodeSize` and
**End-Of-Information (EOI)** at value `2^minCodeSize + 1`. The
dictionary therefore starts with `2^minCodeSize + 2` valid entries.

Decoding loop:
1. Initialise `codeSize = minCodeSize + 1` (so the first code read
   is `minCodeSize+1` bits wide, e.g. 9 bits for a typical
   minCodeSize=8). Initialise `nextCode = 2^minCodeSize + 2`.
2. Read codes LSB-first across the byte stream (Trap §2 — note the
   contrast with PNG/JPEG which are MSB-first).
3. On CLEAR: reset `codeSize = minCodeSize + 1`, `nextCode =
   2^minCodeSize + 2`, discard the dictionary back to its trivial
   prefix; the next non-CLEAR code is treated as the FIRST code of
   a new run (no prefix to add an entry to).
4. On EOI: stop decoding immediately. Padding bits in the current
   byte are discarded.
5. Otherwise: look up the code in the dictionary, emit its expansion
   bytes, and add a new dictionary entry `dict[nextCode++] = prev +
   firstByte(current)`. If `nextCode === (1 << codeSize)` and
   `codeSize < 12`, increment `codeSize`. The "kwkwk" edge case
   where a code is read that EQUALS `nextCode` (it has not yet been
   added) is handled by emitting `prev + firstByte(prev)` (Trap §3).
6. If `codeSize === 12` and the dictionary is full, KEEP using
   12-bit codes; the encoder is responsible for emitting CLEAR
   before adding a new entry. Some decoders (incorrectly) reset on
   `nextCode === 4096`; we follow the spec strictly and do NOT
   reset until we see CLEAR.

## APNG format primer

APNG is a strict superset of PNG. The PNG signature (`89 50 4E 47 0D
0A 1A 0A`) is unchanged. The chunk grammar is unchanged: each chunk
is `length (uint32 BE) | type (4 ASCII) | data (length bytes) | crc32
(uint32 BE)`. APNG adds three chunk types:

- **`acTL`** (Animation Control, 8-byte data): `num_frames (uint32
  BE) | num_plays (uint32 BE)`. `num_plays = 0` means infinite.
  MUST appear before the first `IDAT`.
- **`fcTL`** (Frame Control, 26-byte data): `sequence_number (u32 BE)
  | width (u32 BE) | height (u32 BE) | x_offset (u32 BE) | y_offset
  (u32 BE) | delay_num (u16 BE) | delay_den (u16 BE) | dispose_op
  (u8) | blend_op (u8)`. Each `fcTL` precedes the chunks that
  contain its frame's pixel data.
- **`fdAT`** (Frame Data, ≥4-byte data): `sequence_number (u32 BE) |
  zlib_compressed_pixels (rest of data)`. The pixel format mirrors
  IDAT: a zlib stream wrapping deflate-compressed PNG-filtered scan
  lines. The `sequence_number` is the chunk's index in the global
  animation sequence, and is REQUIRED to increment by 1 for each
  successive `fcTL` and `fdAT` (Trap §1).

The first `IDAT` MAY be the first animation frame, controlled by
where the first `fcTL` appears:

- If `fcTL` appears BEFORE `IDAT` → the IDAT is the FIRST frame, and
  its `fcTL` has `sequence_number = 0`. Subsequent frames are
  encoded as `fcTL` (`sequence_number = 1, 3, 5, ...`) + one or more
  `fdAT` (`sequence_number = 2, 4, 6, ...`).
- If `fcTL` appears AFTER `IDAT` → the IDAT is a "default image"
  used by APNG-unaware viewers, and is NOT part of the animation.
  The animation has `num_frames` animation frames each represented
  by `fcTL` (`sequence_number = 0, 2, 4, ...`) + `fdAT`
  (`sequence_number = 1, 3, 5, ...`). This is Trap §5 — easy to
  miss because the IDAT and the default-image rules are not
  obvious from the chunk types alone.

The APNG dispose_op values:
- `0` `APNG_DISPOSE_OP_NONE` — leave frame as-is
- `1` `APNG_DISPOSE_OP_BACKGROUND` — clear frame's region to
  transparent black (or background colour for indexed PNGs)
- `2` `APNG_DISPOSE_OP_PREVIOUS` — restore the canvas to its state
  before this frame was rendered (requires the renderer to KEEP the
  prior canvas snapshot until this frame finishes; Trap §6)

The APNG blend_op values:
- `0` `APNG_BLEND_OP_SOURCE` — overwrite frame region with new pixels
- `1` `APNG_BLEND_OP_OVER` — alpha-composite new pixels OVER existing
  canvas at frame region (Porter-Duff "over"; Trap §7)

## Animated WebP format primer

A WebP file is a RIFF container. Outer layout:

```
"RIFF" (4 bytes) | size (uint32 LE) | "WEBP" (4 bytes) | chunks...
```

The outer `size` field counts the bytes AFTER itself, INCLUDING the
4-byte `WEBP` FourCC and ALL subsequent chunks (Trap §11). So a
minimal valid WebP file is `RIFF` + `size=0x0000000C` + `WEBP` +
`VP8 ` + 4-byte VP8-chunk-size + 0 bytes payload — total 20 bytes.

For animated WebP, the chunks after `WEBP` are:

1. **`VP8X`** (Extended File chunk, 10-byte payload): MUST be the
   first chunk after `WEBP`. Layout: `flags (u8) | reserved (u24) |
   canvas_width_minus_one (u24 LE) | canvas_height_minus_one (u24 LE)`.
   The flags byte bits (LSB to MSB):
   - bit 0: reserved (MUST be 0)
   - bit 1: animation flag (1 if file is animated)
   - bit 2: XMP metadata flag
   - bit 3: EXIF metadata flag
   - bit 4: alpha flag (any frame has alpha)
   - bit 5: ICC profile flag
   - bits 6-7: reserved (MUST be 0)
   Trap §10: width and height are stored MINUS 1 (read +1, write -1).
2. Optional `ICCP` chunk (if ICC flag set in VP8X).
3. **`ANIM`** (6-byte payload): `background_color (u32 LE) |
   loop_count (u16 LE)`. Loop count 0 = infinite.
4. Sequence of **`ANMF`** chunks (one per frame). Each ANMF payload:
   - `frame_x_div_2 (u24 LE)` (Trap §9 — actual offset = stored * 2)
   - `frame_y_div_2 (u24 LE)`
   - `frame_width_minus_one (u24 LE)`
   - `frame_height_minus_one (u24 LE)`
   - `duration_ms (u24 LE)` (Trap §12 — 24-bit, max ~16.7M ms)
   - `flags (u8)`: bit 0 = blending method (0 = blend with prior,
     1 = no blend / overwrite — INVERTED, Trap §22), bit 1 =
     disposal method (0 = none, 1 = dispose to background). Bits
     2-7 reserved.
   - Followed by sub-frame chunks: optional `ALPH` (alpha channel
     for VP8 lossy frames) + exactly one of `VP8 ` or `VP8L`
     (note the trailing space in `VP8 ` — Trap §13).
5. Optional `EXIF`, `XMP` chunks at end.

The `VP8 ` (lossy) frame's first 3 bytes are the VP8 frame tag:
`bit 0 = key_frame`, `bit 1-3 = version`, `bit 4 = show_frame`,
`bits 5-23 = first_part_size`. We read `key_frame` and `show_frame`
to validate the frame is renderable but DO NOT decode the
macroblocks.

The `VP8L` (lossless) frame starts with the byte `0x2F` (lossless
signature). The next 4 bytes pack `image_width_minus_one (14
bits) | image_height_minus_one (14 bits) | alpha_used (1 bit) |
version (3 bits)` LSB-first. We validate the signature and read
the dimensions.

## File map

```
packages/image-animation/
├── package.json
├── README.md
└── src/
    ├── index.ts                      Public API re-exports
    ├── constants.ts                  Security caps, magic bytes, chunk FourCCs
    ├── errors.ts                     Typed error classes per format
    ├── detect.ts                     detectAnimationFormat magic-byte sniff
    ├── parser.ts                     parseAnimation top-level dispatch
    ├── serializer.ts                 serializeAnimation top-level dispatch
    ├── backend.ts                    AnimationBackend (identity within format)
    ├── gif.ts                        GIF container walker + GCE/AppExt parsing
    ├── gif-lzw.ts                    GIF LZW decoder + encoder
    ├── gif-deinterlace.ts            GIF interlaced row reordering helper
    ├── apng.ts                       APNG chunk walker + acTL/fcTL/fdAT parsing
    ├── png-chunks.ts                 Shared PNG chunk reader/writer (length+type+CRC)
    ├── crc32.ts                      Hand-rolled CRC-32 (PNG polynomial 0xEDB88320)
    ├── webp-anim.ts                  WebP RIFF walker + VP8X/ANIM/ANMF parsing
    ├── riff.ts                       Shared RIFF chunk reader/writer
    └── _test-helpers/
        ├── bytes.ts                  ascii, concat, u16le, u24le, u32le, u32be helpers
        ├── build-gif.ts              Synthetic GIF87a/GIF89a builders for tests
        ├── build-apng.ts             Synthetic APNG builders (chunk + CRC)
        └── build-webp-anim.ts        Synthetic animated WebP builders
```

Approximate breakdown: GIF (~900 LOC including LZW), APNG (~600
LOC), WebP-anim (~500 LOC), shared infra (~400 LOC), tests (~1,000
LOC).

## Required structures for first pass

```ts
/** Discriminated tag for top-level dispatch. */
export type AnimationFormat = 'gif' | 'apng' | 'webp-anim';

/** Disposal method enumeration (normalised across formats). */
export type DisposalMethod =
  | 'none'              // keep frame on canvas
  | 'background'        // clear region to transparent / background colour
  | 'previous';         // restore prior canvas state (APNG dispose_op=2 only)

/** Blend mode enumeration (normalised across formats). */
export type BlendMode =
  | 'source'            // overwrite (APNG blend_op=0, GIF default, WebP no-blend)
  | 'over';             // alpha-composite over (APNG blend_op=1, WebP blend)

/**
 * One frame of an animated image.
 *
 * pixelData is set ONLY for GIF (we own its pixel decode).
 * payloadBytes + subFormat are set for APNG / WebP-anim (raw encoded payload
 * for downstream WASM decoder).
 */
export interface AnimationFrame {
  /** Frame index in the animation sequence (0-based). */
  index: number;
  /** X offset of frame's top-left corner within the canvas. */
  x: number;
  /** Y offset of frame's top-left corner within the canvas. */
  y: number;
  width: number;
  height: number;
  /** Frame display duration in milliseconds. */
  durationMs: number;
  disposalMethod: DisposalMethod;
  blendMode: BlendMode;
  /** Decoded RGBA, row-major top-down. Only set for GIF. */
  pixelData?: Uint8Array;
  /**
   * Raw encoded payload bytes (zlib-deflate stream for APNG, VP8/VP8L
   * bitstream for WebP-anim). Only set for APNG and WebP-anim.
   */
  payloadBytes?: Uint8Array;
  /** Sub-format of payloadBytes for WebP-anim. Undefined for GIF/APNG. */
  subFormat?: 'VP8' | 'VP8L';
}

/** GIF: container + decoded frames. */
export interface GifFile {
  format: 'gif';
  variant: 'GIF87a' | 'GIF89a';
  /** Logical screen width. */
  canvasWidth: number;
  /** Logical screen height. */
  canvasHeight: number;
  /** Loop count from NETSCAPE2.0 application extension; 0 = infinite. */
  loopCount: number;
  /** Background colour index into globalColorTable, or undefined if no GCT. */
  backgroundColorIndex?: number;
  /** Global Color Table (RGB triplets), if present. */
  globalColorTable?: Uint8Array;
  /** Pixel aspect ratio byte from LSD; default 0 (square). */
  pixelAspectRatio: number;
  /** Decoded frames. Always at least 1. */
  frames: AnimationFrame[];
  /** Comment Extension blocks, ASCII. Round-tripped on serialize. */
  commentBlocks: string[];
}

/** APNG: container + raw frame payloads. */
export interface ApngFile {
  format: 'apng';
  /** Canvas width from the IHDR chunk. */
  canvasWidth: number;
  /** Canvas height from the IHDR chunk. */
  canvasHeight: number;
  /** num_plays from acTL; 0 = infinite. */
  numPlays: number;
  /** num_frames from acTL. MUST equal frames.length. */
  numFrames: number;
  /**
   * True if the IDAT chunk represents the first animation frame
   * (fcTL appears before IDAT). False if IDAT is a hidden default image.
   * Trap §5.
   */
  idatIsFirstFrame: boolean;
  /**
   * Frames in animation sequence order. payloadBytes contains the
   * zlib-compressed pixel stream for downstream DecompressionStream('deflate').
   */
  frames: AnimationFrame[];
  /**
   * All other PNG chunks (IHDR, PLTE, tRNS, gAMA, sBIT, etc.) preserved
   * verbatim for round-trip. Order is preserved.
   */
  ancillaryChunks: { type: string; data: Uint8Array }[];
}

/** Animated WebP: container + raw VP8/VP8L frame payloads. */
export interface WebpAnimFile {
  format: 'webp-anim';
  /** Canvas width from VP8X (already +1 corrected). */
  canvasWidth: number;
  /** Canvas height from VP8X (already +1 corrected). */
  canvasHeight: number;
  /** Background colour from ANIM, ARGB layout (uint32 LE). */
  backgroundColor: number;
  /** loop_count from ANIM; 0 = infinite. */
  loopCount: number;
  /** True if any frame has alpha (VP8X bit 4). */
  hasAlpha: boolean;
  /**
   * Frames in container order. payloadBytes contains the VP8 or VP8L
   * sub-frame as raw bytes (without the outer ANMF header). subFormat
   * tells consumers which decoder to invoke.
   */
  frames: AnimationFrame[];
  /**
   * Optional metadata chunks preserved verbatim: ICCP, EXIF, XMP, etc.
   * Order is preserved relative to ANIM/ANMF.
   */
  metadataChunks: { fourcc: string; payload: Uint8Array }[];
}

/** Discriminated union returned by the top-level dispatcher. */
export type AnimationFile = GifFile | ApngFile | WebpAnimFile;

export function parseGif(input: Uint8Array): GifFile;
export function serializeGif(file: GifFile): Uint8Array;

export function parseApng(input: Uint8Array): ApngFile;
export function serializeApng(file: ApngFile): Uint8Array;

export function parseWebpAnim(input: Uint8Array): WebpAnimFile;
export function serializeWebpAnim(file: WebpAnimFile): Uint8Array;

export function parseAnimation(
  input: Uint8Array,
  format: AnimationFormat,
): AnimationFile;
export function serializeAnimation(file: AnimationFile): Uint8Array;

/** Magic-byte sniff. Returns null if no known animated-image magic matches.
 *  NOTE: a static PNG also matches the PNG magic; this returns 'apng' only
 *  if an `acTL` chunk is FOUND in the first 64 KiB. Likewise, a static
 *  WebP returns null (no animation flag in VP8X). */
export function detectAnimationFormat(
  input: Uint8Array,
): AnimationFormat | null;
```

## Shared infra — PNG chunks + RIFF chunks + CRC-32

`png-chunks.ts` exports `readPngChunk(bytes, offset) => { type, data,
crc, nextOffset }` and `writePngChunk(type, data) => Uint8Array`.
Both compute / validate the CRC-32 over `type + data`. The CRC
implementation in `crc32.ts` uses the standard PNG polynomial
`0xEDB88320` (reflected) with a 256-entry table built lazily on
first use.

`riff.ts` exports `readRiffChunk(bytes, offset) => { fourcc, size,
payload, nextOffset }` (handles the odd-byte pad rule: chunk total
size is `8 + size + (size & 1 ? 1 : 0)`) and `writeRiffChunk(fourcc,
payload) => Uint8Array`. The outer `RIFF` chunk is treated as a
special case: `parseWebpAnim` reads bytes 0..3 as `'RIFF'`, bytes 4..7
as the outer size, asserts bytes 8..11 are `'WEBP'`, then walks
chunks starting at offset 12.

## Parser algorithm — GIF

1. **Validate input size**: `input.length >= 14` (signature + LSD +
   trailer minimum) and `<= MAX_INPUT_BYTES`. Else throw
   `GifTooShortError` / `ImageInputTooLargeError`.
2. **Read signature**: bytes 0..5 must be `GIF87a` or `GIF89a` (ASCII).
   Else throw `GifBadSignatureError`. Set `variant`.
3. **Read Logical Screen Descriptor** (7 bytes at offset 6):
   `canvasWidth = u16le(bytes[6..7])`, `canvasHeight =
   u16le(bytes[8..9])`, packed = `bytes[10]`,
   `backgroundColorIndex = bytes[11]`, `pixelAspectRatio = bytes[12]`.
4. **Validate canvas dimensions**: `canvasWidth >= 1 && <= MAX_DIM`,
   `canvasHeight >= 1 && <= MAX_DIM`. Else `GifBadDimensionError`.
5. **Read Global Color Table** if `(packed >> 7) & 1`: size in
   entries = `2 << (packed & 7)` (so 2..256), bytes = `entries * 3`.
   Read into `globalColorTable: Uint8Array`. Advance offset.
6. **Initialise** `pos`, `frames: AnimationFrame[]`, `commentBlocks:
   string[]`, `loopCount = 1` (default 1 play if no NETSCAPE),
   `pendingGCE: GraphicsControlExtension | null = null`.
7. **Main block loop** while `pos < input.length`:
   - `intro = bytes[pos++]`
   - If `intro === 0x3B` (Trailer): break.
   - If `intro === 0x21` (Extension):
     - `label = bytes[pos++]`
     - If `label === 0xF9` (GCE): consume the 8-byte GCE, decode
       disposal/transparent/delay, store as `pendingGCE`. The GCE
       block is `0x04 | packed | delay-lo | delay-hi | trans-idx |
       0x00`; assert the leading `0x04` block-size and trailing
       `0x00` terminator.
     - If `label === 0xFF` (Application): consume 1-byte block-size
       (must be `0x0B`), 11 bytes of identifier+auth-code. If
       identifier+auth = `NETSCAPE2.0`, the next sub-block is `0x03
       | 0x01 | loop-lo | loop-hi`; read `loopCount = u16le(...)`.
       Then consume sub-blocks until terminator `0x00`. For other
       application identifiers, skip all sub-blocks.
     - If `label === 0xFE` (Comment): collect sub-block contents into
       a string and push to `commentBlocks`. Sub-blocks terminate at
       `0x00`.
     - If `label === 0x01` (Plain Text): skip the 13-byte header +
       trailing sub-blocks (we ignore Plain Text content).
     - Else: throw `GifUnknownExtensionError`.
   - Else if `intro === 0x2C` (Image Descriptor):
     - Consume the 9 bytes after the separator: `frameX, frameY,
       frameWidth, frameHeight, packed`.
     - Validate `frameX + frameWidth <= canvasWidth` (Trap §15) and
       same for Y.
     - Read Local Color Table if LCT-flag set.
     - Choose active palette: LCT if present, else GCT. If neither,
       throw `GifNoPaletteError`.
     - Read 1-byte `lzwMinCodeSize` (must be in `[2, 8]`).
     - Read sub-blocks (length-prefixed bytes terminated by `0x00`)
       and concatenate into `compressedBytes`. Cap total size at
       `MAX_GIF_FRAME_BYTES` (Trap §16).
     - Call `decodeLzw(compressedBytes, lzwMinCodeSize, frameWidth *
       frameHeight)` to produce indexed pixel array.
     - If interlace-flag set, call `deinterlace(indexed,
       frameWidth, frameHeight)` to reorder rows from the
       4-pass GIF interlace pattern (Trap §14): rows in order
       0,8,16,..., then 4,12,20,..., then 2,6,10,..., then
       1,3,5,...
     - Convert indexed → RGBA: for each index `i`, look up
       `palette[i*3..i*3+2]` for RGB; alpha = (pendingGCE has
       transparent-flag AND `i === pendingGCE.transparentIndex`) ?
       0 : 255.
     - Build `AnimationFrame`: `index = frames.length`, `x =
       frameX`, `y = frameY`, `width = frameWidth`, `height =
       frameHeight`, `durationMs = pendingGCE ? pendingGCE.delay *
       10 : 0`, `disposalMethod = mapGifDisposal(pendingGCE?.
       disposal ?? 0)`, `blendMode = 'source'` (GIF has no
       per-frame blend; transparency is via index, not alpha
       channel, but emitted RGBA reflects it).
     - Push frame; clear `pendingGCE`.
   - Else: throw `GifBadBlockIntroError`.
8. Validate `pos <= input.length` (Trap §17 — we tolerate extra
   trailing bytes after `0x3B` from some encoders).
9. Return `GifFile`.

`mapGifDisposal(0|1) → 'none'`, `(2) → 'background'`, `(3) →
'previous'`, `(4..7) → 'none'` (reserved values, treat as no
disposal; some encoders emit 4).

## Parser algorithm — GIF LZW

1. Initialise `out = new Uint8Array(expectedPixels)`, `dst = 0`.
2. `clearCode = 1 << minCodeSize`, `eoiCode = clearCode + 1`,
   `nextCode = eoiCode + 1`, `codeSize = minCodeSize + 1`.
3. Initialise dictionary: `dict[i] = [i]` for `i in 0..clearCode-1`;
   `dict[clearCode]` and `dict[eoiCode]` are sentinels.
4. Initialise bit reader: `bitBuf = 0`, `bitsAvailable = 0`,
   `srcPos = 0`. Helper `readCode()` returns the next `codeSize`
   bits LSB-first from `compressed`:
   ```
   while bitsAvailable < codeSize:
     bitBuf |= compressed[srcPos++] << bitsAvailable
     bitsAvailable += 8
   code = bitBuf & ((1 << codeSize) - 1)
   bitBuf >>>= codeSize
   bitsAvailable -= codeSize
   return code
   ```
5. Read first code; expect CLEAR. Read second code → it must be a
   trivial code (`< clearCode`); emit its single byte; set `prev =
   code`.
6. Loop: `code = readCode()`.
   - If `code === clearCode`: reset `nextCode = eoiCode + 1`,
     `codeSize = minCodeSize + 1`. The next code becomes the new
     `prev` (no dictionary entry added).
   - Else if `code === eoiCode`: stop.
   - Else if `code < nextCode`: `entry = dict[code]`; emit `entry`;
     add `dict[nextCode++] = dict[prev] ++ [entry[0]]`; if
     `nextCode === (1 << codeSize) && codeSize < 12`, `codeSize++`.
   - Else if `code === nextCode` (kwkwk edge case, Trap §3):
     `entry = dict[prev] ++ [dict[prev][0]]`; emit `entry`; add
     `dict[nextCode++] = entry`; size-bump same as above.
   - Else: throw `GifLzwInvalidCodeError(code)`.
   - Set `prev = code`.
7. Validate `dst === expectedPixels` (Trap §18 — reject overlong
   too). If too short, throw `GifLzwTruncatedError`.

## Serializer algorithm — GIF

1. Build header: `'GIF89a'` (we always emit GIF89a even if input was
   GIF87a, because we may serialize NETSCAPE2.0).
2. Build Logical Screen Descriptor (7 bytes) from `canvasWidth /
   canvasHeight / globalColorTable / backgroundColorIndex /
   pixelAspectRatio`.
3. Emit Global Color Table if present.
4. Emit NETSCAPE2.0 Application Extension with `loopCount` (always
   emitted if `frames.length > 1`).
5. For each frame:
   - Build a Local Color Table from the frame's RGBA pixelData
     (quantise to ≤256 unique colours per frame). If frame uses
     more than 256 colours, throw `GifTooManyColorsError` —
     real-world GIF encoders run k-means quantisation; we DEFER
     palette quantisation to a future helper and accept only
     ≤256-colour frames in first-pass serialize.
   - Build Graphics Control Extension from
     `durationMs / disposalMethod / blendMode`. Round
     `durationMs / 10` to nearest hundredth (Trap §4); cap delay at
     `0xFFFF` hundredths.
   - Build Image Descriptor (10 bytes) + LCT + LZW pixel stream.
   - Encode pixels with `encodeLzw(indexed, lzwMinCodeSize)` —
     produces a sub-block stream (length-prefixed segments
     terminated by `0x00`).
6. Append trailer `0x3B`.
7. Return concatenated Uint8Array.

## Parser algorithm — APNG

1. **Validate input size**: `input.length >= 8 + 12 + 12 + 12` (PNG
   sig + IHDR + at minimum acTL + IEND). Else throw
   `ApngTooShortError`. `input.length <= MAX_INPUT_BYTES`.
2. **Validate PNG signature**: bytes 0..7 must equal `89 50 4E 47 0D
   0A 1A 0A`. Else `ApngBadSignatureError`.
3. **Walk chunks** starting at offset 8:
   - For each chunk: `length = u32be(off)`, `type = ascii(off+4..8)`,
     `data = bytes[off+8..off+8+length]`, `crc = u32be(off+8+length)`.
     Validate CRC-32 over `type + data` (Trap §8). Cap `length <=
     MAX_PNG_CHUNK_BYTES` BEFORE allocation.
   - On `IHDR`: parse `canvasWidth = u32be(data[0..4])`,
     `canvasHeight = u32be(data[4..8])`, plus bit-depth, colour-type,
     compression, filter, interlace bytes. Validate dimensions.
     Store the chunk in `ancillaryChunks` (we keep IHDR for
     round-trip but fold the parsed values into the file record).
   - On `acTL`: parse `numFrames = u32be(data[0..4])`,
     `numPlays = u32be(data[4..8])`. Validate `numFrames >= 1 && <=
     MAX_FRAMES` and `numFrames * canvasWidth * canvasHeight * 4 <=
     MAX_TOTAL_FRAME_BYTES` (Trap §19 — multiplicative cap BEFORE
     allocating the frames array).
   - On `fcTL`: parse the 26-byte frame header. Validate
     `sequenceNumber === expectedSequence` (start at 0, increment by
     1 on each fcTL+fdAT; Trap §1). Begin a new frame
     `currentFrame = { ... }`. The fcTL's pixel data is whatever
     IDAT/fdAT chunks come next until the next fcTL or IEND.
   - On `IDAT`: append `data` to `currentFrame.payloadBytes` if
     `currentFrame` exists (i.e. fcTL appeared before IDAT, so this
     IDAT IS the first animation frame); otherwise (fcTL not yet
     seen) accumulate IDAT into `defaultImagePayload` as a hidden
     default image (Trap §5). Set `idatIsFirstFrame` accordingly
     when the first fcTL is encountered.
   - On `fdAT`: validate `sequenceNumber = u32be(data[0..4]) ===
     expectedSequence`. Append `data[4..]` (the bytes AFTER the
     4-byte sequence-number prefix; Trap §2) to
     `currentFrame.payloadBytes`.
   - On `IEND`: stop. Validate `frames.length === numFrames`;
     `currentFrame` (if any) is finalised before this check.
   - On other chunk types (`PLTE`, `tRNS`, `gAMA`, `cHRM`, `sRGB`,
     `iCCP`, `bKGD`, `hIST`, `pHYs`, `sBIT`, `sPLT`, `tIME`, `tEXt`,
     `zTXt`, `iTXt`): preserve verbatim in `ancillaryChunks` for
     round-trip. Reject unknown CRITICAL chunks (chunk type's first
     letter is uppercase) with `ApngUnknownCriticalChunkError`.
4. After IEND: build the `frames` array. For each frame, pixelData
   stays undefined; `payloadBytes` is the concatenated raw IDAT/fdAT
   payload (zlib-deflate stream); subFormat stays undefined (APNG
   payload is always zlib-deflate).
5. Return `ApngFile`.

The duration calculation: APNG `delay_num / delay_den` is in
seconds. Per spec, `delay_den === 0` MUST be treated as `100`
(centiseconds). Compute `durationMs = (delayNum / (delayDen ||
100)) * 1000`. Round to integer.

## Serializer algorithm — APNG

1. Reject if `idatIsFirstFrame === false` and `frames.length > 0`
   — first-pass serializer cannot generate a hidden default image
   (Out of scope above). Throw `ApngHiddenDefaultNotSupportedError`.
2. Emit PNG signature `89 50 4E 47 0D 0A 1A 0A`.
3. Emit IHDR chunk (rebuilt from `canvasWidth, canvasHeight` and
   the IHDR ancillary chunk's other bytes if present, else default
   to 8-bit RGBA / colour-type 6).
4. Emit `acTL` chunk: `numFrames = frames.length`, `numPlays`.
5. For each `frame` in `frames`:
   - Emit `fcTL` chunk (sequence_number = next expected, currently
     `2 * index`).
   - For frame 0 (which is the IDAT frame because
     `idatIsFirstFrame === true`): emit `IDAT` chunk(s) splitting
     `payloadBytes` into ≤ `MAX_IDAT_CHUNK_SIZE` (typically 8 KiB).
     IDAT chunks do NOT carry a sequence number.
   - For frames 1..N-1: emit `fdAT` chunk(s) with the sequence
     number prefix prepended (Trap §2). Split if `payloadBytes`
     exceeds `MAX_IDAT_CHUNK_SIZE`.
6. Emit ancillary chunks at their original positions in the chunk
   stream (we recorded `(type, data)` in order; preserve insertion
   order, but skip critical chunks we already emitted).
7. Emit `IEND` chunk (zero-length, type `'IEND'`, fixed CRC).
8. CRC-32 over `type + data` for every chunk.

## Parser algorithm — Animated WebP

1. **Validate input size**: `input.length >= 12 + 18 + 6 + 24` (RIFF
   + VP8X + ANIM + minimal ANMF). Else `WebpAnimTooShortError`.
   `input.length <= MAX_INPUT_BYTES`.
2. **Read RIFF header**: bytes 0..3 must be `RIFF`. Bytes 4..7 are
   the outer size (uint32 LE). Bytes 8..11 must be `WEBP`. Validate
   `8 + outerSize === input.length` OR `8 + outerSize === input.length
   - 1` (some encoders omit the trailing pad byte; tolerate). Else
   `WebpBadRiffError`.
3. **Walk chunks** starting at offset 12:
   - `fourcc = ascii(bytes[off..off+4])`, `size = u32le(bytes[off+4..
     off+8])`, `payload = bytes[off+8..off+8+size]`. If `size & 1`,
     advance by 1 extra pad byte. Cap `size <= MAX_RIFF_CHUNK_BYTES`.
   - Expect first chunk to be `VP8X`. Else throw
     `WebpAnimMissingVp8xError`.
   - Parse VP8X: `flags = payload[0]`. `(flags >> 1) & 1` MUST be
     1 (animation flag set; Trap §20). Read `canvasWidth =
     u24le(payload[4..7]) + 1` and `canvasHeight = u24le(payload[7..
     10]) + 1` (Trap §10). Validate dimensions.
   - Walk remaining chunks:
     - `ICCP`: store in `metadataChunks`.
     - `ANIM`: parse `backgroundColor = u32le(payload[0..4])`,
       `loopCount = u16le(payload[4..6])`.
     - `ANMF`: parse 16-byte header. `frameX = u24le(payload[0..3])
       * 2`, `frameY = u24le(payload[3..6]) * 2` (Trap §9: x/y use
       *2 bias); `frameWidth = u24le(payload[6..9]) + 1`,
       `frameHeight = u24le(payload[9..12]) + 1` (Trap §10: width/
       height use +1 bias); `durationMs = u24le(payload[12..15])`
       (Trap §12), `frameFlags = payload[15]`. `blendingMethod =
       (frameFlags & 0x02) ? 'source' : 'over'` (Trap §22 — bit 1
       SET means "do not blend"!). `disposalMethod = (frameFlags &
       0x01) ? 'background' : 'none'`. Validate `frameX +
       frameWidth <= canvasWidth` and similarly for Y. Then walk
       inner chunks within `payload[16..]`:
       - Optional `ALPH` (alpha channel for VP8 lossy frames):
         store alongside payload.
       - Exactly one of `VP8 ` (note trailing space; Trap §13) or
         `VP8L`. Set `subFormat`. For `VP8 `, validate the 3-byte
         frame tag: `key_frame = (tag[0] & 1) === 0` and
         `show_frame = (tag[0] >> 4) & 1`. For `VP8L`, validate the
         signature byte `0x2F`.
       - Set `payloadBytes = entire VP8 or VP8L sub-frame including
         its own header bytes` (downstream decoder needs them).
     - `EXIF`, `XMP`: store in `metadataChunks`.
     - Unknown FourCC: `WebpAnimUnknownChunkError`.
   - Cap `frames.length <= MAX_FRAMES` AS each ANMF is appended,
     not after (Trap §19).
4. Return `WebpAnimFile`.

## Serializer algorithm — Animated WebP

1. Build VP8X chunk: 10-byte payload, animation flag set, width-1
   and height-1 written as u24 LE. Pad-byte if size is odd (size 10
   is even, no pad).
2. Optionally emit `ICCP` (from metadataChunks, in original order).
3. Build ANIM chunk: `backgroundColor` u32 LE, `loopCount` u16 LE.
4. For each frame:
   - Build ANMF header (16 bytes): x/2, y/2, width-1, height-1,
     durationMs (capped at 0x00FFFFFF), flags byte.
   - Append the frame's `payloadBytes` (already containing the VP8
     or VP8L sub-frame bytes verbatim).
   - Wrap as RIFF chunk with FourCC `ANMF`.
5. Append remaining metadata chunks (`EXIF`, `XMP`).
6. Compute outer size = total bytes written - 8.
7. Prepend `RIFF` + outer size + `WEBP`. Return.

## Top-level dispatch and detection

`parseAnimation(input, format)` switches on `format`. `serializeAnimation
(file)` switches on `file.format`. `detectAnimationFormat(input)`
returns `'gif'` for `GIF87a` / `GIF89a`, `'apng'` for the PNG signature
(after a quick scan for an `acTL` chunk in the first 64 KiB — a static
PNG returns null), `'webp-anim'` for `RIFF....WEBP` followed by a
`VP8X` chunk with the animation flag set, and `null` otherwise.

Detection is exposed for callers but is NOT applied automatically
inside `parseAnimation` — the caller passes the format hint
explicitly to defend against magic-byte coincidences and to avoid
double-scanning the input for the APNG / WebP-anim disambiguation.

## Backend integration

`AnimationBackend` (in `backend.ts`) implements the `@webcvt/core`
backend interface. `canHandle(input, output)` returns `true` only when
input MIME === output MIME AND both belong to one of the three formats
(`image/gif`, `image/apng`, `image/webp` with the animation flag).
The backend is identity-within-format: `convert` parses and re-
serializes, returning the same MIME. There is no cross-format
conversion in this package.

Note on `image/webp`: the standard WebP MIME is `image/webp`
regardless of static or animated. To distinguish at the backend level,
we either read the VP8X flag from the input bytes during `canHandle`
(small read, cheap) or accept that `canHandle` returns true and
`convert` throws `WebpStaticNotSupportedError` for static WebP
inputs. Choose the latter for simplicity in first pass.

## Fixture strategy

All-synthetic in-test, like `image-legacy`. NO committed binary
fixtures. Test inputs are inline byte arrays built with helpers under
`src/_test-helpers/`:

- `bytes.ts` — `ascii`, `concat`, `u16le`, `u24le`, `u32le`, `u32be`.
  ~50 LOC. (Note: `u24le` is new — WebP uses 24-bit LE values
  pervasively.)
- `build-gif.ts` — `gif89a({ canvasW, canvasH, gct?, frames:
  [{ x, y, w, h, palette?, indexed: number[], delay?, disposal?,
  transparent? }], loopCount? }) => Uint8Array`. Constructs full
  GIF89a with NETSCAPE2.0 if `loopCount` provided; encodes pixel
  data via the SAME `encodeLzw` we use in production (validated
  separately). ~250 LOC.
- `build-apng.ts` — `apng({ w, h, numPlays, frames:
  [{ x, y, w, h, delayNum, delayDen, dispose, blend, payload:
  Uint8Array }], idatIsFirstFrame, ancillary?: Chunk[] }) =>
  Uint8Array`. Computes CRC-32 for each chunk via the same
  `crc32` helper. ~200 LOC.
- `build-webp-anim.ts` — `webpAnim({ canvasW, canvasH,
  loopCount, bg, frames: [{ x, y, w, h, duration, dispose, blend,
  subFormat, payload }] }) => Uint8Array`. Handles the (-1) bias on
  width/height and the (/2) bias on x/y. ~150 LOC.

Round-trip tests use `serializeXxx` output as input to `parseXxx`
and assert structural equality (and byte equality where the format
is deterministic).

## Test plan

Minimum 12 hand-crafted synthetic fixture cases (we list more for
margin):

1. `parseGif decodes a static 2×2 GIF87a with global color table`
2. `parseGif decodes a 4-frame GIF89a with NETSCAPE2.0 loop=0 (infinite)`
3. `parseGif decodes a frame with transparent index via GCE and emits alpha=0`
4. `parseGif decodes an interlaced 8×8 frame and reorders rows correctly`
5. `parseGif decodes an LZW stream with explicit CLEAR mid-stream and resets dictionary`
6. `parseGif decodes the kwkwk LZW edge case (code === nextCode)`
7. `parseGif rejects a frame with frameX + frameWidth > canvasWidth`
8. `parseGif rejects an LZW stream that produces fewer pixels than width × height`
9. `parseGif rejects unknown extension label with GifUnknownExtensionError`
10. `parseGif tolerates trailing bytes after 0x3B trailer`
11. `serializeGif round-trips a 4-frame animation to byte-equal output (palette unchanged)`
12. `serializeGif caps delay at 0xFFFF hundredths and rounds to centiseconds`
13. `parseApng decodes a 1-frame APNG that's actually static (acTL.numFrames=1, fcTL before IDAT)`
14. `parseApng decodes a 3-frame APNG where IDAT is the first frame (idatIsFirstFrame=true)`
15. `parseApng decodes a 3-frame APNG where IDAT is a hidden default image (fcTL after IDAT, idatIsFirstFrame=false)`
16. `parseApng rejects fdAT whose sequence_number breaks the running sequence`
17. `parseApng rejects fdAT whose data is shorter than the 4-byte sequence prefix`
18. `parseApng rejects an unknown CRITICAL chunk type with uppercase first letter`
19. `parseApng rejects a chunk whose declared length exceeds MAX_PNG_CHUNK_BYTES`
20. `parseApng rejects a chunk with corrupt CRC-32`
21. `parseApng treats delay_den=0 as denominator=100 (per spec)`
22. `serializeApng refuses to serialize an APNG with idatIsFirstFrame=false (deferred case)`
23. `serializeApng splits oversized fdAT payloads into multiple chunks`
24. `parseWebpAnim decodes a 2-frame animation with mixed VP8 + VP8L frames and reports correct subFormat`
25. `parseWebpAnim correctly applies +1 bias on canvas width/height (VP8X) and frame width/height (ANMF)`
26. `parseWebpAnim correctly applies *2 bias on frame x/y (ANMF)`
27. `parseWebpAnim correctly interprets the inverted blending bit (set means "no blend / source")`
28. `parseWebpAnim rejects a file whose VP8X is missing the animation flag (static WebP)`
29. `parseWebpAnim rejects a file where VP8X is not the first chunk after WEBP`
30. `parseWebpAnim handles the odd-byte RIFF pad correctly across multiple chunks`
31. `parseWebpAnim rejects the FourCC "VP8" without trailing space (Trap §13)`
32. `parseWebpAnim rejects VP8L sub-frame missing the 0x2F signature byte`
33. `parseWebpAnim rejects truncated frame headers (ANMF payload < 16 bytes)`
34. `parseAnimation rejects a file with frame count > MAX_FRAMES`
35. `parseAnimation rejects a file where total declared frame pixel bytes > MAX_TOTAL_FRAME_BYTES`
36. `detectAnimationFormat returns 'apng' only when an acTL chunk is present in first 64 KiB of a PNG`
37. `detectAnimationFormat returns 'webp-anim' only when VP8X has animation flag set`
38. `serializeAnimation / parseAnimation round-trip preserves discriminated union for all 3 formats`

## Known traps

1. **APNG `sequence_number` invariant across fcTL+fdAT.** The
   spec mandates a STRICTLY MONOTONIC sequence: `fcTL`(seq=0) →
   (IDAT or fdAT(seq=1)) → `fcTL`(seq=2) → fdAT(seq=3) → ... or,
   when IDAT is the first frame, `fcTL`(seq=0) → IDAT (no
   sequence_number) → `fcTL`(seq=1) → fdAT(seq=2) → ... The
   sequence_number lives in `fcTL` AND in `fdAT`'s 4-byte prefix.
   Many decoders forget to validate the prefix sequence; we MUST,
   else a deliberately-mis-sequenced file could be used to cause
   frame-state desync. Validate `expectedSequence === sequenceNumber`
   on EVERY fcTL and fdAT, and increment after each.

2. **APNG `fdAT` chunk has a 4-byte sequence_number prefix BEFORE
   the zlib data.** When extracting `payloadBytes` for downstream
   decoding, you MUST strip the first 4 bytes of the `fdAT` data
   field. The remaining bytes are the zlib-compressed frame
   pixels. A naïve concat that includes the sequence_number bytes
   produces invalid zlib. The corresponding IDAT chunk for frame 0
   does NOT have a sequence_number prefix — its entire data field
   is zlib bytes. The serializer must symmetrically PREPEND the
   sequence_number to fdAT and not to IDAT.

3. **APNG `IDAT`/`fdAT` payload is zlib-WRAPPED deflate, not raw
   deflate.** The first two bytes are the zlib header (CMF + FLG,
   typically `0x78 0x9C` for default-compression deflate). Use
   `DecompressionStream('deflate')` (which expects the zlib
   wrapper), NOT `'deflate-raw'`. Many decoder bugs come from
   confusing the two. We do not decode here, but our DOC must say
   "use 'deflate'" so downstream consumers do the right thing.

4. **GIF delay 0 is "as fast as possible" but browsers floor.**
   Spec says `delay = 0` means render with no delay. Browsers
   (Chromium / Firefox) silently floor delays of 0 OR 1 to ~10
   hundredths (~100 ms) to prevent CPU thrashing. We preserve the
   on-disk value verbatim in `durationMs` (so 0 → 0, 1 → 10) and
   document that consumers must apply their own minimum-delay
   policy if rendering. Do NOT silently re-write to 100 ms in the
   parser.

5. **APNG `dispose_op = 2` (APNG_DISPOSE_OP_PREVIOUS) requires
   keeping prior canvas state.** The compositor MUST snapshot the
   canvas BEFORE rendering this frame, and after the frame's
   display time elapses, RESTORE the snapshot. This means a
   compositor needs O(N) snapshots in the worst case. The first
   frame MUST NOT use dispose_op=2 (no prior state). We do not
   implement compositing in this package, but `AnimationFrame.
   disposalMethod = 'previous'` is set so consumers know to
   snapshot. Rejection rule: throw `ApngFirstFramePreviousError`
   if frames[0].disposalMethod === 'previous'.

6. **APNG `blend_op = 1` (APNG_BLEND_OP_OVER) does alpha
   compositing per pixel.** Each output pixel is computed via
   Porter-Duff "over": `C_out = C_src + C_dst * (1 - A_src)`,
   `A_out = A_src + A_dst * (1 - A_src)`. Naïve overwrite when
   blend_op=1 is set produces wrong results for partially-
   transparent sprites. The first frame MUST use blend_op=0
   (no canvas state to blend against). We do not composite here
   but document via `AnimationFrame.blendMode = 'over'`.

7. **APNG IDAT defines the canvas size, NOT the first fcTL.** The
   IHDR chunk's `width × height` is the CANVAS size, which all
   frame coordinates are relative to. The first fcTL's
   `width × height` may be SMALLER than the canvas (a sprite
   updating a region). Failing to keep IHDR's dimensions for the
   canvas leads to clipped or stretched output.

8. **PNG chunk CRC-32 over `type + data`, not just data.** The
   CRC field at the end of every chunk is computed over the 4-byte
   chunk type + the data bytes. NOT over the length prefix. NOT
   over data alone. Use the standard PNG polynomial `0xEDB88320`
   (which is the bit-reversed `0x04C11DB7`). Our `crc32.ts`
   builds a 256-entry lookup table on first call and runs the
   standard table-driven loop with bit-flip pre/post.

9. **WebP ANMF frame_x and frame_y are stored as (offset / 2),
   width and height as (n - 1).** Two DIFFERENT bias rules in the
   same struct. `frameX = (payload[0..3] LE) * 2`,
   `frameY = (payload[3..6] LE) * 2`,
   `frameWidth = (payload[6..9] LE) + 1`,
   `frameHeight = (payload[9..12] LE) + 1`. The /2 implies that
   frame offsets must be EVEN — the spec says odd offsets produce
   undefined behaviour; we reject odd offsets at serialize time
   with `WebpAnimOddOffsetError`.

10. **WebP VP8X canvas_width and canvas_height are stored as
    (n - 1), packed as 24-bit little-endian.** A canvas of width
    1024 stores `0x03FF` (1023) over 3 bytes LE: `FF 03 00`. Read
    the 3 bytes as a uint24 LE then add 1. Max canvas dim is
    `2^24 = 16777216`, but we cap at `MAX_DIM = 16384`. Forgetting
    the +1 produces an off-by-one canvas that crops the final
    column / row.

11. **WebP RIFF outer size includes the `WEBP` FourCC.** The
    outer-most `RIFF` chunk's 4-byte size field counts ALL bytes
    after itself: the 4-byte `WEBP` FourCC + every subsequent
    chunk. So `8 + outerSize === total file length` (modulo a
    trailing pad byte if the last chunk's payload had odd length).
    Many implementations count only the chunks AFTER `WEBP` and
    miss it by 4. The validation rule is exact: `8 + outerSize ===
    input.length` OR `8 + outerSize === input.length - 1` (allow
    the trailing pad). On serialize, write `outerSize = 4 +
    sum(8 + chunk.payload.length + (chunk.payload.length & 1) for
    each chunk)`.

12. **WebP ANMF duration is 24-bit unsigned, max ~16.7M ms.** The
    duration field is 3 bytes (uint24 LE), not 4. A typical
    encoder produces values like 100 (100 ms) or 33 (~30 fps);
    durations > 16,777,215 ms (~4.6 hours per frame) overflow.
    Cap on serialize; reject durations > 0x00FFFFFF on the
    `frame.durationMs` input with `WebpAnimDurationOverflowError`.
    Read MUST mask to 24 bits in case the 4th byte at that offset
    happens to be the first byte of the flags field.

13. **WebP `VP8 ` FourCC has a TRAILING SPACE.** The VP8 lossy
    chunk's FourCC is the four bytes `0x56 0x50 0x38 0x20` —
    `'V' 'P' '8' ' '`. Without the trailing space it is not the
    lossy chunk identifier. `'VP8L'` (0x56 0x50 0x38 0x4C) is the
    lossless one. Comparison must be byte-exact, not by
    string-trimmed equality. A common bug: storing the FourCC as a
    JS string `'VP8'` (3 chars) and comparing fails for the lossy
    case but passes for VP8L.

14. **GIF interlace — 4-pass row order.** When the Image
    Descriptor's interlace-flag is set, on-disk rows are emitted
    in 4 passes: pass 1 = rows 0, 8, 16, 24, ...; pass 2 = rows
    4, 12, 20, ...; pass 3 = rows 2, 6, 10, ...; pass 4 = rows
    1, 3, 5, .... `gif-deinterlace.ts` rebuilds a contiguous
    top-down raster from the on-disk order. Forgetting this leaves
    the image appearing "venetian-blind" striped. The serializer
    we ship does NOT emit interlaced GIFs (always interlace-flag =
    0); we only need the decode path.

15. **GIF frame may extend beyond canvas.** The Image Descriptor's
    `frameLeft + frameWidth` can exceed `canvasWidth` per the
    informal "any encoder might do it" tradition. The W3C spec
    is silent on whether this is legal; in practice browsers clip.
    We REJECT it strictly with `GifFrameOutsideCanvasError` to
    keep the parser simple — clipping is a render-time concern.

16. **GIF LZW sub-block stream cap.** Each sub-block is up to 255
    bytes; an arbitrary number of sub-blocks may follow. A 100×100
    GIF with maximally-padded LZW could reasonably reach 12 KB of
    compressed data; a malicious input could declare millions of
    sub-blocks and exhaust memory before LZW decode caps the pixel
    count. Cap the total compressed-byte accumulation at
    `MAX_GIF_FRAME_BYTES = 16 MiB` per frame BEFORE the LZW
    decode step.

17. **GIF trailing bytes after `0x3B` trailer.** Some encoders
    (notably old FlashAnts) emit a trailing newline or a few null
    bytes after the trailer byte. Tolerate up to 16 trailing
    bytes; reject more with `GifTrailingBytesError`.

18. **GIF LZW pixel-count mismatch.** The LZW stream's decoded
    output MUST equal exactly `frameWidth × frameHeight`. Both
    underflow (truncated input) and overflow (extra trailing data
    before EOI) are rejection conditions. Some real-world
    encoders pad with extra clear/EOI sequences; we do not
    tolerate any post-EOI bytes within the sub-block stream
    (only the terminating zero-length sub-block).

19. **APNG / WebP `numFrames` allocation amplification.** A 30-byte
    `acTL` chunk can declare `numFrames = 0xFFFFFFFF`. The natural
    implementation `frames = new Array(numFrames)` allocates 4G
    pointers (~32 GB on 64-bit). Cap `MAX_FRAMES = 4096` for both
    formats. Additionally, validate `numFrames * canvasWidth *
    canvasHeight * 4 <= MAX_TOTAL_FRAME_BYTES = 1 GiB` BEFORE
    allocating any frame structures. Same rule for WebP-anim
    incrementally as ANMF chunks are walked: stop and reject the
    moment the count exceeds `MAX_FRAMES`.

20. **WebP VP8X animation flag is bit 1, not bit 0.** The flags
    byte has bits 0 (reserved, must be 0), 1 (animation), 2 (XMP),
    3 (EXIF), 4 (alpha), 5 (ICC). A common bug is reading bit 0
    or bit 7. Use `(flags >> 1) & 1` exactly. A static WebP has
    bit 1 = 0; we REJECT it because static WebP is out of scope
    for this package.

21. **GIF NETSCAPE2.0 loop count placement.** The NETSCAPE2.0
    Application Extension MUST appear BEFORE the first Image
    Descriptor for browsers to recognise the loop count. If it
    appears later, behaviour is unspecified. On parse we accept
    it anywhere in the data-block sequence (before or after image
    descriptors); on serialize we always emit it immediately after
    the LSD/GCT, before any frames.

22. **WebP ANMF blending bit is INVERTED from intuition.** The
    flags byte bit 0 is `1` for "do not blend" (overwrite,
    `BlendMode.source`) and `0` for "alpha blend" (`BlendMode.
    over`). The naive reading "1 = blend" is BACKWARDS. The
    disposal bit (bit 1) is straightforward: `1` = dispose to
    background. Misinterpretation here results in every frame
    overwriting OR every frame alpha-blending — visually
    catastrophic. Test 27 covers this explicitly.

23. **WebP ANMF inner chunks are themselves RIFF chunks.** The
    payload inside ANMF after the 16-byte header is one or more
    nested RIFF-format chunks: optional `ALPH` then exactly one
    `VP8 ` or `VP8L`. Use the same `readRiffChunk` helper inside
    the ANMF payload as for the outer chunks. Each inner chunk
    pays the same odd-byte pad cost.

## Security caps

- **Input cap**: 200 MiB (`MAX_INPUT_BYTES = 200 * 1024 * 1024`).
  Validated before any parse. Reuses the cap from `image-legacy`.

- **Frame count cap**: `MAX_FRAMES = 4096`. Real-world animated
  formats rarely exceed a few hundred frames; a 4096 cap allows
  reasonable looping animations while preventing
  `numFrames=0xFFFFFFFF` allocation amplification (Trap §19).
  Validated BEFORE allocating the `frames` array.

- **Total frame pixel-byte cap**: `MAX_TOTAL_FRAME_BYTES = 1 GiB`.
  Sanity check on `numFrames * canvasWidth * canvasHeight * 4`.
  For GIF this is computed as `numFrames * canvasWidth *
  canvasHeight * 4` even though GIF stores indexed pixels (each
  decoded frame produces RGBA). Belt-and-braces with `MAX_FRAMES`.

- **Per-frame compressed-byte cap**: `MAX_GIF_FRAME_BYTES = 16
  MiB` for GIF LZW sub-block accumulation; `MAX_PNG_CHUNK_BYTES =
  64 MiB` for any single PNG chunk; `MAX_RIFF_CHUNK_BYTES = 64
  MiB` for any single RIFF chunk. Caps the inner allocation step
  before the chunk's data is buffered.

- **Per-format dimension cap**: `MAX_DIM = 16384` (independent
  width and height limit). Defends against u24 / u32 max
  declarations.

- **Loop count cap**: `MAX_LOOP_COUNT = 0xFFFF` for GIF (uint16
  is the spec max anyway); APNG and WebP store loop count in
  uint32 / uint16 respectively, but we cap both at the GIF max
  for normalisation. Loop count 0 is treated as "infinite" and
  preserved verbatim; values 1..MAX_LOOP_COUNT are explicit
  counts.

- **Allocation order**: ALL caps validated BEFORE any allocation.
  A failed cap throws a typed error and never allocates.

- **Strict parsers**: malformed signatures, missing required
  chunks (acTL, VP8X, ANIM, ANMF), broken sequence numbers,
  corrupt CRC-32, invalid VP8X flags, ANMF without VP8/VP8L
  sub-frame, GIF frame outside canvas, GIF LZW invalid code, GIF
  LZW pixel-count mismatch — all throw typed per-format errors.
  No silent acceptance.

- **No format auto-detection inside `parseAnimation`**: caller
  must pass `format` explicitly. `detectAnimationFormat` is a
  separate, opt-in helper. This avoids silent corruption from
  misclassified inputs (especially important because static PNG
  and APNG share the same magic bytes).

## Dependencies

- **`@webcvt/core`** — `WebcvtError` base class for typed errors;
  `Backend`, `FormatDescriptor`, `ConvertOptions`, `ConvertResult`
  types for the backend integration.

- **Native `DecompressionStream('deflate')`** — used by
  CONSUMERS of this package to decode APNG `IDAT` / `fdAT`
  payloads. Not invoked inside this package (we pass through
  `payloadBytes`). Documented in our README so consumers know
  which algorithm name to pass (NOT `'deflate-raw'`; APNG uses
  zlib-wrapped deflate per Trap §3).

- **Hand-rolled LZW decoder + encoder** for GIF — implemented in
  `gif-lzw.ts`. The decoder is ~100 LOC, the encoder ~150 LOC.
  No external dependency.

- **Hand-rolled CRC-32** for PNG chunks — implemented in
  `crc32.ts`. ~30 LOC including the lazy table init. No external
  dependency. Required because the browser provides no built-in
  CRC-32 primitive.

- **VP8 / VP8L pixel decoding is OUT OF SCOPE.** Per the Scope
  statement: animated WebP frame pixel decoding is delegated to
  `@webcvt/backend-wasm` (which wraps libwebp). This package only
  parses the RIFF container, validates VP8X / ANIM / ANMF
  chunks, and yields the raw VP8 / VP8L sub-frame bytes for the
  consumer to decode. We are EXPLICIT in the README and in
  `WebpAnimFile.frames[i].payloadBytes`'s JSDoc that these bytes
  are NOT decoded RGBA — they are the on-disk encoded frame
  bytes. Consumers must wire them into a VP8/VP8L decoder via
  `backend-wasm`.

- **PNG IDAT / fdAT pixel decoding is OUT OF SCOPE.** Same
  pattern as WebP. We yield the zlib-compressed scan-line stream
  as `payloadBytes`; consumer pipes to `DecompressionStream
  ('deflate')`, then defilters (PNG filter types 0..4 per scan
  line), then re-interleaves channels. The defiltering step is a
  natural fit for a future `@webcvt/image-png` package; this
  package's surface area is intentionally limited to APNG
  container concerns.

- **`@webcvt/test-utils`** (dev-only) — provides shared test-byte
  helpers that overlap with our `_test-helpers/bytes.ts`. We
  prefer per-package `_test-helpers/` to keep the package
  zero-deps, but may import `@webcvt/test-utils` for fixture
  generation parity in cross-package integration tests.

- **`@webcvt/backend-wasm`** — NOT a hard dependency of this
  package. Mentioned in the README as the recommended way to
  complete the APNG / WebP-anim pipeline, but the consumer wires
  it explicitly. This package compiles and ships independent of
  any WASM bundle.

## Estimated LOC

| File | LOC est. |
|---|---|
| `gif.ts` | 350 |
| `gif-lzw.ts` | 280 |
| `gif-deinterlace.ts` | 50 |
| `apng.ts` | 400 |
| `png-chunks.ts` | 120 |
| `crc32.ts` | 50 |
| `webp-anim.ts` | 380 |
| `riff.ts` | 80 |
| `detect.ts` | 90 |
| `parser.ts` | 60 |
| `serializer.ts` | 50 |
| `backend.ts` | 110 |
| `errors.ts` | 200 |
| `constants.ts` | 80 |
| `index.ts` | 60 |
| **subtotal source** | **~2,360** |
| `_test-helpers/bytes.ts` | 60 |
| `_test-helpers/build-gif.ts` | 250 |
| `_test-helpers/build-apng.ts` | 200 |
| `_test-helpers/build-webp-anim.ts` | 150 |
| `*.test.ts` (38 cases) | 700 |
| **subtotal tests** | **~1,360** |
| **TOTAL** | **~3,720** |
