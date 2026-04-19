# container-mp3 design

> Implementation reference for `@webcvt/container-mp3`. Write the code from
> this note plus the linked official spec. Do not consult competing
> implementations except for debugging spec-ambiguous edge cases.

## Format overview

MP3 is a packetised audio stream made of a sequence of independent
MPEG-1/2 Layer III frames. There is no container envelope: a file is just
frames back-to-back, optionally prefixed with an ID3v2 metadata block and
optionally suffixed with a 128-byte ID3v1 tag. Each frame begins with a
32-bit header (11-bit sync word `0xFFE`), then side information, then
Huffman-coded subband data. Frame length in bytes is computed from the
header fields — there is no explicit length prefix.

Variable-bitrate (VBR) files embed a Xing/Info or VBRI header inside the
payload of the *first* frame; that frame is silent and should be treated
as metadata, not audio.

## Official references

- ISO/IEC 11172-3:1993 §2.4 — Audio frame header and bitrate/sample-rate tables
- ISO/IEC 13818-3:1998 — MPEG-2 Layer III extension (half sample rates)
- ID3v2.4 structure: https://id3.org/id3v2.4.0-structure
- ID3v2.4 frames: https://id3.org/id3v2.4.0-frames
- ID3v1: https://id3.org/ID3v1
- Xing/Info VBR header: unofficial (Fraunhofer/LAME) — reference doc at https://www.codeproject.com/Articles/8295/MPEG-Audio-Frame-Header
- LAME tag extension: http://gabriel.mp3-tech.org/mp3infotag.html

## Top-level file layout

```
offset  bytes    block
0       variable [optional ID3v2 tag]   "ID3" magic + size
N       4        MPEG audio frame header (sync word 0xFFE, ...)
N+4     ...      side info + main data
...              (repeat frames until EOF or ID3v1 tag)
EOF-128 128      [optional ID3v1 tag]   "TAG" magic
```

## MPEG audio frame header (32 bits, big-endian)

```
bit  width  field                  notes
31   11     sync                   must be 0b11111111111 (0xFFE)
20    2     version                00=2.5 (ext), 01=reserved, 10=MPEG-2, 11=MPEG-1
18    2     layer                  00=reserved, 01=Layer III, 10=Layer II, 11=Layer I
16    1     protection_absent      1=no CRC, 0=2-byte CRC follows header
15    4     bitrate_index          0=free-format, 15=bad, 1-14=lookup table
11    2     sampling_frequency     lookup {0:44100/22050/11025, 1:48000/24000/12000, 2:32000/16000/8000, 3:reserved}
 9    1     padding_bit            1=one extra byte in this frame
 8    1     private_bit            ignored
 7    2     channel_mode           00=stereo, 01=joint-stereo, 10=dual, 11=mono
 5    2     mode_extension         MS/IS stereo flags for joint-stereo
 3    1     copyright
 2    1     original
 1    2     emphasis
```

Layer III frame length (in bytes), including header and CRC:
```
frame_bytes = floor(144 * bitrate / sample_rate) + padding    (MPEG-1)
frame_bytes = floor( 72 * bitrate / sample_rate) + padding    (MPEG-2 / 2.5)
```
`bitrate` is in bits/sec from the index table, `sample_rate` from the
sampling_frequency lookup combined with version bits.

Layer III also has a 17-byte (mono) or 32-byte (stereo) side-information
block directly after the header (or after the 2-byte CRC if present).

## ID3v2 tag layout

```
offset  bytes  field
0       3      "ID3" (0x49 0x44 0x33)
3       1      major version (3 or 4 in the wild)
4       1      revision
5       1      flags bitfield:
                  bit7=unsynchronisation, bit6=extended header,
                  bit5=experimental, bit4=footer present (v2.4 only)
6       4      size (synchsafe int, 7 bits per byte, big-endian)
10      size   frames (each frame = 4-byte id + 4-byte size + 2-byte flags + data)
[footer 10 bytes if flag bit4 set, same layout as header but id = "3DI"]
```

Synchsafe: each byte uses only the low 7 bits; MSB must be 0. Decode with
`(b0<<21)|(b1<<14)|(b2<<7)|b3`.

## Key types we will model

