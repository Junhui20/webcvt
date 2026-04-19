/**
 * PES (Packetized Elementary Stream) header parsing and PTS/DTS decoding.
 *
 * Handles:
 * - packet_start_code_prefix validation (0x00 0x00 0x01)
 * - stream_id, PES_packet_length (bounded vs unbounded video — Trap §5)
 * - PTS/DTS bit-fragmented decode (Trap §6)
 * - 90 kHz → microseconds conversion
 *
 * References: ISO/IEC 13818-1 §2.4.3.6, §2.4.3.7
 */

import { MAX_PES_BYTES } from './constants.ts';
import { TsCorruptStreamError, TsPesTooLargeError } from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TsPesHeader {
  streamId: number;
  /** PES_packet_length: 0 means unbounded (video). */
  pesPacketLength: number;
  /** PTS in microseconds (undefined when PTS_DTS_flags = 0b00). */
  ptsUs?: number;
  /** DTS in microseconds (undefined when no DTS). Falls back to PTS when absent. */
  dtsUs?: number;
  /** Byte offset within the PES buffer where payload begins. */
  headerDataLength: number;
  /** PES_header_data_length field value (not counting the 9-byte fixed header). */
  optionalFieldsLength: number;
}

export interface TsPesPacket {
  pid: number;
  streamId: number;
  ptsUs?: number;
  dtsUs?: number;
  /** PES payload (Annex-B NAL bytes or ADTS frames). Zero-copy subarray. */
  payload: Uint8Array;
  /** Source TS packet byte offsets (for debugging / round-trip). */
  sourcePacketOffsets: number[];
}

// ---------------------------------------------------------------------------
// PES header decode
// ---------------------------------------------------------------------------

/**
 * Decode a PES header from the start of a PES buffer.
 *
 * @param buf PES buffer starting at packet_start_code_prefix (0x00 0x00 0x01).
 * @throws TsCorruptStreamError if start_code_prefix is wrong or buffer too short.
 * @internal Not part of the stable public API — exported for unit-test access only.
 */
export function decodePesHeader(buf: Uint8Array): TsPesHeader {
  if (buf.length < 9) {
    throw new TsCorruptStreamError(`PES buffer too short (${buf.length} < 9)`);
  }

  // packet_start_code_prefix: 0x00 0x00 0x01
  if (buf[0] !== 0x00 || buf[1] !== 0x00 || buf[2] !== 0x01) {
    throw new TsCorruptStreamError(
      `Invalid PES start code: 0x${buf[0]?.toString(16)}${buf[1]?.toString(16)}${buf[2]?.toString(16)}`,
    );
  }

  const streamId = buf[3] as number;
  const pesPacketLength = (((buf[4] as number) << 8) | (buf[5] as number)) >>> 0;

  // Byte 6: '10' marker(2) | scrambling(2) | priority(1) | alignment(1) | copyright(1) | original(1)
  // Byte 7: PTS_DTS_flags(2) | ESCR(1) | ES_rate(1) | DSM_trick(1) | add_copy(1) | PES_CRC(1) | ext(1)
  // Byte 8: PES_header_data_length

  const ptsDtsFlags = ((buf[7] as number) >> 6) & 0x03;
  const optionalFieldsLength = buf[8] as number;
  // payload starts at byte 9 + optionalFieldsLength
  const headerDataLength = 9 + optionalFieldsLength;

  if (headerDataLength > buf.length) {
    throw new TsCorruptStreamError(
      `PES header_data_length (${optionalFieldsLength}) extends beyond buffer`,
    );
  }

  let ptsUs: number | undefined;
  let dtsUs: number | undefined;

  // Trap §6: PTS/DTS bit-fragment decode
  if (ptsDtsFlags === 0b10 || ptsDtsFlags === 0b11) {
    if (buf.length < 14) {
      throw new TsCorruptStreamError('PES buffer too short for PTS');
    }
    ptsUs = decodePtsDts(buf, 9, ptsDtsFlags === 0b11 ? 0b0011 : 0b0010);
  }

  if (ptsDtsFlags === 0b11) {
    if (buf.length < 19) {
      throw new TsCorruptStreamError('PES buffer too short for DTS');
    }
    dtsUs = decodePtsDts(buf, 14, 0b0001);
  }

  return {
    streamId,
    pesPacketLength,
    ptsUs,
    dtsUs,
    headerDataLength,
    optionalFieldsLength,
  };
}

