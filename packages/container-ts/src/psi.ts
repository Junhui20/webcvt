/**
 * PSI section reassembly across TS packets.
 *
 * Handles:
 * - pointer_field on first packet (Trap §7, §17)
 * - Multi-packet section spanning (payload_unit_start=0 continuations)
 * - section_length extraction and total section size (Trap §16)
 * - CRC-32 verification (Trap §8)
 *
 * References: ISO/IEC 13818-1 §2.4.4
 */

import { MAX_PSI_SECTION_BYTES } from './constants.ts';
import { computePsiCrc32 } from './crc32.ts';
import { TsPsiCrcError } from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TsPsiSection {
  tableId: number;
  tableIdExtension: number;
  versionNumber: number;
  currentNextIndicator: boolean;
  sectionNumber: number;
  lastSectionNumber: number;
  /**
   * Section body: bytes after the 8-byte generic header and before the
   * 4-byte CRC-32 trailer. Zero-copy subarray.
   */
  body: Uint8Array;
}

// ---------------------------------------------------------------------------
// PSI assembler state
// ---------------------------------------------------------------------------

export interface PsiAssemblerState {
  /** Accumulation buffer for the current in-progress section. */
  buffer: Uint8Array;
  /** Number of bytes accumulated so far. */
  accumulated: number;
  /** Expected total section bytes (= section_length + 3). */
  expected: number;
  /** PID this assembler tracks (for error messages). */
  pid: number;
}

/**
 * Create a fresh PSI assembler state for a given PID.
 */
export function createPsiAssembler(pid: number): PsiAssemblerState {
  return {
    buffer: new Uint8Array(MAX_PSI_SECTION_BYTES),
    accumulated: 0,
    expected: 0,
    pid,
  };
}

// ---------------------------------------------------------------------------
// Feed and complete
// ---------------------------------------------------------------------------

/**
 * Feed a payload slice into the PSI assembler.
 *
 * @param state   Mutable assembler state.
 * @param payload TS packet payload (may contain pointer_field on start).
 * @param isStart payload_unit_start_indicator — true means pointer_field present.
 * @returns Completed TsPsiSection or null if still accumulating.
 */
export function feedPsiPayload(
  state: PsiAssemblerState,
  payload: Uint8Array,
  isStart: boolean,
): TsPsiSection | null {
  let cursor = 0;

  if (isStart) {
    // Reset accumulator. Read pointer_field (Trap §7).
    const pointerField = Math.min(payload[0] ?? 0, 182);
    cursor = 1 + pointerField; // skip pointer_field bytes
    state.accumulated = 0;
    state.expected = 0;
  }

  if (cursor >= payload.length) return null;

  // Accumulate bytes
  const toAppend = payload.subarray(cursor);
  const room = state.buffer.length - state.accumulated;
  const take = Math.min(toAppend.length, room);
  state.buffer.set(toAppend.subarray(0, take), state.accumulated);
  state.accumulated += take;

  // Once we have >= 3 bytes we can read section_length
  if (state.accumulated >= 3 && state.expected === 0) {
    // Bytes 0: table_id, 1-2: section_syntax_indicator + section_length
    const hi = (state.buffer[1] as number) & 0x0f; // mask reserved upper bits
    const lo = state.buffer[2] as number;
    const sectionLength = (hi << 8) | lo;
    // Trap §16: total section size = section_length + 3
    state.expected = sectionLength + 3;
    if (state.expected > MAX_PSI_SECTION_BYTES || state.expected < 8) {
      // Invalid section — reset
      state.accumulated = 0;
      state.expected = 0;
      return null;
    }
  }

  // Check if we have the complete section
  if (state.expected > 0 && state.accumulated >= state.expected) {
    const sectionBytes = state.buffer.subarray(0, state.expected);
    const section = decodePsiSection(sectionBytes, state.pid);
    // Reset for next section
    state.accumulated = 0;
    state.expected = 0;
    return section;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Section decode
// ---------------------------------------------------------------------------

/**
 * Decode a complete PSI section buffer, verifying CRC-32.
 *
 * @throws TsPsiCrcError on CRC mismatch.
 */
function decodePsiSection(sectionBytes: Uint8Array, pid: number): TsPsiSection {
  // Generic PSI section header (8 bytes):
  // [0]    table_id
  // [1]    section_syntax_indicator(1) | private_indicator(1) | reserved(2) | section_length[11:8](4)
  // [2]    section_length[7:0]
  // [3-4]  table_id_extension (16 bits)
  // [5]    reserved(2) | version_number(5) | current_next_indicator(1)
  // [6]    section_number
  // [7]    last_section_number
  // [8..end-4]  body
  // [end-4..end] CRC-32

  const tableId = sectionBytes[0] as number;
  const tableIdExtension = (((sectionBytes[3] as number) << 8) | (sectionBytes[4] as number)) >>> 0;
  const versionByte = sectionBytes[5] as number;
  const versionNumber = (versionByte >> 1) & 0x1f;
  const currentNextIndicator = (versionByte & 0x01) !== 0;
  const sectionNumber = sectionBytes[6] as number;
  const lastSectionNumber = sectionBytes[7] as number;

  // Validate CRC-32 over the entire section (Trap §8)
  // CRC covers bytes [0..end-4]; result is at [end-4..end]
  const crcStart = sectionBytes.length - 4;
  const dataForCrc = sectionBytes.subarray(0, crcStart);
  const computedCrc = computePsiCrc32(dataForCrc);
  const storedCrc =
    (((sectionBytes[crcStart] as number) << 24) |
      ((sectionBytes[crcStart + 1] as number) << 16) |
      ((sectionBytes[crcStart + 2] as number) << 8) |
      (sectionBytes[crcStart + 3] as number)) >>>
    0;

  if (computedCrc !== storedCrc) {
    throw new TsPsiCrcError(tableId, pid, storedCrc, computedCrc);
  }

  // Body is bytes [8..crcStart] (exclusive)
  const body = sectionBytes.subarray(8, crcStart);

  return {
    tableId,
    tableIdExtension,
    versionNumber,
    currentNextIndicator,
    sectionNumber,
    lastSectionNumber,
    body,
  };
}
