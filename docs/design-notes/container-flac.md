# container-flac design

> Implementation reference for `@webcvt/container-flac`. Write the code
> from this note plus the linked official spec. Do not consult competing
> implementations except for debugging spec-ambiguous edge cases.

## Format overview

FLAC (Free Lossless Audio Codec) is a self-contained audio stream. A
native FLAC file starts with the 4-byte magic `fLaC`, followed by a
sequence of metadata blocks (STREAMINFO mandatory + optional
SEEKTABLE / VORBIS_COMMENT / PICTURE / APPLICATION / CUESHEET /
PADDING), followed by the coded audio frames. Each audio frame is
self-delimiting and starts with a 14-bit sync code (`0b11111111111110`).

FLAC's metadata model is simple: one variable-length header with a "last
block" flag followed by the block payload. Audio frames use a header
that embeds either a frame number (fixed blocksize mode) or a sample
number (variable blocksize mode), both encoded using a UTF-8-style
variable-length integer.

## Official references

- FLAC Format specification: https://xiph.org/flac/format.html
- IETF draft-ietf-cellar-flac: https://datatracker.ietf.org/doc/draft-ietf-cellar-flac/ (modern RFC-style mirror)
- Vorbis comment: https://xiph.org/vorbis/doc/v-comment.html
- CRC-8 poly 0x07 (init 0), CRC-16 poly 0x8005 (init 0) — §9.1.1 and §9.2.2

## Top-level file layout

```
offset   bytes   block
0        4       "fLaC" magic (0x66 0x4C 0x61 0x43)
4        4       STREAMINFO block header (last=0 bit, type=0, length=34)
8        34      STREAMINFO block body (mandatory, always first)
...              0..N additional metadata blocks, last one has last=1
M        ...     audio frames, back-to-back, until EOF
```

## Metadata block header (4 bytes)

```
bit  width  field
31    1     last_block_flag
30    7     block_type (0=STREAMINFO, 1=PADDING, 2=APPLICATION,
                         3=SEEKTABLE, 4=VORBIS_COMMENT,
                         5=CUESHEET, 6=PICTURE, 127=INVALID)
23   24     block_length (big-endian, does NOT include the 4-byte header)
```

## STREAMINFO block body (34 bytes)

```
offset  bits  field
 0      16    min_block_size (samples)
 2      16    max_block_size
 4      24    min_frame_size (bytes; 0 = unknown)
 7      24    max_frame_size
10      20    sample_rate (Hz)
12.5     3    channels - 1 (so 0..7 → 1..8)
12.875   5    bits_per_sample - 1
13.5    36    total_samples (0 = unknown)
18     128    MD5 signature of unencoded audio
```

Bit-packing is big-endian MSB-first. The sample_rate field crosses a
byte boundary — extract with a bit reader, not struct unpacking.

## Frame header (variable-length, §9.1)

```
bits  field
14    sync code: 0b11111111111110
 1    reserved (must be 0)
 1    blocking_strategy: 0=fixed size, 1=variable size
 4    block_size_bits (lookup; 0b0110/0b0111 = read 8/16-bit uncommon value after header)
 4    sample_rate_bits (lookup; 0b1100..0b1110 = read 8/16-bit uncommon value)
 4    channel_assignment (0-7=raw Ns channels, 8=left+side, 9=side+right, 10=mid+side)
 3    sample_size_bits (lookup {0=from STREAMINFO, 1=8, 2=12, 4=16, 5=20, 6=24, 7=32})
 1    reserved (0)
var   UTF-8 coded frame_number OR sample_number (see Trap #1)
var   if block_size_bits == 0b0110/0b0111, uncommon block size
var   if sample_rate_bits == 0b1100/0b1101/0b1110, uncommon sample rate
 8    CRC-8 of everything so far (poly 0x07, init 0)
```

Frame body: N subframes (one per channel) + zero-padding to byte boundary
+ 16-bit CRC-16 of the entire frame including CRC-8 (poly 0x8005).

## Key types we will model

