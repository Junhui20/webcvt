/**
 * MPEG-TS serializer (muxer).
 *
 * Accepts a TsFile produced by parseTs and serializes it back to a valid
 * 188-byte MPEG-TS byte stream.
 *
 * Round-trip note (per design note §Muxer):
 * This serializer produces semantically equivalent output — same elementary
 * stream content, PTS/DTS timestamps, and codec parameters — but NOT
 * byte-identical to the input. Continuity counters restart at 0, stuffing
 * byte placement may differ, and PCR injection intervals are implementation-defined.
 *
 * Out of scope (Phase 3.5+): PCR-driven A/V resync, PSI refresh mid-stream,
 * adaptation field PCR for audio PIDs.
 */

import {
  DEFAULT_AUDIO_PID,
  DEFAULT_PMT_PID,
  DEFAULT_VIDEO_PID,
  PID_PAT,
  PSI_REFRESH_INTERVAL_PACKETS,
  STREAM_TYPE_AAC_ADTS,
  STREAM_TYPE_AVC,
  TABLE_ID_PAT,
  TABLE_ID_PMT,
  TS_PACKET_SIZE,
  TS_SYNC_BYTE,
} from './constants.ts';
import { computePsiCrc32 } from './crc32.ts';
import type { TsFile } from './parser.ts';
import type { TsPesPacket } from './pes.ts';
import type { TsProgram } from './pmt.ts';

// ---------------------------------------------------------------------------
// Continuity counter manager
// ---------------------------------------------------------------------------

type CcMap = Map<number, number>;

function nextCc(ccMap: CcMap, pid: number): number {
  const cc = (ccMap.get(pid) ?? 0) & 0x0f;
  ccMap.set(pid, (cc + 1) & 0x0f);
  return cc;
}

// ---------------------------------------------------------------------------
// TS packet emission helpers
// ---------------------------------------------------------------------------

/**
 * Build a single 188-byte TS packet.
 *
 * @param pid          PID value.
 * @param pusi         payload_unit_start_indicator.
 * @param cc           continuity_counter (0..15).
 * @param payload      Payload bytes (must be <= 184 bytes; padded with stuffing if needed).
 * @param withAdaptation  true to emit adaptation field with stuffing to fill to 188.
 */
function buildTsPacket(
  pid: number,
  pusi: boolean,
  cc: number,
  payload: Uint8Array,
  withAdaptation = false,
): Uint8Array {
  const pkt = new Uint8Array(TS_PACKET_SIZE);

  // Header
  pkt[0] = TS_SYNC_BYTE;
  pkt[1] = ((pusi ? 0x40 : 0x00) | ((pid >> 8) & 0x1f)) & 0xff;
  pkt[2] = pid & 0xff;

  const payloadRoom = TS_PACKET_SIZE - 4; // 184 bytes for adaptation + payload

  if (!withAdaptation) {
    // Pure payload (AFC=01): pad remainder with 0xFF (PSI stuffing)
    pkt[3] = (0x10 | (cc & 0x0f)) & 0xff; // AFC=01
    const take = Math.min(payload.length, payloadRoom);
    pkt.set(payload.subarray(0, take), 4);
    if (take < payloadRoom) {
      pkt.fill(0xff, 4 + take);
    }
  } else {
    // Adaptation + payload (AFC=11): adaptation field carries stuffing
    const stuffingNeeded = payloadRoom - payload.length;

    if (stuffingNeeded === 1) {
      // Need exactly 1 byte of adaptation = just the length byte (value 0)
      pkt[3] = (0x30 | (cc & 0x0f)) & 0xff; // AFC=11
      pkt[4] = 0x00; // adaptation_field_length = 0 (no flags byte)
      pkt.set(payload, 5);
    } else if (stuffingNeeded >= 2) {
      // adaptation_field_length byte + flags byte + (stuffingNeeded-2) stuffing bytes
      pkt[3] = (0x30 | (cc & 0x0f)) & 0xff; // AFC=11
      pkt[4] = (stuffingNeeded - 1) & 0xff; // length (not including itself)
      pkt[5] = 0x00; // flags byte (no PCR, no discontinuity, etc.)
      // Stuffing bytes = 0xFF
      pkt.fill(0xff, 6, 4 + stuffingNeeded);
      pkt.set(payload, 4 + stuffingNeeded);
    } else {
      // stuffingNeeded === 0: just use payload
      pkt[3] = (0x10 | (cc & 0x0f)) & 0xff; // AFC=01
      pkt.set(payload.subarray(0, payloadRoom), 4);
    }
  }

  return pkt;
}

// ---------------------------------------------------------------------------
// PSI section builder
// ---------------------------------------------------------------------------