```ts
interface Mp3FrameHeader {
  version: '1' | '2' | '2.5';
  layer: 3;                        // Layer III only in scope
  bitrate: number;                 // kbps; 0 = free-format (unsupported)
  sampleRate: number;              // Hz
  channelMode: 'stereo' | 'joint' | 'dual' | 'mono';
  modeExtension: number;           // 0-3
  padding: boolean;
  protected: boolean;              // true if CRC present
  frameBytes: number;              // total size including header and CRC
  samplesPerFrame: 384 | 1152 | 576; // layer+version derived
}

interface Mp3Frame {
  header: Mp3FrameHeader;
  /** Full frame bytes including header, CRC, side info, main data. */
  data: Uint8Array;
}

interface Id3v2Frame {
  id: string;                      // 4-char ASCII, e.g. "TIT2"
  flags: number;                   // frame-level flags (2 bytes)
  data: Uint8Array;                // raw bytes, decoder-agnostic
}

interface Id3v2Tag {
  version: [major: number, revision: number];
  flags: number;
  frames: Id3v2Frame[];
  /** true if tag had unsynchronisation applied globally */
  unsynced: boolean;
}

interface Id3v1Tag {
  title: string; artist: string; album: string; year: string;
  comment: string; track?: number; genre: number;
}

interface Mp3File {
  id3v2?: Id3v2Tag;
  /** If first frame is a Xing/Info/VBRI metadata frame, it lives here separately. */
  xingHeader?: XingHeader;
  frames: Mp3Frame[];
  id3v1?: Id3v1Tag;
}

interface XingHeader {
  kind: 'Xing' | 'Info' | 'VBRI';
  totalFrames?: number;
  totalBytes?: number;
  toc?: Uint8Array;                // 100-byte seek table
  qualityIndicator?: number;
  lame?: LameExtension;
}

export function parseMp3(input: Uint8Array): Mp3File;
export function serializeMp3(file: Mp3File): Uint8Array;
```

## Demuxer (read) algorithm

1. If bytes 0-2 equal `"ID3"`, parse ID3v2 tag:
   a. Read 10-byte header, decode synchsafe size.
   b. If bit4 of flags is set, size includes +10 for footer.
   c. If bit7 (unsynchronisation) is set, scan the tag body and remove every `0x00` byte that follows a `0xFF` byte (spec §6.1).
   d. Parse frames: loop reading 4-byte id + 4-byte size (v2.4: synchsafe; v2.3: plain u32) + 2-byte flags + `size` bytes of data.
   e. Advance cursor past the tag.
2. Check last 128 bytes for ID3v1 (`"TAG"` at EOF-128). If present, parse and limit audio scan to [cursor, EOF-128].
3. Frame scan loop:
   a. At cursor, require 11-bit sync `0xFFE`. If not present, scan forward byte-by-byte until one appears (tolerates trailing junk and APE tags).
   b. Parse 4-byte header. Validate: layer == Layer III, bitrate_index not 0 (free-format) and not 15, sampling_frequency not 3.
   c. **Validate the full header** — the sync word alone is not sufficient. Extract version/layer/bitrate/samplerate/channels and cross-check against a lookup table; reject "impossible" combinations such as MPEG-1 with bitrate_index 0x1 kbps.
   d. Compute `frame_bytes` from formulas above.
   e. For the very first successfully parsed frame, check bytes at offset 36 (stereo) or 21 (mono) from frame start: if it equals `"Xing"`, `"Info"`, or `"VBRI"`, record a `XingHeader` and DO NOT add this frame to `frames`.
   f. Otherwise push `{header, data: bytes[cursor .. cursor+frame_bytes]}`.
   g. Advance cursor by `frame_bytes`.
4. Stop when cursor reaches end of audio region (EOF or ID3v1 boundary).

## Muxer (write) algorithm

1. Validate: all frames share sample rate and channel count (refuse mixed streams in Phase 1).
2. If `id3v2` present: serialize with synchsafe sizes. Phase 1 policy: write v2.4 tags only; never apply unsynchronisation on output (simpler, tolerated by all decoders).
3. If `xingHeader` present: synthesize the metadata frame. For Xing/Info variant: one silent Layer III frame at the stream's sample rate with the Xing fields populated at the correct offset.
4. Concatenate all `frame.data` bytes in order.
5. If `id3v1` present: append 128-byte tag at end.
6. Return assembled Uint8Array.

The serializer does NOT re-encode audio — it ships the stored `frame.data`
bytes verbatim. This guarantees lossless round-trip.

## WebCodecs integration

- **Decode**: `codec: 'mp3'` into `WebCodecsAudioDecoder`. For each
  `Mp3Frame`, submit `new EncodedAudioChunk({type: 'key', timestamp,
  data: frame.data})`. `samplesPerFrame` × frame index / sampleRate gives
  the timestamp.
- **Encode**: `WebCodecsAudioEncoder` with `codec: 'mp3'` is **not
  available in current browsers** (Chromium supports opus/aac/mp3 decode
  only). Phase 1 scope: decode-only backend; encode throws
  `Mp3EncodeNotImplementedError` with guidance to use ffmpeg-wasm fallback.

## Test plan