```ts
interface FlacStreamInfo {
  minBlockSize: number;
  maxBlockSize: number;
  minFrameSize: number;
  maxFrameSize: number;
  sampleRate: number;
  channels: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  bitsPerSample: number;             // 4..32
  totalSamples: number;              // 0 = unknown
  md5: Uint8Array;                   // 16 bytes
}

interface FlacMetadataBlock {
  type: number;                      // 0..6, 127
  data: Uint8Array;                  // raw body, decoded lazily
}

interface FlacFrame {
  /** Sample number of first sample in this frame (variable-blocksize) or
      frame_number * blockSize (fixed-blocksize). */
  sampleNumber: number;
  blockSize: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  channelAssignment: 'raw' | 'left+side' | 'side+right' | 'mid+side';
  /** Full frame bytes from sync through CRC-16 inclusive. */
  data: Uint8Array;
}

interface FlacFile {
  streamInfo: FlacStreamInfo;
  blocks: FlacMetadataBlock[];       // includes STREAMINFO as blocks[0]
  frames: FlacFrame[];
}

export function parseFlac(input: Uint8Array): FlacFile;
export function serializeFlac(file: FlacFile): Uint8Array;
```

## Demuxer (read) algorithm

1. Skip any leading ID3v2 tag (some encoders prefix one; see Trap #3).
2. Require magic `fLaC` at the current offset, else throw.
3. Metadata loop: read 4-byte block header, extract last_flag, type,
   length. Read `length` payload bytes. If type == 0 (STREAMINFO), also
   decode bit-packed fields into `streamInfo`. Append to `blocks`.
   Stop after block whose last_flag == 1.
4. Frame loop:
   a. Require 14-bit sync `0x3FFE` at the current bit position.
   b. Parse fixed-layout header bits.
   c. Decode the UTF-8-style sample/frame number (1 to 7 bytes, same
      encoding as UTF-8 but allowing 36 bits of payload — see Trap #1).
   d. Resolve uncommon block_size / sample_rate fields if flagged.
   e. Read CRC-8, verify against bytes parsed so far.
   f. Scan forward to find the next sync code OR end-of-stream to
      determine frame length. Verify CRC-16 against the whole frame.
   g. Push `FlacFrame`. Advance cursor.
5. Stop at EOF. Verify total sample count matches STREAMINFO
   `totalSamples` if it was nonzero.

Reason we scan for the next sync to find frame length: FLAC frames do
not carry a length field. The CRC-16 at the end is the validation
signal. This is error-prone — consider an optimisation where we
parse each subframe and track encoded bit length directly; keep the
scan-for-next-sync as a fallback.

## Muxer (write) algorithm

1. Write magic `fLaC`.
2. Write metadata blocks in order. Set last_flag on the final block.
   Ensure STREAMINFO is first. If caller did not set `totalSamples`,
   compute from `sum(frame.blockSize)`.
3. Write each frame's `data` bytes verbatim (lossless — we do not
   re-encode the Rice-coded residual).
4. Return assembled Uint8Array.

## WebCodecs integration

- **Decode**: `codec: 'flac'` into `WebCodecsAudioDecoder`. Submit each
  `FlacFrame.data` as an `EncodedAudioChunk`. Browser support landed in
  Chrome 124+ / Safari 17+. Use `probeAudioCodec({codec: 'flac',
  sampleRate, numberOfChannels})` to check.
- **Encode**: FLAC is not a WebCodecs encode target anywhere in 2026.
  **Decision: route encode requests to `@webcvt/backend-wasm` (ffmpeg.wasm)
  via the core BackendRegistry's fallback chain.** The `FlacBackend.canHandle`
  returns `false` for encode (output FLAC) so the registry tries the next
  backend. `backend-wasm` has FLAC encode via libFLAC compiled in. Users
  see seamless encode without our package shipping a JS encoder. Document
  this in the README so consumers know to also install `@webcvt/backend-wasm`
  if they want FLAC encode.

## Test plan

- `parses STREAMINFO from fixture sine-44100-mono.flac`
- `parses VORBIS_COMMENT block and exposes key/value pairs`
- `parses SEEKTABLE block with N seek points`
- `parses PICTURE block, exposes MIME and dimensions`
- `handles PADDING block`
- `decodes fixed-blocksize frame number via UTF-8 varint`
- `decodes variable-blocksize sample number via extended UTF-8 varint up to 36 bits`
- `verifies CRC-8 on frame header`
- `verifies CRC-16 on full frame`
- `tolerates ID3v2 prefix before fLaC magic`
- `rejects file with non-fLaC magic and no ID3 prefix`
- `round-trips: parse → serialize → byte-identical metadata + frames`
- `recognises left+side / side+right / mid+side stereo assignments`

## Known traps

1. **Variable-blocksize UTF-8 sample number** (§9.1.6): the sample
   number can be up to 36 bits, encoded using an extended UTF-8 scheme:
   a 7-byte form where the lead byte is `0b11111110` carrying 0 payload
   bits, then 6 continuation bytes of 6 bits each = 36 bits. Standard
   UTF-8 decoders top out at 4 bytes / 21 bits and will reject this.
   Write our own decoder.
2. **CRC-8 on header, CRC-16 on entire frame including the CRC-8 byte**:
   the CRC-16 covers everything in the frame from sync to just before
   itself, including the CRC-8. Easy to mis-skip one or the other.
3. **ID3v2 prefix tolerated by encoders** (non-compliant but common —
   mpg123 and LAME produce these): some encoders wrap FLAC with ID3v2
   tags before `fLaC`. Scan for `fLaC` up to N bytes in, same logic as
   ID3v2 in MP3. Do not error on this.
4. **PICTURE block MIME field is variable-length**: 4-byte length then
   ASCII MIME, then 4-byte length then UTF-8 description, then 4x4
   integers, then 4-byte length then picture data. Do not assume fixed
   offsets within the block.
5. **Mid-side / left-side / side-right stereo decorrelation**: channel
   assignments 8/9/10 mean the stored samples are correlated
   representations, not raw L/R. The codec reconstructs L/R during
   decode; container layer only needs to pass the correct
   `channelAssignment` to WebCodecs and preserve the bytes on mux.
6. **Sample_rate field crosses byte boundaries** in STREAMINFO (20 bits
   starting at bit 80, i.e. byte 10). Use a proper bit reader.
7. **Uncommon block size / sample rate markers** (block_size_bits
   0b0110 / 0b0111 and sample_rate_bits 0b1100 / 0b1101 / 0b1110):
   the actual value is read from 8 or 16 additional bits AFTER the
   UTF-8 coded number, not before. Order matters.
8. **CRC polynomial subtlety**: CRC-8 is reflected-input, non-reflected;
   CRC-16 (FLAC uses CRC-16-IBM, poly 0x8005) — precompute both lookup
   tables at module load.
9. **STREAMINFO totalSamples = 0** is valid and means "unknown".
   Don't treat 0 as empty; rebuild from frames during decode.
10. **Multiple metadata blocks of the same type**: STREAMINFO must be
    first and exactly one. Others can repeat (e.g. two PICTURE blocks
    for front + back cover).

## LOC budget breakdown

| File | LOC est. |
|---|---|
| `streaminfo.ts` (STREAMINFO bit-pack decode/encode, bit reader) | 100 |
| `metadata.ts` (block header + SEEKTABLE/VORBIS_COMMENT/PICTURE/PADDING) | 150 |
| `frame.ts` (frame header decode, UTF-8 varint, CRC-8) | 120 |
| `crc.ts` (CRC-8 and CRC-16 tables + update) | 50 |
| `parser.ts` (full-file scan) | 100 |
| `serializer.ts` | 80 |
| `backend.ts` (Backend impl, decode-only for Phase 1) | 70 |
| `errors.ts` | 30 |
| `index.ts` | 20 |
| **total** | **~720** |
| tests | ~400 |

Headline plan.md budget: ~600. Realistic: ~720 with CRC tables and
UTF-8 varint. Acceptable overrun.

## Implementation references (for the published README)

This package is implemented from the FLAC Format specification at
xiph.org/flac/format.html and the IETF CELLAR FLAC draft. Vorbis
comment parsing follows xiph.org/vorbis/doc/v-comment.html. No code
was copied from other implementations. Test fixtures derived from
FFmpeg samples (LGPL-2.1) live under `tests/fixtures/audio/` and are
not redistributed in npm.
