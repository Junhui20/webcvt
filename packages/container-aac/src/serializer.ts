/**
 * ADTS muxer — serialize an AdtsFile back to a Uint8Array.
 *
 * Algorithm (per design note §Muxer):
 * 1. For each frame:
 *    a. Recompute frameBytes = headerSize + payloadLength.
 *       headerSize = hasCrc ? 9 : 7.
 *    b. Pack bitfields into header bytes per ADTS layout.
 *    c. If hasCrc, write the preserved CRC verbatim (Phase 1 policy:
 *       preserve CRC from parse; throw AdtsCrcUnsupportedError if asked
 *       for fresh CRC generation — not applicable here since we only
 *       re-serialize parsed frames).
 *    d. Write payload bytes after the header.
 * 2. Concatenate all frames.
 *
 * Refs: ISO/IEC 14496-3:2019 §1.A.2
 */

import { encodeAdtsHeader } from './header.ts';
import type { AdtsFile } from './header.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize an AdtsFile to a raw ADTS byte stream.
 *
 * Each frame's payload is the data bytes after the header (and CRC if present).
 * This is a lossless round-trip: the output bytes are byte-identical to the
 * original input that was parsed (on the same platform).
 */
export function serializeAdts(file: AdtsFile): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const frame of file.frames) {
    const { header, data } = frame;
    const headerSize = header.hasCrc ? 9 : 7;
    // Extract payload from the full frame data (data includes header + optional CRC + payload).
    const payload = data.subarray(headerSize);
    // Encode a fresh header with the correct frameBytes recalculated.
    const encodedHeader = encodeAdtsHeader(header, payload.length);
    parts.push(encodedHeader);
    // Payload is sliced at the API boundary so callers get an immutable copy (Security cap #5).
    parts.push(payload.slice());
  }

  return concatBytes(parts);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
