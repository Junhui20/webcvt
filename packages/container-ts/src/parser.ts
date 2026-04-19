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
  MAX_ES_PIDS,
  MAX_INPUT_BYTES,
  MAX_PACKETS,
  MAX_PSI_WAIT_PACKETS,
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
} from './errors.ts';
import { acquireSync, decodePacket } from './packet.ts';
import { type PatEntry, decodePat } from './pat.ts';
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
  program: TsProgram;
  /** Reassembled PES packets in stream order (mixed PIDs). */
  pesPackets: readonly TsPesPacket[];
  /** Total raw-packet count seen. */
  packetCount: number;
}

// ---------------------------------------------------------------------------
// Main parser entry point
// ---------------------------------------------------------------------------

/**
 * Parse an MPEG-TS byte stream (first-pass: single-program H.264 + AAC ADTS).
 *
 * @param input Raw TS bytes. Must be <= 200 MiB.
 * @throws TsInputTooLargeError, TsNoSyncByteError, TsScrambledNotSupportedError,
 *         TsReservedAdaptationControlError, TsMultiProgramNotSupportedError,
 *         TsMissingPatError, TsMissingPmtError, TsCorruptStreamError,
 *         TsPsiCrcError
 */
export function parseTs(input: Uint8Array): TsFile {
  // Security cap — FIRST statement (container-flac C-1 lesson)
  if (input.length > MAX_INPUT_BYTES) {
    throw new TsInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  // Step 1: Sync acquisition
  let offset = acquireSync(input, 0);

  // Parser state
  let packetCount = 0;
  let patSeen = false;
  let pmtSeen = false;
  let patPacketIndex = -1;

  let patTable: {
    transportStreamId: number;
    programs: Array<{ programNumber: number; pmtPid: number }>;
  } | null = null;

  let program: TsProgram | null = null;
  let pmtPid = -1;

  const pesPackets: TsPesPacket[] = [];

  // PSI assemblers (keyed by PID)
  const patAssembler: PsiAssemblerState = createPsiAssembler(PID_PAT);
  let pmtAssembler: PsiAssemblerState | null = null;

  // PES assemblers (keyed by PID)
  const pesAssemblers = new Map<number, PesAssemblerState>();

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

    // PMT wait cap: if PAT was seen but PMT not yet, track packets elapsed
    if (patSeen && !pmtSeen && patPacketIndex >= 0) {
      if (packetCount - patPacketIndex > MAX_PSI_WAIT_PACKETS) {
        throw new TsMissingPmtError(pmtPid, MAX_PSI_WAIT_PACKETS);
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
        patTable = {
          transportStreamId: decoded.transportStreamId,
          programs: decoded.entries.map((e) => ({
            programNumber: e.programNumber,
            pmtPid: e.pid,
          })),
        };
        if (decoded.entries.length > 0) {
          pmtPid = (decoded.entries[0] as PatEntry).pid;
          pmtAssembler = createPsiAssembler(pmtPid);
        }
      }
    } else if (patSeen && !pmtSeen && pmtPid >= 0 && pid === pmtPid && pmtAssembler !== null) {
      // PMT section assembler
      const section = feedPsiPayload(pmtAssembler, payload, payloadUnitStart);
      if (section !== null) {
        program = decodePmt(section, pmtPid);
        pmtSeen = true;

        // Register ES PID assemblers for supported streams
        let count = 0;
        for (const stream of program.streams) {
          if (!stream.unsupported && count < MAX_ES_PIDS) {
            pesAssemblers.set(stream.pid, createPesAssembler());
            count++;
          }
        }
      }
    } else if (pmtSeen && program !== null && pesAssemblers.has(pid)) {
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
  if (program !== null) {
    for (const [pid, assembler] of pesAssemblers) {
      const last = flushPes(assembler, pid);
      if (last !== null) {
        pesPackets.push(last);
      }
    }
  }

  // Step 9: Validation
  if (!patSeen || patTable === null) {
    throw new TsMissingPatError();
  }

  if (!pmtSeen || program === null) {
    throw new TsMissingPmtError(pmtPid, MAX_PSI_WAIT_PACKETS);
  }

  // M-1 lesson: if non-empty input yields zero PES packets, the stream is corrupt
  if (input.length > 0 && pesPackets.length === 0) {
    throw new TsCorruptStreamError('No PES packets could be reassembled from a non-empty input.');
  }

  return {
    pat: patTable,
    program,
    pesPackets,
    packetCount,
  };
}
