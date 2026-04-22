# container-ts design

> Implementation reference for `@catlabtech/webcvt-container-ts`. Write the code
> from this note plus the linked official spec. Do not consult competing
> implementations except for debugging spec-ambiguous edge cases.

## Format overview

MPEG-2 Transport Stream (MPEG-TS) is a packet-multiplexed container
defined by ISO/IEC 13818-1 (a.k.a. ITU-T Rec. H.222.0) for the purpose
of delivering one or more programs over an unreliable channel.
Everything lives inside a uniform stream of 188-byte packets, each
beginning with the sync byte `0x47`. A 13-bit `PID` (Packet
Identifier) field in the header tells the demuxer which logical stream
the packet belongs to. Some PIDs carry **PSI** (Program Specific
Information) tables — PAT at PID `0x0000` lists the programs; each
program's PMT enumerates its elementary streams (video, audio,
private). The remaining PIDs carry **PES** (Packetized Elementary
Stream) payloads that, once reassembled across multiple TS packets,
yield codec-level access units (NAL units, ADTS frames, etc.).

Unlike ISOBMFF or Matroska, MPEG-TS has **no global header and no
sample table**. Timing rides inline with the data: a **PCR** (Program
Clock Reference) in the adaptation field gives the system clock; PTS
and DTS in the PES header give per-frame presentation/decode times,
all on a 90 kHz clock derived from the 27 MHz system clock. The format
is designed so a receiver can tune in mid-stream, find the next
sync byte, wait for the next PAT/PMT, and start decoding — there is no
"file start" concept.

## Scope statement

**This note covers a FIRST-PASS implementation, not full DVB / ATSC /
M2TS support.** The goal is the smallest TS subset that can demux a
single-program HLS-style segment (H.264 video + AAC ADTS audio) and
round-trip it semantically. Phase 3.5+ will extend to M2TS / DVB-ASI
packet variants, multi-program multiplexes, HEVC, AC-3, and SI tables.
See "Out of scope (DEFERRED)" below for the explicit deferred list.

**In scope (first pass for `container-ts`, ~1,000 LOC):**

- 188-byte fixed-size TS packets only
- Sync byte `0x47` detection and forward sync-recovery scan when the
  current offset has no valid sync (capped at 1 MiB of skipped bytes)
- TS header decode: `transport_error_indicator`,
  `payload_unit_start_indicator`, `transport_priority`, `PID`,
  `transport_scrambling_control`, `adaptation_field_control`,
  `continuity_counter`
- Adaptation field decode: length, PCR (informational only), splice
  countdown skipped, stuffing tolerated
- PSI section reassembly across TS packets, with `pointer_field`
  handling, CRC-32 (poly `0x04C11DB7`, init `0xFFFFFFFF`,
  non-reflected) verification
- PAT (PID `0x0000`) — single-program only; throw on multi-program
- PMT — extract video + audio elementary stream PIDs and stream types
- PES reassembly per ES PID (a new payload_unit_start_indicator on the
  same PID terminates the previous PES and begins the next)
- PES header decode: `packet_start_code_prefix`, `stream_id`,
  `PES_packet_length` (including the bounded vs unbounded video case),
  `PTS_DTS_flags`, 33-bit PTS / DTS bit-fragment decode at 90 kHz
- Codecs first pass:
  - **Video: H.264** (stream_type `0x1B`) — Annex-B framed NAL units,
    converted to length-prefixed (AVCC) for WebCodecs
  - **Audio: AAC ADTS** (stream_type `0x0F`) — 7-byte ADTS header per
    access unit; reuse `container-aac`'s ADTS parser inline to derive
    the AudioSpecificConfig handed to WebCodecs
- Round-trip parse → serialize **semantic** equivalence (NOT
  byte-identical — continuity_counter resets, stuffing-byte counts,
  and PCR refresh placement are implementation-defined and not
  preserved)
- WebCodecs decode for H.264 + AAC

**Out of scope (Phase 3.5+, DEFERRED):**

- M2TS (192-byte packets with 4-byte timestamp prefix — Blu-ray /
  AVCHD camcorder)
- DVB-ASI 204-byte packets (16-byte Reed-Solomon FEC trailer)
- Multiple programs in a single PAT (DVB SPTS/MPTS multiplexes)
- HEVC video stream type (`0x24`)
- AC-3 (`0x81`) / E-AC-3 (`0x87`) / DTS (`0x82`) audio stream types
- MPEG-2 video stream type (`0x02`)
- MPEG-1 / MPEG-2 audio Layer I/II/III stream types
- MP3-in-TS stream types (`0x03`, `0x04`)
- Encrypted TS (`transport_scrambling_control != 0`) — throws
- PCR-driven A/V resync (PCR is decoded but informational only;
  first-pass relies on PTS/DTS for timing)
- DVB SI tables (SDT, NIT, EIT, TDT, TOT, BAT)
- ATSC PSIP tables (MGT, VCT, EIT, ETT, STT, RRT)
- SCTE-35 splice information sections
- Private-data stream type (`0x06`) and its descriptor-driven payload
  variants
- DVB / ATSC subtitle and teletext PIDs
- Adaptation-field private data, splice information, transport_private_data

## Official references

- ITU-T Rec. H.222.0 / ISO/IEC 13818-1:2023 — Generic coding of moving
  pictures and associated audio: Systems (the substantive spec for TS
  packets, PSI, PES):
  https://www.itu.int/rec/T-REC-H.222.0
  https://www.iso.org/standard/83239.html
