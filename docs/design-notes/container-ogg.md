# container-ogg design

> Implementation reference for `@catlabtech/webcvt-container-ogg`. Write the code
> from this note plus the linked official spec. Do not consult competing
> implementations except for debugging spec-ambiguous edge cases.

## Format overview

Ogg (RFC 3533) is a generic envelope for framing a sequence of
*packets* into fixed-structure *pages* suitable for streaming over a
lossy channel. Ogg itself is codec-agnostic: a logical bitstream inside
Ogg can carry Vorbis audio, Opus audio, Theora video, FLAC, Speex,
Skeleton metadata, etc. Each logical bitstream has a unique 32-bit
serial number and its own stream of packets. Pages from multiple
logical streams may be interleaved (multiplexed) within one physical
file.

Our Phase 1 scope is limited to:
- Single logical stream per file
- Audio codecs only: Vorbis and Opus
- File extensions: `.ogg`, `.oga`, `.opus`

Chaining (sequential streams) and multiplexing (concurrent streams)
are out of scope; we flag them at parse time and throw.

## Official references

- RFC 3533 — The Ogg Encapsulation Format Version 0
- RFC 5334 — Ogg media types
- RFC 7845 — Ogg Encapsulation for the Opus Audio Codec (granule_pos semantics, pre-skip, output gain)
- RFC 6716 — Opus codec (for the identification header layout)
- Vorbis I specification: https://xiph.org/vorbis/doc/Vorbis_I_spec.html
- Vorbis in Ogg: https://xiph.org/vorbis/doc/oggstream.html

## Ogg page layout

```
offset  bytes  field                       notes
 0       4     capture_pattern             "OggS" (0x4F 0x67 0x67 0x53)
 4       1     stream_structure_version    must be 0
 5       1     header_type_flags           bit0=continued packet, bit1=BOS, bit2=EOS
 6       8     granule_position            LE int64, codec-defined semantics
14       4     bitstream_serial_number     LE uint32
18       4     page_sequence_number        LE uint32
22       4     checksum                    LE uint32, CRC-32 over the whole page with this field zeroed
26       1     page_segments               N (1..255)
27       N     segment_table               each entry 0..255 = byte count of a lacing segment
27+N    ...    page body                   sum(segment_table) bytes
```

## Lacing (packet framing within pages)

A page body is a concatenation of lacing segments. Each segment has a
length of 0 to 255 bytes as declared in `segment_table[i]`. Consecutive
segments of length 255 belong to the same packet and signal
"more bytes follow". A segment of length 0..254 terminates a packet.
Algorithm (RFC 3533 §6):

```
packet_bytes = []
for each entry len in segment_table:
    packet_bytes.append(next len bytes from body)
    if len < 255:
        emit packet(packet_bytes); packet_bytes = []
# If segment_table ends with a 255-entry, the final packet continues on the next page.
```

A packet that spans pages: the next page has header flag bit0
("continued packet") set, and its first segments prepend to the
in-progress packet_bytes.

## CRC-32 polynomial

Ogg uses the CRC-32 polynomial `0x04C11DB7` in its non-reflected form,
init 0, with the checksum field treated as zero during computation.
This is **not** the same as the zlib CRC-32 used by PNG/GZIP (reflected,
poly `0xEDB88320`). Implement a dedicated 256-entry lookup table.

## Codec identification headers (page 0 body)

### Vorbis (3 packets in the first pages: identification, comment, setup)

Identification packet (30 bytes):
```
offset  bytes  field
 0       1     packet_type = 0x01
 1       6     "vorbis" magic
 7       4     vorbis_version = 0
11       1     audio_channels
12       4     audio_sample_rate (LE u32)
16       4     bitrate_maximum
20       4     bitrate_nominal
24       4     bitrate_minimum
28       1     blocksize_0 (4 bits) / blocksize_1 (4 bits)
29       1     framing_bit = 1
```

### Opus (2 packets: OpusHead, OpusTags; RFC 7845 §5)

OpusHead:
```
offset  bytes  field
 0       8     "OpusHead" magic
 8       1     version = 1
 9       1     channel_count
10       2     pre_skip (LE u16, samples at 48 kHz)
12       4     input_sample_rate (LE u32; informational, NOT used for playback rate)
16       2     output_gain (LE i16, Q7.8 dB)
18       1     channel_mapping_family (0 = mono/stereo, 1 = surround, 255 = undefined)
[if family != 0: variable-length channel mapping table, §5.1.1]
```

## granule_position semantics (per codec)

- **Vorbis**: granule_pos is the PCM sample index of the last sample
  completed in this page (total samples produced so far). Sample rate
  equals the identification header's sample_rate.
