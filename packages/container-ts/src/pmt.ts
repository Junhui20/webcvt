/**
 * PMT (Program Map Table) parser.
 *
 * table_id = 0x02, on the PID announced by the PAT.
 * Extracts per-ES (stream_type, elementary_PID) pairs.
 * Marks unsupported stream types with unsupported=true (not thrown).
 *
 * Security: caps ES count at MAX_ES_PIDS (Trap §14).
 *
 * References: ISO/IEC 13818-1 §2.4.4.8
 */

import { MAX_ES_PIDS, STREAM_TYPE_AAC_ADTS, STREAM_TYPE_AVC, TABLE_ID_PMT } from './constants.ts';
import { TsCorruptStreamError } from './errors.ts';
import type { TsPsiSection } from './psi.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TsProgramStream {
  pid: number;
  streamType: number;
  /** Raw ES_info descriptor bytes (not parsed in first pass). Zero-copy subarray. */
  esInfoDescriptors: Uint8Array;
  /** true for stream types not supported in first pass. */
  unsupported: boolean;
}

export interface TsProgram {
  programNumber: number;
  pmtPid: number;
  pcrPid: number;
  streams: TsProgramStream[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Decode the body of a PMT PSI section.
 *
 * @param section     Fully assembled and CRC-verified PSI section.
 * @param pmtPid      The PID on which the PMT was received (for TsProgram.pmtPid).
 * @throws TsCorruptStreamError if table_id is not 0x02.
 */
export function decodePmt(section: TsPsiSection, pmtPid: number): TsProgram {
  if (section.tableId !== TABLE_ID_PMT) {
    throw new TsCorruptStreamError(
      `Expected PMT table_id=0x02, got 0x${section.tableId.toString(16)}`,
    );
  }

  const body = section.body;
  const programNumber = section.tableIdExtension;

  if (body.length < 4) {
    throw new TsCorruptStreamError('PMT body too short (< 4 bytes)');
  }

  // PMT body layout:
  // [0..1]: reserved(3) | PCR_PID(13)
  // [2..3]: reserved(4) | program_info_length(12)  — Trap §14: mask 0x0FFF
  const pcrPid = (((body[0] as number) & 0x1f) << 8) | (body[1] as number);
  const programInfoLength = (((body[2] as number) & 0x0f) << 8) | (body[3] as number);

  // Clamp program_info_length to remaining bytes (Trap §14: reserved bits can make value too large)
  const clampedProgramInfoLength = Math.min(programInfoLength, Math.max(0, body.length - 4));
  const esLoopStart = 4 + clampedProgramInfoLength;

  const streams: TsProgramStream[] = [];
  let cursor = esLoopStart;

  while (cursor + 4 < body.length) {
    const streamType = body[cursor] as number;
    // reserved(3) | elementary_PID(13)
    const esPid = (((body[cursor + 1] as number) & 0x1f) << 8) | (body[cursor + 2] as number);
    // reserved(4) | ES_info_length(12) — Trap §14: mask 0x0FFF
    const esInfoLength =
      (((body[cursor + 3] as number) & 0x0f) << 8) | (body[cursor + 4] as number);

    cursor += 5;

    // Validate ES_info_length against remaining bytes
    if (cursor + esInfoLength > body.length) {
      // Truncated — stop ES loop
      break;
    }

    const esInfoDescriptors = body.subarray(cursor, cursor + esInfoLength);
    cursor += esInfoLength;

    const unsupported = streamType !== STREAM_TYPE_AVC && streamType !== STREAM_TYPE_AAC_ADTS;

    streams.push({
      pid: esPid,
      streamType,
      esInfoDescriptors,
      unsupported,
    });

    // Cap ES count (security)
    if (streams.length >= MAX_ES_PIDS) break;
  }

  return {
    programNumber,
    pmtPid,
    pcrPid,
    streams,
  };
}