/**
 * Build a PAT section body and emit as TS packets.
 * Returns the emitted packets.
 */
function buildPatPackets(
  transportStreamId: number,
  programNumber: number,
  pmtPid: number,
  ccMap: CcMap,
): Uint8Array[] {
  // PAT section body: one entry (4 bytes)
  // table_id=0x00, section_syntax_indicator=1, reserved=0b11
  // section_length = 9 (header extension 5 bytes + 4 entry bytes + 4 CRC bytes)
  const sectionLength = 5 + 4 + 4; // tableIdExtension(2) + version(1) + secNum(1) + lastSec(1) + entry(4) + crc(4)

  // Full section: 3 header bytes + sectionLength bytes
  const section = new Uint8Array(3 + sectionLength);
  let off = 0;

  section[off++] = TABLE_ID_PAT;
  section[off++] = 0xb0 | ((sectionLength >> 8) & 0x0f); // section_syntax_indicator=1, private=0, reserved=0b11
  section[off++] = sectionLength & 0xff;

  // table_id_extension (transport_stream_id)
  section[off++] = (transportStreamId >> 8) & 0xff;
  section[off++] = transportStreamId & 0xff;

  // reserved(11) | version_number(5) | current_next_indicator(1) = 0b11_00001_1 = 0xC3
  section[off++] = 0xc1; // version=0, current_next=1
  section[off++] = 0x00; // section_number
  section[off++] = 0x00; // last_section_number

  // Single program entry
  section[off++] = (programNumber >> 8) & 0xff;
  section[off++] = programNumber & 0xff;
  section[off++] = 0xe0 | ((pmtPid >> 8) & 0x1f); // reserved(111) | pmtPid[12:8]
  section[off++] = pmtPid & 0xff;

  // CRC-32
  const crc = computePsiCrc32(section.subarray(0, off));
  section[off++] = (crc >> 24) & 0xff;
  section[off++] = (crc >> 16) & 0xff;
  section[off++] = (crc >> 8) & 0xff;
  section[off++] = crc & 0xff;

  return emitPsiPackets(PID_PAT, section, ccMap);
}

/**
 * Build a PMT section body and emit as TS packets.
 */
function buildPmtPackets(program: TsProgram, ccMap: CcMap): Uint8Array[] {
  // Calculate section body size: 4 (PCR_PID + program_info_len) + sum of ES entries
  let esBodySize = 0;
  for (const stream of program.streams) {
    esBodySize += 5; // stream_type(1) + reserved+PID(2) + reserved+ES_info_len(2)
    // No ES_info descriptors in first-pass mux
  }

  const sectionLength = 5 + 4 + esBodySize + 4; // header ext (5) + PCR+progInfoLen(4) + es(n) + crc(4)
  const section = new Uint8Array(3 + sectionLength);
  let off = 0;

  section[off++] = TABLE_ID_PMT;
  section[off++] = 0xb0 | ((sectionLength >> 8) & 0x0f);
  section[off++] = sectionLength & 0xff;

  // table_id_extension = program_number
  section[off++] = (program.programNumber >> 8) & 0xff;
  section[off++] = program.programNumber & 0xff;

  section[off++] = 0xc1; // version=0, current_next=1
  section[off++] = 0x00; // section_number
  section[off++] = 0x00; // last_section_number

  // PCR_PID
  section[off++] = 0xe0 | ((program.pcrPid >> 8) & 0x1f);
  section[off++] = program.pcrPid & 0xff;

  // program_info_length = 0 (no program descriptors in first pass)
  section[off++] = 0xf0;
  section[off++] = 0x00;

  // ES loop
  for (const stream of program.streams) {
    section[off++] = stream.streamType & 0xff;
    section[off++] = 0xe0 | ((stream.pid >> 8) & 0x1f);
    section[off++] = stream.pid & 0xff;
    // ES_info_length = 0
    section[off++] = 0xf0;
    section[off++] = 0x00;
  }

  // CRC-32
  const crc = computePsiCrc32(section.subarray(0, off));
  section[off++] = (crc >> 24) & 0xff;
  section[off++] = (crc >> 16) & 0xff;
  section[off++] = (crc >> 8) & 0xff;
  section[off++] = crc & 0xff;

  return emitPsiPackets(program.pmtPid, section, ccMap);
}

/**
 * Emit PSI section bytes as one or more TS packets.
 * First packet has PUSI=1 and a pointer_field=0x00.
 */