- ETSI EN 300 468 — Specification for Service Information (SI) in DVB
  systems (referenced for descriptor tag values reused in PMT, even
  though SI tables themselves are deferred):
  https://www.etsi.org/deliver/etsi_en/300400_300499/300468/
- ATSC A/53 Part 3 — Service Multiplex and Transport Subsystem
  Characteristics (referenced for ATSC stream-type assignments and
  registration descriptor patterns; SI tables deferred):
  https://www.atsc.org/atsc-documents/a532013-service-multiplex-transport-subsystem-characteristics/
- ISO/IEC 14496-10 / ITU-T Rec. H.264 — Advanced Video Coding (Annex B
  byte-stream format, NAL unit syntax):
  https://www.itu.int/rec/T-REC-H.264
- ISO/IEC 14496-15 §5 — Carriage of NAL unit structured video (defines
  the AVCC length-prefixed format that WebCodecs expects):
  https://www.iso.org/standard/83336.html
- ISO/IEC 13818-7 — MPEG-2 AAC (ADTS framing reused in TS):
  https://www.iso.org/standard/43345.html
- SMPTE RP 2010 — Format of Information Carried in MPEG-2 Transport
  Stream for HLS-style applications (informative; for AAC ADTS-in-TS
  conventions used by HLS):
  referenced via Apple HLS (RFC 8216) where appropriate

## MPEG-TS packet primer

```
offset   bytes   field                                     notes
 0        1     sync_byte                                  always 0x47
 1        2     transport_error_indicator (1 bit)          set by upstream demuxer; skip packet if 1
                payload_unit_start_indicator (1 bit)       1 = this packet begins a new PES or PSI section
                transport_priority (1 bit)                 ignored
                PID (13 bits)                              big-endian, 0x0000..0x1FFF
 3        1     transport_scrambling_control (2 bits)      0 = clear; non-zero = scrambled (rejected)
                adaptation_field_control (2 bits)          01=payload only, 10=adaptation only,
                                                           11=adaptation + payload, 00=reserved
                continuity_counter (4 bits)                wraps mod 16 per PID for packets carrying payload
 4        ...   adaptation_field (variable)                present iff adaptation_field_control & 0b10
 ...      ...   payload (variable)                         present iff adaptation_field_control & 0b01
```

The packet is **always 188 bytes** in our scope. After the 4-byte
header, the adaptation field (if present) starts immediately and is
length-prefixed by a 1-byte `adaptation_field_length` (the length
**does not include itself**). The payload then occupies whatever bytes
remain. For an adaptation-only packet (control = `10`), the
adaptation field length is exactly `188 - 4 - 1 = 183`, with stuffing
bytes (`0xFF`) filling the unused interior.

## PSI (Program Specific Information)

PSI tables are carried as **sections** inside ordinary TS packets on
designated PIDs. We need two:

- **PAT** (Program Association Table) — always on PID `0x0000`,
  table_id `0x00`. Lists program numbers and the PID of each program's
  PMT.
- **PMT** (Program Map Table) — on a PID announced by the PAT,
  table_id `0x02`. Lists the elementary streams of one program: per-ES
  PID, stream_type, and ES descriptors.

Deferred: NIT (`0x40`), CAT (`0x01`), SDT/EIT/TDT/etc. (DVB), MGT/VCT
(ATSC), splice_info (SCTE-35).

### PSI section header (8 bytes generic, plus table-specific body)

```
offset   bits  field
 0        8    table_id                       0x00 = PAT, 0x02 = PMT
 1        1    section_syntax_indicator       1 for PAT/PMT (long form)
 1        1    private_indicator              0 for PAT/PMT (reserved as 0)
 1        2    reserved                       set to 0b11
 1       12    section_length                 bytes following this field, INCLUDING CRC-32
                                              (max 1021 for PAT/PMT; 4093 for private SI)
 3       16    table_id_extension             PAT: transport_stream_id; PMT: program_number
 5        2    reserved                       0b11
 5        5    version_number                 increments when table changes
 5        1    current_next_indicator         1 = currently applicable
 6        8    section_number                 0 for PAT/PMT in our scope (single-section)
 7        8    last_section_number            0 for PAT/PMT in our scope
 8       ...   table-specific body            section_length - 9 bytes (4 of which are CRC-32 trailer)
end-4    32   CRC-32                         poly 0x04C11DB7, init 0xFFFFFFFF, non-reflected
```

PSI sections are reassembled from one or more TS packets on the same
PID. The first packet has `payload_unit_start_indicator = 1`; the
**first byte of its payload is a `pointer_field`** indicating how
many bytes to skip before the section header (almost always 0 in
single-section tables). Continuations have
`payload_unit_start_indicator = 0` and no `pointer_field`.

### PAT — program_association_table (table-specific body)

```
repeats while bytes remain (excluding the trailing 4-byte CRC-32):
  16 bits   program_number          0 = NIT entry (skipped); non-zero = a program
   3 bits   reserved                0b111
  13 bits   network_PID OR program_map_PID    (which one depends on program_number)
```

We accept exactly **one** non-zero program. Multi-program: throw
`TsMultiProgramNotSupportedError`.

### PMT — program_map_table (table-specific body)

