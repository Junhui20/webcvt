/**
 * ADTS demuxer — parse a Uint8Array into an AdtsFile.
 *
 * Algorithm (per design note §Demuxer):
 * 1. Input size guard (200 MiB cap).
 * 2. Frame loop starting at offset 0:
 *    a. Require 12-bit sync 0xFFF. If absent, scan forward byte-by-byte,
 *       but validate each candidate's full header before accepting (Trap #5).
 *    b. Parse bitfields. Verify layer==0, sampleRateIndex<13, channelConfig>0.
 *    c. Compute frameBytes (13-bit field). Validate does not exceed EOF.
 *    d. If protection_absent==0, CRC occupies bytes 7-8 (header=9 bytes).
 *    e. Record full frame bytes [cursor, cursor+frameBytes).
 *    f. Advance cursor += frameBytes.
 * 3. Stop at EOF (allow up to 4 KiB trailing junk).
 * 4. Corrupt-stream detection: if >8 candidates all rejected, throw.
 *
 * Refs: ISO/IEC 14496-3:2019 §1.A.2
 */

import {
  ADTS_MIN_HEADER_BYTES,
  MAX_INPUT_BYTES,
  MAX_TOTAL_SYNC_SCAN_BYTES,
  MAX_TRAILING_JUNK,
  MIN_CANDIDATES_FOR_CORRUPT,
  SYNC_SCAN_CAP,
} from './constants.ts';
import {
  AdtsCorruptStreamError,
  AdtsInputTooLargeError,
  AdtsMultipleRawBlocksUnsupportedError,
  AdtsTruncatedFrameError,
} from './errors.ts';
import { type AdtsFile, type AdtsFrame, hasSyncAt, parseAdtsHeader } from './header.ts';

// Re-export types for consumers who import from parser
export type { AdtsFile, AdtsFrame } from './header.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a complete ADTS-framed AAC byte stream into an AdtsFile.
 *
 * @throws AdtsInputTooLargeError, AdtsTruncatedFrameError, AdtsCorruptStreamError,
 *         AdtsPceRequiredError, AdtsReservedSampleRateError, AdtsInvalidLayerError,
 *         AdtsMultipleRawBlocksUnsupportedError
 */
export function parseAdts(input: Uint8Array): AdtsFile {
  // Security cap: must be very first check (mirrors parseFlac pattern).
  if (input.length > MAX_INPUT_BYTES) {
    throw new AdtsInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  const frames: AdtsFrame[] = [];
  let cursor = 0;
  let candidatesAttempted = 0;
  let candidatesRejected = 0;
  let totalSyncScanBytes = 0;

  while (cursor < input.length) {
    // Find next sync word (0xFFF = top 12 bits).
    if (!hasSyncAt(input, cursor)) {
      const scanStart = cursor + 1;
      const nextSync = scanForSync(input, scanStart);
      // Accumulate bytes scanned (SYNC_SCAN_CAP is the per-call cap; track global total).
      const bytesScanned = Math.min(SYNC_SCAN_CAP, input.length - scanStart);
      totalSyncScanBytes += bytesScanned;
      if (totalSyncScanBytes > MAX_TOTAL_SYNC_SCAN_BYTES) {
        throw new AdtsCorruptStreamError(candidatesAttempted);
      }
      if (nextSync < 0) break; // No more syncs — trailing junk, done.
      cursor = nextSync;
    }

    // Try parsing the header at cursor.
    candidatesAttempted++;

    // Need at least 7 bytes for the minimal header.
    if (cursor + ADTS_MIN_HEADER_BYTES > input.length) {
      break;
    }

    let header: ReturnType<typeof parseAdtsHeader>;
    try {
      header = parseAdtsHeader(input, cursor);
    } catch {
      // False sync or invalid header — advance one byte and rescan.
      candidatesRejected++;
      cursor++;
      continue;
    }

    // Reject rawBlocks > 0 (Trap #8 — Phase 1 unsupported).
    if (header.rawBlocks > 0) {
      throw new AdtsMultipleRawBlocksUnsupportedError(cursor, header.rawBlocks);
    }

    // Validate frameBytes does not exceed input length (Security cap #3).
    if (cursor + header.frameBytes > input.length) {
      throw new AdtsTruncatedFrameError(cursor, header.frameBytes, input.length - cursor);
    }

    // Validate frameBytes is at least the header size (sanity).
    const headerSize = header.hasCrc ? 9 : 7;
    if (header.frameBytes < headerSize) {
      candidatesRejected++;
      cursor++;
      continue;
    }

    // Validate sync-candidate via lookahead: check that frameBytes lands on
    // another valid 0xFFF sync or at EOF (Trap #5 — false sync detection).
    // Trailing junk allowance: if there is no sync after nextFrameOffset within
    // MAX_TRAILING_JUNK bytes, the frame is the last valid frame in the stream
    // and we accept it (design note §Demuxer step 2: allow up to 4 KiB trailing junk).
    const nextFrameOffset = cursor + header.frameBytes;
    const isAtEof = nextFrameOffset >= input.length;
    const hasNextSync = !isAtEof && hasSyncAt(input, nextFrameOffset);
    // Accept when: at EOF, OR next byte is a valid sync, OR the trailing region
    // has no further sync within MAX_TRAILING_JUNK (i.e., is pure padding/junk).
    const trailingBytes = isAtEof ? 0 : input.length - nextFrameOffset;
    const isTrailingJunk =
      !isAtEof &&
      !hasNextSync &&
      trailingBytes <= MAX_TRAILING_JUNK &&
      scanForSync(input, nextFrameOffset) < 0;
    const nextSyncValid = isAtEof || hasNextSync || isTrailingJunk;

    if (!nextSyncValid) {
      // Not a true sync — advance one byte and rescan.
      candidatesRejected++;
      cursor++;
      continue;
    }

    // Accept the frame. Use subarray for zero-copy (Security cap #5).
    const frameData = input.subarray(cursor, nextFrameOffset);
    frames.push({ header, data: frameData });
    cursor = nextFrameOffset;
  }

  // Security cap #4: throw if the stream is predominantly corrupt.
  // Case A: no frames found and all candidates were rejected.
  const allRejected =
    frames.length === 0 &&
    candidatesAttempted > MIN_CANDIDATES_FOR_CORRUPT &&
    candidatesRejected === candidatesAttempted;
  // Case B: a few frames found but ≥95% of candidates rejected with at least
  //         MIN_CANDIDATES_FOR_CORRUPT * 4 attempts ("mostly garbage" guard).
  const mostlyGarbage =
    candidatesAttempted >= MIN_CANDIDATES_FOR_CORRUPT * 4 &&
    candidatesRejected / candidatesAttempted > 0.95;
  if (allRejected || mostlyGarbage) {
    throw new AdtsCorruptStreamError(candidatesAttempted);
  }

  return { frames };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scan forward from `start` for the next 0xFFF ADTS sync word.
 * Caps the search at SYNC_SCAN_CAP bytes to prevent CPU DoS (Security cap #2).
 *
 * @returns Offset of sync byte or -1 if not found within cap.
 */
function scanForSync(input: Uint8Array, start: number): number {
  const limit = Math.min(start + SYNC_SCAN_CAP, input.length - 1);
  for (let i = start; i < limit; i++) {
    if (hasSyncAt(input, i)) return i;
  }
  return -1;
}
