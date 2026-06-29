/**
 * MPEG-TS top-level parser.
 *
 * Implements the full demux algorithm:
 * 1. Sync acquisition (Trap §1)
 * 2. Packet loop with header decode
 * 3. PSI dispatch (PAT → PMT)
 * 4. PES reassembly per ES PID
 * 5. Final validation (PAT/PMT presence, non-empty PES)
 *
 * Security: 200 MiB input cap is the FIRST statement.
 *
 * References: ISO/IEC 13818-1 §2.4.3, §2.4.4
 */

import {
  DISCONTINUITY_WARN_INTERVAL,
  DISCONTINUITY_WARN_THRESHOLD,
  MAX_INPUT_BYTES,
  MAX_PACKETS,
  MAX_PROGRAMS,
  MAX_PSI_WAIT_PACKETS,
  MAX_TOTAL_ES_PIDS,
  PID_PAT,
  TS_PACKET_SIZE,
  TS_SYNC_BYTE,
} from './constants.ts';
import {
  TsCorruptStreamError,
  TsInputTooLargeError,
  TsMissingPatError,
  TsMissingPmtError,
  TsTooManyPacketsError,
  TsTooManyProgramsError,
} from './errors.ts';
import { maybeNormalizeM2ts } from './m2ts.ts';
import { acquireSync, decodePacket } from './packet.ts';
import { decodePat } from './pat.ts';
import {
  type PesAssemblerState,
  type TsPesPacket,
  continuePes,
  createPesAssembler,
  flushPes,
  startPes,
} from './pes.ts';
import { type TsProgram, decodePmt } from './pmt.ts';
import { type PsiAssemblerState, createPsiAssembler, feedPsiPayload } from './psi.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TsFile {
  pat: {
    transportStreamId: number;
    programs: Array<{ programNumber: number; pmtPid: number }>;
  };
  /** Every program found in the stream, in PAT (program_number) order. */
  readonly programs: TsProgram[];
  /**
   * The first program (== programs[0]). Retained for backward compatibility
   * with single-program consumers; multi-program callers should read
   * `programs`.
   */
  program: TsProgram;
  /** Reassembled PES packets in stream order (mixed PIDs across all programs). */
  pesPackets: readonly TsPesPacket[];
  /** Total raw-packet count seen. */
  packetCount: number;
}

// ---------------------------------------------------------------------------
// Main parser entry point
// ---------------------------------------------------------------------------

/**
 * Parse an MPEG-TS byte stream (multi-program H.264 + AAC ADTS).
 *
 * The PAT may announce one or many programs; each program's PMT is decoded and
 * every program's elementary streams are reassembled into PES packets. ES PIDs
 * are unique per stream so PES keying by PID works across programs.
 *
 * @param input Raw TS bytes. Must be <= 200 MiB.
 * @throws TsInputTooLargeError, TsNoSyncByteError, TsScrambledNotSupportedError,
 *         TsReservedAdaptationControlError, TsTooManyProgramsError,
 *         TsMissingPatError, TsMissingPmtError, TsCorruptStreamError,
 *         TsPsiCrcError
 */