```
 3 bits   reserved                              0b111
13 bits   PCR_PID                               PID carrying the PCR for this program
 4 bits   reserved                              0b1111
12 bits   program_info_length                   length of program_info descriptors that follow
N bytes   program_info_descriptors              skipped in first pass (registration_descriptor etc.)

repeat until end of section (minus CRC-32):
  8 bits   stream_type                           0x1B = AVC, 0x0F = AAC ADTS, ...
  3 bits   reserved                              0b111
 13 bits   elementary_PID                        PID carrying this ES's PES packets
  4 bits   reserved                              0b1111
 12 bits   ES_info_length                        length of ES descriptors that follow
  N bytes  ES_info_descriptors                   walked to look for registration / language; otherwise skipped
```

We capture each `(stream_type, elementary_PID)` pair into the
`TsProgram.streams` list. Unknown stream types record the PID with a
flag `unsupported = true` so the parser can skip those packets without
attempting PES reassembly.

## PES (Packetized Elementary Stream) packet structure

Inside a non-PSI TS packet's payload, when
`payload_unit_start_indicator = 1`, the first bytes are a PES packet
header:

```
offset   bytes   field
 0        3     packet_start_code_prefix         always 0x00 0x00 0x01
 3        1     stream_id                        0xE0..0xEF = video; 0xC0..0xDF = audio; etc.
 4        2     PES_packet_length                u16; bytes following this field; 0 = unbounded (video only)
 6        1     '10' marker (2 bits) + PES_scrambling (2) + PES_priority + data_alignment + copyright + original_or_copy
 7        1     PTS_DTS_flags (2 bits) + ESCR + ES_rate + DSM_trick + additional_copy + PES_CRC + PES_extension
 8        1     PES_header_data_length           bytes of optional fields that follow before payload
 9       ...   optional fields                   PTS, DTS, ESCR, ... per the flags
N        ...   payload                          actual ES bytes (Annex-B NAL units or ADTS frames in our scope)
```

Computed PES payload start = `9 + PES_header_data_length`.

### PTS / DTS encoding (5 bytes each)

When `PTS_DTS_flags` is `10`, only PTS follows. When it is `11`, PTS
then DTS follow (10 bytes total). Each timestamp is 33 bits split
across 5 bytes with marker bits:

```
byte 0:   0010 PPP1     (high 3 bits of 33-bit PTS, marker bit = 1)
                        (when DTS also present, the leading nibble of PTS is 0011, of DTS is 0001)
byte 1:   PPPP PPPP     (mid-high 8 bits)
byte 2:   PPPP PPP1     (mid 7 bits, marker = 1)
byte 3:   PPPP PPPP     (mid-low 8 bits)
byte 4:   PPPP PPP1     (low 7 bits, marker = 1)
```

Combined value is on a 90 kHz clock; convert to microseconds for
WebCodecs by `Math.round(pts * 1_000_000 / 90_000)` (= `pts * 100 /
9`, careful with `Number` precision for streams > ~26 hours).

### Codec-specific PES payloads

- **AVC (H.264)**: PES payload is one or more NAL units in **Annex-B
  byte-stream** framing. Each NAL is preceded by the start code
  `0x00 0x00 0x01` (3-byte) or `0x00 0x00 0x00 0x01` (4-byte). For
  WebCodecs we must convert to **length-prefixed** AVCC framing
  (4-byte big-endian length per NAL). SPS / PPS NAL units (types 7
  and 8) appear inline before keyframes; we extract the most recent
  SPS+PPS to synthesize an `AVCDecoderConfigurationRecord` description
  for the WebCodecs `VideoDecoder.configure({ description })` call.
- **AAC ADTS**: PES payload is one or more **ADTS frames**. Each
  frame begins with the 12-bit ADTS sync `0xFFF`, then a 7-byte (or
  9-byte if `protection_absent = 0`) header, then the raw_data_block.
  We hand off to `container-aac`'s ADTS parser to derive the
  `AudioSpecificConfig` for the WebCodecs description and to strip the
  ADTS header before submitting raw access units to `AudioDecoder`.

## Key types we will model

