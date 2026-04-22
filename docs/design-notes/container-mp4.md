# container-mp4 design

> Implementation reference for `@catlabtech/webcvt-container-mp4`. Write the code
> from this note plus the linked official spec. Do not consult competing
> implementations except for debugging spec-ambiguous edge cases.

## Format overview

MP4 (ISO/IEC 14496-14) is a profile of the ISO Base Media File Format
(ISOBMFF, ISO/IEC 14496-12), which itself is the spec descendant of
Apple's QuickTime File Format. The on-disk model is a tree of
*boxes* (also called *atoms* in QuickTime-speak), each carrying a
4-byte size, a 4-byte four-character type, and a payload that is either
opaque bytes or a list of child boxes. There is no global file header
beyond an `ftyp` box that names the major brand (e.g. `mp42`, `isom`,
`M4A `) and a list of compatible brands.

Audio and video are described by a `moov` (movie) box containing one
`trak` (track) per stream. Each track's `stbl` (sample table) is a set
of parallel arrays that map *sample number → chunk → file offset → size
→ duration*. The encoded sample bytes live in one or more `mdat` (media
data) boxes, which may appear before or after `moov` depending on
whether the file was authored for streaming ("faststart") or
post-processed ("interleaved").

## Scope statement

**This note covers a FIRST-PASS implementation, not full ISOBMFF.** The
goal is the smallest box set that can demux a single-audio-track M4A
(AAC-in-MP4) and round-trip it. Phase 3.5+ will extend to video tracks,
multi-track files, fragmented MP4, edit lists, metadata, and DRM. See
"Out of scope (DEFERRED)" below for the explicit deferred list.

**In scope (first pass, ~1,650 LOC):**

- `ftyp` box and brand recognition (`M4A `, `M4V `, `mp42`, `isom`, `qt  `)
- Single-track audio files (`.m4a` is the canonical fixture target)
- The minimum box set: `ftyp`, `moov`, `mvhd`, `trak`, `tkhd`, `mdia`,
  `mdhd`, `hdlr`, `minf`, `smhd`, `dinf`, `stbl`, `stsd`, `mp4a`,
  `esds`, `stts`, `stsc`, `stsz`, `stco`/`co64`, `mdat`
- 32-bit `stco` chunk offsets and 64-bit `co64` (interchangeable)
- Uncompressed sample tables: per-sample sizes (`stsz`), time-to-sample
  (`stts`), sample-to-chunk (`stsc`), chunk offsets (`stco`/`co64`)
- `esds` parsing to recover the AAC `AudioSpecificConfig`
- Round-trip parse → serialize for the supported subset
- WebCodecs decode: extract AAC samples from `mdat` and submit as
  `EncodedAudioChunk`s with `description = AudioSpecificConfig`

**Out of scope (Phase 3.5+, DEFERRED):**

- Video sample entries (`mp4v`, `avc1`, `hev1`/`hvc1`, `vp09`, `av01`)
- Multi-track files (multi-audio, audio+video, subtitles)
- Edit lists (`elst`)
- Fragmented MP4 (`moof`, `mfra`, `tfra`, `sidx`, `mehd`, `trex`,
  `traf`, `tfhd`, `trun`)
- Movie / track metadata (`udta`, `meta`, iTunes-style atoms, MP4RA
  brand registries)
- DRM and encryption (`pssh`, `senc`, `saiz`, `saio`, `cenc`)
- Sample groups (`sbgp`, `sgpd`)
- Subtitle / text tracks (`tx3g`, `text`)
- HEIF / HEIC image item tracks (`iloc`, `iinf`, `iprp`, `ipco`)
- QuickTime-only legacy boxes (`wide`, `pnot`, `pict`, `cmov`)
- Composition-time offsets (`ctts`) — assumed absent; throw if seen
- Compact sample size table (`stz2`) — only `stsz` supported

## Official references

- ISO/IEC 14496-12:2022 — ISO Base Media File Format (the substantive
  spec for boxes, sample tables, time mapping):
  https://www.iso.org/standard/83102.html
- ISO/IEC 14496-14:2020 — MP4 file format (thin profile on top of
  14496-12, defines `ftyp` brand `mp42` and the `mp4a`/`esds` audio
  sample entry): https://www.iso.org/standard/79110.html
