# container-mkv design

> Implementation reference for `@webcvt/container-mkv`. Write the code
> from this note plus the linked official spec. Do not consult competing
> implementations except for debugging spec-ambiguous edge cases.

## Format overview

Matroska is a flexible, EBML-based multimedia container that carries
arbitrary combinations of audio, video, subtitle, and metadata tracks.
WebM is a strict subset of Matroska restricted to a small codec set
(VP8/VP9 video, Vorbis/Opus audio, optionally AV1) and identified by
the EBML `DocType` string `webm`; full Matroska sets `DocType` to
`matroska` and admits a much wider codec namespace including H.264
(AVC), HEVC, AAC, MP3, FLAC, and many others. The binary format is
identical between the two profiles — what differs is the codec
allowlist, the optional element set (Chapters, Tags, Attachments,
Subtitles), and a few semantic relaxations around Cluster timecode
ordering.

The on-disk model is a single `EBML` header element followed by one
`Segment` element. The Segment carries `SeekHead`, `Info`, `Tracks`,
zero or more `Cluster`s (each holding `SimpleBlock`s of coded media
data), and an optional `Cues` index for seeking. EBML (Extensible
Binary Meta Language) encodes every element as `(ID, size, payload)`
where IDs and sizes are *variable-length integers* whose first byte's
high-bit position encodes the byte-length of the field. Payloads are
either typed scalars (uint, int, float, string, utf-8, binary, date)
or further EBML elements.

## Scope statement

**This note covers a FIRST-PASS implementation, not full Matroska.**
The goal is the smallest element set that can demux a single-video-track
+ single-audio-track Matroska file across the common modern codec
set, and round-trip it. Phase 3.5+ will extend to multi-track files,
subtitles, chapters, attachments, encryption, and live/streaming MKV.
See "Out of scope (DEFERRED)" below for the explicit deferred list.

**In scope (first pass for `container-mkv`, ~2,500 LOC):**

- `EBML` header with `DocType == "matroska"` only — **reject `"webm"`
  with `MkvDocTypeNotSupportedError`** so the registry routes WebM
  files to the dedicated `@webcvt/container-webm` package
- One video track + one audio track (typical MKV layout)
- Codecs (wider set than WebM):
  - Video: H.264 (`V_MPEG4/ISO/AVC`), HEVC (`V_MPEGH/ISO/HEVC`),
    VP8 (`V_VP8`), VP9 (`V_VP9`)
  - Audio: AAC (`A_AAC`), MP3 (`A_MPEG/L3`), FLAC (`A_FLAC`),
    Vorbis (`A_VORBIS`), Opus (`A_OPUS`)
- `Segment` with `SeekHead`, `Info`, `Tracks`, `Cluster`s, and
  optional `Cues`
- Cluster / `SimpleBlock` parsing for unlaced and Xiph-laced packets
- Cues (`CuePoint` / `CueTrackPositions`) read for seek positions
  if present; muxer emits a basic Cues block if absent
- `CodecPrivate` preserved verbatim per codec (per-codec parsers
  in `codec-meta/*.ts` derive WebCodecs codec strings without
  rewriting the bytes)
- Round-trip parse → serialize semantic equivalence for the supported
  subset
- WebCodecs decode for all in-scope codecs where the browser supports
  them; encode for VP9 / Opus / AAC where WebCodecs has it. All other
  encode paths fall back to `@webcvt/backend-wasm`.

**Out of scope (Phase 3.5+, DEFERRED):**

- Multiple video or multiple audio tracks
- Subtitle tracks (`S_TEXT/UTF8`, `S_TEXT/WEBVTT`, `S_TEXT/ASS`,
  `S_TEXT/SSA`, `S_DVBSUB`, `S_VOBSUB`, `S_HDMV/PGS`)
- `Chapters` (`Chapters` / `EditionEntry` / `ChapterAtom`)
- `Tags` (`Tags` / `Tag` / `Targets` / `SimpleTag`) and Track
  Statistics tags
- `Attachments` (`Attachments` / `AttachedFile`)
- Encryption (`ContentEncoding` with `ContentEncryption`)
- Live / streaming MKV (no `Cues`, infinite `Segment` size)
- Track Groups (`TrackJoinBlocks`, `TrackTranslate`, `TrackOverlay`)
- `BlockGroup` / `BlockAdditions` / `ReferenceBlock` (only
  `SimpleBlock` supported in first pass)
- `Cues` with `CueRelativePosition` and `CueDuration` advanced fields
- AV1 (`V_AV1`) — defer to Phase 3.5 (matters once AV1-in-MKV is
  mainstream)
- Block lacing modes 10 (fixed) and 11 (EBML)
- Track Statistics tags
- Old QuickTime-derived audio sample entries (`A_QUICKTIME`,
  `A_MS/ACM`, `A_REAL/*`, `A_PCM/*`)
- `Void` element preservation across round-trip (skipped on read,
  not re-emitted on write outside the SeekHead reservation)

## Code reuse — EBML primitives are intentionally duplicated

`@webcvt/container-webm` already ships working EBML primitives
(`ebml-vint.ts`, `ebml-element.ts`, `ebml-types.ts`, ~370 LOC total).
This package duplicates those files into its own `src/ebml-*.ts`
verbatim rather than importing from `container-webm`. **The
duplication is INTENTIONAL.**

Rationale: premature shared abstraction often locks in the wrong API.
With two working implementations side by side we will be able to
confidently extract a `@webcvt/ebml` package as a separate Phase 3
wrap-up task, with both consumers driving the API surface. Until then,
duplication is the cheaper bet — it keeps each package's evolution
independent and avoids cross-package version churn during the
codec-meta build-out for MKV.