function emitPsiPackets(pid: number, sectionBytes: Uint8Array, ccMap: CcMap): Uint8Array[] {
  const packets: Uint8Array[] = [];
  const MAX_PSI_PAYLOAD = 183; // 184 - 1 (pointer_field on first packet)

  // First packet: pointer_field (1 byte) + up to 183 bytes of section
  const firstPayloadSize = Math.min(sectionBytes.length, MAX_PSI_PAYLOAD);
  const firstPayload = new Uint8Array(1 + firstPayloadSize);
  firstPayload[0] = 0x00; // pointer_field = 0
  firstPayload.set(sectionBytes.subarray(0, firstPayloadSize), 1);

  const cc0 = nextCc(ccMap, pid);
  // PSI sections always use AFC=01 (payload-only) with 0xFF stuffing — no adaptation field
  packets.push(buildTsPacket(pid, true, cc0, firstPayload, false));

  // Continuation packets
  let cursor = firstPayloadSize;
  while (cursor < sectionBytes.length) {
    const chunk = sectionBytes.subarray(cursor, cursor + 184);
    const cc = nextCc(ccMap, pid);
    packets.push(buildTsPacket(pid, false, cc, chunk, false));
    cursor += 184;
  }

  return packets;
}

// ---------------------------------------------------------------------------
// PES header builder
// ---------------------------------------------------------------------------

/**
 * Build a PES packet header bytes.
 *
 * @param streamId    PES stream_id byte.
 * @param payloadLen  Payload byte count (0 for unbounded video).
 * @param ptsUs       PTS in microseconds (optional).
 * @param dtsUs       DTS in microseconds (optional, only when != ptsUs).
 */
function buildPesHeader(
  streamId: number,
  payloadLen: number,
  ptsUs?: number,
  dtsUs?: number,
): Uint8Array {
  const hasPts = ptsUs !== undefined;
  const hasDts = dtsUs !== undefined && dtsUs !== ptsUs;
  const optionalLen = hasPts ? (hasDts ? 10 : 5) : 0;

  // Fixed PES header: 9 bytes
  const headerSize = 9 + optionalLen;
  const header = new Uint8Array(headerSize);

  // packet_start_code_prefix
  header[0] = 0x00;
  header[1] = 0x00;
  header[2] = 0x01;
  header[3] = streamId;

  // PES_packet_length: length after this field = headerSize - 6 + payloadLen
  const pesLen = headerSize - 6 + payloadLen;
  // For video, use 0 when payload is unbounded (0 stored as per spec)
  const pesLenField = payloadLen === 0 ? 0 : Math.min(pesLen, 0xffff);
  header[4] = (pesLenField >> 8) & 0xff;
  header[5] = pesLenField & 0xff;

  // Marker bits + flags: '10' | scrambling=00 | priority=0 | alignment=0 | copyright=0 | original=0
  header[6] = 0x80;

  // PTS_DTS_flags: 10=PTS-only, 11=PTS+DTS, 00=none
  const ptsDtsFlags = hasPts ? (hasDts ? 0x03 : 0x02) : 0x00;
  header[7] = (ptsDtsFlags << 6) & 0xff;

  // PES_header_data_length
  header[8] = optionalLen & 0xff;

  if (hasPts) {
    const pts90 = Math.round(((ptsUs as number) * 9) / 100);
    const ptsPrefixNibble = hasDts ? 0b0011 : 0b0010;
    encodePtsDts(header, 9, pts90, ptsPrefixNibble);
  }

  if (hasDts) {
    const dts90 = Math.round(((dtsUs as number) * 9) / 100);
    encodePtsDts(header, 14, dts90, 0b0001);
  }

  return header;
}

function encodePtsDts(buf: Uint8Array, offset: number, value90kHz: number, prefix: number): void {
  // 33-bit value split as 3 + 15 + 15 with marker bits
  const part0 = (value90kHz / 0x40000000) & 0x07; // bits [32:30]
  const part1 = (value90kHz >> 15) & 0x7fff; // bits [29:15]
  const part2 = value90kHz & 0x7fff; // bits [14:0]

  buf[offset] = ((prefix & 0x0f) << 4) | ((part0 & 0x07) << 1) | 0x01;
  buf[offset + 1] = (part1 >> 7) & 0xff;
  buf[offset + 2] = ((part1 & 0x7f) << 1) | 0x01;
  buf[offset + 3] = (part2 >> 7) & 0xff;
  buf[offset + 4] = ((part2 & 0x7f) << 1) | 0x01;
}

// ---------------------------------------------------------------------------
// PES → TS packet emission
// ---------------------------------------------------------------------------

/**
 * Emit a PES packet as one or more TS packets.
 * First chunk has PUSI=1; continuations have PUSI=0.
 */