- ISO/IEC 14496-1 — Systems (defines the MPEG-4 elementary stream
  descriptor tags inside `esds`): https://www.iso.org/standard/55688.html
- ISO/IEC 14496-3 §1.6.2.1 — `AudioSpecificConfig` bit layout (also
  used by `container-aac`)
- Apple QuickTime File Format Specification (the historical ancestor;
  useful for the `qt  ` brand and any QT-only quirks):
  https://developer.apple.com/documentation/quicktime-file-format
- MP4 Registration Authority (brands, codec four-CCs, object type
  indications): https://mp4ra.org/

## Top-level file layout

```
offset   bytes   box
0        8+      ftyp box       major_brand + minor_version + compatible_brands[]
N        8+      moov box       movie header + tracks
                                 ├─ mvhd            (movie header: timescale, duration)
                                 └─ trak            (one track)
                                     ├─ tkhd        (track header: id, dimensions=0 for audio)
                                     └─ mdia
                                         ├─ mdhd    (media header: timescale, duration, language)
                                         ├─ hdlr    (handler type: 'soun')
                                         └─ minf
                                             ├─ smhd  (sound media header: balance)
                                             ├─ dinf  (data information: dref → 'url ' self-ref)
                                             └─ stbl
                                                 ├─ stsd → mp4a → esds
                                                 ├─ stts (time-to-sample, RLE)
                                                 ├─ stsc (sample-to-chunk, RLE)
                                                 ├─ stsz (sample sizes)
                                                 └─ stco / co64 (chunk offsets)
M        8+      mdat box       opaque bytes; sample table indexes into this
                 (mdat may also precede moov — see Trap #8)
```

## Box header layout

```
offset  bytes  field            notes
 0       4     size             big-endian u32; see Trap #1 for special values
 4       4     type             four-byte ASCII ('moov', 'mp4a', etc.)
[8       8     largesize]       big-endian u64, present iff size == 1
[8 or 16 16    user_type]       UUID, present iff type == 'uuid' (we reject for first pass)
N       ...    payload          payload_size = (size or largesize) - header_size
```

Header size is 8 bytes normally, 16 bytes when `largesize` is used, +16
more when type is `uuid`. Many "full" boxes (a 14496-12 concept)
prepend a 1-byte `version` and 3-byte `flags` to the payload — that is
the box's first 4 payload bytes, not part of the size header.

## Required boxes — layouts and semantics

### `ftyp` (File Type Box, 14496-12 §4.3)

```
payload offset  bytes        field
 0              4            major_brand        e.g. 'mp42', 'M4A ', 'isom', 'qt  '
 4              4            minor_version      u32, informational
 8              4 * N        compatible_brands  list until end of payload
```

We accept any of `mp42`, `M4A `, `M4V `, `isom`, `qt  ` as
major-or-compatible. We reject brands implying fragmented MP4
(`iso5`, `iso6`, `dash`) for the first pass — see deferred list.

### `moov` (Movie Box, §8.2.1) — container

Children we read: `mvhd` (1), `trak` (1 in first pass; throw if >1).

### `mvhd` (Movie Header Box, §8.2.2) — full box, version 0 or 1

```
field                version=0   version=1
creation_time        u32         u64
modification_time    u32         u64
timescale            u32         u32         (movie time units per second)
duration             u32         u64         (in timescale units)
rate                 i32 (Q16.16)            playback rate, usually 0x00010000
volume               i16 (Q8.8)              usually 0x0100
reserved             10 bytes
matrix               9 * i32                 (transform; identity for audio)
pre_defined          24 bytes (zero)
next_track_ID        u32
```

### `trak` (Track Box, §8.3.1) — container

Children: `tkhd` (1), `mdia` (1). We do NOT read `edts/elst` or `udta`
in first pass.

### `tkhd` (Track Header Box, §8.3.2) — full box, version 0 or 1

```
flags             3 bytes (bit 0 = enabled, bit 1 = in_movie, bit 2 = in_preview)
creation_time     u32 / u64
modification_time u32 / u64
track_ID          u32
reserved          4 bytes
duration          u32 / u64       (in mvhd.timescale, NOT mdhd.timescale — Trap #9)
reserved          8 bytes
layer             i16
alternate_group   i16
volume            i16             (Q8.8; 0x0100 for audio, 0 for non-audio)
reserved          2 bytes
matrix            9 * i32
width             u32 (Q16.16)    0 for audio
height            u32 (Q16.16)    0 for audio
```

