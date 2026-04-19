# container-webm design

> Implementation reference for `@webcvt/container-webm`. Write the code
> from this note plus the linked official spec. Do not consult competing
> implementations except for debugging spec-ambiguous edge cases.

## Format overview

WebM is a strict subset of the Matroska Multimedia Container, restricted
to a small codec set (VP8/VP9 video, Vorbis/Opus audio, optionally AV1)
and identified by the EBML `DocType` string `webm`. Matroska itself is
built on EBML (Extensible Binary Meta Language), a generic binary
counterpart to XML in which every element is `(ID, size, payload)` and
payloads are either typed scalars (uint, int, float, string, utf-8,
binary, date) or further EBML elements. EBML element IDs and sizes are
both *variable-length integers* whose first byte's high-bit position
encodes the byte-length of the field.

The on-disk model is a single `EBML` header element followed by one
`Segment` element. The Segment carries `SeekHead`, `Info`, `Tracks`,
zero or more `Cluster`s (each holding `SimpleBlock`s of coded media
data), and an optional `Cues` index for seeking. WebM-spec authors
chose this profile so a streaming-friendly muxer can be small while a
demuxer remains a finite element walker rather than a recursive XML
parser.

## Scope statement

**This note covers a FIRST-PASS implementation, not full
Matroska/MKV.** The goal is the smallest element set that can demux a
single-video-track + single-audio-track WebM file and round-trip it.
Generic Matroska (`DocType = matroska`) is the separate
`container-mkv` package, designed and shipped later in Phase 3. See
"Out of scope (DEFERRED)" below for the explicit deferred list.

**In scope (first pass for `container-webm`, ~2,500 LOC):**

- `EBML` header with `DocType == "webm"` only — reject `matroska`
- One video track + one audio track (typical WebM layout)
- Codecs: VP8 (`V_VP8`) + VP9 (`V_VP9`) video; Vorbis (`A_VORBIS`)
  + Opus (`A_OPUS`) audio
- `Segment` with `SeekHead`, `Info`, `Tracks`, `Cluster`s, and
  optional `Cues`
- Cluster / `SimpleBlock` parsing for unlaced and Xiph-laced packets
- Cues (`CuePoint` / `CueTrackPositions`) read for seek positions
  if present; muxer emits a basic Cues block if absent
- Round-trip parse → serialize for the supported subset
- WebCodecs decode for VP8 / VP9 / Vorbis / Opus; encode for VP9
  + Opus (the WebCodecs-encodable subset). Vorbis encode and any
  other path falls back to `@webcvt/backend-wasm`.

**Out of scope (Phase 3.5+ or container-mkv, DEFERRED):**

- Full Matroska `DocType = matroska` — separate `container-mkv`
  package, design note pending
- AV1 (`V_AV1`) — defer to Phase 3.5 (WebM-spec optional)
- Block-laced packets in EBML lacing or fixed-size lacing modes
  (rare in real WebM; Xiph lacing only in first pass)
- Multiple video or multiple audio tracks
- Subtitle tracks (`S_TEXT/UTF8`, `S_TEXT/WEBVTT`)
- `Chapters`, `Tags`, `Attachments`
- Encryption (`ContentEncoding` with `ContentEncryption`)
- Live / streaming WebM (no `Cues`, infinite `Segment` size)
- Track Groups (`TrackJoinBlocks`, `TrackTranslate`, `TrackOverlay`)
- `BlockGroup` / `BlockAdditions` / `ReferenceBlock` (only
  `SimpleBlock` supported in first pass)
- `Void` element preservation across round-trip (skipped on read,
  not re-emitted on write)

## Official references

- WebM Container Guidelines: https://www.webmproject.org/docs/container/
- WebM Byte Stream Format (the on-disk profile of Matroska):
  https://www.webmproject.org/docs/webm-encryption/ (links to the
  byte-stream sub-page)
- Matroska element specification:
  https://www.matroska.org/technical/elements.html
- IETF EBML — RFC 8794 "Extensible Binary Meta Language":
  https://datatracker.ietf.org/doc/html/rfc8794
- IETF Matroska — draft-ietf-cellar-matroska:
  https://datatracker.ietf.org/doc/draft-ietf-cellar-matroska/
- RFC 7845 — Ogg Encapsulation for Opus (defines `OpusHead`, the
  payload of `CodecPrivate` for `A_OPUS`)
- Vorbis I specification: https://xiph.org/vorbis/doc/Vorbis_I_spec.html
  (defines the three-packet sequence carried in `A_VORBIS`
  `CodecPrivate`)
- VP8 bitstream — RFC 6386
- VP9 bitstream — https://www.webmproject.org/vp9/

## EBML primer — variable-length integer (VINT) encoding

Both element IDs and element sizes are VINTs. The high-bit position of
the first byte tells the reader how many bytes the VINT occupies.