function emitPesPackets(
  pid: number,
  streamId: number,
  payload: Uint8Array,
  ptsUs: number | undefined,
  dtsUs: number | undefined,
  ccMap: CcMap,
): Uint8Array[] {
  const packets: Uint8Array[] = [];

  // Video ES: use PES_packet_length=0 (unbounded); audio: use actual length
  const isVideo = (streamId & 0xf0) === 0xe0;
  const pesHeader = buildPesHeader(streamId, isVideo ? 0 : payload.length, ptsUs, dtsUs);

  // Combine PES header + payload
  const combined = new Uint8Array(pesHeader.length + payload.length);
  combined.set(pesHeader, 0);
  combined.set(payload, pesHeader.length);

  const CHUNK_SIZE = 184;
  let cursor = 0;
  let first = true;

  while (cursor < combined.length) {
    const chunk = combined.subarray(cursor, cursor + CHUNK_SIZE);
    const cc = nextCc(ccMap, pid);
    packets.push(buildTsPacket(pid, first, cc, chunk, chunk.length < CHUNK_SIZE));
    cursor += CHUNK_SIZE;
    first = false;
  }

  return packets;
}

// ---------------------------------------------------------------------------
// Main serializer entry point
// ---------------------------------------------------------------------------

/**
 * Serialize a TsFile back to a 188-byte MPEG-TS byte stream.
 *
 * Round-trip semantic equivalence (NOT byte-identical):
 * - Continuity counters start at 0
 * - Stuffing byte placement is implementation-defined
 * - PCR refresh interval is implementation-defined
 * - PSI refresh every PSI_REFRESH_INTERVAL_PACKETS packets
 *
 * @param file TsFile produced by parseTs or constructed by higher layers.
 */
export function serializeTs(file: TsFile): Uint8Array {
  const { program, pesPackets } = file;

  // Determine PID assignments: keep input PIDs if present, else use defaults
  const pmtPid = program.pmtPid > 0 ? program.pmtPid : DEFAULT_PMT_PID;
  const transportStreamId = file.pat.transportStreamId;
  const programNumber = program.programNumber;

  // Normalise program with potentially-updated PMT PID
  const muxProgram: TsProgram = {
    ...program,
    pmtPid,
    streams: program.streams.map((s) => {
      // Map PIDs: keep originals if valid, else use defaults
      let pid = s.pid;
      if (pid <= 0) {
        if (s.streamType === STREAM_TYPE_AVC) pid = DEFAULT_VIDEO_PID;
        else if (s.streamType === STREAM_TYPE_AAC_ADTS) pid = DEFAULT_AUDIO_PID;
      }
      return { ...s, pid };
    }),
  };

  // PCR PID: use video PID if available
  const videoPid =
    muxProgram.streams.find((s) => s.streamType === STREAM_TYPE_AVC)?.pid ?? muxProgram.pcrPid;
  const normalizedProgram: TsProgram = { ...muxProgram, pcrPid: videoPid };

  // Per-PID continuity counters
  const ccMap: CcMap = new Map();

  const allPackets: Uint8Array[] = [];

  // Pre-emit PSI
  const patPackets = buildPatPackets(transportStreamId, programNumber, pmtPid, ccMap);
  const pmtPackets = buildPmtPackets(normalizedProgram, ccMap);

  for (const pkt of patPackets) allPackets.push(pkt);
  for (const pkt of pmtPackets) allPackets.push(pkt);

  let psiRefreshCounter = 0;

  // Emit PES packets
  for (const pes of pesPackets) {
    // Find the stream_id from the program
    const stream = normalizedProgram.streams.find((s) => s.pid === pes.pid);
    const pid = pes.pid;
    const streamId = pes.streamId;

    // Skip unsupported streams
    if (stream?.unsupported) continue;

    const pesPacketList = emitPesPackets(pid, streamId, pes.payload, pes.ptsUs, pes.dtsUs, ccMap);

    for (const pkt of pesPacketList) {
      allPackets.push(pkt);
    }

    // PSI refresh
    psiRefreshCounter++;
    if (psiRefreshCounter >= PSI_REFRESH_INTERVAL_PACKETS) {
      const refreshPat = buildPatPackets(transportStreamId, programNumber, pmtPid, ccMap);
      const refreshPmt = buildPmtPackets(normalizedProgram, ccMap);
      for (const pkt of refreshPat) allPackets.push(pkt);
      for (const pkt of refreshPmt) allPackets.push(pkt);
      psiRefreshCounter = 0;
    }
  }

  // Concatenate all packets
  const totalBytes = allPackets.length * TS_PACKET_SIZE;
  const output = new Uint8Array(totalBytes);
  let off = 0;
  for (const pkt of allPackets) {
    output.set(pkt, off);
    off += TS_PACKET_SIZE;
  }

  return output;
}