// ---------------------------------------------------------------------------
// PTS/DTS bit-fragment decode (Trap §6)
// ---------------------------------------------------------------------------

/**
 * Decode a 33-bit PTS or DTS value from 5 bytes at `offset` in `buf`.
 *
 * Bit layout:
 *   byte 0: prefix(4) | value[32:30](3) | marker(1)
 *   byte 1: value[29:22](8)
 *   byte 2: value[21:15](7) | marker(1)
 *   byte 3: value[14:7](8)
 *   byte 4: value[6:0](7) | marker(1)
 *
 * @param expectedPrefixNibble  0b0010 for PTS-only, 0b0011 for PTS-of-pair, 0b0001 for DTS.
 * @returns timestamp in microseconds.
 */
function decodePtsDts(buf: Uint8Array, offset: number, expectedPrefixNibble: number): number {
  const b0 = buf[offset] as number;
  const b1 = buf[offset + 1] as number;
  const b2 = buf[offset + 2] as number;
  const b3 = buf[offset + 3] as number;
  const b4 = buf[offset + 4] as number;

  // Prefix nibble should match expectedPrefixNibble (top 4 bits of b0)
  const prefix = (b0 >> 4) & 0x0f;
  if (prefix !== expectedPrefixNibble) {
    throw new TsCorruptStreamError(
      `PTS/DTS prefix nibble mismatch: expected 0x${expectedPrefixNibble.toString(16)}, got 0x${prefix.toString(16)}`,
    );
  }

  // Trap §6: validate marker bits — each must be 1 (ISO/IEC 13818-1 §2.4.3.7)
  if ((b0 & 0x01) !== 1) {
    throw new TsCorruptStreamError('PTS/DTS byte 0 marker bit not 1');
  }
  if ((b2 & 0x01) !== 1) {
    throw new TsCorruptStreamError('PTS/DTS byte 2 marker bit not 1');
  }
  if ((b4 & 0x01) !== 1) {
    throw new TsCorruptStreamError('PTS/DTS byte 4 marker bit not 1');
  }

  // 33-bit value assembled as 3 + 15 + 15 bits
  const part0 = (b0 >> 1) & 0x07; // bits [32:30] — 3 bits
  const part1 = (b1 << 7) | (b2 >> 1); // bits [29:15] — 15 bits
  const part2 = (b3 << 7) | (b4 >> 1); // bits [14:0] — 15 bits

  // Combine: 33-bit value. Use floating-point to avoid int32 overflow.
  // part0 occupies bits 32..30, so multiply by 2^30
  const pts90 = part0 * 0x40000000 + (part1 << 15) + part2;

  // Convert from 90 kHz to microseconds: pts * 1_000_000 / 90_000 = pts * 100 / 9
  return Math.round((pts90 * 100) / 9);
}

// ---------------------------------------------------------------------------
// PES assembler state
// ---------------------------------------------------------------------------

export interface PesAssemblerState {
  /** In-progress PES buffer (grows as TS packets arrive). */
  buffer: Uint8Array;
  /** Number of accumulated bytes. */
  accumulated: number;
  /** Expected total size (6 + PES_packet_length). 0 means unbounded. */
  expected: number;
  /** Source packet offsets accumulated. */
  sourceOffsets: number[];
}

/**
 * Create a fresh PES assembler state.
 */
export function createPesAssembler(): PesAssemblerState {
  return {
    buffer: new Uint8Array(0),
    accumulated: 0,
    expected: 0,
    sourceOffsets: [],
  };
}

/**
 * Start a new PES packet (called when PUSI=1 on an ES PID).
 * Returns the flushed packet if there was one in progress, else null.
 */
export function startPes(
  state: PesAssemblerState,
  pid: number,
  payload: Uint8Array,
  packetOffset: number,
): TsPesPacket | null {
  // Flush the in-flight PES if we have one (unbounded video case — Trap §5)
  const flushed = flushPes(state, pid);

  // Start fresh
  resetPesAssembler(state, payload, packetOffset);

  return flushed;
}

