/**
 * PAT (Program Association Table) parser.
 *
 * table_id = 0x00, always on PID 0x0000.
 * Returns ALL non-zero programs (multi-program transport streams supported);
 * program_number=0 entries are NIT pointers and are skipped. The MAX_PROGRAMS
 * security cap is enforced by the caller (parseTs).
 *
 * References: ISO/IEC 13818-1 §2.4.4.3
 */

import { TABLE_ID_PAT } from './constants.ts';
import { TsCorruptStreamError } from './errors.ts';
import type { TsPsiSection } from './psi.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PatEntry {
  programNumber: number;
  pid: number;
}

export interface PatTable {
  transportStreamId: number;
  versionNumber: number;
  entries: PatEntry[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Decode the body of a PAT PSI section.
 *
 * @param section   Fully assembled and CRC-verified PSI section.
 * @returns PatTable listing every non-zero program (NIT entries skipped).
 * @throws TsCorruptStreamError if table_id is not 0x00.
 */
export function decodePat(section: TsPsiSection): PatTable {
  if (section.tableId !== TABLE_ID_PAT) {
    throw new TsCorruptStreamError(
      `Expected PAT table_id=0x00, got 0x${section.tableId.toString(16)}`,
    );
  }

  const body = section.body;
  const entries: PatEntry[] = [];

  // PAT body: repeating 4-byte entries (program_number: 16 bits, reserved: 3 bits, pid: 13 bits)
  let i = 0;
  while (i + 3 < body.length) {
    const programNumber = (((body[i] as number) << 8) | (body[i + 1] as number)) >>> 0;
    const pid = (((body[i + 2] as number) & 0x1f) << 8) | (body[i + 3] as number);
    i += 4;

    if (programNumber === 0) {
      // NIT pointer — skip per design note
      continue;
    }

    entries.push({ programNumber, pid });
  }

  return {
    transportStreamId: section.tableIdExtension,
    versionNumber: section.versionNumber,
    entries,
  };
}
