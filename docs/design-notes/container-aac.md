# container-aac design

> Implementation reference for `@webcvt/container-aac`. Write the code
> from this note plus the linked official spec. Do not consult competing
> implementations except for debugging spec-ambiguous edge cases.

## Format overview

"Raw AAC" in the wild is almost always AAC framed in **ADTS** (Audio
Data Transport Stream): a thin 7- or 9-byte header prepended to each
raw AAC access unit. ADTS is a streaming-oriented envelope that
lets decoders tune into the middle of a stream (e.g. over the air for
DAB+/HE-AAC broadcasts). A `.aac` file is a simple concatenation of
ADTS frames back-to-back; there is no file-level header.

Modern M4A / MP4 containers carry AAC in a "raw" form (no ADTS), relying
on the MP4 `esds` box for decoder config. Our package handles ADTS
only; MP4 integration is the `container-mp4` package's job.

## Official references

- ISO/IEC 14496-3:2019 §1.A.2 — ADTS frame format (current reference)
- ISO/IEC 13818-7:2006 §6.2 — legacy ADTS definition (identical bitfields, minor interpretation differences)
- AudioSpecificConfig layout: ISO/IEC 14496-3 §1.6.2.1
- MP4 Registration Authority AAC object types: https://mp4ra.org/#/object_types

## ADTS frame layout (7 bytes fixed + optional 2-byte CRC)

```
byte  bits  field                              value / notes
 0    1111 1111                                 sync word (high 8 bits)
 1    1111                                      sync word (low 4 bits)
 1       1  id                                  0 = MPEG-4, 1 = MPEG-2
 1       2  layer                               always 00
 1       1  protection_absent                   1 = no CRC, 0 = 2-byte CRC at end of header
 2       2  profile_object_type_minus_1         00=MAIN, 01=LC, 10=SSR, 11=LTP  (see Trap #4)
 2       4  sampling_frequency_index            0..12 valid, 13-14 reserved, 15 = explicit rate follows (rare)
 2       1  private_bit                         ignored
 2    3 3   channel_configuration               high bit at byte 2 bit 0, low 2 bits at byte 3 bits 7-6
 3       1  original_copy                       ignored
 3       1  home                                ignored
 3       1  copyright_identification_bit
 3       1  copyright_identification_start
 3    2 8   aac_frame_length (bytes)            includes header (13 bits; high 2 at byte 3 bits 1-0, mid 8 at byte 4, low 3 at byte 5 bits 7-5)
 5       11 adts_buffer_fullness                0x7FF = VBR
 6       2  number_of_raw_data_blocks_in_frame  typically 0 (1 block per frame)
[7       16 crc_check                            present only if protection_absent == 0]
[header ends, then raw AAC access unit of (aac_frame_length - header_size) bytes]
```

Sampling frequency index table (§1.6.3.3):
```
0=96000   1=88200   2=64000   3=48000   4=44100   5=32000
6=24000   7=22050   8=16000   9=12000  10=11025  11=8000   12=7350
13=reserved  14=reserved  15=explicit (24-bit value follows — not seen in practice)
```

Channel configuration:
```
0=PCE-defined in payload  1=mono  2=L/R  3=C/L/R  4=C/L/R/Cs
5=C/L/R/Ls/Rs  6=C/L/R/Ls/Rs/LFE  7=C/Lc/Rc/L/R/Ls/Rs/LFE (7.1)
```

## Key types we will model

```ts
interface AdtsHeader {
  mpegVersion: 2 | 4;                          // id bit
  profile: 'MAIN' | 'LC' | 'SSR' | 'LTP';
  sampleRate: number;                          // Hz resolved from index
  sampleRateIndex: number;                     // 0..12
  channelConfiguration: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  frameBytes: number;                          // total frame length including header
  hasCrc: boolean;
  crc?: number;                                // 16-bit, when hasCrc
  bufferFullness: number;                      // 0..0x7FE or 0x7FF (VBR)
  rawBlocks: number;                           // number_of_raw_data_blocks_in_frame
}

interface AdtsFrame {
  header: AdtsHeader;
  /** Full frame bytes including ADTS header + optional CRC + access unit payload. */
  data: Uint8Array;
}

interface AdtsFile {
  frames: AdtsFrame[];
}

export function parseAdts(input: Uint8Array): AdtsFile;
export function serializeAdts(file: AdtsFile): Uint8Array;

/** Build the 5-byte AudioSpecificConfig used by WebCodecs / MP4 `esds` from an ADTS header. */
export function buildAudioSpecificConfig(h: AdtsHeader): Uint8Array;
```