### `mdia` (Media Box, §8.4.1) — container

Children: `mdhd` (1), `hdlr` (1), `minf` (1).

### `mdhd` (Media Header Box, §8.4.2) — full box, version 0 or 1

```
creation_time     u32 / u64
modification_time u32 / u64
timescale         u32             (track time units per second; for audio
                                   typically equal to sample rate, e.g. 44100)
duration          u32 / u64       (in mdhd.timescale)
language          u16             (ISO-639-2/T packed: 3 chars, 5 bits each, +1 pad bit)
pre_defined       u16
```

### `hdlr` (Handler Reference Box, §8.4.3) — full box, version 0

```
pre_defined   u32 (0)
handler_type  4 bytes              for audio = 'soun'; 'vide' for video (rejected)
reserved      12 bytes (3 * u32, zero)
name          UTF-8 string, null-terminated, fills rest of box
```

### `minf` (Media Information Box, §8.4.4) — container

Children: `smhd` (1, audio), `dinf` (1), `stbl` (1).

### `smhd` (Sound Media Header Box, §8.4.5.3) — full box, version 0

```
balance       i16 (Q8.8; 0 for centered)
reserved      u16 (0)
```

### `dinf` (Data Information Box, §8.7.1) — container

Holds a `dref` (data reference) that itself holds entries pointing at
where the media data lives. For self-contained files the only entry is
a single `url ` box with flags=1 (self-contained). We **assert** this
in first pass; external data references throw.

### `stbl` (Sample Table Box, §8.5.1) — container