- `parses ID3v2.4 tag with TIT2/TPE1/TALB frames from fixture tagged.mp3`
- `parses file with no ID3v2 tag (raw frames only)`
- `parses ID3v1 tag from end of file`
- `recognises Xing VBR header and separates it from audio frames`
- `recognises LAME extension inside Xing header`
- `parses VBRI header (Fraunhofer variant)`
- `counts frame sample offsets correctly for MPEG-1 Layer III (1152 samples/frame)`
- `parses MPEG-2 Layer III (576 samples/frame, half sample rates)`
- `rejects free-format frames (bitrate_index == 0) with Mp3FreeFormatError`
- `parses MPEG 2.5 frames read-only (sample rates 11025/12000/8000 Hz); serializer rejects them with Mp3Mpeg25EncodeNotSupportedError`
- `survives random 0xFF bytes in tag payload without matching them as frame sync`
- `round-trips: parse then serialize → byte-identical audio region`
- `removes unsynchronisation bytes on ID3v2 read and does not emit them on write`

## Known traps

1. **Free-format frames** (`bitrate_index == 0`): frame length is not
   derivable from the header — it must be detected by scanning forward
   for the next sync word. Phase 1 scope: throw; Phase 2: optional
   forward-scan. Spec §2.4.2.3.
2. **MPEG 2.5 unofficial extension** (version bits `00`): defined by
   Fraunhofer, not in ISO. Adds sample rates 11025/12000/8000 Hz.
   **Decision: read-only support.** ~5% of in-the-wild MP3 files use
   this extension; rejecting them would surprise users. The parser
   accepts version `00` and reports `version: '2.5'` on `Mp3Frame`. The
   serializer rejects writing 2.5 frames with `Mp3Mpeg25EncodeNotSupportedError`
   so we never produce non-standard output ourselves.
3. **Xing/Info/VBRI header in first audio frame**: looks like a real
   frame (valid sync, valid header) but its payload is all zeros
   except for the Xing/Info/VBRI signature at a known offset. Treating
   it as audio produces a silent blip at the start. Offset depends on
   version + channel mode: MPEG-1 stereo = 36, MPEG-1 mono = 21, MPEG-2
   stereo = 21, MPEG-2 mono = 13.
4. **ID3v2 unsynchronisation flag** (bit 7 of flags): every `0xFF 0x00`
   byte pair in the tag body must be collapsed to `0xFF` on read.
   Applies to header-declared size so the raw bytes on disk exceed the
   declared size. Spec §6.1. Most v2.4 encoders don't use it but some v2.3
   encoders do.
5. **ID3v2 footer** (v2.4 flag bit 4): 10 extra bytes at the end of
   the tag with id `"3DI"` instead of `"ID3"`. Increase skip length.
6. **ID3v1 tag at EOF**: 128 bytes, fixed layout, magic `"TAG"` at
   offset 0. Fields are fixed-width ASCII padded with 0x00 or spaces.
   Legacy but still shipped by old encoders. Read but don't write in
   Phase 1 unless the input had one.
7. **Frame sync false positive**: `0xFFE` appears in random binary ~1
   in 4096 bytes. NEVER trust just the sync word — always validate the
   full 4-byte header (layer != 0b00, bitrate != 0xF, sample_rate != 0b11).
8. **APE tags** (APEv1/v2) live between the last frame and ID3v1.
   Phase 1 scope: scan for the `"APETAGEX"` marker, skip, do not parse.
9. **Synchsafe integers**: ID3v2.4 size field is 4 bytes of 7-bit
   values (high bit must be 0). Don't decode as a normal u32.
10. **VBR vs CBR total-samples counting**: for seekable output, derive
    total samples from (frame_count × samples_per_frame) not from
    Xing's `totalFrames` which can lie on malformed files.

## LOC budget breakdown

| File | LOC est. |
|---|---|
| `header.ts` (frame header decode, bitrate/samplerate tables, frame size formula) | 120 |
| `id3v2.ts` (ID3v2 parse + serialize, synchsafe, unsynchronisation) | 150 |
| `id3v1.ts` (128-byte tag parse + serialize) | 40 |
| `xing.ts` (Xing / Info / VBRI / LAME detection and decode) | 100 |
| `parser.ts` (full-file scan: tag, frames, trailer) | 100 |
| `serializer.ts` (assemble tags + frames + trailer) | 60 |
| `backend.ts` (Backend impl, WebCodecs decode-only) | 70 |
| `errors.ts` | 40 |
| `index.ts` | 20 |
| **total** | **~700** |
| tests | ~400 |

Headline plan.md budget: ~600. Realistic with ID3v2 edge cases: ~700.
Flag as acceptable overrun; ID3v2 alone is ~150 LOC and non-negotiable
since every real-world MP3 has tags.

## Implementation references (for the published README)

This package is implemented from ISO/IEC 11172-3 (MPEG-1 Audio) and the
ID3v2.4 structure and frames documents published by id3.org. The Xing
VBR header and LAME extension are covered by unofficial but
well-documented community references. No code was copied from other
implementations. Test fixtures derived from FFmpeg samples (LGPL-2.1)
live under `tests/fixtures/audio/` and are not redistributed in npm.