```ts
interface TsPacketHeader {
  pid: number;                          // 0x0000..0x1FFF
  payloadUnitStart: boolean;
  transportError: boolean;
  scrambling: 0 | 1 | 2 | 3;            // first pass: must be 0
  adaptationFieldControl: 1 | 2 | 3;    // 0 is reserved/illegal
  continuityCounter: number;            // 0..15
}

interface TsAdaptationField {
  /** Decoded for telemetry; first pass does not act on it. */
  pcrBase?: number;        // 33-bit
  pcrExtension?: number;   // 9-bit
  discontinuityIndicator: boolean;
  randomAccessIndicator: boolean;
  /** Total adaptation field length including length byte. */
  totalLength: number;
}

interface TsPacket {
  header: TsPacketHeader;
  adaptation?: TsAdaptationField;
  /** Payload slice (may be empty if adaptation_field_control == 10). */
  payload: Uint8Array;
  /** Byte offset of the packet start in the source buffer. */
  fileOffset: number;
}

interface TsPsiSection {
  tableId: number;
  tableIdExtension: number;
  versionNumber: number;
  sectionNumber: number;
  lastSectionNumber: number;
  /** Section body excluding the 8-byte generic header and the 4-byte CRC trailer. */
  body: Uint8Array;
}

interface TsProgramStream {
  pid: number;
  streamType: number;                   // 0x1B = AVC, 0x0F = AAC, ...
  esInfoDescriptors: Uint8Array;        // raw; not parsed in first pass
  unsupported: boolean;                 // true for stream types we don't decode
}

interface TsProgram {
  programNumber: number;
  pmtPid: number;
  pcrPid: number;
  streams: TsProgramStream[];
}

interface TsPesPacket {
  pid: number;
  streamId: number;                     // 0xE0..0xEF or 0xC0..0xDF in our scope
  ptsUs?: number;                       // microseconds
  dtsUs?: number;                       // microseconds (defaults to PTS when absent)
  /** PES payload (Annex-B NAL bytes or ADTS frame bytes). */
  payload: Uint8Array;
  /** Source TS packet offsets that contributed (for debugging / round-trip). */
  sourcePacketOffsets: number[];
}

interface TsFile {
  pat: { transportStreamId: number; programs: Array<{ programNumber: number; pmtPid: number }> };
  program: TsProgram;                   // first pass: exactly one
  /** Reassembled PES packets in stream order (mixed PIDs). */
  pesPackets: TsPesPacket[];
  /** Total raw-packet count seen, for telemetry. */
  packetCount: number;
}

export function parseTs(input: Uint8Array): TsFile;
export function serializeTs(file: TsFile): Uint8Array;

export function* iterateVideoChunks(file: TsFile): Generator<EncodedVideoChunkInit>;
export function* iterateAudioChunks(file: TsFile): Generator<EncodedAudioChunkInit>;
```

## Demuxer (read) algorithm