## Demuxer (read) algorithm

1. Frame loop starting at offset 0:
   a. Require 12-bit sync `0xFFF` at current position. If absent,
      scan forward byte-by-byte — but validate each candidate's full
      header (see Trap #5) before accepting.
   b. Parse bitfields as laid out above. Verify `layer == 00`,
      `sampleRateIndex < 13`, `channelConfiguration` any value (0 is
      legal, see Trap #2).
   c. Compute `frameBytes` (13-bit field).
   d. If `protection_absent == 0`, read 2-byte CRC after the 7-byte
      header. Header bytes thus = 9.
   e. Record the full frame bytes `[cursor, cursor + frameBytes)`.
   f. Advance `cursor += frameBytes`.
2. Stop at EOF. Allow up to 4 KiB of trailing junk (some muxers pad).
3. Return collected frames.

## Muxer (write) algorithm

1. For each frame:
   a. Recompute `frameBytes = headerSize + payload.length` where
      `headerSize = hasCrc ? 9 : 7`.
   b. Pack bitfields into header bytes per layout above.
   c. If `hasCrc`, compute CRC-16 (CCITT, poly `0x8005`, init `0xFFFF`)
      over the header bytes with the CRC field zeroed, write into
      bytes 7-8. **Note:** AAC ADTS CRC covers only the header and
      the error-sensitive parts of the payload, not the full frame;
      Phase 1 policy is to preserve CRCs from parse on round-trip and
      throw `AdtsCrcUnsupportedError` if the caller requests fresh
      CRC generation. (ISO/IEC 14496-3 §1.A.2 spec is ambiguous;
      most tools omit CRC by setting `protection_absent = 1`.)
   d. Write `payload` bytes after the header.
2. Concatenate all frames.

## WebCodecs integration

- **Decode**: `codec: 'mp4a.40.2'` (AAC-LC) or `'mp4a.40.5'` (HE-AAC
  v1) or `'mp4a.40.29'` (HE-AAC v2). Strip the ADTS header from each
  frame and submit the raw access unit as an `EncodedAudioChunk`.
  Decoder `description` must be the 5-byte AudioSpecificConfig built
  from the first frame's header via `buildAudioSpecificConfig`.
- **Encode**: `WebCodecsAudioEncoder` with `codec: 'mp4a.40.2'`.
  Output `EncodedAudioChunk`s are raw access units; the Adts layer
  wraps them with fresh 7-byte headers (we emit `protection_absent =
  1`, `bufferFullness = 0x7FF` VBR).

## AudioSpecificConfig construction

The 5-byte ASC (used by MP4 `esds` and WebCodecs `description`):
```
bits  field                      derivation
 5    audio_object_type          profile + 1  (MAIN=1, LC=2, SSR=3, LTP=4)
 4    sampling_frequency_index   from ADTS header
 4    channel_configuration      from ADTS header
 1    frame_length_flag          0 (1024 samples)
 1    depends_on_core_coder      0
 1    extension_flag             0
```
If object_type == 5 (SBR) or 29 (PS), add explicit-rate extension
fields. Phase 1 only needs AAC-LC (object type 2), so this is a
straight 5-byte pack.

## Test plan

- `parses ADTS frame stream from fixture sine-44100-stereo.aac`
- `extracts sample rate 44100 from sampleRateIndex == 4`
- `extracts channel_configuration == 2 for stereo`
- `computes correct frameBytes for AAC-LC at 128 kbps`
- `reads 2-byte CRC when protection_absent == 0`
- `rejects sampleRateIndex 13 and 14 (reserved)`
- `rejects layer != 0`
- `handles channel_configuration == 0 by surfacing a warning and not crashing`
- `validates full header — random 0xFFF bytes in payload do not cause false frame starts`
- `round-trip: parse → serialize → byte-identical output`
- `builds 5-byte AudioSpecificConfig for AAC-LC stereo 44100`

## Known traps

1. **protection_absent CRC handling**: when bit is 0, the 2-byte CRC
   occupies bytes 7-8 and the header is 9 bytes total instead of 7.
   Easy to read the CRC bytes as part of the payload and shift all
   downstream frame parsing by 2.
2. **channel_configuration == 0** means "use the Program Config Element
   (PCE) embedded in the payload". Rare but legal. Phase 1 policy:
   surface as `AdtsPceRequiredError` with a warning; do not try to
   decode the PCE bitstream.
3. **sampling_frequency_index 13 and 14 are reserved** in current
   specs. Index 15 means "explicit 24-bit rate follows" — not used
   by any real encoder but specified. Reject 13/14, throw on 15 with
   "not seen in practice, please file a bug".
4. **ISO/IEC 13818-7 vs 14496-3 `profile` interpretation**: in the
   legacy MPEG-2 spec, the 2-bit profile field means MAIN/LC/SSR/reserved.
   In 14496-3, the same 2 bits are `profile_ObjectType - 1` which
   extends to LTP. For files with id=0 (MPEG-4), always use the
   14496-3 mapping. The `+1` offset when building AudioSpecificConfig's
   5-bit audio_object_type is spec-defined, not a typo.
5. **Sync word `0xFFF` may collide with raw audio payload** in
   mid-stream (AAC coefficient bitstreams contain arbitrary bytes).
   NEVER re-sync on sync word alone — when resyncing after an error
   or searching for the first frame, validate a candidate by checking
   that the computed `frameBytes` lands on another valid `0xFFF`
   sync, ideally 2-3 frames deep, before accepting it.
6. **`aac_frame_length` spans three bytes**: 2 bits at byte 3, 8 bits
   at byte 4, 3 bits at byte 5 bits 7-5. 13 bits total = max 8191
   bytes per frame. Easy to mis-shift.
7. **HE-AAC v1/v2 (SBR / PS)**: identified by object_type 5 and 29.
   The ADTS header itself does NOT change; the payload contains
   SBR/PS extension data and the *effective* output sample rate is
   2× the ADTS `sampleRateIndex` value. WebCodecs decoder handles this
   if you pass the right codec string. Phase 1 scope: AAC-LC only,
   defer HE-AAC detection to Phase 2.
8. **Multiple raw_data_blocks per frame**: the 2-bit field at byte 6
   bits 1-0 encodes `N-1` blocks, so value 0 means one block (the
   common case). ≥ 2 blocks per frame is rare (DAB+). Phase 1 scope:
   refuse frames with `rawBlocks > 0` until we have a test fixture.

## LOC budget breakdown

| File | LOC est. |
|---|---|
| `header.ts` (ADTS bit-pack decode + lookup tables) | 80 |
| `parser.ts` (frame scan loop) | 50 |
| `serializer.ts` (frame emit) | 40 |
| `asc.ts` (AudioSpecificConfig builder) | 30 |
| `backend.ts` (Backend impl, WebCodecs decode + encode) | 80 |
| `errors.ts` | 30 |
| `index.ts` | 20 |
| **total** | **~330** |
| tests | ~200 |

Headline plan.md budget: ~200. Realistic: ~330 including the ASC
builder (needed anywhere AAC crosses into MP4 or WebCodecs). Flag as
moderate overrun; ASC builder can be shared with `container-mp4`
later so the cost is recouped.

## Implementation references (for the published README)

This package is implemented from ISO/IEC 14496-3:2019 §1.A.2 (ADTS
frame format), §1.6.2.1 (AudioSpecificConfig), and §1.6.3.3
(sampling_frequency_index table). The legacy ISO/IEC 13818-7 is
consulted as a cross-reference. No code was copied from other
implementations. Test fixtures derived from FFmpeg samples (LGPL-2.1)
live under `tests/fixtures/audio/` and are not redistributed in npm.