| First byte mask | Length | Payload bits |
|---|---|---|
| `0b1xxxxxxx` (`0x80`) | 1 byte | 7 |
| `0b01xxxxxx` (`0x40`) | 2 bytes | 14 |
| `0b001xxxxx` (`0x20`) | 3 bytes | 21 |
| `0b0001xxxx` (`0x10`) | 4 bytes | 28 |
| `0b00001xxx` (`0x08`) | 5 bytes | 35 |
| `0b000001xx` (`0x04`) | 6 bytes | 42 |
| `0b0000001x` (`0x02`) | 7 bytes | 49 |
| `0b00000001` (`0x01`) | 8 bytes | 56 |
| `0x00` | invalid | — |

**Critical asymmetry between IDs and sizes:**

- For an **element ID**, the leading length-marker bit IS retained in
  the parsed value. e.g. `0x1A 0x45 0xDF 0xA3` is the ID for the
  EBML header element and the parsed numeric value is
  `0x1A45DFA3` — the leading `0x1` is part of the canonical ID.
- For an **element size**, the leading length-marker bit is STRIPPED.
  e.g. `0x82` is size = 2; `0x40 0x83` is size = 3 (low 14 bits of
  `0x4083` after stripping the marker = 0x0083 = 131 — wait, the marker
  strip happens on the first byte: low 6 bits of `0x40` = 0, then the
  `0x83` byte = 0x83, giving `0x0083` = 131). This is the canonical
  source of decoding bugs (see Trap #2 / #3).

The all-ones-payload pattern (`0xFF` for 1-byte, `0x7F 0xFF` for
2-byte, etc.) means **unknown size**, valid only on `Segment` and
`Cluster` for live streaming. First pass: reject unknown size.

## Top-level WebM file layout

```
offset   bytes   element
0        N       EBML header element  (ID 0x1A45DFA3)
                  ├─ EBMLVersion              (default 1)
                  ├─ EBMLReadVersion          (default 1)
                  ├─ EBMLMaxIDLength          (default 4)
                  ├─ EBMLMaxSizeLength        (default 8)
                  ├─ DocType                  ("webm")
                  ├─ DocTypeVersion           (2 or 4)
                  └─ DocTypeReadVersion       (2)
M        N       Segment element       (ID 0x18538067)
                  ├─ SeekHead                 (optional but recommended)
                  │    └─ Seek*               (SeekID, SeekPosition)
                  ├─ Info                     (mandatory)
                  │    ├─ TimecodeScale       (default 1_000_000 ns)
                  │    ├─ Duration            (float, in TimecodeScale units)
                  │    ├─ MuxingApp           (utf-8)
                  │    └─ WritingApp          (utf-8)
                  ├─ Tracks                   (mandatory)
                  │    └─ TrackEntry+         (one per track)
                  │         ├─ TrackNumber    (vint)
                  │         ├─ TrackUID       (uint64)
                  │         ├─ TrackType      (1=video, 2=audio)
                  │         ├─ CodecID        (string)
                  │         ├─ CodecPrivate   (binary, codec init data)
                  │         ├─ Video { PixelWidth, PixelHeight, ... }
                  │         └─ Audio { SamplingFrequency, Channels, ... }
                  ├─ Cluster*                 (one or more)
                  │    ├─ Timecode            (uint, Cluster base ts)
                  │    └─ SimpleBlock+        (track ts + flags + payload)
                  └─ Cues                     (optional)
                       └─ CuePoint*
                            ├─ CueTime
                            └─ CueTrackPositions (CueTrack, CueClusterPosition)
```

`Segment` size SHOULD be a known finite value in WebM; the muxer
back-patches it after the segment body is finalised. Cues live AFTER
all Clusters so the writer must know Cluster file offsets before
emitting them.

## Required elements — layouts and semantics

### EBML header (RFC 8794 §11)

| Element | ID | Type | Default | First-pass requirement |
|---|---|---|---|---|
| `EBML` | `0x1A45DFA3` | master | — | required, always first |
| `EBMLVersion` | `0x4286` | uint | 1 | reject != 1 |
| `EBMLReadVersion` | `0x42F7` | uint | 1 | reject != 1 |
| `EBMLMaxIDLength` | `0x42F2` | uint | 4 | reject > 4 |
| `EBMLMaxSizeLength` | `0x42F3` | uint | 8 | reject > 8 |
| `DocType` | `0x4282` | string | "matroska" | **must be `"webm"`** |
| `DocTypeVersion` | `0x4287` | uint | 1 | accept 2..4 |
| `DocTypeReadVersion` | `0x4285` | uint | 1 | accept 2 |

### Segment (Matroska top-level)

| Element | ID | Type |
|---|---|---|
| `Segment` | `0x18538067` | master |

The Segment payload is itself a sequence of EBML elements. WebM's
canonical write order is `SeekHead → Info → Tracks → Cluster* → Cues`
but the reader must accept any order.

### SeekHead and Seek (optional, recommended)

| Element | ID | Type |
|---|---|---|
| `SeekHead` | `0x114D9B74` | master |
| `Seek` | `0x4DBB` | master |
| `SeekID` | `0x53AB` | binary (encoded as the target element's ID bytes) |
| `SeekPosition` | `0x53AC` | uint (offset relative to Segment payload start) |

### Info

| Element | ID | Type | Notes |
|---|---|---|---|
| `Info` | `0x1549A966` | master | required |
| `TimecodeScale` | `0x2AD7B1` | uint | nanoseconds per tick; **default 1_000_000** |
| `Duration` | `0x4489` | float (32 or 64 bit) | in TimecodeScale units |
| `MuxingApp` | `0x4D80` | utf-8 | required by Matroska, recommended |
| `WritingApp` | `0x5741` | utf-8 | required by Matroska, recommended |
| `DateUTC` | `0x4461` | date | optional |

### Tracks and TrackEntry

| Element | ID | Type | Notes |
|---|---|---|---|
| `Tracks` | `0x1654AE6B` | master | required |
| `TrackEntry` | `0xAE` | master | one per track |
| `TrackNumber` | `0xD7` | uint | 1-based, used in SimpleBlock header |
| `TrackUID` | `0x73C5` | uint64 | unique nonzero |
| `TrackType` | `0x83` | uint | 1=video, 2=audio (others rejected) |
| `FlagEnabled` | `0xB9` | uint | default 1 |
| `FlagDefault` | `0x88` | uint | default 1 |
| `FlagLacing` | `0x9C` | uint | default 1 |
| `DefaultDuration` | `0x23E383` | uint (ns) | optional |
| `CodecID` | `0x86` | string | "V_VP8", "V_VP9", "A_VORBIS", "A_OPUS" |
| `CodecPrivate` | `0x63A2` | binary | codec init bytes (Trap #12) |
| `CodecDelay` | `0x56AA` | uint (ns) | optional, common for Opus |
| `SeekPreRoll` | `0x56BB` | uint (ns) | optional, common for Opus (80 ms) |
| `Language` | `0x22B59C` | string | ISO 639-2 |

`Video` master (ID `0xE0`):

| Sub-element | ID | Type |
|---|---|---|
| `PixelWidth` | `0xB0` | uint |
| `PixelHeight` | `0xBA` | uint |
| `DisplayWidth` | `0x54B0` | uint (optional) |
| `DisplayHeight` | `0x54BA` | uint (optional) |

`Audio` master (ID `0xE1`):

| Sub-element | ID | Type |
|---|---|---|
| `SamplingFrequency` | `0xB5` | float |
| `Channels` | `0x9F` | uint |
| `BitDepth` | `0x6264` | uint (optional) |

### Cluster and SimpleBlock

| Element | ID | Type |
|---|---|---|
| `Cluster` | `0x1F43B675` | master |
| `Timecode` | `0xE7` | uint (in TimecodeScale units, REQUIRED in WebM) |
| `SimpleBlock` | `0xA3` | binary |

`SimpleBlock` payload layout (Matroska §16.4):

```
offset   bytes  field
 0       1-2    track_number_vint   (EBML VINT, with marker bit STRIPPED)
 N       2      timecode_delta      (BIG-endian signed int16, RELATIVE to Cluster.Timecode)
 N+2     1      flags
                 bit 7    : keyframe (1 = keyframe)
                 bits 6-4 : reserved (0)
                 bit 3    : invisible
                 bits 2-1 : lacing  (00 none, 01 Xiph, 10 fixed, 11 EBML)
                 bit 0    : discardable
[if lacing != 00]
 N+3     1      lace_count_minus_one
 N+4     ...    lace size table (Xiph: chained 0..255 bytes; EBML: vint deltas; fixed: implicit)
 ...     ...    frame payload(s)
```

For Xiph lacing the size table is a sequence of unsigned bytes terminated
when a byte != 255 is seen; that closes one frame's size as
`sum(255-bytes) + final_byte`. The last frame's size is whatever is
left in the Block payload.

### Cues (optional but recommended for seekable files)

| Element | ID | Type |
|---|---|---|
| `Cues` | `0x1C53BB6B` | master |
| `CuePoint` | `0xBB` | master |
| `CueTime` | `0xB3` | uint (in TimecodeScale units) |
| `CueTrackPositions` | `0xB7` | master |
| `CueTrack` | `0xF7` | uint |
| `CueClusterPosition` | `0xF1` | uint (offset into Segment payload) |
| `CueRelativePosition` | `0xF0` | uint (optional, offset into Cluster) |
| `CueDuration` | `0xB2` | uint (optional, in TimecodeScale units) |

## Key types we will model

```ts
interface EbmlVint {
  /** Numeric value (size: marker stripped; ID: marker retained). */
  value: number | bigint;
  /** Width on the wire, 1..8 bytes. */
  width: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}

interface EbmlElement {
  /** Numeric ID with leading length-marker bit retained (e.g. 0x1A45DFA3). */
  id: number;
  /** Size of payload in bytes; -1n if "unknown size" (rejected first pass). */
  size: bigint;
  /** Absolute file offset of the first payload byte. */
  payloadOffset: number;
  /** Absolute file offset of the next sibling element. */
  nextOffset: number;
}

interface WebmEbmlHeader {
  ebmlVersion: 1;
  ebmlReadVersion: 1;
  ebmlMaxIdLength: number;     // <= 4 first pass
  ebmlMaxSizeLength: number;   // <= 8 first pass
  docType: 'webm';             // reject anything else
  docTypeVersion: number;      // 2..4
  docTypeReadVersion: number;  // 2
}

interface WebmInfo {
  timecodeScale: number;       // ns per tick; 1_000_000 if absent
  duration?: number;           // in TimecodeScale units (float)
  muxingApp: string;
  writingApp: string;
}

type WebmCodecId = 'V_VP8' | 'V_VP9' | 'A_VORBIS' | 'A_OPUS';

interface WebmVideoTrack {
  trackNumber: number;
  trackUid: bigint;
  trackType: 1;                // video
  codecId: 'V_VP8' | 'V_VP9';
  codecPrivate?: Uint8Array;   // empty/absent for VP8/VP9
  pixelWidth: number;
  pixelHeight: number;
  displayWidth?: number;
  displayHeight?: number;
  defaultDuration?: number;    // ns per frame
}

interface WebmAudioTrack {
  trackNumber: number;
  trackUid: bigint;
  trackType: 2;                // audio
  codecId: 'A_VORBIS' | 'A_OPUS';
  codecPrivate: Uint8Array;    // Vorbis: Xiph-packed 3 packets; Opus: OpusHead
  samplingFrequency: number;   // Hz
  channels: number;
  bitDepth?: number;
  codecDelay?: number;         // ns
  seekPreRoll?: number;        // ns
}

type WebmTrack = WebmVideoTrack | WebmAudioTrack;

interface WebmSimpleBlock {
  trackNumber: number;
  /** Absolute timestamp in nanoseconds = (Cluster.Timecode + delta) * TimecodeScale. */
  timestampNs: bigint;
  keyframe: boolean;
  invisible: boolean;
  discardable: boolean;
  /** One Uint8Array per frame: 1 for unlaced, N for laced (Xiph only first pass). */
  frames: Uint8Array[];
}

interface WebmCluster {
  /** Absolute file offset of the Cluster element start. */
  fileOffset: number;
  /** Cluster.Timecode in TimecodeScale units. */
  timecode: bigint;
  blocks: WebmSimpleBlock[];
}

interface WebmCuePoint {
  /** CueTime in TimecodeScale units. */
  cueTime: bigint;
  trackNumber: number;
  /** Absolute file offset of the target Cluster, computed from
      Segment.payloadOffset + CueClusterPosition. */
  clusterFileOffset: number;
}

interface WebmFile {
  ebmlHeader: WebmEbmlHeader;
  /** Absolute file offset of the Segment element's first payload byte. */
  segmentPayloadOffset: number;
  info: WebmInfo;
  tracks: WebmTrack[];          // first pass: 1 video + 1 audio
  clusters: WebmCluster[];
  cues?: WebmCuePoint[];
  /** Reference to the underlying file bytes; SimpleBlock payloads sliced on demand. */
  fileBytes: Uint8Array;
}

export function parseWebm(input: Uint8Array): WebmFile;
export function serializeWebm(file: WebmFile): Uint8Array;

export function* iterateVideoChunks(
  file: WebmFile,
  trackNumber: number,
): Generator<{ data: Uint8Array; type: 'key' | 'delta'; timestampUs: number }>;

export function* iterateAudioChunks(
  file: WebmFile,
  trackNumber: number,
): Generator<{ data: Uint8Array; timestampUs: number }>;
```

## Demuxer (read) algorithm

1. **Validate input**: enforce 200 MiB input cap. Reject empty input.
2. **Parse EBML header**: read ID at offset 0; require
   `0x1A45DFA3`. Read size VINT, then descend into the header
   payload. Decode every child element. **Require `DocType == "webm"`**;
   reject `"matroska"` with `WebmDocTypeNotSupportedError` (deferred to
   `container-mkv`). Validate version/read-version constraints.
3. **Locate Segment**: read the next element ID; require `0x18538067`.
   Read size VINT. Reject unknown size for first pass (Trap #2). Record
   `segmentPayloadOffset`.
4. **Two-phase Segment scan**:
   a. **Phase 1 — light walk**: walk top-level Segment children
      (depth 1) without descending. Record the file offset of each
      `SeekHead`, `Info`, `Tracks`, `Cluster`, `Cues`. Enforce
      element-count cap (100,000) and per-element size cap (64 MiB
      except `Cluster`). On any unknown element ID at depth 1, skip it
      using its declared size (Trap #14).
   b. **Phase 2 — depth descent**: parse `Info`, `Tracks` (deeply,
      capping recursion at 8), then `Cues` if present, then each
      `Cluster`.
5. **Decode `Info`**: extract `TimecodeScale` (default `1_000_000` if
   absent — Trap #4), `Duration` (optional float), `MuxingApp`,
   `WritingApp`.
6. **Decode `Tracks`**: for each `TrackEntry`:
   a. Read `TrackNumber`, `TrackUID`, `TrackType`. Reject `TrackType`
      values other than 1 (video) or 2 (audio).
   b. Read `CodecID` and validate against the allowlist
      `{V_VP8, V_VP9, A_VORBIS, A_OPUS}`. Anything else throws
      `WebmUnsupportedCodecError`.
   c. Descend into `Video` or `Audio` child master and extract
      pixel/sample fields.
   d. Capture `CodecPrivate` (cap at 1 MiB; required for Vorbis/Opus,
      empty/absent for VP8/VP9 — Trap #12 / #13).
   e. Capture `CodecDelay` and `SeekPreRoll` if present (Opus).
   f. Reject if Tracks contains more than 1 video track or more than
      1 audio track (`WebmMultiTrackNotSupportedError`).
7. **Decode `Cues`** if present: for each `CuePoint` collect
   `(CueTime, CueTrack, CueClusterPosition)`. Translate
   `CueClusterPosition` into an absolute file offset using
   `segmentPayloadOffset + CueClusterPosition`.
8. **Decode each `Cluster`**:
   a. Read `Timecode` (REQUIRED — Trap #8). Convert to bigint.
   b. Iterate children. For each `SimpleBlock`:
      - Decode `track_number` VINT (size marker stripped).
      - Read 2-byte signed BE `timecode_delta`.
      - Read flags byte. Decode `keyframe`, `invisible`, `discardable`,
        and `lacing` bits (Trap #6).
      - Compute absolute timestamp:
        `(cluster.timecode + delta) * info.timecodeScale` (in
        nanoseconds). Convert to microseconds for WebCodecs by
        dividing by 1000.
      - For lacing == 00: single frame is the rest of the payload.
      - For lacing == 01 (Xiph): read `lace_count_minus_one`, then
        decode `lace_count_minus_one` Xiph sizes (chained 255 +
        final-byte-<=254). Last frame size = `payload_remaining -
        sum(decoded_sizes)`.
      - For lacing == 10 or 11: throw
        `WebmLacingNotSupportedError` (deferred).
      - Cap per-track block count at 10,000,000. Cap recursion / nest
        depth at 8.
      - On an unknown child ID inside Cluster (e.g. `BlockGroup`,
        `PrevSize`, `Position`), skip with declared size.
9. **Build `WebmFile`** and return. SimpleBlock payloads are slices
   into `fileBytes`; do not eagerly copy.

## Muxer (write) algorithm

1. Accept a `WebmFile`. Reject inputs whose `tracks` exceed 1 video +
   1 audio, contain unsupported codecs, or contain unsupported lacing
   modes.
2. **Canonical write order** within Segment: `SeekHead` → `Info` →
   `Tracks` → `Cluster*` → `Cues`. This is the streaming-friendly
   order recommended by the WebM Container Guidelines.
3. **Serialise EBML header**: emit fixed default values for
   `EBMLVersion / ReadVersion / MaxIDLength / MaxSizeLength`, set
   `DocType = "webm"`, `DocTypeVersion = 4`, `DocTypeReadVersion = 2`.
4. **Two-pass serialise of Segment** (sizes and positions are mutually
   dependent):
   a. **Pass 1 — provisional layout**: serialise `Info` and `Tracks`
      to standalone buffers. Choose a fixed byte budget for `SeekHead`
      (e.g. reserve 96 bytes; `Void` pad to fit if smaller). Serialise
      each `Cluster` to a buffer, recording `segment-relative
      cluster_offset` for each. Build `Cues` from
      `(cueTime, cueTrack, cluster_offset)` triples; serialise.
      Compute total Segment payload size.
   b. **Pass 2 — emit**: emit `Segment` ID + size VINT (always 8-byte
      width VINT for headroom — Trap #15). Emit `SeekHead` with
      `(SeekID, SeekPosition)` entries for `Info`, `Tracks`, and
      `Cues`, padding with `Void` to the reserved 96-byte size if
      necessary. Emit `Info`, `Tracks`, all `Cluster`s, then `Cues`.
5. **Cluster emission**: for each `WebmCluster`:
   - Emit `Cluster` ID (`0x1F43B675`). Compute body size including
     `Timecode` element + all `SimpleBlock`s. Emit size VINT.
   - Emit `Timecode` element with the cluster's base time.
   - For each `WebmSimpleBlock`: serialise `track_number_vint` (1-byte
     form for tracks 1..127), 2-byte signed BE `timecode_delta`
     (computed as `block.timestampNs / TimecodeScale -
     cluster.timecode`; assert in [-32768, 32767]), flags byte, and
     the frame payload (no lacing in writer's first pass — emit one
     SimpleBlock per frame).
6. **Cues emission**: emit `Cues` master containing one `CuePoint` per
   keyframe of the video track (or per Cluster if audio-only).
   `CueClusterPosition` is segment-relative.
7. Concatenate `[ebml_header_bytes, segment_bytes]` and return.

For the round-trip-no-edits fast path: if input was parsed and not
mutated, copy `fileBytes` verbatim. Only the slow path triggers the
two-pass layout above.

## WebCodecs integration

- **VP8 decode**: `codec: 'vp8'`. No `description` needed (VP8
  keyframes self-contained). For each video `SimpleBlock`, construct
  `EncodedVideoChunk({ type: keyframe ? 'key' : 'delta', timestamp:
  timestampUs, data: frames[0] })`.
- **VP9 decode**: `codec: 'vp09.<profile>.<level>.<bitdepth>'`. The
  codec string can be derived from the first keyframe header bytes;
  for first pass, use `'vp09.00.10.08'` (profile 0, level 1.0,
  8-bit) as a reasonable default and let `probeVideoCodec` confirm.
  No `description` needed.
- **Vorbis decode**: `codec: 'vorbis'`. `description` =
  `CodecPrivate` bytes (Xiph-laced concatenation of identification,
  comment, setup packets per RFC 5334). `EncodedAudioChunk` with
  `type: 'key'` per packet (Vorbis packets are independent post-init).
- **Opus decode**: `codec: 'opus'`. `description` = `CodecPrivate`
  bytes (the `OpusHead` structure per RFC 7845). Each SimpleBlock
  payload is one Opus packet. `EncodedAudioChunk` with `type: 'key'`.
  Apply `CodecDelay` / `SeekPreRoll` to upstream playback if exposed.
- **VP9 encode**: `WebCodecsVideoEncoder` with `codec: 'vp09.00.10.08'`
  produces raw VP9 frames; the WebM layer muxes them into one
  SimpleBlock per frame. Cluster boundaries chosen at every keyframe
  (or every ~5 seconds, whichever is sooner).
- **Opus encode**: `WebCodecsAudioEncoder` with `codec: 'opus'`. Same
  per-packet → SimpleBlock mux. `CodecDelay` set from encoder's
  `preSkip` or default 6.5 ms; `SeekPreRoll` set to 80 ms (3,840
  samples at 48 kHz, RFC 7845 recommendation).
- **Vorbis encode / VP8 encode**: not supported by WebCodecs in 2026.
  `WebmBackend.canHandle` returns `false` for those encode requests
  so the BackendRegistry falls through to `@webcvt/backend-wasm`
  (libvpx + libvorbis) for synthesis.
- **Probe**: `probeVideoCodec({ codec, width, height, framerate })`
  and `probeAudioCodec({ codec, sampleRate, numberOfChannels })`
  before submitting any chunk; fall back to ffmpeg-wasm on miss.

## Test plan

- `parses EBML header and recognises DocType "webm"`
- `rejects DocType "matroska" with WebmDocTypeNotSupportedError`
- `rejects EBMLVersion != 1 / EBMLReadVersion != 1`
- `decodes VINT IDs (1, 2, 3, 4-byte) preserving the marker bit`
- `decodes VINT sizes (1, 2, 4, 8-byte) stripping the marker bit`
- `rejects unknown-size element (all-ones VINT) for first pass`
- `applies TimecodeScale default of 1_000_000 ns when Info omits it`
- `parses single VP9 video track + single Opus audio track end-to-end`
- `parses single VP8 video track + single Vorbis audio track end-to-end`
- `decodes Cluster with unlaced SimpleBlocks (lacing == 00)`
- `decodes SimpleBlock with Xiph lacing (lacing == 01) and 3 frames`
- `rejects SimpleBlock with EBML lacing (lacing == 11) as deferred`
- `rejects SimpleBlock with fixed-size lacing (lacing == 10) as deferred`
- `computes absolute timestamp = (Cluster.Timecode + delta) * TimecodeScale`
- `extracts OpusHead from A_OPUS CodecPrivate and routes as WebCodecs description`
- `extracts Vorbis 3-packet init from A_VORBIS CodecPrivate via Xiph unpacking`
- `parses Cues block and resolves CueClusterPosition to absolute file offset`
- `tolerates missing Cues (writer synthesises a basic Cues on serialise)`
- `tolerates missing SeekHead`
- `rejects multi-video-track file with WebmMultiTrackNotSupportedError`
- `rejects S_TEXT/UTF8 subtitle track with WebmUnsupportedCodecError`
- `round-trip: parse → serialize → byte-identical Segment for clean WebM`
- `serializer back-patches SeekHead positions in two passes`
- `enforces 200 MiB input cap, per-element 64 MiB cap, recursion depth 8`

## Known traps

1. **EBML variable-length ID encoding**: IDs are 1-4 bytes; the
   leading byte's high-bit position indicates length (`0x80` = 1 byte,
   `0x40` = 2, `0x20` = 3, `0x10` = 4). The leading length-marker bit
   is **kept** in the parsed ID value (unlike size encoding). Easy to
   confuse with size encoding.

2. **EBML variable-length size encoding**: sizes are 1-8 bytes; the
   leading byte's high-bit position indicates length (`0x80` = 1 byte,
   ..., `0x01` = 8 bytes). The leading length-marker bit is
   **stripped** from the parsed size. The all-ones-payload pattern
   (`0xFF`, `0x7F 0xFF`, `0x3F 0xFF 0xFF`, ...) means "unknown size"
   and is only valid on `Segment` and `Cluster` (used for live
   streaming). First pass: reject unknown size everywhere.

3. **ID and size are read in different ways**: ID keeps the marker
   bit, size strips it. Easy to swap and corrupt all downstream
   parsing. Implement two distinct functions
   (`readVintId` / `readVintSize`) rather than a single
   parameterised helper that's easy to misuse.

4. **`TimecodeScale` default is `1_000_000` nanoseconds (1 ms)** if
   absent from `Info`. Cluster `Timecode` and SimpleBlock
   `timecode_delta` are in `TimecodeScale` units. Ignoring the
   default → wrong PTS by 1000x silently. Validate that the resolved
   scale is non-zero before division.

5. **SimpleBlock structure**: 1-2 byte `track_number_vint`
   (size-style VINT, marker stripped) + 2-byte signed big-endian
   `timecode_delta` + 1-byte flags + payload. The block timecode is
   RELATIVE to `Cluster.Timecode`; absolute timestamp =
   `(Cluster.Timecode + delta) * TimecodeScale`. Easy to mis-add or
   treat as absolute. The 2-byte delta is signed — cast through
   `DataView.getInt16(offset, /* littleEndian= */ false)` not
   `getUint16`.

6. **Block lacing modes** (flags bits 1-2): `00` = no lacing, `01` =
   Xiph lacing (Theora-style 255-chained sizes), `10` = fixed-size
   lacing (rare), `11` = EBML lacing (Matroska-specific signed
   delta-encoded VINT sizes). First pass: support `00` and `01`.
   Throw `WebmLacingNotSupportedError` on `10` and `11`.

7. **`CodecID` is an ASCII string namespace**: "V_VP8", "V_VP9",
   "A_VORBIS", "A_OPUS", etc. Match exactly (case-sensitive). Generic
   Matroska also allows "S_TEXT/UTF8", "S_TEXT/WEBVTT", "V_AV1",
   "A_AAC", "V_MPEG4/ISO/AVC", and many more — reject all of these in
   first pass with `WebmUnsupportedCodecError`.

8. **`Cluster` MUST have a `Timecode` element**. Per WebM spec,
   `Cluster.Timecode` is required and must precede the first
   `SimpleBlock` in the Cluster. Reject Clusters without it. (Generic
   Matroska is sometimes more permissive; WebM is not.)

9. **Element nesting depth**: raw Matroska allows arbitrary nesting,
   but in WebM the deepest legitimate path is roughly `Segment →
   Cluster → BlockGroup → Block` (5 levels including the EBML root
   element). Cap recursion depth at 8 — comfortable headroom that
   still defeats malformed-file stack-blowing inputs.

10. **`SeekHead` is OPTIONAL but RECOMMENDED**. SeekHead lists
    `(SeekID, SeekPosition)` pairs giving absolute positions of major
    elements (`Tracks`, `Cues`, `Info`) within the Segment payload
    (i.e. positions relative to the Segment payload's first byte, NOT
    absolute file offsets). Writer should emit one for streaming
    friendliness; reader optionally uses it to skip the linear scan.

11. **`Cues` come AFTER all `Cluster`s** in WebM (so the writer must
    compute Cluster positions before emitting Cues). For round-trip
    preservation, the muxer copies original Cues bytes verbatim if
    nothing was edited; otherwise it regenerates via the two-pass
    layout. Reader handles both pre-Clusters and post-Clusters Cues
    (some Matroska files do put Cues before Clusters via SeekHead
    indirection).

12. **Vorbis `CodecPrivate` is the Xiph-laced 3-packet init**: header
    byte `0x02`, then Xiph-lacing-packed `len(packet0)` and
    `len(packet1)` (255-chained), then the three packets concatenated
    (identification, comment, setup). WebCodecs `description` is
    EXACTLY these `CodecPrivate` bytes — do not unpack. The
    container's only job is to preserve them.

13. **Opus `CodecPrivate` is the `OpusHead` structure** (RFC 7845
    §5.1): magic `OpusHead` + version + channel count + pre-skip +
    input sample rate + output gain + channel mapping family. WebCodecs
    `description` is exactly these bytes. **VP8 and VP9 `CodecPrivate`
    is empty or absent**: VP8/VP9 keyframes are self-contained.

14. **Unknown elements at any level must be SKIPPED, not rejected**.
    Matroska is designed for forward compatibility: writers may add
    elements unknown to older readers. Read the unknown element's
    size VINT and advance by `header_bytes + size`. The first-pass
    allowlist applies only to elements we deliberately support; all
    other IDs at any depth are skipped (after capping their size).
    Exception: at depth 0 inside the `EBML` master, an unknown
    element is fine to skip but at depth 0 inside the Segment master
    we additionally enforce element-count and per-element size caps.

15. **Segment size VINT width is a layout pin**. The Segment's size
    VINT can be 1-8 bytes. The muxer doesn't know the final body size
    until everything is serialised, so we always reserve an 8-byte
    width VINT for `Segment.size` (and pad sub-element sizes likewise
    when they are sources of truth for SeekHead positions). This
    avoids needing a third pass to re-encode size VINTs at narrower
    widths after sizes shrink.

16. **`Void` element (`0xEC`) is a padding mechanism**. The muxer uses
    it inside SeekHead to pad to the reserved size when fewer Seek
    entries are needed; the reader simply skips it. First-pass
    reader: skip `Void` content without decoding. First-pass writer:
    emit `Void` only inside SeekHead reserved space, never elsewhere.

17. **Endianness asymmetry inside SimpleBlock**: the `track_number`
    VINT is encoded VINT-style (which has its own length-prefix logic
    and isn't really "an endianness"), but the 2-byte `timecode_delta`
    immediately following is **big-endian signed int16**. Writers
    converting from typed arrays must `setInt16(offset, value, false)`
    (the `false` literal is required — JavaScript's
    `DataView.setInt16` defaults to big-endian only when the third arg
    is omitted, which is easy to forget when refactoring).

18. **`CodecDelay` and `SeekPreRoll` propagate to playback semantics
    for Opus**. `CodecDelay` is the encoder's pre-skip in nanoseconds
    (typically 6.5 ms = 312 samples at 48 kHz × 1000000 / 48000
    rounded). `SeekPreRoll` (typically 80 ms = 80000000 ns) is the
    minimum decoded-but-discarded duration before any seek-target
    sample to converge the decoder state. Container layer preserves
    both; downstream player applies them.

## Security caps

- 200 MiB input cap in parser entry (`MAX_INPUT_BYTES`).
- Per-element size cap: any non-`Cluster` non-`Segment` element
  claiming size > 64 MiB rejected (`MAX_ELEMENT_PAYLOAD_BYTES`).
  `Cluster` size capped at 256 MiB (`MAX_CLUSTER_BYTES`).
- Total element count cap: 100,000 across the file
  (`MAX_ELEMENTS_PER_FILE`) — finer-grained than MP4 because EBML is
  finer-grained.
- EBML recursion depth cap: 8 levels (`MAX_NEST_DEPTH`).
- Per-track Block count cap: 10,000,000 (`MAX_BLOCKS_PER_TRACK`) —
  generous given the 200 MiB input cap.
- VINT max width: 8 bytes per RFC 8794; reject any encoding that
  declares > 8 bytes via the all-zeros-leading-byte pattern.
- `CodecPrivate` cap: 1 MiB per track
  (`MAX_CODEC_PRIVATE_BYTES`) — Vorbis init is typically 5-20 KB so
  this is generous.
- Cues cap: 1,000,000 `CuePoint` entries (`MAX_CUE_POINTS`).
- All multi-byte length fields validated against
  `claimed <= remaining_bytes_in_container` BEFORE allocating any
  receiving buffer.
- Unknown-size elements: rejected for first pass (only valid for
  `Segment` / `Cluster` in live streaming, which is deferred).
- `TrackNumber` and `TrackUID` non-zero; reject zero values.
- `TimecodeScale` non-zero (avoid divide-by-zero in PTS computation).

## LOC budget breakdown

| File | LOC est. |
|---|---|
| `ebml-vint.ts` (VINT ID + size codec, distinct entry points) | 100 |
| `ebml-element.ts` (element header parse + walker with depth cap) | 150 |
| `ebml-types.ts` (uint / int / float / string / utf-8 / binary / date readers + writers) | 120 |
| `elements/header.ts` (EBML header decode + encode, DocType gate) | 80 |
| `elements/segment-info.ts` (Info: TimecodeScale, Duration, MuxingApp, WritingApp) | 100 |
| `elements/tracks.ts` (Tracks / TrackEntry / Video / Audio / CodecPrivate) | 250 |
| `elements/cluster.ts` (Cluster / SimpleBlock with Xiph lacing) | 300 |
| `elements/cues.ts` (CuePoint / CueTrackPositions) | 150 |
| `elements/seek-head.ts` (SeekHead / Seek with Void padding) | 100 |
| `parser.ts` (top-level: EBML header → two-phase Segment scan → element dispatch) | 200 |
| `serializer.ts` (canonical write order + two-pass back-patching) | 250 |
| `block-iterator.ts` (parsed clusters → EncodedAudioChunk / EncodedVideoChunk) | 150 |
| `backend.ts` (WebmBackend, identity-only canHandle for first pass) | 120 |
| `errors.ts` (typed errors) | 70 |
| `constants.ts` (caps, codec-ID allowlist, default TimecodeScale) | 50 |
| `index.ts` (re-exports) | 50 |
| **total** | **~2,640** |
| tests | ~1,000 |

Headline plan.md budget for `container-webm` first pass: ~2,500 LOC.
Realistic with the two-pass serialiser, two distinct VINT entry points,
and Xiph lacing: ~2,640. Acceptable overrun; everything beyond
first-pass scope is deferred to Phase 3.5 or to the separate
`container-mkv` package.

## Implementation references (for the published README)

This package is implemented from the WebM Container Guidelines
(webmproject.org), the Matroska element specification
(matroska.org/technical/elements.html), IETF RFC 8794 (Extensible
Binary Meta Language), and IETF draft-ietf-cellar-matroska. Codec
init data parsing follows RFC 7845 (Opus in Ogg, used here for
`OpusHead` inside `CodecPrivate`) and the Vorbis I specification at
xiph.org. VP8 and VP9 bitstream identification follows RFC 6386 and
the WebM Project's VP9 documentation. No code was copied from
libavformat, libwebm, libmkvtoolnix, mkvtoolnix, Bento4, FFmpeg, or
any other implementation. Generic Matroska (`DocType = matroska`)
support lives in the separate `@webcvt/container-mkv` package. Test
fixtures derived from FFmpeg samples (LGPL-2.1) live under
`tests/fixtures/video/` and `tests/fixtures/audio/` and are not
redistributed in npm.