Required children for first pass: `stsd`, `stts`, `stsc`, `stsz`, and
either `stco` or `co64`. Canonical write order is exactly that
sequence; readers tolerate any order (Trap #12).

### `stsd` (Sample Description Box, §8.5.2) — full box, version 0

```
entry_count   u32
entries       entry_count concatenated sample entry boxes
              (for our scope: exactly one `mp4a` entry)
```

### `mp4a` (MP4 Audio Sample Entry, 14496-14 §5.6) — sample entry

Inherits from `AudioSampleEntry` (14496-12 §12.2.3):

```
reserved                6 bytes (zero)
data_reference_index    u16   (1-based index into dinf/dref; we expect 1)
reserved                u32 + u32 (zero)
channelcount            u16   (1 or 2; QuickTime extensions allow more, ignored)
samplesize              u16   (16; legacy, not the actual decoded depth)
pre_defined             u16
reserved                u16
samplerate              u32 (Q16.16)   high 16 bits = sample rate; low 16 bits zero
                                       for rates > 65535 see QTFF v1 sound entry (deferred)
[child boxes follow — for mp4a, exactly one `esds` box]
```

### `esds` (Elementary Stream Descriptor, 14496-1 §7.2.6) — full box, version 0

Body is a tree of MPEG-4 descriptor tags. Each tag: 1-byte tag id,
1–4-byte variable-length size, payload. For our scope:

```
ES_DescrTag (0x03)
  ES_ID                u16
  flags                u8   (stream_dependence | URL | OCR_stream | streamPriority)
  [optional fields skipped per flags]
  DecoderConfigDescriptor (0x04)
    objectTypeIndication  u8   (0x40 = MPEG-4 Audio; 0x67 = MPEG-2 LC AAC)
    streamType            u8   (high 6 bits; 0x05 = AudioStream)
    bufferSizeDB          u24
    maxBitrate            u32
    avgBitrate            u32
    DecoderSpecificInfo (0x05)
      bytes              AudioSpecificConfig (2..N bytes)
  SLConfigDescriptor (0x06)
    predefined           u8   (0x02 = MP4)
```

We read `DecoderSpecificInfo` (which IS the `AudioSpecificConfig`) and
hand it to WebCodecs as the decoder description.

### `stts` (Time-to-Sample Box, §8.6.1.2) — full box, version 0; **RLE**

```
entry_count            u32
entries[entry_count]:
  sample_count         u32
  sample_delta         u32   (in mdhd.timescale units)
```

Sample N's start time = sum of deltas for samples 0..N-1. See Trap #10.

### `stsc` (Sample-to-Chunk Box, §8.7.4) — full box, version 0; **RLE**

```
entry_count            u32
entries[entry_count]:
  first_chunk          u32   (1-based)
  samples_per_chunk    u32
  sample_description_index u32
```

Each entry applies until the `first_chunk` of the next entry; the last
entry runs to the final chunk. See Trap #3.

### `stsz` (Sample Size Box, §8.7.3.2) — full box, version 0

```
sample_size            u32   (if non-zero, all samples have this size)
sample_count           u32
[if sample_size == 0]
  entry_size[sample_count]   u32
```

See Trap #5.

### `stco` (Chunk Offset Box, §8.7.5) — full box, version 0

```
entry_count            u32
chunk_offset[entry_count]   u32   (file offset)
```

### `co64` (Large Chunk Offset Box, §8.7.5) — full box, version 0

Same as `stco` but `u64` offsets. Reader picks whichever is present
(exactly one). See Trap #4.

### `mdat` (Media Data Box, §8.1.1) — opaque

Payload is opaque media bytes. Sample table chunk offsets point into
the file (not into `mdat` payload). May appear before or after `moov`
(Trap #8). May be very large; do NOT eagerly copy — slice on demand.

## Key types we will model

```ts
interface Mp4BoxHeader {
  type: string;            // four-CC, e.g. 'mp4a'
  size: number;            // total box size including header (bytes)
  headerSize: 8 | 16;      // 16 if largesize was used
  payloadOffset: number;   // absolute file offset of the first payload byte
  payloadSize: number;     // size - headerSize
}

interface Mp4Box extends Mp4BoxHeader {
  /** Raw payload slice. Children boxes (if any) parsed lazily. */
  payload: Uint8Array;
  children?: Mp4Box[];     // populated only for known container types
}

interface Mp4Ftyp {
  majorBrand: string;
  minorVersion: number;
  compatibleBrands: string[];
}

interface Mp4MovieHeader {
  timescale: number;       // mvhd.timescale (movie units / second)
  duration: number;        // in mvhd.timescale units
  nextTrackId: number;
}

interface Mp4MediaHeader {
  timescale: number;       // mdhd.timescale (track units / second)
  duration: number;        // in mdhd.timescale units
  language: string;        // 3-char ISO-639-2/T, e.g. 'und'
}

interface Mp4AudioSampleEntry {
  channelCount: number;
  sampleSize: number;      // legacy; usually 16
  sampleRate: number;      // from Q16.16 high half
  /** AudioSpecificConfig bytes from esds DecoderSpecificInfo. */
  decoderSpecificInfo: Uint8Array;
  objectTypeIndication: number;  // 0x40 = MPEG-4 Audio
}

interface Mp4SampleTable {
  /** Per-sample byte length, computed from stsz (flat table or constant). */
  sampleSizes: Uint32Array;
  /** Per-sample absolute file offset, computed from stsc + stco/co64. */
  sampleOffsets: BigUint64Array;
  /** Per-sample duration in mdhd.timescale units, expanded from RLE stts. */
  sampleDeltas: Uint32Array;
  /** sampleCount === sampleSizes.length === sampleOffsets.length. */
  sampleCount: number;
}

interface Mp4Track {
  trackId: number;
  handlerType: 'soun';     // first pass: only audio
  mediaHeader: Mp4MediaHeader;
  audioSampleEntry: Mp4AudioSampleEntry;
  sampleTable: Mp4SampleTable;
}

interface Mp4File {
  ftyp: Mp4Ftyp;
  movieHeader: Mp4MovieHeader;
  tracks: Mp4Track[];      // first pass: length 1
  /** Original mdat byte ranges as (offset, length) pairs; used by serializer. */
  mdatRanges: Array<{ offset: number; length: number }>;
  /** Reference to the underlying file bytes; sample data sliced on demand. */
  fileBytes: Uint8Array;
}

export function parseMp4(input: Uint8Array): Mp4File;
export function serializeMp4(file: Mp4File): Uint8Array;

export function* iterateAudioSamples(
  track: Mp4Track,
  fileBytes: Uint8Array,
): Generator<{ data: Uint8Array; timestampUs: number; durationUs: number }>;
```

## Demuxer (read) algorithm

1. **Top-level scan**: from offset 0, walk top-level boxes by reading
   each box header. Validate `size` against remaining bytes (Trap #1).
   Record offset + size + type for every top-level box. Enforce the
   200 MiB input cap and the per-box size cap (mdat exempted). Enforce
   the global box-count cap.
2. **Locate `ftyp`**: must be the first top-level box. Decode brands.
   Reject fragmented brands.
3. **Locate `moov`**: search the top-level list. May not be first
   (Trap #8). If absent, throw `Mp4MissingMoovError`.
4. **Locate `mdat`**: at least one top-level `mdat`. Record byte
   ranges; do not copy contents.
5. **Descend into `moov`** with the recursive box walker, capped at
   depth 10 (Trap: deep nesting). Parse `mvhd` (branch on version for
   32/64-bit time fields, Trap #2).
6. **For the single `trak`** (throw if count != 1):
   a. Parse `tkhd` (versioned).
   b. Parse `mdia → mdhd` (versioned).
   c. Parse `mdia → hdlr`. If `handler_type != 'soun'`, throw
      `Mp4UnsupportedTrackTypeError` (deferred: video).
   d. Parse `mdia → minf → smhd` (just for validation).
   e. Parse `mdia → minf → dinf → dref`. Assert single self-contained
      `url ` entry with flags & 1.
   f. Parse `mdia → minf → stbl`:
      - `stsd`: assert `entry_count == 1`. Read the child as `mp4a`;
        if any other four-CC, throw `Mp4UnsupportedSampleEntryError`.
      - `mp4a`: extract channel_count, sample_rate, then descend into
        the child `esds`.
      - `esds`: walk descriptor tags 0x03 → 0x04 → 0x05, decode each
        variable-length size (Trap #6). Capture
        `DecoderSpecificInfo` bytes as `decoderSpecificInfo`.
      - `stts`: decode RLE table (Trap #10). Expand into a flat
        `sampleDeltas: Uint32Array` of length `sampleCount`.
      - `stsc`: decode RLE table (Trap #3). Combined with `stco`/`co64`
        chunk offsets and `stsz` per-sample sizes, compute
        `sampleOffsets[i]` for every sample.
      - `stsz`: branch on `sample_size == 0` (per-sample table) vs
        non-zero (constant size — broadcast into the array). See
        Trap #5.
      - `stco` xor `co64`: read offsets array. If `co64` is present
        treat offsets as u64; else u32 widened to u64 (Trap #4).
      - Apply the cap of 1,000,000 entries to each table.
   g. Build `Mp4SampleTable`. Validate every `sampleOffset +
      sampleSize <= fileBytes.length` (catches truncated files).
7. **Validate** that `mdhd.duration / mdhd.timescale` is consistent
   with the sum of `sampleDeltas / mdhd.timescale` to within one
   sample (Trap #9). Warn rather than throw on mismatch.
8. Return `Mp4File`.

## Muxer (write) algorithm

1. Accept an `Mp4File` produced by the parser (or constructed by
   higher layers). Reject files with unsupported content (more than
   one track, video tracks, fragmented hints).
2. **Canonical box order**: `ftyp` → `moov` → `mdat`. We always emit
   `moov` before `mdat` ("faststart" layout) regardless of the input
   order — simpler for streaming consumers.
3. **Recompute offsets**: serialise `moov` to a buffer first
   (descriptor sizes depend on contents). Compute the absolute file
   offset where `mdat` payload will begin =
   `len(ftyp) + len(moov) + 8` (or +16 for `co64` / largesize). Patch
   each `chunk_offset` in `stco`/`co64` to point at the new mdat
   location. Re-emit `stbl`/`moov` with patched offsets — this is a
   second serialise pass since changing values may toggle u32 → u64
   and shift sizes. Iterate to a fixed point (max 2 passes in
   practice).
4. **Emit `ftyp`** with original brands, or `mp42` major + `[isom,
   mp42, M4A ]` compatible if synthesising from scratch.
5. **Emit `moov`** with versioned boxes using version 0 when all time
   fields fit in u32, version 1 otherwise.
6. **Emit `mdat`**: 8-byte header (or 16-byte largesize header if
   payload > 4 GiB - 8) followed by sample bytes copied from the
   source `fileBytes` slices in sample-iteration order. Maintain
   chunking so that recomputed `stsc` and `stco` agree.
7. Concatenate and return.

For the round-trip case (no edits), the muxer can take a fast path:
preserve the original box order including a leading `mdat` if present,
and emit byte-identical output. The "always-faststart" path above is
the canonical write order for newly authored files.

## WebCodecs integration

- **Decode**: `codec: 'mp4a.40.2'` (LC AAC) into a `WebCodecsAudioDecoder`.
  Pass `description = decoderSpecificInfo` (the raw
  `AudioSpecificConfig` bytes from `esds`). For each sample emitted by
  `iterateAudioSamples`, construct an `EncodedAudioChunk` with `type:
  'key'` (AAC frames are independent), `timestamp` in microseconds
  derived from the running `mdhd.timescale` total, and `duration` from
  the `stts` entry. `data` is the raw `mdat` slice — no ADTS header.
  Object type indication 0x40 maps to `mp4a.40.<aot>` where `aot` is
  the first 5 bits of `AudioSpecificConfig` (2 = LC, 5 = SBR/HE-AACv1,
  29 = PS/HE-AACv2). Emit the codec string accordingly.
- **Encode**: WebCodecs supports AAC encode in Chromium 116+. The
  `Mp4Backend.canHandle` returns `false` for encode in Phase 1, routing
  encode requests to `@catlabtech/webcvt-backend-wasm` (ffmpeg.wasm) via the core
  BackendRegistry's fallback chain. A native AAC-encode → MP4-mux path
  is Phase 3.5+ work.
- **Probe**: `probeAudioCodec({ codec: 'mp4a.40.2', sampleRate,
  numberOfChannels })` before submitting any chunk. Fall back to
  ffmpeg-wasm if unsupported (mostly older Safari).

## Test plan

- `parses ftyp box and recognises mp42 / isom / M4A brands`
- `rejects fragmented MP4 brand (iso5) with Mp4UnsupportedBrandError`
- `parses single-track audio M4A end-to-end`
- `decodes mvhd and tkhd version 0 (32-bit time fields)`
- `decodes mvhd and tkhd version 1 (64-bit time fields)`
- `expands stts RLE into per-sample durations`
- `expands stsc RLE and computes per-sample chunk membership correctly`
- `extracts sample table and computes per-sample byte offsets via stsc + stsz + stco`
- `accepts both stco (32-bit) and co64 (64-bit) chunk offsets transparently`
- `handles stsz with sample_size != 0 (constant-size case) without per-sample table`
- `parses esds variable-length descriptor sizes (1-byte and 4-byte forms)`
- `extracts AudioSpecificConfig bytes from DecoderSpecificInfo`
- `tolerates moov-after-mdat layout and moov-before-mdat layout`
- `rejects multi-track file with Mp4MultiTrackNotSupportedError`
- `rejects video-handler track with Mp4UnsupportedTrackTypeError`
- `rejects external data reference (dref url with flags = 0)`
- `round-trip: parse → serialize → byte-identical for a clean M4A`
- `serializer faststart re-layout: input mdat-first → output ftyp+moov+mdat with patched offsets`
- `enforces 200 MiB input cap and per-table 1M entry cap`

## Known traps

1. **Box size encoding** (§4.2): the 4-byte `size` is the total box
   size including header. `size == 1` means "read 8 more bytes as
   `largesize` and use that instead". `size == 0` means "extends to
   end of file" and is **only valid for the top-level `mdat`** —
   every other box must declare its size. Mis-handling any of these
   three cases corrupts the entire walk.

2. **Versioned boxes** (§4.2 "FullBox"): `mvhd`, `tkhd`, `mdhd` carry
   a 1-byte `version` followed by 3-byte `flags` BEFORE the payload.
   `version == 0` uses u32 time fields; `version == 1` uses u64. Reader
   must branch on version. `stsd`, `stts`, `stsc`, `stsz`,
   `stco`/`co64`, `hdlr`, `smhd`, `dref`, `esds` are also FullBoxes
   (version + flags header), but their version is always 0 in our
   scope.

3. **`stsc` is run-length encoded** (§8.7.4): each entry says
   "starting at chunk N, every chunk has K samples and uses
   description index D". An entry runs until the `first_chunk` of the
   *next* entry. Reading entries naively as one entry per chunk
   produces wildly wrong sample counts. Algorithm: iterate chunk
   index, advance to next stsc entry when chunk index reaches its
   `first_chunk`. The total chunk count comes from `stco`/`co64`.

4. **`stco` (32-bit) vs `co64` (64-bit)**: same logical role; exactly
   one is present. Files >4 GiB use `co64`; smaller files almost
   always use `stco`. The `ftyp` brand does not predict which. Reader
   must look for both. Writer should choose based on whether any
   chunk offset exceeds u32 range.

5. **`stsz.sample_size == 0` means "use per-sample table"**, non-zero
   means "all samples are this size and no table follows". Easy to
   over-allocate (parsing a table that isn't there) or under-iterate
   (assuming there's always a table).

6. **`esds` descriptor size is variable-length** (14496-1 §8.3.3): 1
   to 4 bytes, 7 payload bits per byte, top bit = "more bytes
   follow". The byte sequence `0x80 0x80 0x80 0x22` decodes to size
   34, not 0x80808022. Easy to mis-decode. Cap descriptor size at 16
   MiB to bound recursion.

7. **Endianness**: ALL multi-byte fields are big-endian (network byte
   order). MP4 is consistently BE — but if you've just been working
   on RIFF/WAV (LE) it's the opposite, easy to misread. The Q16.16
   sample rate in `mp4a` is also BE: high u16 is the integer rate.

8. **`mdat` placement**: may appear before `moov` (interleaved
   authoring layout) or after `moov` (faststart, used for
   progressive download). Reader MUST scan all top-level boxes
   before trying to extract sample data — it cannot assume `moov`
   precedes `mdat`. Do not stop at the first `mdat`.

9. **`mvhd.timescale` vs `mdhd.timescale`**: `mvhd.timescale` is the
   movie-level time unit (e.g. 600 ticks/sec, an Apple legacy). `tkhd.duration` is in `mvhd.timescale`.
   `mdhd.timescale` is the track-level time unit (commonly equal to
   the audio sample rate, e.g. 44100). `mdhd.duration` and all
   `stts` deltas are in `mdhd.timescale`. Mixing the two corrupts
   duration and timestamp calculations.

10. **`stts` is run-length encoded**: each entry is
    `(sample_count, sample_delta)`. Most audio files have exactly
    one entry covering all samples (constant frame duration), but
    the spec allows N entries. Treat as RLE; expand or iterate
    lazily.

11. **`AudioSpecificConfig` reuse with `container-aac`**: the
    DecoderSpecificInfo bytes inside `esds` are an
    `AudioSpecificConfig` — the same 2+ byte structure that
    `container-aac` already parses (`packages/container-aac/src/asc.ts`).
    Plan: extract the ASC parser/builder into a shared helper
    (proposed location `packages/codec-aac/src/asc.ts` or similar)
    so both packages depend on a single implementation. Documented
    in §"Implementation references" as planned helper-share.

12. **Box ordering in `stbl`**: the recommended order is `stsd → stts
    → ctts? → stsc → stsz/stz2 → stco/co64`. Some real-world files
    violate this. Reader should accept any order (collect known
    boxes by type into a record then assemble at the end). Writer
    should always emit canonical order.

13. **`stsd` `entry_count` header**: the box body starts with the
    standard 1-byte version + 3-byte flags + a 4-byte `entry_count`
    BEFORE the child sample-entry boxes. Easy to forget the entry
    count and start parsing the first sample entry from byte 4
    instead of byte 8.

14. **Sample entry inheritance** (§8.5.2.2 / §12.2.3): `mp4a` is an
    `AudioSampleEntry` which is itself a `SampleEntry`. The first 8
    payload bytes are 6 reserved zero bytes + a u16
    `data_reference_index` — that header is *not* a FullBox header
    (no version/flags). Then the `AudioSampleEntry`-specific 20
    bytes follow. Then child boxes (e.g. `esds`). Mis-skipping the
    8-byte SampleEntry header makes everything downstream a slip
    by 8.

15. **QuickTime `mp4a` v1 sound description**: QuickTime extends the
    `AudioSampleEntry` with a `version` field (the legacy "sound
    description version" in the first 2 bytes of the otherwise-zero
    6-byte reserved area). v1 adds 16 more bytes (samples_per_packet,
    bytes_per_packet, bytes_per_frame, bytes_per_sample); v2 adds
    even more. ISO MP4 always uses v0 (all zeros in the reserved
    area). For first pass, **assert v0** and throw on v1/v2 — defer
    QT-specific extensions.

16. **`mdat` size field for very large files**: when sample data
    exceeds ~4 GiB minus header overhead, the writer must use the
    `largesize` (16-byte header) form for `mdat`. This shifts every
    chunk offset by 8 bytes, which is what forces the muxer's
    fixed-point iteration in step 3.

## Security caps

- 200 MiB input cap in parser entry (`MAX_INPUT_BYTES`).
- Per-box size cap: any box claiming size > 64 MiB is rejected,
  except `mdat` which may be the bulk of the file.
- Total box count per file: 10,000 (`MAX_BOXES_PER_FILE`).
- Recursion depth cap: 10 levels when descending into containers
  (`moov/trak/mdia/minf/stbl/stsd/mp4a/esds` is already 8 deep, so
  the budget is tight by design — it forces a stack rather than
  unbounded recursion).
- `entry_count` for `stsz`, `stts`, `stsc`, `stco`/`co64`, `stsd`,
  `dref`: capped at 1,000,000 entries (`MAX_TABLE_ENTRIES`).
- `esds` variable-length descriptor size capped at 16 MiB
  (`MAX_DESCRIPTOR_BYTES`).
- All multi-byte length fields validated against
  `claimed <= remaining_bytes_in_container` BEFORE any allocation.
- Sample offset + size validated against `fileBytes.length` for
  every sample.

## LOC budget breakdown

| File | LOC est. |
|---|---|
| `box-header.ts` (size / largesize parsing, four-CC) | 80 |
| `box-tree.ts` (recursive box walker with depth cap, type whitelist) | 120 |
| `boxes/ftyp.ts` (ftyp + brand recognition + reject list) | 60 |
| `boxes/mvhd-tkhd-mdhd.ts` (versioned time-field boxes) | 150 |
| `boxes/hdlr-stsd-mp4a.ts` (handler + sample entry header + audio sample entry) | 150 |
| `boxes/stbl.ts` (stts / stsc / stsz / stco / co64 — RLE-aware sample-table builder) | 250 |
| `boxes/esds.ts` (variable-length tag decoder + DecoderSpecificInfo extraction) | 180 |
| `parser.ts` (top-level scan, mdat + moov coordination, validation) | 150 |
| `serializer.ts` (round-trip serializer + faststart re-layout fixed point) | 200 |
| `sample-iterator.ts` (turn parsed sample table into iterable EncodedAudioChunks) | 100 |
| `backend.ts` (Mp4Backend, decode-only canHandle for Phase 1) | 80 |
| `errors.ts` (typed errors: missing moov, unsupported brand, multi-track, etc.) | 60 |
| `constants.ts` (security caps, brand allowlist, four-CC table) | 30 |
| `index.ts` (re-exports) | 40 |
| **total** | **~1650** |
| tests | ~700 |

Headline plan.md budget for full container-mp4: ~6,000 LOC. First-pass
target was ~1,500. Realistic: ~1,650 with the RLE-aware sample table
and the variable-length `esds` decoder. Acceptable overrun; everything
beyond first-pass scope is deferred to Phase 3.5.

## Implementation references (for the published README)

This package is implemented from ISO/IEC 14496-12 (ISO Base Media File
Format), ISO/IEC 14496-14 (MP4 file format), ISO/IEC 14496-1 (MPEG-4
Systems, for the `esds` descriptor tags), ISO/IEC 14496-3 §1.6.2.1
(`AudioSpecificConfig`), and the Apple QuickTime File Format
Specification (for the `qt  ` brand and legacy box semantics). Codec
four-CC mappings cross-checked against the MP4 Registration Authority
at mp4ra.org. No code was copied from libavformat, libstagefright,
mp4parse-rust, mp4-tools, Bento4, or any other implementation. The
`AudioSpecificConfig` parser is shared with `@catlabtech/webcvt-container-aac`
(see `packages/codec-aac/src/asc.ts`). Test fixtures derived from
FFmpeg samples (LGPL-2.1) live under `tests/fixtures/audio/` and are
not redistributed in npm.