export function parseTs(rawInput: Uint8Array): TsFile {
  // Security cap — FIRST statement (container-flac C-1 lesson)
  if (rawInput.length > MAX_INPUT_BYTES) {
    throw new TsInputTooLargeError(rawInput.length, MAX_INPUT_BYTES);
  }

  // M2TS (192-byte BDAV/AVCHD packets): strip the 4-byte TP_extra_header
  // prefixes to a standard 188-byte TS stream so the rest of the demuxer is
  // unchanged. Returns null for plain TS (and for non-TS input, leaving the
  // sync-acquisition step below to raise TsNoSyncByteError).
  const input = maybeNormalizeM2ts(rawInput) ?? rawInput;

  // Step 1: Sync acquisition
  let offset = acquireSync(input, 0);

  // Parser state
  let packetCount = 0;
  let patSeen = false;
  let patPacketIndex = -1;

  let patTable: {
    transportStreamId: number;
    programs: Array<{ programNumber: number; pmtPid: number }>;
  } | null = null;

  // Program numbers announced by the PAT (used to decide when ALL PMTs arrived).
  const expectedProgramNumbers = new Set<number>();
  // Decoded programs, keyed by program_number (first version of each wins).
  const programsByNumber = new Map<number, TsProgram>();
  // Running total of registered ES PIDs across all programs (global cap).
  let totalEsPids = 0;

  const pesPackets: TsPesPacket[] = [];

  // PSI assemblers (keyed by PID)
  const patAssembler: PsiAssemblerState = createPsiAssembler(PID_PAT);
  // One PMT section assembler per distinct PMT PID announced by the PAT.
  const pmtAssemblers = new Map<number, PsiAssemblerState>();

  // PES assemblers (keyed by PID — unique per elementary stream, even across
  // programs).
  const pesAssemblers = new Map<number, PesAssemblerState>();

  // True once a decoded program exists for every program_number in the PAT.
  const allPmtsSeen = (): boolean =>
    expectedProgramNumbers.size > 0 && programsByNumber.size >= expectedProgramNumbers.size;

  // The PMT PID still carries an undecoded program announced by the PAT.
  const pmtPidHasPending = (candidatePid: number): boolean => {
    if (patTable === null) return false;
    for (const entry of patTable.programs) {
      if (entry.pmtPid === candidatePid && !programsByNumber.has(entry.programNumber)) {
        return true;
      }
    }
    return false;
  };

  // Continuity counter tracker (PID → expected CC)
  const ccMap = new Map<number, number>();
  const ccWarnCount = new Map<number, number>();

  // Step 2: Packet loop
  while (offset + TS_PACKET_SIZE <= input.length) {
    // Verify sync byte; re-acquire if lost
    if (input[offset] !== TS_SYNC_BYTE) {
      offset = acquireSync(input, offset + 1);
      continue;
    }

    // Packet count cap
    packetCount++;
    if (packetCount > MAX_PACKETS) {
      throw new TsTooManyPacketsError(MAX_PACKETS);
    }

    // Decode packet header (may throw on scrambled/reserved-AFC packets)
    const packet = decodePacket(input, offset);

    // Skip error packets (Trap §12)
    if (packet.header.transportError) {
      offset += TS_PACKET_SIZE;
      continue;
    }

    const { pid, payloadUnitStart, adaptationFieldControl, continuityCounter } = packet.header;

    // Continuity counter tracking (Trap §2)
    // CC increments only for payload-bearing packets (AFC & 0b01)
    if ((adaptationFieldControl & 0b01) !== 0) {
      const expected = ccMap.get(pid);
      if (expected !== undefined && continuityCounter !== expected) {
        const warnCount = (ccWarnCount.get(pid) ?? 0) + 1;
        ccWarnCount.set(pid, warnCount);
        if (
          warnCount <= DISCONTINUITY_WARN_THRESHOLD ||
          warnCount % DISCONTINUITY_WARN_INTERVAL === 0
        ) {
          // In a browser/Node environment we emit a warning but do not throw.
          // (Design note: discontinuities are common at HLS segment boundaries.)
        }
      }
      ccMap.set(pid, (continuityCounter + 1) & 0x0f);
    }

    // PMT wait cap: once the PAT is seen, allow MAX_PSI_WAIT_PACKETS packets for
    // ALL announced PMTs to arrive (not just the first one). If the window is
    // exceeded before every program's PMT is decoded, fail on a missing one.
    if (patSeen && patPacketIndex >= 0 && expectedProgramNumbers.size > 0 && !allPmtsSeen()) {
      if (packetCount - patPacketIndex > MAX_PSI_WAIT_PACKETS) {
        const missing = (patTable as NonNullable<typeof patTable>).programs.find(
          (e) => !programsByNumber.has(e.programNumber),
        );
        throw new TsMissingPmtError(missing?.pmtPid ?? -1, MAX_PSI_WAIT_PACKETS);
      }
    }

    // Step 2g: Dispatch by PID
    const payload = packet.payload;

    if (pid === PID_PAT && !patSeen) {
      // PAT section assembler
      const section = feedPsiPayload(patAssembler, payload, payloadUnitStart);
      if (section !== null) {
        const decoded = decodePat(section);
        patSeen = true;
        patPacketIndex = packetCount;

        // Security cap: bound the number of programs.
        if (decoded.entries.length > MAX_PROGRAMS) {
          throw new TsTooManyProgramsError(decoded.entries.length, MAX_PROGRAMS);
        }

        patTable = {
          transportStreamId: decoded.transportStreamId,
          programs: decoded.entries.map((e) => ({
            programNumber: e.programNumber,
            pmtPid: e.pid,
          })),
        };

        // Register one PSI assembler per distinct PMT PID and remember which
        // program numbers we still expect to see a PMT for.
        for (const entry of patTable.programs) {
          expectedProgramNumbers.add(entry.programNumber);
          if (!pmtAssemblers.has(entry.pmtPid)) {
            pmtAssemblers.set(entry.pmtPid, createPsiAssembler(entry.pmtPid));
          }
        }
      }
    } else if (patSeen && pmtAssemblers.has(pid) && pmtPidHasPending(pid)) {
      // PMT section assembler (one per PMT PID)
      const pmtAssembler = pmtAssemblers.get(pid) as PsiAssemblerState;
      const section = feedPsiPayload(pmtAssembler, payload, payloadUnitStart);
      if (section !== null) {
        const program = decodePmt(section, pid);

        // Only accept programs announced by the PAT that we have not decoded yet.
        if (
          expectedProgramNumbers.has(program.programNumber) &&
          !programsByNumber.has(program.programNumber)
        ) {
          programsByNumber.set(program.programNumber, program);

          // Register ES PID assemblers for supported streams (global cap).
          for (const stream of program.streams) {
            if (stream.unsupported) continue;
            if (totalEsPids >= MAX_TOTAL_ES_PIDS) break;
            if (!pesAssemblers.has(stream.pid)) {
              pesAssemblers.set(stream.pid, createPesAssembler());
              totalEsPids++;
            }
          }
        }
      }
    } else if (pesAssemblers.has(pid)) {
      // ES PES reassembler
      const assembler = pesAssemblers.get(pid) as PesAssemblerState;

      if (payloadUnitStart) {
        // PUSI=1: flush previous PES and start new one
        const flushed = startPes(assembler, pid, payload, offset);
        if (flushed !== null) {
          pesPackets.push(flushed);
        }
      } else {
        // PUSI=0: continuation
        const completed = continuePes(assembler, pid, payload, offset);
        if (completed !== null) {
          pesPackets.push(completed);
        }
      }
    }
    // Other PIDs (null packets, unknown PIDs) are ignored

    offset += TS_PACKET_SIZE;
  }

  // Flush in-progress PES assemblers at stream end
  for (const [pid, assembler] of pesAssemblers) {
    const last = flushPes(assembler, pid);
    if (last !== null) {
      pesPackets.push(last);
    }
  }

  // Step 9: Validation
  if (!patSeen || patTable === null) {
    throw new TsMissingPatError();
  }

  // Collect decoded programs in PAT (program_number) order.
  const programs: TsProgram[] = [];
  const added = new Set<number>();
  for (const entry of patTable.programs) {
    if (added.has(entry.programNumber)) continue;
    const decoded = programsByNumber.get(entry.programNumber);
    if (decoded !== undefined) {
      programs.push(decoded);
      added.add(entry.programNumber);
    }
  }

  if (programs.length === 0) {
    // PAT seen but no PMT decoded (zero programs, or none arrived in time).
    throw new TsMissingPmtError(patTable.programs[0]?.pmtPid ?? -1, MAX_PSI_WAIT_PACKETS);
  }

  // M-1 lesson: if non-empty input yields zero PES packets, the stream is corrupt
  if (input.length > 0 && pesPackets.length === 0) {
    throw new TsCorruptStreamError('No PES packets could be reassembled from a non-empty input.');
  }

  return {
    pat: patTable,
    programs,
    program: programs[0] as TsProgram,
    pesPackets,
    packetCount,
  };
}
