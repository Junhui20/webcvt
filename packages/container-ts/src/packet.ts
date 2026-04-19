/**
 * MPEG-TS packet header decode and sync acquisition.
 *
 * Covers:
 * - 188-byte fixed-size packet structure
 * - Sync byte 0x47 detection with triple-anchor confirmation (Trap §1)
 * - TS header bit decode: TEI, PUSI, PID, scrambling, AFC, CC
 * - Adaptation field decode: length, flags, PCR (Trap §4, §11)
 * - Payload slice extraction
 *
 * References: ISO/IEC 13818-1 §2.4.3.2, §2.4.3.5
 */

import { MAX_SYNC_SCAN_BYTES, TS_PACKET_SIZE, TS_SYNC_BYTE } from './constants.ts';
import {
  TsInvalidAdaptationLengthError,
  TsNoSyncByteError,
  TsReservedAdaptationControlError,
  TsScrambledNotSupportedError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TsPacketHeader {
  /** 13-bit PID, 0x0000..0x1FFF. */
  pid: number;
  /** payload_unit_start_indicator. */
  payloadUnitStart: boolean;
  /** transport_error_indicator — packet must be skipped when true. */
  transportError: boolean;
  /** transport_scrambling_control: 0=clear, 1/2/3=scrambled. */
  scrambling: 0 | 1 | 2 | 3;
  /** adaptation_field_control: 1=payload-only, 2=adaptation-only, 3=both. */
  adaptationFieldControl: 1 | 2 | 3;
  /** 4-bit continuity counter, 0..15. */
  continuityCounter: number;
}

export interface TsAdaptationField {
  /** Decoded PCR base (33-bit, 90 kHz) — informational only. */
  pcrBase?: number;
  /** Decoded PCR extension (9-bit, 27 MHz) — informational only. */
  pcrExtension?: number;
  /** discontinuity_indicator. */
  discontinuityIndicator: boolean;
  /** random_access_indicator. */
  randomAccessIndicator: boolean;
  /** Total adaptation field length including the length byte itself. */
  totalLength: number;
}

export interface TsPacket {
  header: TsPacketHeader;
  adaptation?: TsAdaptationField;
  /** Payload slice (zero-copy subarray). May be empty when adaptation_field_control == 2. */
  payload: Uint8Array;
  /** Byte offset of the packet start in the source buffer. */
  fileOffset: number;
}

// ---------------------------------------------------------------------------
// Sync acquisition (Trap §1)
// ---------------------------------------------------------------------------

/**
 * Acquire packet sync by triple-anchor confirmation.
 *
 * Scans forward from `startOffset` looking for 0x47 at `offset`,
 * `offset + 188`, and `offset + 376`. Caps scan at MAX_SYNC_SCAN_BYTES.
 *
 * @throws TsNoSyncByteError when sync cannot be acquired.
 */
export function acquireSync(input: Uint8Array, startOffset: number): number {
  const cap = Math.min(startOffset + MAX_SYNC_SCAN_BYTES, input.length);
  for (let i = startOffset; i < cap; i++) {
    if (
      input[i] === TS_SYNC_BYTE &&
      (i + TS_PACKET_SIZE >= input.length || input[i + TS_PACKET_SIZE] === TS_SYNC_BYTE) &&
      (i + 2 * TS_PACKET_SIZE >= input.length || input[i + 2 * TS_PACKET_SIZE] === TS_SYNC_BYTE)
    ) {
      return i;
    }
  }
  throw new TsNoSyncByteError(cap - startOffset);
}

// ---------------------------------------------------------------------------
// Packet decode
// ---------------------------------------------------------------------------

/**
 * Decode one 188-byte TS packet starting at `offset` in `input`.
 *
 * Does NOT throw on transport_error_indicator (caller must check
 * packet.header.transportError and skip). DOES throw on scrambled packets
 * and reserved adaptation_field_control.
 *
 * @throws TsScrambledNotSupportedError, TsReservedAdaptationControlError
 */
export function decodePacket(input: Uint8Array, offset: number): TsPacket {
  // Byte 0: sync (already verified by caller or acquireSync)
  // Byte 1: TEI(1) | PUSI(1) | transport_priority(1) | PID[12:8](5)
  const b1 = input[offset + 1] as number;
  const b2 = input[offset + 2] as number;
  const b3 = input[offset + 3] as number;

  const transportError = (b1 & 0x80) !== 0;
  const payloadUnitStart = (b1 & 0x40) !== 0;
  // PID is 13 bits: lower 5 of b1 | all 8 of b2 (Trap §18)
  const pid = ((b1 & 0x1f) << 8) | b2;

  // Byte 3: scrambling(2) | AFC(2) | CC(4)
  const scrambling = ((b3 >> 6) & 0x03) as 0 | 1 | 2 | 3;
  const afc = ((b3 >> 4) & 0x03) as 0 | 1 | 2 | 3;
  const continuityCounter = b3 & 0x0f;

  // Trap §13: scrambled packet → throw immediately
  if (scrambling !== 0) {
    throw new TsScrambledNotSupportedError(pid, scrambling, offset);
  }

  // Trap §3: AFC == 0 is reserved/illegal
  if (afc === 0) {
    throw new TsReservedAdaptationControlError(offset);
  }

  const adaptationFieldControl = afc as 1 | 2 | 3;

  const header: TsPacketHeader = {
    pid,
    payloadUnitStart,
    transportError,
    scrambling,
    adaptationFieldControl,
    continuityCounter,
  };

  // After the 4-byte header, parse adaptation field if present (AFC & 0b10)
  let adaptationEnd = 4; // default: payload starts right after header
  let adaptation: TsAdaptationField | undefined;

  if ((adaptationFieldControl & 0b10) !== 0) {
    // Adaptation field present
    const afLength = input[offset + 4] as number;
    // Trap §4: adaptation_field_length must be <= 183
    // (188 - 4 header - 1 length byte = 183 max). Values 184-255 are malformed —
    // clamping would misalign the payload start offset, feeding corrupt bytes to PES/PSI.
    if (afLength > 183) {
      throw new TsInvalidAdaptationLengthError(afLength, offset);
    }
    const safeAfLength = afLength;
    const afEnd = offset + 4 + 1 + safeAfLength; // 4 header + 1 length byte + field bytes

    let pcrBase: number | undefined;
    let pcrExtension: number | undefined;
    let discontinuityIndicator = false;
    let randomAccessIndicator = false;

    if (safeAfLength >= 1) {
      const flags = input[offset + 5] as number;
      discontinuityIndicator = (flags & 0x80) !== 0;
      randomAccessIndicator = (flags & 0x40) !== 0;
      const pcrFlag = (flags & 0x10) !== 0;

      // Trap §11: PCR is 33-bit base (× 90 kHz) + 6 reserved bits + 9-bit extension (× 27 MHz)
      if (pcrFlag && afEnd >= offset + 5 + 6) {
        const p0 = input[offset + 6] as number;
        const p1 = input[offset + 7] as number;
        const p2 = input[offset + 8] as number;
        const p3 = input[offset + 9] as number;
        const p4 = input[offset + 10] as number;
        // Base: bits 32..0 of the 48-bit field [47:15]
        // p0[7:0] = base[32:25], p1[7:0] = base[24:17], p2[7:0] = base[16:9]
        // p3[7:0] = base[8:1], p4[7] = base[0], p4[6:1] = reserved, p4[0] = ext[8]
        // Note: JS numbers lose precision on >53-bit integers; we use 33-bit base as two parts
        const baseHigh = (p0 << 25) | (p1 << 17) | (p2 << 9) | (p3 << 1) | (p4 >> 7);
        pcrBase = baseHigh >>> 0;
        // Extension: low 9 bits of the 48-bit field [8:0], skipping 6 reserved bits
        const extHigh = (p4 & 0x01) << 8;
        const extLow = input[offset + 11] as number;
        pcrExtension = extHigh | extLow;
      }
    }

    adaptation = {
      pcrBase,
      pcrExtension,
      discontinuityIndicator,
      randomAccessIndicator,
      totalLength: 1 + safeAfLength, // includes the length byte itself
    };

    adaptationEnd = 4 + 1 + safeAfLength; // header + length byte + field bytes
  }

  // Payload slice
  const payloadStart = offset + adaptationEnd;
  const packetEnd = offset + TS_PACKET_SIZE;
  const payload =
    (adaptationFieldControl & 0b01) !== 0 && payloadStart < packetEnd
      ? input.subarray(payloadStart, packetEnd)
      : new Uint8Array(0);

  return {
    header,
    adaptation,
    payload,
    fileOffset: offset,
  };
}