1. **Sync acquisition**: starting at offset 0, look for `0x47` at
   `offset`, `offset + 188`, and `offset + 376`. If all three match,
   adopt this offset as packet boundary. Otherwise advance one byte
   and retry. Cap the scan at 1 MiB (Trap #1).
2. **Packet loop**: while `offset + 188 <= input.length`:
   a. Read 4-byte header. Verify `sync_byte == 0x47`; if not, restart
      sync acquisition from `offset + 1`.
   b. Decode header bits. If `transport_error_indicator`, skip the
      packet (Trap #12). If `transport_scrambling_control != 0`,
      throw `TsScrambledNotSupportedError` (Trap #13). If
      `adaptation_field_control == 0`, throw
      `TsReservedAdaptationControlError`.
   c. If adaptation present, read 1-byte `adaptation_field_length`.
      Validate `<= 183` (Trap #4) and `+ 1 <= 184`. Decode PCR if
      `PCR_flag` is set; record discontinuity / random-access bits.
   d. If payload present, slice payload bytes (= `188 - 4 -
      adaptation_total`).
   e. Increment `packetCount`; cap at `MAX_PACKETS = 1,200,000`
      (Trap: pathological input).
   f. Update continuity-counter tracker per PID; record discontinuity
      events as warnings (Trap #2).
   g. Dispatch on PID:
      - PID `0x0000` → feed to PAT section assembler.
      - PID matches the program's PMT PID (after PAT seen) → feed to
        PMT section assembler.
      - PID matches a known ES PID → feed to PES reassembler for that
        PID.
      - Other PIDs → ignored.
   h. Advance `offset += 188`.
3. **PSI section assembler** (per PID): on `payload_unit_start = 1`,
   read `pointer_field`, skip its bytes, and start a new section
   buffer. Read `section_length` from the next 3 bytes; expected
   total section length = `3 + section_length` (the `section_length`
   field counts everything after itself). Append payload bytes;
   continue across packets (`payload_unit_start = 0`, no
   pointer_field) until accumulated bytes reach the expected length.
   Validate CRC-32 over the whole section (Trap #8). Decode
   table-specific body.
4. **PAT decode**: validate `table_id == 0x00`. Iterate program
   entries; skip `program_number == 0` (NIT pointer). If exactly one
   non-zero entry, record its `pmtPid`. Else throw
   `TsMultiProgramNotSupportedError`.
5. **PMT decode**: validate `table_id == 0x02`,
   `tableIdExtension == programNumber`. Skip
   `program_info_descriptors`. Walk ES loop; for each entry record
   `(stream_type, elementary_PID)`. Mark unknown stream types
   `unsupported = true`. Cap ES count at `MAX_ES_PIDS = 16`
   (Trap: pathological PMT).
6. **PES reassembler** (per ES PID): when
   `payload_unit_start_indicator = 1`, **flush the in-flight PES**
   for this PID (it is now complete) and start a new buffer.
   Append payload bytes from each subsequent packet (with
   `payload_unit_start_indicator = 0`) to the current buffer. The PES
   ends either when:
   - the in-flight `PES_packet_length` (read from header bytes 4..5)
     is non-zero and the buffer has reached `6 + length` bytes
     (bounded case), OR
   - a new `payload_unit_start_indicator = 1` arrives on the same PID
     (unbounded video case — Trap #5), OR
   - the input stream ends.
7. **PES decode** (called on flush): validate
   `packet_start_code_prefix == 0x00 0x00 0x01`. Decode
   `PTS_DTS_flags`, then PTS / DTS via the bit-fragment scheme
   (Trap #6) — convert from 90 kHz to microseconds. Set the payload
   slice = bytes after the optional-header region.
8. **Codec post-processing** (called per ES PID after PES decode):
   - For AVC: split payload on Annex-B start codes (3-byte and 4-byte
     forms — Trap #9). Convert each NAL to AVCC by prepending a
     4-byte big-endian length. Capture SPS (NAL type 7) and PPS
     (type 8) seen so far; derive
     `AVCDecoderConfigurationRecord` for the WebCodecs description.
     Mark chunk as keyframe if any IDR (type 5) is present in the
     access unit.
   - For AAC: parse ADTS frames using the shared helper. Concatenate
     raw_data_blocks into a single `EncodedAudioChunk` payload (one
     per PES is the common case).
9. **Validation**: if no PAT was ever seen, throw `TsMissingPatError`.
   If PAT seen but PMT not seen within `MAX_PSI_WAIT_PACKETS = 500`
   subsequent packets, throw `TsMissingPmtError`.
10. Return `TsFile`.

## Muxer (write) algorithm

1. Accept a `TsFile` produced by the parser (or constructed by higher
   layers). Reject inputs with multi-program PAT, scrambled streams,
   or ES counts beyond the cap.
2. **Plan the PID assignments**: keep the input's PIDs verbatim if
   present; otherwise allocate PMT PID = `0x1000`, video ES PID =
   `0x0100`, audio ES PID = `0x0101` (HLS-style defaults).
3. **Pre-emit PSI**:
   a. Build the PAT section body (one program entry pointing at the
      PMT PID). Compute and append CRC-32.
   b. Build the PMT section body (PCR_PID = video PID; one ES entry
      per stream). Compute and append CRC-32.
   c. Pad each to a multiple of 184 bytes' worth of PSI payload
      after accounting for the 1-byte `pointer_field` on the first
      packet.
4. **Per-PID continuity counters**: initialise each PID's counter
   to 0. Increment **only** for packets carrying payload
   (`adaptation_field_control & 0b01`), wrap mod 16 (Trap #2).
5. **Packet emission loop**: emit packets in this order at the head
   of the file:
   - 1+ packets carrying the PAT section (PID `0x0000`,
     `payload_unit_start_indicator = 1` on first packet, with
     `pointer_field = 0`)
   - 1+ packets carrying the PMT section (PID = PMT PID)
   - then PES bodies, interleaved by PID. For each PES:
     * Build the PES header in a temporary buffer.
     * For AVC, convert the AVCC chunk back to Annex-B (re-insert
       4-byte start codes; if SPS/PPS are stored separately as
       description, prepend them on the keyframe access unit) —
       Trap #9 in reverse.
     * For AAC, prepend the ADTS header derived from the
       AudioSpecificConfig (sample rate, channel config) per access
       unit.
     * Chunk the resulting bytes into 184-byte (or smaller, if
       adaptation field carries PCR) payload slices.
     * On the first chunk of the PES, set
       `payload_unit_start_indicator = 1`; on continuations, 0.
     * Refresh PCR every `PCR_REFRESH_INTERVAL_PACKETS` (~ 100ms
       worth, ~ 50 packets at typical bitrates) by emitting an
       adaptation field with `PCR_flag = 1` on the video PID.
     * If the final chunk underfills 184 bytes, **prepend** an
       adaptation field containing stuffing bytes (Trap #4) so the
       packet remains 188 bytes.
6. **Repeat PAT + PMT** every `PSI_REFRESH_INTERVAL_PACKETS` (~ 100
   packets) for tune-in-mid-stream compatibility.
7. Concatenate all packets and return.

We do **not** attempt byte-identical round-trip. Continuity counter
restart values, stuffing distribution, PCR refresh placement, and PSI
refresh interval are all implementation-defined; the spec only
mandates that the demuxer can recover the same logical content.

## WebCodecs integration

- **Decode (video — H.264)**: build the WebCodecs codec string from
  the SPS bytes: `avc1.<profile_idc>.<constraint_set_flags>.<level_idc>`
  rendered as 6 hex digits (e.g. SPS profile 100 / flags 0 / level 40
  → `avc1.640028`). Configure `VideoDecoder` with `description =
  AVCDecoderConfigurationRecord` synthesised from the captured SPS +
  PPS. For each access unit, submit an `EncodedVideoChunk` with
  `type: 'key'` (IDR present) or `'delta'`, `timestamp =
  ptsUs`, `duration = (next.dtsUs - this.dtsUs)` (or fall back to
  `1_000_000 / 30` when only one chunk). `data` is the AVCC-converted
  bytes.
- **Decode (audio — AAC)**: codec string `mp4a.40.<aot>` derived from
  the first 5 bits of the AudioSpecificConfig (LC = 2 → `mp4a.40.2`).
  Configure `AudioDecoder` with `description = AudioSpecificConfig`
  bytes. For each ADTS frame, submit `EncodedAudioChunk` with `type:
  'key'`, `timestamp = ptsUs + frameOffsetUs` (multiple ADTS frames
  in one PES share a base PTS — derive per-frame offset from the
  cumulative sample count and sample rate). `data` is the raw
  access unit (ADTS header stripped).
- **Encode**: `TsBackend.canHandle` returns `false` for encode in
  Phase 1 — TS muxing for newly-encoded content is Phase 3.5+ work;
  the BackendRegistry's fallback chain routes encode requests to
  `@catlabtech/webcvt-backend-wasm` (ffmpeg.wasm).
- **Probe**: call `probeVideoCodec({ codec: 'avc1.640028', codedWidth,
  codedHeight })` and `probeAudioCodec({ codec: 'mp4a.40.2',
  sampleRate, numberOfChannels })` before submitting the first chunk
  of each stream.

## Test plan

- `acquires sync at offset 0 when fixture starts with 0x47 cleanly`
- `recovers sync when fixture has 11-byte garbage prefix before first 0x47`
- `does NOT mistake 0x47 inside an AVC NAL unit for a packet boundary (Trap #1)`
- `parses PAT at PID 0x0000 with single program`
- `rejects PAT with two non-zero programs (TsMultiProgramNotSupportedError)`
- `parses PMT and extracts video PID + audio PID with stream types 0x1B and 0x0F`
- `marks unsupported stream types (e.g. 0x81 AC-3) as unsupported = true without throwing`
- `verifies PSI CRC-32 over PAT and PMT sections (poly 0x04C11DB7, init 0xFFFFFFFF)`
- `rejects PSI section with corrupted CRC-32`
- `reassembles PES across 4 TS packets correctly (Trap #5 unbounded video case)`
- `decodes PTS-only PES (PTS_DTS_flags = 10)`
- `decodes PTS+DTS PES (PTS_DTS_flags = 11) with PTS != DTS`
- `decodes 33-bit PTS at the high-bit boundary (~ 26.5h) without precision loss`
- `tracks continuity counter wrap mod 16 per PID without false discontinuity`
- `warns (does not throw) on continuity discontinuity at stream boundary`
- `tolerates adaptation-only packet (control = 10) with 183-byte stuffing`
- `splits Annex-B AVC payload into NAL units at both 3-byte and 4-byte start codes`
- `synthesises AVCDecoderConfigurationRecord from captured SPS + PPS`
- `parses ADTS header and derives AudioSpecificConfig matching container-aac`
- `rejects scrambled packet (transport_scrambling_control != 0) with TsScrambledNotSupportedError`
- `rejects packet with adaptation_field_control = 00 (reserved)`
- `enforces 200 MiB input cap and MAX_PACKETS = 1,200,000`
- `round-trip semantic equivalence: parse → serialize → parse yields identical PES list (PTS, DTS, payloads)`

## Known traps

1. **Sync byte 0x47 can appear inside PES payloads** — especially
   inside AVC NAL units where the byte sequences `0x00 0x00 0x01 0x47
   ...` and `0x00 0x00 0x47 ...` occur naturally. The reader MUST
   trust packet boundaries derived from the stream offset, not search
   for `0x47`. When **acquiring** sync (start of file or post-error),
   validate by checking that `offset + 188`, `offset + 376`, and
   ideally `offset + 564` also have `0x47`. Triple-anchor confirmation
   keeps false-positive rate under one-in-2-billion for random data.
2. **Continuity counter wraps mod 16** (4-bit field). The CC
   increments **only** when the packet carries payload — i.e. when
   `adaptation_field_control & 0b01` is set (`01` or `11`). Packets
   with adaptation-only (`10`) repeat the previous CC value. A
   discontinuity is `expected_cc != actual_cc` for a payload-bearing
   packet on the same PID. Discontinuities are common at HLS segment
   boundaries and at upstream tuner glitches; emit a warning, do not
   throw.
3. **`adaptation_field_control` is bits 5-4 of byte 3** of the TS
   header. Encoding: `00 = reserved (illegal)`, `01 = payload only`,
   `10 = adaptation only, no payload`, `11 = adaptation + payload`.
   The order on the wire when `11` is **adaptation field FIRST, then
   payload**. Easy traps: mis-shifting bits (these are bits 5-4 in
   MSB-first numbering, i.e. mask `0x30`, shift `>> 4`); reading the
   payload before the adaptation field; treating `00` as a valid
   "neither" case (it is reserved and must be rejected).
4. **`adaptation_field_length` is the FIRST byte of the adaptation
   section, NOT including itself**. So an adaptation-only packet
   (`control == 10`) has length byte at offset 4 with value `183`
   (= 188 - 4 - 1), and stuffing bytes (`0xFF`) fill the unused
   interior. An adaptation+payload packet (`control == 11`) with a
   2-byte adaptation field has length byte = `1` (just the flags
   byte), and 183 bytes of payload follow. Mis-counting (off-by-one
   on length-includes-itself) shifts every subsequent payload byte by
   one and produces total chaos downstream.
5. **`PES_packet_length` is 16 bits (max 65,535)** and **MAY be 0 for
   video PES**. ISO/IEC 13818-1 §2.4.3.7 explicitly allows
   `PES_packet_length = 0` for video PES streams to mean "unbounded —
   the PES ends when the next PES begins on the same PID" (signaled
   by a fresh `payload_unit_start_indicator = 1`). This is the common
   case for HLS-style AVC PES. The reader must support **both** the
   bounded form (length non-zero, terminate at `6 + length` bytes)
   and the unbounded form (length zero, terminate on next PUS).
6. **PTS / DTS encoding is bit-fragmented across 5 bytes**: the
   33-bit value is split as `3 + 15 + 15` with 1-bit marker
   bits between groups (and a 4-bit prefix nibble identifying the
   timestamp). The marker bits are always `1` and must be validated
   on read but ignored when reconstructing the value. Easy errors:
   forgetting to strip the markers; mis-masking the prefix nibble;
   off-by-one on the bit positions of the 15-bit groups. The prefix
   nibble distinguishes the cases: `0010` = PTS-only PTS; `0011` =
   PTS-of-(PTS+DTS-pair); `0001` = DTS-of-(PTS+DTS-pair). A common
   bug is to ignore the prefix and accept any marker, missing
   corruption.
7. **PSI sections span multiple TS packets**, and the section header
   is at the FIRST packet (with `payload_unit_start_indicator = 1`
   and a leading `pointer_field` byte). Continuations have
   `payload_unit_start_indicator = 0` and no `pointer_field`. A
   packet with `payload_unit_start_indicator = 1` may even contain
   the **last bytes of the previous section** in `pointer_field`
   bytes, then a new section header — the `pointer_field` value is
   the number of bytes to skip from the start of the payload to
   reach the new section start. Most real-world TS uses
   `pointer_field = 0` and one section per packet, but the reader
   MUST handle the general case.
8. **PSI section CRC-32 polynomial is `0x04C11DB7`** with **init
   `0xFFFFFFFF`**, **non-reflected** input and output (a.k.a.
   "MPEG-2 CRC-32"). This is the same polynomial as Ogg, but Ogg
   uses init `0x00000000` and DIFFERENT bit ordering. Wiring
   together a generic CRC-32 helper from another container without
   re-checking the init / reflection settings produces silent
   integrity failures. The CRC covers all bytes of the PSI section
   from `table_id` through (but not including) the trailing 4 CRC
   bytes; the result is appended big-endian.
9. **AVC over MPEG-TS uses Annex-B framing** (NAL units prefixed by
   `0x00 0x00 0x01` or `0x00 0x00 0x00 0x01`), NOT the AVCC
   length-prefixed framing used in MP4 / MKV. WebCodecs expects
   AVCC. Conversion algorithm: scan the PES payload for start codes,
   carve out each NAL, and prepend a 4-byte big-endian length per
   NAL into a new buffer. **Do not** confuse the start code with
   "emulation prevention bytes" inside NAL payloads: the byte
   sequence `0x00 0x00 0x03` inside a NAL is an inserted
   prevention byte where the encoder wanted to write `0x00 0x00
   0x00`, `0x00 0x00 0x01`, `0x00 0x00 0x02`, or `0x00 0x00 0x03` —
   the prevention byte does NOT terminate the NAL. The start-code
   scanner must look for `0x00 0x00 0x01` only after at least one
   non-`0x00` byte (or at PES payload start), never inside a NAL.
10. **AAC over MPEG-TS uses ADTS framing** (7-byte ADTS header per
    access unit, same format as `.aac` files), NOT the raw access
    units used in MP4 (`mp4a` sample entry with description from
    `esds`). The PES payload is one or more ADTS frames concatenated.
    Reader can hand off to `container-aac`'s ADTS parser inline;
    plan to share the AAC-LC AudioSpecificConfig derivation helper
    in a future `packages/codec-aac/src/asc.ts` (cross-referenced
    in `container-mp4` Trap #11 and `container-mkv`).
11. **PCR (Program Clock Reference) is in the adaptation field**
    with a special encoding: the 33-bit base × 90 kHz, then **6
    reserved bits**, then 9-bit extension × 27 MHz. Combined into a
    42-bit physical timestamp. The reserved 6 bits between base and
    extension are MUST-be-1, and must be skipped — easy to read the
    extension off-by-6-bits otherwise. First-pass decodes PCR for
    informational purposes; doesn't drive any PTS adjustment.
12. **`transport_error_indicator` bit** (byte 1, bit 7) is set by
    upstream demuxers/tuners to signal an unrecoverable channel
    error in this packet. The packet MUST be skipped; never decode
    its payload. Continuity counter on the affected PID will likely
    show a discontinuity at the next valid packet — that is
    expected, do not double-warn.
13. **`transport_scrambling_control` field** (byte 3, bits 7-6):
    `00` = clear; `01`/`10`/`11` = scrambled by even/odd/reserved
    keys (CSA / DVB-CSA / AES). First pass rejects scrambled streams
    by throwing `TsScrambledNotSupportedError` at the offending
    packet. Do NOT attempt to "skip and continue" — once scrambling
    is in use, downstream PSI / PES integrity is lost.
14. **PMT `program_info_length` and `ES_info_length` upper 4 bits are
    reserved (`0b1111`) and must be masked off** before reading the
    12-bit length. Real-world muxers vary in whether they zero or
    set these reserved bits; reading the full 16-bit field as length
    yields garbage values up to 65,535 and triggers spurious "section
    overflow" errors. Mask with `0x0FFF`.
15. **Stream type 0x06 is "PES private data"** and is ambiguous —
    its payload could be DVB subtitles, AC-3 (when accompanied by an
    `AC3_descriptor`), Teletext, or arbitrary private data. The
    correct interpretation depends on walking the ES descriptors
    in the PMT entry. First pass marks 0x06 as `unsupported = true`
    and skips its packets; do not attempt heuristic detection.
16. **PSI section size is `section_length + 3`** (the
    `section_length` field counts everything **after itself**, i.e.
    after byte 3, including the CRC-32 trailer). The total section
    on the wire including the 1-byte `pointer_field` therefore
    occupies `1 + 3 + section_length` payload bytes on the first
    packet (plus continuation bytes). Off-by-three errors here cause
    the CRC to be computed over the wrong byte range and validation
    to fail on every section.
17. **`payload_unit_start_indicator` semantics differ for PSI vs
    PES PIDs**. On a PES PID, `PUS = 1` means "this packet contains
    the start of a new PES packet". On a PSI PID, `PUS = 1` means
    "this packet contains the start of a new PSI section, and the
    first byte of payload is a `pointer_field`". The reader must
    branch on whether the PID is a known PSI PID before interpreting
    the first payload bytes — otherwise it will treat the
    `pointer_field` as a PES `packet_start_code_prefix` byte and
    fail validation.
18. **Big-endian everywhere**: all multi-byte fields in TS, PSI, and
    PES headers are big-endian. The 13-bit PID crosses bytes 1-2
    with the bottom 5 bits of byte 1 and all 8 bits of byte 2 —
    extracting it as `((header[1] & 0x1F) << 8) | header[2]` is the
    one-liner; reading byte 2 alone is a common slip.

## Security caps

- 200 MiB input cap in parser entry (`MAX_INPUT_BYTES`).
- Packet count cap: 200 MiB / 188 ≈ 1.06M; use `MAX_PACKETS =
  1_200_000` (small headroom over the input cap).
- PSI section size cap: `MAX_PSI_SECTION_BYTES = 4096` (spec maximum
  for PAT/PMT is 1024; SI tables go to 4096; use 4096 for headroom).
- Distinct PSI PID count cap: `MAX_PSI_PIDS = 64` (legitimate TS
  files have 1 PAT PID + 1-2 PMT PIDs).
- ES PID count per program cap: `MAX_ES_PIDS = 16` (legitimate
  streams have 1 video + 1-2 audio + maybe subtitles ≤ 4).
- PES packet size cap: `MAX_PES_BYTES = 16 * 1024 * 1024` (16 MiB
  per PES — a single AVC keyframe + slices is unlikely to exceed
  ~ 1 MiB; 16 MiB is a generous fail-safe).
- Continuity discontinuity warning threshold: 100 per PID. Past that,
  emit one warning per 1,000.
- `adaptation_field_length` validated `<= 183`.
- `pointer_field` validated `<= 182` (must leave room for at least
  the 8-byte PSI generic header in the same packet).
- Sync-acquisition forward scan capped at 1 MiB
  (`MAX_SYNC_SCAN_BYTES`); past that, throw `TsNoSyncByteError`.
- All multi-byte length fields validated against `claimed <=
  remaining_bytes` BEFORE any allocation.

## LOC budget breakdown

| File | LOC est. |
|---|---|
| `packet.ts` (188-byte header decode, adaptation-field decode, sync detection) | 150 |
| `psi.ts` (PSI section reassembly across TS packets, CRC-32 verification) | 120 |
| `pat.ts` (PAT body parser; single-program enforcement) | 60 |
| `pmt.ts` (PMT body parser; ES descriptor walk) | 100 |
| `pes.ts` (PES header parse, PTS/DTS bit-fragment decode, payload reassembly across packets) | 150 |
| `nal-conversion.ts` (Annex-B → AVCC for WebCodecs; SPS/PPS capture; AVCDecoderConfigurationRecord synthesis) | 80 |
| `crc32.ts` (non-reflected CRC-32 with init 0xFFFFFFFF, lookup-table) | 50 |
| `parser.ts` (top-level: packet loop, PSI dispatch, PES reassembly per ES PID, validation) | 150 |
| `serializer.ts` (packet emission, continuity counter management, PSI/PCR refresh) | 150 |
| `chunk-iterator.ts` (parsed PES → EncodedAudioChunk / EncodedVideoChunk) | 100 |
| `backend.ts` (TsBackend; identity-only canHandle for first pass) | 80 |
| `errors.ts` (typed errors: scrambled, multi-program, missing PAT, no sync, ...) | 50 |
| `constants.ts` (caps, stream-type table, well-known PID constants) | 40 |
| `index.ts` (re-exports) | 40 |
| **total** | **~1,320** |
| tests | ~600 |

Headline plan.md budget for first-pass `container-ts`: ~1,000 LOC.
Realistic: ~1,320 with PES reassembly across both bounded and
unbounded forms, PSI assembler, and Annex-B ↔ AVCC conversion.
Acceptable overrun; everything beyond first-pass scope is deferred to
Phase 3.5.

## Implementation references (for the published README)

This package is implemented from ITU-T Rec. H.222.0 / ISO/IEC
13818-1 (Generic coding of moving pictures and associated audio:
Systems), ETSI EN 300 468 (DVB SI — referenced for descriptor tag
values reused in PMT, even though SI tables themselves are
deferred), ATSC A/53 Part 3 (referenced for stream-type
assignments), ITU-T Rec. H.264 / ISO/IEC 14496-10 Annex B (AVC
byte-stream format), ISO/IEC 14496-15 §5 (AVCDecoderConfigurationRecord,
needed for the WebCodecs `description`), and ISO/IEC 13818-7 (ADTS
framing). No code was copied from libavformat, mpegts.js, hls.js,
video.js, Bento4, or any other implementation. The AAC ADTS parser is
shared with `@catlabtech/webcvt-container-aac` (planned helper at
`packages/codec-aac/src/asc.ts`); the AVCDecoderConfigurationRecord
synthesis helper is shared with `@catlabtech/webcvt-container-mp4` and
`@catlabtech/webcvt-container-mkv`. Test fixtures derived from FFmpeg samples
(LGPL-2.1) live under `tests/fixtures/video/` and are not redistributed
in npm.