- **Opus**: granule_pos is the total sample count at 48 kHz, including
  the pre-skip samples at the start of the stream. To get the playable
  sample index, subtract pre_skip. Final page may carry a granule_pos
  that implies the stream ends mid-packet (used to encode "trim last N
  samples" via end_trim calculation).

## Key types we will model

```ts
interface OggPage {
  continuedPacket: boolean;          // header flag bit 0
  bos: boolean;                      // bit 1
  eos: boolean;                      // bit 2
  granulePosition: bigint;           // raw LE int64
  serialNumber: number;
  pageSequenceNumber: number;
  /** Raw segment table (0..255 entries). Length sum = body.length. */
  segmentTable: Uint8Array;
  body: Uint8Array;
}

interface OggPacket {
  /** Concatenated bytes after lacing reassembly. */
  data: Uint8Array;
  /** granule_position from the page where this packet ENDED.
      -1 (i.e. 0xFFFFFFFFFFFFFFFF) if the packet is split and no page completed it. */
  granulePosition: bigint;
  /** Serial number of the logical stream. */
  serialNumber: number;
}

type OggCodec = 'vorbis' | 'opus';

interface OggLogicalStream {
  serialNumber: number;
  codec: OggCodec;
  identification: Uint8Array;        // first packet, codec-specific
  comments?: Uint8Array;             // second packet (Vorbis-comment format for both codecs)
  setup?: Uint8Array;                // third packet, Vorbis only
  packets: OggPacket[];              // audio packets (post-headers)
  /** Opus pre_skip in 48 kHz samples; 0 for Vorbis. */
  preSkip: number;
  sampleRate: number;
  channels: number;
}

interface OggFile {
  streams: OggLogicalStream[];       // Phase 1: length 1
}

export function parseOgg(input: Uint8Array): OggFile;
export function serializeOgg(file: OggFile, options?: {
  targetPageSize?: number;           // default 4096, bounded by lacing math
}): Uint8Array;
```

## Demuxer (read) algorithm

1. Scan for "OggS" capture pattern at offset 0. If not present, throw
   `OggCaptureMissingError`.
2. Page loop:
   a. Read fixed 27-byte header + `page_segments` byte + segment_table.
   b. Read body of `sum(segment_table)` bytes.
   c. Verify CRC-32: copy the page, zero out checksum field, recompute.
   d. If `pageSequenceNumber` is not `expected_for_this_serial`,
      throw `OggSequenceGapError` (do not silently skip — lost pages
      imply lost audio).
   e. Track in-progress packet per serial number. Apply lacing rules.
3. First pages per logical stream (flag BOS set): decode
   identification header. For Vorbis, expect two more header packets
   (comment + setup) before any audio packets. For Opus, expect one
   more (OpusTags). These packets must arrive on pages before any
   audio.
4. After headers, remaining packets go into `packets`. Attach
   granule_position from the page where the packet terminated.
5. Final page (EOS flag) terminates the stream. Verify it ends a packet
   cleanly (no dangling continued packet).
6. Phase 1: if more than one BOS flag is seen OR more than one distinct
   serial number appears, throw `OggMultiStreamNotSupportedError`.

## Muxer (write) algorithm

1. For each logical stream (Phase 1: exactly one):
   a. Emit identification packet on a page with BOS flag set,
      `pageSequenceNumber = 0`, `granule_position = 0`.
   b. Emit comment packet (+ setup for Vorbis) on subsequent pages.
      Align so the first audio packet starts on its own page for easy
      seeking.
   c. For each audio packet, compute target page size (default 4096
      bytes). Emit new page when adding the packet would exceed.
      Update granule_position on page boundaries using codec semantics
      (Vorbis: sample index; Opus: sample index at 48 kHz + pre_skip).
   d. When a packet is larger than targetPageSize, split across pages
      using 255-byte lacing segments. Set continued-packet flag on
      follow-on pages.
   e. Set EOS flag on the final page.
2. For each page:
   a. Build segment_table from current packet lengths.
   b. Assemble the full page, leave checksum = 0, compute CRC-32,
      patch the checksum field in place.
3. Concatenate pages.

## WebCodecs integration

- **Vorbis decode**: `codec: 'vorbis'`. Browser support is limited;
  Chromium decodes Vorbis in WebAudio but WebCodecs audio support is
  gated (Safari does not). Use `probeAudioCodec` to check and fall
  back to ffmpeg-wasm if needed.
- **Opus decode**: `codec: 'opus'`. Broadly supported. Submit each
  `OggPacket.data` as an `EncodedAudioChunk`. Opus description is the
  first packet's bytes (OpusHead).
- **Encode**: Opus encoding is supported in Chromium/Safari.
  `WebCodecsAudioEncoder` with `codec: 'opus'` produces raw Opus
  frames; the Ogg layer must mux them into pages with pre_skip set to
  80 ms × 48 kHz = 3840 samples (a safe default recommended by RFC
  7845 §4.2) and granule_position updated per page.
- **Vorbis encode**: not in WebCodecs; encode path throws with a
  pointer to ffmpeg-wasm fallback.

## Test plan

- `parses single-stream Vorbis file (OggS + vorbis id header)`
- `parses single-stream Opus file (OggS + OpusHead)`
- `reassembles packets that span page boundaries via 255-lacing`
- `verifies CRC-32 using Ogg polynomial, not zlib polynomial`
- `tracks granule_position for Vorbis as sample index`
- `tracks granule_position for Opus as 48 kHz sample index minus pre_skip`
- `rejects file with missing OggS capture pattern`
- `rejects file with non-zero stream_structure_version`
- `rejects file with page sequence number gap (simulated lost page)`
- `parses chained file (two sequential streams concatenated) — both decoded in order`
- `rejects multiplexed file (two concurrent serial numbers) with OggMultiplexNotSupportedError`
- `round-trip: parse → serialize → byte-identical pages, including CRC`
- `serializer sets BOS on first page and EOS on last page`
- `serializer splits oversized packet across pages with continued-packet flag`

## Known traps

1. **granule_pos semantics differ per codec**. Vorbis = PCM sample
   index of last completed sample. Opus = 48 kHz sample index
   including pre_skip. Wrong assumption here silently corrupts
   timestamps. RFC 7845 §4.
2. **Continued packets across pages**: lacing value `255` means
   "more bytes follow in a later segment" which may be on the same
   page OR the next page. Reassembly is stateful — you must carry
   the in-progress packet across page reads until a segment <255
   terminates it. On the receiving page, the continued-packet flag
   (bit 0 of header_type) must be set.
3. **Page sequence gaps are errors, not tolerated skips**. RFC 3533
   §6. A gap means lost pages = lost audio. Do not pretend to
   recover; raise `OggSequenceGapError` with the missing range.
4. **Multiple logical streams** — two forms, treated differently:
   a. **Multiplexed (out of Phase 2 scope)**: two streams with different
      serial numbers interleaved within the file, both BOS at start,
      both EOS at end. Throw `OggMultiplexNotSupportedError`.
   b. **Chained (Phase 2 SUPPORTED, +~150 LOC)**: one stream ends (EOS)
      and another begins (BOS) later in the same file. Think
      concatenated Opus podcasts. Decoder iterates streams in sequence,
      yielding each one's packets to the caller. State resets between
      streams; downstream codec must reinit on each new logical stream.
5. **BOS / EOS flags MUST be set correctly**. First page of a stream
   has BOS. Last page has EOS. Without these, decoders may refuse or
   behave unpredictably.
6. **CRC-32 polynomial is non-reflected `0x04C11DB7`**, distinct from
   zlib's CRC-32. Using `crc32` from a generic library will produce
   wrong checksums 100% of the time.
7. **Checksum field must be zeroed during computation**. On read, to
   verify, copy the 4 bytes aside, zero them, recompute, compare.
   On write, build the page with checksum = 0, compute, patch in.
8. **Vorbis three-header requirement**: identification, comment,
   setup must all arrive before any audio packet. Setup packet is
   large (~5-20 KB) and often spans pages. Parser must defer declaring
   the stream "ready" until all three are seen.
9. **Opus pre_skip** is encoded in OpusHead. Decoder must discard the
   first `pre_skip` samples from the decoded output. Container layer
   just preserves the value and reports it upstream.
10. **Granule_position = -1** (`0xFFFFFFFFFFFFFFFF` as int64) means
    "no packet completed on this page" — valid for middle-of-packet
    pages.
11. **Output gain (Opus OpusHead bytes 16-17)** is a Q7.8 signed
    value in dB. Container layer preserves; decoder applies.
12. **Comment packet format for Opus mirrors Vorbis-comment** with
    an "OpusTags" magic prefix instead of the Vorbis-specific header.

## LOC budget breakdown

| File | LOC est. |
|---|---|
| `page.ts` (page header, lacing, serialize/deserialize) | 150 |
| `crc32.ts` (non-reflected CRC-32 table + compute) | 50 |
| `packet.ts` (lacing reassembly state machine) | 100 |
| `vorbis.ts` (identification + comment + setup header decode) | 120 |
| `opus.ts` (OpusHead + OpusTags decode) | 100 |
| `parser.ts` (file-level scan, stream discovery, multiplex rejection) | 130 |
| `chain.ts` (sequential chained-stream iteration, state reset) | 150 |
| `serializer.ts` (build pages from packets, pagination, CRC patching) | 150 |
| `backend.ts` (Backend impl, codec-webcodecs integration, encode for Opus) | 120 |
| `errors.ts` | 40 |
| `index.ts` | 20 |
| **total** | **~1130** |
| tests | ~550 |

Headline plan.md budget: ~800. Realistic with Vorbis + Opus codec
headers AND sequential chaining: ~1130. plan.md §5 to be revised.

## Implementation references (for the published README)

This package is implemented from RFC 3533 (Ogg), RFC 7845 (Opus in
Ogg), RFC 5334 (Ogg media types), and the Vorbis I specification at
xiph.org. No code was copied from other implementations. Test fixtures
derived from FFmpeg samples (LGPL-2.1) live under
`tests/fixtures/audio/` and are not redistributed in npm.