A dedicated extraction task ("extract `@webcvt/ebml` package from
`container-webm` and `container-mkv`") will be added to plan.md
§"Phase 3 remaining" when this design note ships. The implementation
agent for this package MUST NOT `import from '@webcvt/container-webm'`;
copy the three files and adapt the namespace.

## Official references

- Matroska element specification:
  https://www.matroska.org/technical/elements.html
- IETF Matroska — draft-ietf-cellar-matroska:
  https://datatracker.ietf.org/doc/draft-ietf-cellar-matroska/
- IETF EBML — RFC 8794 "Extensible Binary Meta Language":
  https://datatracker.ietf.org/doc/html/rfc8794
- IETF Matroska Codec Mappings — draft-ietf-cellar-codec:
  https://datatracker.ietf.org/doc/draft-ietf-cellar-codec/
- ISO/IEC 14496-15:2022 — Carriage of NAL unit structured video
  (defines `AVCDecoderConfigurationRecord` §5.3.3 and
  `HEVCDecoderConfigurationRecord` §8.3.3):
  https://www.iso.org/standard/83336.html
- ISO/IEC 14496-3 §1.6.2.1 — `AudioSpecificConfig` bit layout
  (carried verbatim in `A_AAC` `CodecPrivate`)
- ISO/IEC 14496-10 — Advanced Video Coding (H.264) bitstream
- ISO/IEC 23008-2 — High Efficiency Video Coding (HEVC) bitstream
- ISO/IEC 11172-3 / 13818-3 — MPEG-1/2 Audio Layer III (MP3) frame
  structure
- FLAC Format specification: https://xiph.org/flac/format.html
  (defines the STREAMINFO body carried in `A_FLAC` `CodecPrivate`)
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
  EBML header element and the parsed numeric value is `0x1A45DFA3` —
  the leading `0x1` is part of the canonical ID.
- For an **element size**, the leading length-marker bit is STRIPPED.
  e.g. `0x82` is size = 2; `0x40 0x83` is size = 131 (low 6 bits of
  `0x40` = 0, then the `0x83` byte = 0x83, giving `0x0083` = 131).
  This is the canonical source of decoding bugs (see Trap #2 / #3).

The all-ones-payload pattern (`0xFF` for 1-byte, `0x7F 0xFF` for
2-byte, etc.) means **unknown size**, valid only on `Segment` and
`Cluster` for live streaming. First pass: reject unknown size.

## Top-level Matroska file layout

```
offset   bytes   element
0        N       EBML header element  (ID 0x1A45DFA3)
                  ├─ EBMLVersion              (default 1)
                  ├─ EBMLReadVersion          (default 1)
                  ├─ EBMLMaxIDLength          (default 4)
                  ├─ EBMLMaxSizeLength        (default 8)
                  ├─ DocType                  ("matroska")
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
                  │         ├─ CodecID        (string, wider allowlist)
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

`Segment` size SHOULD be a known finite value in non-streaming MKV;
the muxer back-patches it after the segment body is finalised. Cues
typically live AFTER all Clusters so the writer must know Cluster file
offsets before emitting them.

## Required elements — layouts and semantics

### EBML header (RFC 8794 §11)

| Element | ID | Type | Default | First-pass requirement |
|---|---|---|---|---|
| `EBML` | `0x1A45DFA3` | master | — | required, always first |
| `EBMLVersion` | `0x4286` | uint | 1 | reject != 1 |
| `EBMLReadVersion` | `0x42F7` | uint | 1 | reject != 1 |
| `EBMLMaxIDLength` | `0x42F2` | uint | 4 | reject > 4 |
| `EBMLMaxSizeLength` | `0x42F3` | uint | 8 | reject > 8 |
| `DocType` | `0x4282` | string | "matroska" | **must be `"matroska"`; reject `"webm"`** |
| `DocTypeVersion` | `0x4287` | uint | 1 | accept 1..4 |
| `DocTypeReadVersion` | `0x4285` | uint | 1 | accept 1..2 |

### Segment (Matroska top-level)

| Element | ID | Type |
|---|---|---|
| `Segment` | `0x18538067` | master |

The Segment payload is itself a sequence of EBML elements. Canonical
write order is `SeekHead → Info → Tracks → Cluster* → Cues` but the
reader must accept any order.

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
| `MuxingApp` | `0x4D80` | utf-8 | required by Matroska |
| `WritingApp` | `0x5741` | utf-8 | required by Matroska |
| `DateUTC` | `0x4461` | date | optional |
| `SegmentUID` | `0x73A4` | binary (16 bytes) | optional, preserved on round-trip |
| `Title` | `0x7BA9` | utf-8 | optional, preserved on round-trip |

### Tracks and TrackEntry

| Element | ID | Type | Notes |
|---|---|---|---|
| `Tracks` | `0x1654AE6B` | master | required |
| `TrackEntry` | `0xAE` | master | one per track |
| `TrackNumber` | `0xD7` | uint | 1-based, used in SimpleBlock header |
| `TrackUID` | `0x73C5` | uint64 | unique nonzero |
| `TrackType` | `0x83` | uint | 1=video, 2=audio (subtitles/etc rejected) |
| `FlagEnabled` | `0xB9` | uint | default 1 |
| `FlagDefault` | `0x88` | uint | default 1 |
| `FlagLacing` | `0x9C` | uint | default 1 |
| `DefaultDuration` | `0x23E383` | uint (ns) | optional |
| `CodecID` | `0x86` | string | see allowlist below |
| `CodecPrivate` | `0x63A2` | binary | codec init bytes (Trap #12, #20, #21, #22) |
| `CodecDelay` | `0x56AA` | uint (ns) | optional, common for Opus |
| `SeekPreRoll` | `0x56BB` | uint (ns) | optional, common for Opus (80 ms) |
| `Language` | `0x22B59C` | string | ISO 639-2 |

**First-pass `CodecID` allowlist** (everything else throws
`MkvUnsupportedCodecError`):

| TrackType | CodecID |
|---|---|
| 1 (video) | `V_MPEG4/ISO/AVC`, `V_MPEGH/ISO/HEVC`, `V_VP8`, `V_VP9` |
| 2 (audio) | `A_AAC`, `A_MPEG/L3`, `A_FLAC`, `A_VORBIS`, `A_OPUS` |

`Video` master (ID `0xE0`):

| Sub-element | ID | Type |
|---|---|---|
| `PixelWidth` | `0xB0` | uint |
| `PixelHeight` | `0xBA` | uint |
| `DisplayWidth` | `0x54B0` | uint (optional) |
| `DisplayHeight` | `0x54BA` | uint (optional) |
| `FlagInterlaced` | `0x9A` | uint (optional; default 0 = progressive) |
| `Colour` | `0x55B0` | master (optional, preserved verbatim — not parsed) |

`Audio` master (ID `0xE1`):

| Sub-element | ID | Type |
|---|---|---|
| `SamplingFrequency` | `0xB5` | float |
| `OutputSamplingFrequency` | `0x78B5` | float (optional, SBR/HE-AAC) |
| `Channels` | `0x9F` | uint |
| `BitDepth` | `0x6264` | uint (optional) |

### Codec init data — `CodecPrivate` per codec (first pass)

| CodecID | CodecPrivate format | WebCodecs codec string | description bytes |
|---|---|---|---|
| `V_MPEG4/ISO/AVC` | `AVCDecoderConfigurationRecord` (ISO 14496-15 §5.3.3) | `avc1.<profile><constraint><level>` derived from CodecPrivate bytes 1–3 | CodecPrivate verbatim |
| `V_MPEGH/ISO/HEVC` | `HEVCDecoderConfigurationRecord` (ISO 14496-15 §8.3.3) | `hev1.<profile_space>.<profile_compat>.<tier_level>` derived from CodecPrivate | CodecPrivate verbatim |
| `V_VP8` | empty / absent | `vp8` | none |
| `V_VP9` | empty / absent | `vp09.<profile>.<level>.<bitdepth>` (default `vp09.00.10.08`) | none |
| `A_AAC` | `AudioSpecificConfig` (2–5 bytes per ISO 14496-3 §1.6.2.1) | `mp4a.40.<aot>` (e.g. `mp4a.40.2` for LC) | CodecPrivate verbatim |
| `A_MPEG/L3` | empty | `mp3` | none |
| `A_FLAC` | FLAC STREAMINFO bytes (autodetect: 38-byte `fLaC`+block, or raw 34-byte STREAMINFO body) | `flac` | CodecPrivate verbatim |
| `A_VORBIS` | Xiph-laced 3-packet init (header byte `0x02`, two Xiph-coded sizes, then identification + comment + setup packets) | `vorbis` | CodecPrivate verbatim |
| `A_OPUS` | `OpusHead` (RFC 7845 §5.1) | `opus` | CodecPrivate verbatim |

### Cluster and SimpleBlock

| Element | ID | Type |
|---|---|---|
| `Cluster` | `0x1F43B675` | master |
| `Timecode` | `0xE7` | uint (in TimecodeScale units, REQUIRED) |
| `SimpleBlock` | `0xA3` | binary |

`SimpleBlock` payload layout (Matroska §16.4):

```
offset   bytes  field
 0       1-2    track_number_vint   (EBML VINT, with marker bit STRIPPED;
                                     1 byte for tracks 1..127, 2 bytes for >127 — Trap #24)
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

For Xiph lacing the size table is a sequence of unsigned bytes
terminated when a byte != 255 is seen; that closes one frame's size
as `sum(255-bytes) + final_byte`. The last frame's size is whatever
is left in the Block payload.

### Cues (optional but recommended for seekable files)

| Element | ID | Type |
|---|---|---|
| `Cues` | `0x1C53BB6B` | master |
| `CuePoint` | `0xBB` | master |
| `CueTime` | `0xB3` | uint (in TimecodeScale units) |
| `CueTrackPositions` | `0xB7` | master |
| `CueTrack` | `0xF7` | uint |
| `CueClusterPosition` | `0xF1` | uint (offset into Segment payload) |
| `CueRelativePosition` | `0xF0` | uint (optional, deferred — read but ignored) |
| `CueDuration` | `0xB2` | uint (optional, deferred — read but ignored) |

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

interface MkvEbmlHeader {
  ebmlVersion: 1;
  ebmlReadVersion: 1;
  ebmlMaxIdLength: number;     // <= 4 first pass
  ebmlMaxSizeLength: number;   // <= 8 first pass
  docType: 'matroska';         // reject anything else (incl. 'webm')
  docTypeVersion: number;      // 1..4
  docTypeReadVersion: number;  // 1..2
}

interface MkvInfo {
  timecodeScale: number;       // ns per tick; 1_000_000 if absent
  duration?: number;           // in TimecodeScale units (float)
  muxingApp: string;
  writingApp: string;
  segmentUid?: Uint8Array;     // 16 bytes if present
  title?: string;
}

type MkvVideoCodecId =
  | 'V_MPEG4/ISO/AVC'
  | 'V_MPEGH/ISO/HEVC'
  | 'V_VP8'
  | 'V_VP9';

type MkvAudioCodecId =
  | 'A_AAC'
  | 'A_MPEG/L3'
  | 'A_FLAC'
  | 'A_VORBIS'
  | 'A_OPUS';

interface MkvVideoTrack {
  trackNumber: number;
  trackUid: bigint;
  trackType: 1;                // video
  codecId: MkvVideoCodecId;
  codecPrivate?: Uint8Array;   // required for AVC/HEVC; empty for VP8/VP9
  pixelWidth: number;
  pixelHeight: number;
  displayWidth?: number;
  displayHeight?: number;
  defaultDuration?: number;    // ns per frame
  /** Derived WebCodecs codec string, e.g. 'avc1.640028', 'hev1.1.6.L120.B0'. */
  webcodecsCodecString: string;
}

interface MkvAudioTrack {
  trackNumber: number;
  trackUid: bigint;
  trackType: 2;                // audio
  codecId: MkvAudioCodecId;
  /** Required for AAC/FLAC/Vorbis/Opus; empty for MP3. */
  codecPrivate: Uint8Array;
  samplingFrequency: number;   // Hz
  outputSamplingFrequency?: number;  // Hz (HE-AAC SBR)
  channels: number;
  bitDepth?: number;
  codecDelay?: number;         // ns
  seekPreRoll?: number;        // ns
  /** Derived WebCodecs codec string, e.g. 'mp4a.40.2', 'flac', 'opus'. */
  webcodecsCodecString: string;
}

type MkvTrack = MkvVideoTrack | MkvAudioTrack;

interface MkvSimpleBlock {
  trackNumber: number;
  /** Absolute timestamp in nanoseconds = (Cluster.Timecode + delta) * TimecodeScale. */
  timestampNs: bigint;
  keyframe: boolean;
  invisible: boolean;
  discardable: boolean;
  /** One Uint8Array per frame: 1 for unlaced, N for laced (Xiph only first pass). */
  frames: Uint8Array[];
}

interface MkvCluster {
  /** Absolute file offset of the Cluster element start. */
  fileOffset: number;
  /** Cluster.Timecode in TimecodeScale units. */
  timecode: bigint;
  blocks: MkvSimpleBlock[];
}

interface MkvCuePoint {
  /** CueTime in TimecodeScale units. */
  cueTime: bigint;
  trackNumber: number;
  /** Absolute file offset of the target Cluster, computed from
      Segment.payloadOffset + CueClusterPosition. */
  clusterFileOffset: number;
}

interface MkvFile {
  ebmlHeader: MkvEbmlHeader;
  /** Absolute file offset of the Segment element's first payload byte. */
  segmentPayloadOffset: number;
  info: MkvInfo;
  tracks: MkvTrack[];          // first pass: 1 video + 1 audio
  clusters: MkvCluster[];
  cues?: MkvCuePoint[];
  /** Reference to the underlying file bytes; SimpleBlock payloads sliced on demand. */
  fileBytes: Uint8Array;
}

export function parseMkv(input: Uint8Array): MkvFile;
export function serializeMkv(file: MkvFile): Uint8Array;

export function* iterateVideoChunks(
  file: MkvFile,
  trackNumber: number,
): Generator<{ data: Uint8Array; type: 'key' | 'delta'; timestampUs: number }>;

export function* iterateAudioChunks(
  file: MkvFile,
  trackNumber: number,
): Generator<{ data: Uint8Array; timestampUs: number }>;
```

## Demuxer (read) algorithm

1. **Validate input**: enforce 200 MiB input cap. Reject empty input.
2. **Parse EBML header**: read ID at offset 0; require `0x1A45DFA3`.
   Read size VINT, then descend into the header payload. Decode every
   child element. **Require `DocType == "matroska"`**; reject
   `"webm"` with `MkvDocTypeNotSupportedError` (route to
   `container-webm`); reject any other DocType. Validate
   version/read-version constraints.
3. **Locate Segment**: read the next element ID; require `0x18538067`.
   Read size VINT. Reject unknown size for first pass (Trap #2).
   Record `segmentPayloadOffset`.
4. **Two-phase Segment scan**:
   a. **Phase 1 — light walk**: walk top-level Segment children
      (depth 1) without descending. Record the file offset of each
      `SeekHead`, `Info`, `Tracks`, `Cluster`, `Cues`. Enforce
      element-count cap (100,000) and per-element size cap (64 MiB
      except `Cluster`). On any unknown element ID at depth 1
      (`Chapters`, `Tags`, `Attachments`, etc.), skip it using its
      declared size (Trap #14).
   b. **Phase 2 — depth descent**: parse `Info`, `Tracks` (deeply,
      capping recursion at 8), then `Cues` if present, then each
      `Cluster`.
5. **Decode `Info`**: extract `TimecodeScale` (default `1_000_000` if
   absent — Trap #4), `Duration` (optional float), `MuxingApp`,
   `WritingApp`, `SegmentUID`, `Title`.
6. **Decode `Tracks`**: for each `TrackEntry`:
   a. Read `TrackNumber`, `TrackUID`, `TrackType`. Reject `TrackType`
      values other than 1 (video) or 2 (audio) with
      `MkvUnsupportedTrackTypeError` (subtitles + others deferred).
   b. Read `CodecID` and validate against the wider allowlist (see
      "Required elements" §). Anything else throws
      `MkvUnsupportedCodecError`.
   c. Descend into `Video` or `Audio` child master and extract
      pixel/sample fields.
   d. Capture `CodecPrivate` (cap at 1 MiB; required for
      AVC/HEVC/AAC/FLAC/Vorbis/Opus, empty/absent for VP8/VP9/MP3 —
      Trap #12, #20, #21, #22).
   e. Dispatch the captured `CodecPrivate` to the matching
      `codec-meta/*.ts` parser to derive the WebCodecs codec string
      (`webcodecsCodecString`). The CodecPrivate bytes themselves
      are kept verbatim as the WebCodecs `description`.
   f. Capture `CodecDelay` and `SeekPreRoll` if present (Opus).
   g. Reject if Tracks contains more than 1 video track or more than
      1 audio track (`MkvMultiTrackNotSupportedError`).
7. **Decode `Cues`** if present: for each `CuePoint` collect
   `(CueTime, CueTrack, CueClusterPosition)`. Translate
   `CueClusterPosition` into an absolute file offset using
   `segmentPayloadOffset + CueClusterPosition`. `CueRelativePosition`
   and `CueDuration` are read but ignored.
8. **Decode each `Cluster`**:
   a. Read `Timecode` (REQUIRED — Trap #8). Convert to bigint.
   b. Iterate children. For each `SimpleBlock`:
      - Decode `track_number` VINT (size-style: marker stripped,
        possibly 2-byte for tracks > 127 — Trap #24).
      - Read 2-byte signed BE `timecode_delta`.
      - Read flags byte. Decode `keyframe`, `invisible`,
        `discardable`, and `lacing` bits (Trap #6).
      - Compute absolute timestamp:
        `(cluster.timecode + delta) * info.timecodeScale` (in
        nanoseconds). Convert to microseconds for WebCodecs by
        dividing by 1000.
      - For lacing == 00: single frame is the rest of the payload.
      - For lacing == 01 (Xiph): read `lace_count_minus_one`, then
        decode `lace_count_minus_one` Xiph sizes (chained 255 +
        final-byte-<=254). Last frame size = `payload_remaining -
        sum(decoded_sizes)`.
      - For lacing == 10 or 11: throw `MkvLacingNotSupportedError`
        (deferred).
      - Cap per-track block count at 10,000,000. Cap recursion / nest
        depth at 8.
      - On an unknown child ID inside Cluster (e.g. `BlockGroup`,
        `PrevSize`, `Position`), skip with declared size.
9. **Build `MkvFile`** and return. SimpleBlock payloads are slices
   into `fileBytes`; do not eagerly copy.

## Muxer (write) algorithm

1. Accept an `MkvFile`. Reject inputs whose `tracks` exceed 1 video +
   1 audio, contain unsupported codecs, or contain unsupported lacing
   modes.
2. **Canonical write order** within Segment: `SeekHead` → `Info` →
   `Tracks` → `Cluster*` → `Cues`. Same as WebM canonical ordering;
   matches IETF draft-ietf-cellar-matroska recommendations.
3. **Serialise EBML header**: emit fixed default values for
   `EBMLVersion / ReadVersion / MaxIDLength / MaxSizeLength`, set
   `DocType = "matroska"`, `DocTypeVersion = 4`,
   `DocTypeReadVersion = 2`.
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
5. **Cluster emission**: for each `MkvCluster`:
   - Emit `Cluster` ID (`0x1F43B675`). Compute body size including
     `Timecode` element + all `SimpleBlock`s. Emit size VINT.
   - Emit `Timecode` element with the cluster's base time.
   - For each `MkvSimpleBlock`: serialise `track_number_vint` (1-byte
     form for tracks 1..127, 2-byte for >127), 2-byte signed BE
     `timecode_delta` (computed as `block.timestampNs / TimecodeScale
     - cluster.timecode`; assert in [-32768, 32767]), flags byte, and
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

- **H.264 (AVC) decode**: `codec: 'avc1.<profile><constraint><level>'`
  derived by `codec-meta/avc.ts` from `AVCDecoderConfigurationRecord`
  bytes 1..3 (`AVCProfileIndication`, `profile_compatibility`,
  `AVCLevelIndication`), formatted as 6 hex digits (e.g.
  `avc1.640028`). `description` = `CodecPrivate` bytes verbatim. NAL
  unit prefix length comes from `lengthSizeMinusOne` (low 2 bits of
  byte 4); SimpleBlock payloads are length-prefixed NAL units, NOT
  Annex-B start codes (Trap #20). `EncodedVideoChunk` `type` =
  `'key'` if SimpleBlock keyframe flag set, else `'delta'`.
- **HEVC decode**: `codec: 'hev1.<profile_space>.<profile_compat>.
  L<tier_level>.B<constraint>'` derived by `codec-meta/hevc.ts` from
  `HEVCDecoderConfigurationRecord`. `description` = `CodecPrivate`
  verbatim. VPS/SPS/PPS parameter-set arrays are inside CodecPrivate
  (Trap #21). Same key/delta mapping as AVC.
- **VP8 decode**: `codec: 'vp8'`. No `description` needed.
- **VP9 decode**: `codec: 'vp09.<profile>.<level>.<bitdepth>'`. For
  first pass, default `'vp09.00.10.08'` and let `probeVideoCodec`
  confirm. No `description` needed.
- **AAC decode**: `codec: 'mp4a.40.<aot>'` where `aot` is the first
  5 bits of `AudioSpecificConfig` (LC = 2, HE-AAC = 5, HE-AACv2 =
  29). `description` = `CodecPrivate` verbatim.
- **MP3 decode**: `codec: 'mp3'`. No `description`. SimpleBlock
  payload is one or more concatenated MP3 frames; each frame is
  self-delimiting via the MPEG sync header so WebCodecs can split
  internally (Trap #23).
- **FLAC decode**: `codec: 'flac'`. `description` = `CodecPrivate`
  bytes (38-byte `fLaC`+block form, normalised by
  `codec-meta/flac-streaminfo.ts` if input was the 34-byte raw-body
  variant — Trap #22). Each SimpleBlock payload is one FLAC frame.
- **Vorbis decode**: `codec: 'vorbis'`. `description` =
  `CodecPrivate` bytes (Xiph-laced 3-packet init). `EncodedAudioChunk`
  with `type: 'key'` per packet.
- **Opus decode**: `codec: 'opus'`. `description` = `CodecPrivate`
  bytes (the `OpusHead` structure per RFC 7845). Each SimpleBlock
  payload is one Opus packet. Apply `CodecDelay` / `SeekPreRoll` to
  upstream playback if exposed.
- **VP9 / Opus / AAC encode**: `WebCodecsVideoEncoder` /
  `WebCodecsAudioEncoder` available in 2026. The MKV layer muxes
  one packet → one SimpleBlock; Cluster boundaries chosen at every
  video keyframe (or every ~5 seconds, whichever is sooner).
- **All other encode paths** (H.264, HEVC, VP8, MP3, FLAC, Vorbis):
  `MkvBackend.canHandle` returns `false` for those encode requests
  so the BackendRegistry falls through to `@webcvt/backend-wasm`
  (ffmpeg.wasm carrying x264, x265, libvpx, lame, libFLAC,
  libvorbis) for synthesis. Output is then re-muxed by this package.
- **Probe**: `probeVideoCodec({ codec, width, height, framerate })`
  and `probeAudioCodec({ codec, sampleRate, numberOfChannels })`
  before submitting any chunk; fall back to ffmpeg-wasm on miss.

## Test plan

- `parses EBML header and recognises DocType "matroska"`
- `rejects DocType "webm" with MkvDocTypeNotSupportedError (routes to container-webm)`
- `rejects DocType "mkv-3d" or any other custom DocType`
- `rejects EBMLVersion != 1 / EBMLReadVersion != 1`
- `decodes VINT IDs (1, 2, 3, 4-byte) preserving the marker bit`
- `decodes VINT sizes (1, 2, 4, 8-byte) stripping the marker bit`
- `decodes 2-byte track_number VINT in SimpleBlock for trackNumber > 127`
- `applies TimecodeScale default of 1_000_000 ns when Info omits it`
- `parses single H.264 video track + single AAC audio track end-to-end`
- `parses single HEVC video track + single AAC audio track end-to-end`
- `parses single VP9 video track + single Opus audio track end-to-end`
- `parses single VP8 video track + single MP3 audio track end-to-end`
- `parses single VP9 video track + single FLAC audio track end-to-end`
- `parses single VP9 video track + single Vorbis audio track end-to-end`
- `parses AVCDecoderConfigurationRecord and derives 'avc1.640028' codec string`
- `parses HEVCDecoderConfigurationRecord with multiple VPS/SPS/PPS arrays`
- `accepts A_FLAC CodecPrivate in fLaC+STREAMINFO (38-byte) form`
- `accepts A_FLAC CodecPrivate in raw STREAMINFO body (34-byte) form and normalises`
- `decodes Cluster with unlaced SimpleBlocks (lacing == 00)`
- `decodes SimpleBlock with Xiph lacing (lacing == 01) and 3 frames`
- `rejects SimpleBlock with EBML / fixed-size lacing as deferred`
- `computes absolute timestamp = (Cluster.Timecode + delta) * TimecodeScale`
- `parses Cues block and resolves CueClusterPosition to absolute file offset`
- `tolerates and skips Chapters / Tags / Attachments at Segment depth`
- `rejects multi-video-track file with MkvMultiTrackNotSupportedError`
- `rejects subtitle track (S_TEXT/UTF8) with MkvUnsupportedTrackTypeError`
- `rejects ContentEncoding (encrypted track) with MkvEncryptionNotSupportedError`
- `round-trip: parse → serialize → semantic-equivalent Segment for clean MKV`
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

5. **SimpleBlock structure**: 1-2 byte `track_number_vint` (size-style
   VINT, marker stripped) + 2-byte signed big-endian `timecode_delta`
   + 1-byte flags + payload. The block timecode is RELATIVE to
   `Cluster.Timecode`; absolute timestamp = `(Cluster.Timecode +
   delta) * TimecodeScale`. Easy to mis-add or treat as absolute. The
   2-byte delta is signed — cast through `DataView.getInt16(offset,
   /* littleEndian= */ false)` not `getUint16`.

6. **Block lacing modes** (flags bits 1-2): `00` = no lacing, `01` =
   Xiph lacing, `10` = fixed-size lacing, `11` = EBML lacing
   (Matroska-specific signed delta-encoded VINT sizes). First pass:
   support `00` and `01`. Throw `MkvLacingNotSupportedError` on `10`
   and `11`. Note: full Matroska makes EBML lacing more common than
   in WebM (some encoders default to it for audio); fixture coverage
   should include explicit reject tests.

7. **`CodecID` is an ASCII string namespace**: Matroska's allowlist
   is huge — the registry includes `V_MPEG4/ISO/AVC`, `V_MPEGH/ISO/HEVC`,
   `V_VP8`, `V_VP9`, `V_AV1`, `V_THEORA`, `V_REAL/RV40`, `V_MS/VFW/FOURCC`,
   `A_AAC`, `A_MPEG/L3`, `A_FLAC`, `A_VORBIS`, `A_OPUS`, `A_AC3`,
   `A_DTS`, `A_PCM/INT/LIT`, `A_MS/ACM`, `A_QUICKTIME`, plus a long
   subtitle list (`S_TEXT/UTF8`, `S_TEXT/WEBVTT`, `S_TEXT/ASS`,
   `S_HDMV/PGS`, ...). Match exactly (case-sensitive) against the
   first-pass allowlist; reject everything else with
   `MkvUnsupportedCodecError`.

8. **`Cluster` MUST have a `Timecode` element**. Per the Matroska
   spec, `Cluster.Timecode` is required and must precede the first
   `SimpleBlock` in the Cluster. Some pre-2010 mkvtoolnix output
   placed it later — be tolerant on read (collect children into a
   record then assemble at the end), but reject Clusters where it is
   absent.

9. **Element nesting depth**: Matroska allows arbitrary nesting in
   theory; the deepest legitimate path in our scope is roughly
   `Segment → Cluster → BlockGroup → Block` (5 levels including the
   EBML root element). Cap recursion depth at 8 — comfortable
   headroom that still defeats malformed-file stack-blowing inputs.

10. **`SeekHead` is OPTIONAL but RECOMMENDED**. SeekHead lists
    `(SeekID, SeekPosition)` pairs giving absolute positions of major
    elements (`Tracks`, `Cues`, `Info`, `Chapters`, `Tags`,
    `Attachments`) within the Segment payload (i.e. positions
    relative to the Segment payload's first byte, NOT absolute file
    offsets). Writer should emit one for streaming friendliness;
    reader optionally uses it to skip the linear scan.

11. **`Cues` come AFTER all `Cluster`s** typically (so the writer
    must compute Cluster positions before emitting Cues). For
    round-trip preservation, the muxer copies original Cues bytes
    verbatim if nothing was edited; otherwise it regenerates via the
    two-pass layout. Reader handles both pre-Clusters and
    post-Clusters Cues — some Matroska files put Cues before Clusters
    via SeekHead indirection.

12. **Vorbis `CodecPrivate` is the Xiph-laced 3-packet init**: header
    byte `0x02`, then Xiph-lacing-packed `len(packet0)` and
    `len(packet1)` (255-chained), then the three packets concatenated
    (identification, comment, setup). WebCodecs `description` is
    EXACTLY these `CodecPrivate` bytes — do not unpack. The
    container's only job is to preserve them.

13. **Opus `CodecPrivate` is the `OpusHead` structure** (RFC 7845
    §5.1): magic `OpusHead` + version + channel count + pre-skip +
    input sample rate + output gain + channel mapping family.
    WebCodecs `description` is exactly these bytes. **VP8 and VP9
    `CodecPrivate` is empty or absent**: VP8/VP9 keyframes are
    self-contained. **MP3 `CodecPrivate` is empty or absent**: MP3
    frames are self-delimiting via their MPEG sync header.

14. **Unknown elements at any level must be SKIPPED, not rejected**.
    Matroska is designed for forward compatibility: writers may add
    elements unknown to older readers (it is also normal for files in
    scope to include `Chapters`, `Tags`, `Attachments` at Segment
    depth — all deferred but must not error). Read the unknown
    element's size VINT and advance by `header_bytes + size`. The
    first-pass allowlist applies only to elements we deliberately
    support; all other IDs at any depth are skipped (after capping
    their size). Exception: at depth 0 inside the Segment master we
    enforce element-count and per-element size caps regardless.

15. **Segment size VINT width is a layout pin**. The Segment's size
    VINT can be 1-8 bytes. The muxer doesn't know the final body size
    until everything is serialised, so we always reserve an 8-byte
    width VINT for `Segment.size` (and pad sub-element sizes likewise
    when they are sources of truth for SeekHead positions). This
    avoids needing a third pass to re-encode size VINTs at narrower
    widths after sizes shrink.

16. **`Void` element (`0xEC`) is a padding mechanism**. The muxer
    uses it inside SeekHead to pad to the reserved size when fewer
    Seek entries are needed; the reader simply skips it. First-pass
    reader: skip `Void` content without decoding. First-pass writer:
    emit `Void` only inside SeekHead reserved space, never elsewhere.

17. **Endianness asymmetry inside SimpleBlock**: the `track_number`
    VINT is encoded VINT-style (length-prefix logic, not really "an
    endianness"), but the 2-byte `timecode_delta` immediately
    following is **big-endian signed int16**. Writers converting from
    typed arrays must `setInt16(offset, value, false)` (the `false`
    literal is required — JavaScript's `DataView.setInt16` defaults
    to big-endian only when the third arg is omitted, which is easy
    to forget when refactoring).

18. **`CodecDelay` and `SeekPreRoll` propagate to playback semantics
    for Opus**. `CodecDelay` is the encoder's pre-skip in nanoseconds
    (typically 6.5 ms = 312 samples at 48 kHz × 1000000 / 48000
    rounded). `SeekPreRoll` (typically 80 ms = 80000000 ns) is the
    minimum decoded-but-discarded duration before any seek-target
    sample to converge the decoder state. Container layer preserves
    both; downstream player applies them.

19. **`DocType` validation is strict**: only `"matroska"` is accepted
    in this package. `"webm"` is REJECTED with
    `MkvDocTypeNotSupportedError` so the BackendRegistry can route
    WebM-flavoured files to `@webcvt/container-webm` (which has the
    inverse rejection). Reject any other DocType (e.g. `"mkv-3d"`,
    `"webmlite"`) the same way. This split-routing is what justifies
    duplicating the EBML primitives — see "Code reuse" §.

20. **`AVCDecoderConfigurationRecord` parsing for H.264** (ISO
    14496-15 §5.3.3): byte layout is fixed — `configurationVersion`
    (1), `AVCProfileIndication`, `profile_compatibility`,
    `AVCLevelIndication`, then `lengthSizeMinusOne` in the low 2 bits
    of byte 4 (high 6 bits all-ones reserved), then `numOfSPS` low 5
    bits of byte 5 (high 3 bits all-ones reserved), SPS array, then
    `numOfPPS` (1 byte), PPS array. **WebCodecs expects NAL units
    prefixed with `lengthSizeMinusOne + 1` byte big-endian length
    prefixes**, NOT Annex-B start codes — Matroska SimpleBlock
    payloads ARE already in length-prefixed form for AVC tracks so
    we pass through unchanged. Verify on first AVC fixture. The
    derived codec string is
    `avc1.<profile_hex><compat_hex><level_hex>` (6 hex digits, e.g.
    `avc1.640028` for High @ L4.0).

21. **HEVC parameter sets** (ISO 14496-15 §8.3.3): the
    `HEVCDecoderConfigurationRecord` byte layout includes a 23-byte
    fixed header followed by `numOfArrays` (1 byte). Each array
    holds `(array_completeness | NAL_unit_type, numNalus,
    [nal_length_u16, nal_unit_bytes]+)` for VPS / SPS / PPS / SEI.
    Variable count per array, variable count of arrays — easy to
    mis-parse. Cap `numOfArrays` at 8 and `numNalus` at 64 per
    array. Derived codec string is
    `hev1.<profile_space>.<profile_compat_hex>.L<tier_level>.B<constraint_hex>`,
    e.g. `hev1.1.6.L120.B0` for Main10 @ L4.0. SimpleBlock payloads
    are length-prefixed NAL units (same convention as AVC), with
    length size from `lengthSizeMinusOne` (low 2 bits of HEVC byte
    21).

22. **MKV `A_FLAC` `CodecPrivate` ambiguity**: the Matroska codec
    mapping spec is ambiguous about whether `CodecPrivate` is the
    full FLAC stream prefix (`fLaC` magic + 4-byte STREAMINFO
    metadata-block header + 34-byte STREAMINFO body = 42 bytes — or
    just `fLaC` + STREAMINFO block = 38 bytes) or the bare 34-byte
    STREAMINFO body. Some encoders write each variant. **Decision**:
    on parse, autodetect by length — accept 42-byte (`fLaC` + 4-byte
    block header + 34-byte body), or 34-byte (raw body), normalising
    both to the 42-byte canonical form for the WebCodecs
    `description`. On write, emit the 42-byte canonical form.

23. **MP3 in MKV via `A_MPEG/L3`**: SimpleBlock payload is one or
    more concatenated MP3 frames. Each frame is self-delimiting
    (MPEG sync `0xFFE0..0xFFFF` on the high 11 bits, header gives
    layer + bitrate + samplerate from which frame size derives).
    `CodecPrivate` is empty. WebCodecs `description` is empty.
    Pass each SimpleBlock payload as one `EncodedAudioChunk` —
    WebCodecs MP3 decoder accepts multiple concatenated frames per
    chunk.

24. **Track number > 127 needs 2-byte VINT in SimpleBlock**: the
    WebM spec recommends single-byte track numbers (1..127). Generic
    Matroska files in the wild (multi-track recordings, archival
    rips) can have track numbers up to 32767, requiring a 2-byte
    VINT in the SimpleBlock header. Reader MUST use `readVintSize`
    for the `track_number` field — not a hard-coded 1-byte read.
    Writer emits 1-byte form for trackNumber 1..127, 2-byte for
    128..16383.

## Security caps

- 200 MiB input cap in parser entry (`MAX_INPUT_BYTES`).
- Per-element size cap: any non-`Cluster` non-`Segment` element
  claiming size > 64 MiB rejected (`MAX_ELEMENT_PAYLOAD_BYTES`).
  `Cluster` size capped at 256 MiB (`MAX_CLUSTER_BYTES`).
- Total element count cap: 100,000 across the file
  (`MAX_ELEMENTS_PER_FILE`).
- EBML recursion depth cap: 8 levels (`MAX_NEST_DEPTH`).
- Per-track Block count cap: 10,000,000 (`MAX_BLOCKS_PER_TRACK`).
- VINT max width: 8 bytes per RFC 8794; reject any encoding that
  declares > 8 bytes via the all-zeros-leading-byte pattern.
- `CodecPrivate` cap: 1 MiB per track (`MAX_CODEC_PRIVATE_BYTES`) —
  AVC/HEVC config records are typically 30..400 bytes, FLAC
  STREAMINFO is 42 bytes, so this is generous.
- Cues cap: 1,000,000 `CuePoint` entries (`MAX_CUE_POINTS`).
- HEVC `numOfArrays` cap: 8; per-array `numNalus` cap: 64
  (`MAX_HEVC_PARAM_SET_ARRAYS`, `MAX_HEVC_NALUS_PER_ARRAY`).
- AVC SPS / PPS count cap: 32 each
  (`MAX_AVC_PARAM_SETS_PER_TYPE`).
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
| `ebml-vint.ts` (DUPLICATE of webm — see §"Code reuse") | 100 |
| `ebml-element.ts` (DUPLICATE of webm) | 150 |
| `ebml-types.ts` (DUPLICATE of webm) | 120 |
| `elements/header.ts` (EBML header decode + encode, DocType="matroska" gate) | 80 |
| `elements/segment-info.ts` (Info: TimecodeScale, Duration, MuxingApp, WritingApp, SegmentUID, Title) | 100 |
| `elements/tracks.ts` (Tracks / TrackEntry / Video / Audio / CodecPrivate — wider codec allowlist) | 280 |
| `elements/cluster.ts` (Cluster / SimpleBlock with Xiph lacing) | 300 |
| `elements/cues.ts` (CuePoint / CueTrackPositions) | 150 |
| `elements/seek-head.ts` (SeekHead / Seek with Void padding) | 100 |
| `codec-meta/avc.ts` (AVCDecoderConfigurationRecord parser, codec string derivation) | 80 |
| `codec-meta/hevc.ts` (HEVCDecoderConfigurationRecord parser, codec string derivation) | 100 |
| `codec-meta/aac-asc.ts` (AudioSpecificConfig 5-byte parser; later shareable with codec-aac) | 50 |
| `codec-meta/flac-streaminfo.ts` (autodetect: fLaC+block vs raw 34-byte; normalise) | 60 |
| `parser.ts` (top-level: EBML header → two-phase Segment scan → element dispatch) | 200 |
| `serializer.ts` (canonical write order + two-pass back-patching) | 250 |
| `block-iterator.ts` (parsed clusters → EncodedAudioChunk / EncodedVideoChunk) | 180 |
| `backend.ts` (MkvBackend, identity-only canHandle for first pass) | 120 |
| `errors.ts` (typed errors) | 80 |
| `constants.ts` (caps, codec-ID allowlist, default TimecodeScale) | 60 |
| `index.ts` (re-exports) | 50 |
| **total** | **~2,610** |
| tests | ~1,100 |

Headline plan.md budget for `container-mkv` first pass: ~2,000 LOC.
Realistic with the wider codec set, the four `codec-meta/*.ts`
parsers, and the two-pass serialiser: ~2,610. Acceptable overrun; the
`codec-meta/*` files account for almost all the overhead vs `webm`.
Everything beyond first-pass scope is deferred to Phase 3.5.

## Implementation references (for the published README)

This package is implemented from the Matroska element specification
(matroska.org/technical/elements.html), IETF RFC 8794 (Extensible
Binary Meta Language), IETF draft-ietf-cellar-matroska, and IETF
draft-ietf-cellar-codec. Codec init data parsing follows ISO/IEC
14496-15 (Carriage of NAL unit structured video — for AVC and HEVC
configuration records), ISO/IEC 14496-3 §1.6.2.1
(`AudioSpecificConfig` for AAC), the FLAC Format specification at
xiph.org/flac/format.html (STREAMINFO body), RFC 7845 (Opus in Ogg,
used here for `OpusHead` inside `CodecPrivate`), and the Vorbis I
specification at xiph.org. VP8 and VP9 bitstream identification
follows RFC 6386 and the WebM Project's VP9 documentation. MP3 frame
synchronisation follows ISO/IEC 11172-3 / 13818-3. No code was
copied from libavformat, libwebm, libmkvtoolnix, mkvtoolnix, Bento4,
FFmpeg, or any other implementation. The EBML primitives
(`ebml-vint.ts`, `ebml-element.ts`, `ebml-types.ts`) are
intentionally duplicated from `@webcvt/container-webm` for first
pass; a `@webcvt/ebml` extraction is a Phase 3 wrap-up task. WebM
(`DocType = webm`) support lives in the separate
`@webcvt/container-webm` package and is rejected here so the
BackendRegistry can route correctly. Test fixtures derived from
FFmpeg samples (LGPL-2.1) live under `tests/fixtures/video/` and
`tests/fixtures/audio/` and are not redistributed in npm.