/**
 * Append more payload bytes to the in-progress PES (PUSI=0 continuation).
 * Returns the packet when it reaches its declared length (bounded case).
 */
export function continuePes(
  state: PesAssemblerState,
  pid: number,
  payload: Uint8Array,
  packetOffset: number,
): TsPesPacket | null {
  if (state.accumulated === 0) return null; // no PES in flight

  appendToPes(state, payload, packetOffset);

  // Check bounded completion — only when payload contributed bytes
  if (payload.length > 0 && state.expected > 0 && state.accumulated >= state.expected) {
    return flushPes(state, pid);
  }

  return null;
}

/**
 * Flush the current in-progress PES (called at stream end or PUSI on same PID).
 * Returns the packet or null if nothing was accumulated.
 */
export function flushPes(state: PesAssemblerState, pid: number): TsPesPacket | null {
  if (state.accumulated < 9) {
    // Not enough data to decode a PES header — discard
    state.accumulated = 0;
    state.expected = 0;
    state.sourceOffsets = [];
    return null;
  }

  const bufView = state.buffer.subarray(0, state.accumulated);

  let header: TsPesHeader;
  try {
    header = decodePesHeader(bufView);
  } catch {
    // Malformed PES — discard
    state.accumulated = 0;
    state.expected = 0;
    state.sourceOffsets = [];
    return null;
  }

  // Copy payload — do NOT use a zero-copy subarray because the assembler buffer
  // will be overwritten when the next PES starts (buffer reuse).
  const payloadSlice = bufView.subarray(header.headerDataLength);
  const payload = payloadSlice.slice(); // defensive copy
  const sourceOffsets = state.sourceOffsets.slice();

  // Reset assembler
  state.accumulated = 0;
  state.expected = 0;
  state.sourceOffsets = [];

  return {
    pid,
    streamId: header.streamId,
    ptsUs: header.ptsUs,
    dtsUs: header.dtsUs ?? header.ptsUs, // fall back to PTS when DTS absent
    payload,
    sourcePacketOffsets: sourceOffsets,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resetPesAssembler(
  state: PesAssemblerState,
  payload: Uint8Array,
  packetOffset: number,
): void {
  state.accumulated = 0;
  state.expected = 0;
  state.sourceOffsets = [packetOffset];

  // Allocate / grow buffer as needed
  const needed = Math.max(payload.length, 64);
  if (state.buffer.length < needed) {
    state.buffer = new Uint8Array(Math.max(needed, 4096));
  }

  const take = Math.min(payload.length, state.buffer.length);
  state.buffer.set(payload.subarray(0, take), 0);
  state.accumulated = take;

  // Determine expected length from PES_packet_length if we have enough bytes
  if (state.accumulated >= 6) {
    const pesLen = (((state.buffer[4] as number) << 8) | (state.buffer[5] as number)) >>> 0;
    // Trap §5: 0 means unbounded (video), non-zero means bounded
    state.expected = pesLen === 0 ? 0 : 6 + pesLen;
  }
}

function appendToPes(state: PesAssemblerState, payload: Uint8Array, packetOffset: number): void {
  state.sourceOffsets.push(packetOffset);

  // Hard cap on accumulated size — throw before any reallocation (Sec-H-1)
  if (state.accumulated + payload.length > MAX_PES_BYTES) {
    throw new TsPesTooLargeError(state.accumulated + payload.length, MAX_PES_BYTES);
  }

  // Grow buffer if needed
  const needed = state.accumulated + payload.length;
  if (needed > state.buffer.length) {
    const newSize = Math.min(needed * 2, MAX_PES_BYTES);
    const newBuf = new Uint8Array(newSize);
    newBuf.set(state.buffer.subarray(0, state.accumulated));
    state.buffer = newBuf;
  }

  const take = Math.min(payload.length, state.buffer.length - state.accumulated);
  state.buffer.set(payload.subarray(0, take), state.accumulated);
  state.accumulated += take;

  // If we didn't have enough bytes before, compute expected now
  if (state.expected === 0 && state.accumulated >= 6) {
    const pesLen = (((state.buffer[4] as number) << 8) | (state.buffer[5] as number)) >>> 0;
    state.expected = pesLen === 0 ? 0 : 6 + pesLen;
  }
}
