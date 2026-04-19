/**
 * FLAC demuxer — parse a Uint8Array into a FlacFile.
 *
 * Algorithm (per design note §Demuxer):
 * 1. Skip any leading ID3v2 tag (Trap #3).
 * 2. Require "fLaC" magic at current offset.
 * 3. Metadata loop: read blocks until last_block flag.
 * 4. Frame loop: sync scan, parse header, scan to next sync for frame boundary,
 *    verify CRC-16 over entire frame.
 * 5. Verify totalSamples if nonzero.
 *
 * Refs: https://xiph.org/flac/format.html
 */

import { MAX_ID3_BODY, MAX_INPUT_BYTES } from './constants.ts';
import { crc16 } from './crc.ts';
import {
  FlacCrc16MismatchError,
  FlacInputTooLargeError,
  FlacInvalidMagicError,
  FlacInvalidMetadataError,
} from './errors.ts';
import type { FlacFrame } from './frame.ts';
import { FRAME_SYNC_CODE, parseFrameHeader } from './frame.ts';
import type { FlacMetadataBlock } from './metadata.ts';
import { BLOCK_TYPE_STREAMINFO, parseBlockHeader } from './metadata.ts';
import type { FlacStreamInfo } from './streaminfo.ts';
import { decodeStreamInfo } from './streaminfo.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FlacFile {
  streamInfo: FlacStreamInfo;
  /** All metadata blocks including STREAMINFO as blocks[0]. Raw data preserved. */
  blocks: FlacMetadataBlock[];
  frames: FlacFrame[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLAC_MAGIC = [0x66, 0x4c, 0x61, 0x43] as const; // "fLaC"
const ID3V2_MAGIC = [0x49, 0x44, 0x33] as const; // "ID3"
const BLOCK_HEADER_SIZE = 4;

/** Cumulative metadata cap: reject files whose metadata blocks exceed this total. */
const MAX_METADATA_BYTES = 64 * 1024 * 1024; // 64 MiB

/**
 * When scanning for the next frame sync after a confirmed frame start, cap the
 * search window to prevent O(n) CPU DoS on pathological inputs.
 */
const FRAME_SCAN_FALLBACK_CAP = 1 * 1024 * 1024; // 1 MiB

/**
 * Threshold for declaring a file corrupt: if more than half the sync candidates
 * fail CRC-16 AND we found at least this many candidates, throw instead of
 * returning an empty frames array.
 */
const MIN_SYNCS_FOR_CORRUPT_DETECTION = 8;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a complete FLAC file from raw bytes.
 *
 * @throws FlacInputTooLargeError, FlacInvalidMagicError, FlacInvalidMetadataError,
 *         FlacCrc8MismatchError, FlacCrc16MismatchError, FlacInvalidVarintError
 */
export function parseFlac(input: Uint8Array): FlacFile {
  // C-1: Input size guard must be the very first check so consumers of parseFlac
  // who bypass FlacBackend.convert are also protected.
  if (input.length > MAX_INPUT_BYTES) {
    throw new FlacInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  let cursor = 0;

  // Step 1: Skip ID3v2 prefix (Trap #3)
  cursor = skipId3v2(input, cursor);

  // Step 2: Require "fLaC" magic
  requireMagic(input, cursor);
  cursor += 4;

  // Step 3: Metadata loop
  const blocks: FlacMetadataBlock[] = [];
  let streamInfo: FlacStreamInfo | undefined;
  let totalMetadataBytes = 0;

  while (cursor < input.length) {
    const headerOffset = cursor;
    const blockHeader = parseBlockHeader(input, cursor);
    cursor += BLOCK_HEADER_SIZE;

    if (cursor + blockHeader.length > input.length) {
      throw new FlacInvalidMetadataError(
        `Block body of ${blockHeader.length} bytes extends past EOF`,
        headerOffset,
      );
    }

    // M-3: Use subarray (zero-copy view) instead of slice to halve peak memory.
    const body = input.subarray(cursor, cursor + blockHeader.length);
    cursor += blockHeader.length;

    // M-3: Cumulative metadata bytes cap (64 MiB total).
    totalMetadataBytes += blockHeader.length;
    if (totalMetadataBytes > MAX_METADATA_BYTES) {
      throw new FlacInvalidMetadataError(
        `Metadata exceeds 64 MiB cumulative cap (${totalMetadataBytes} bytes so far)`,
        headerOffset,
      );
    }

    blocks.push({ type: blockHeader.type, data: body });

    if (blockHeader.type === BLOCK_TYPE_STREAMINFO) {
      if (streamInfo !== undefined) {
        throw new FlacInvalidMetadataError('Duplicate STREAMINFO block (Trap #10)', headerOffset);
      }
      streamInfo = decodeStreamInfo(body, headerOffset);
    }

    if (blockHeader.lastBlock) break;
  }

  if (streamInfo === undefined) {
    throw new FlacInvalidMetadataError('STREAMINFO block not found', 0);
  }

  // Validate STREAMINFO is first (Trap #10)
  if (blocks[0]?.type !== BLOCK_TYPE_STREAMINFO) {
    throw new FlacInvalidMetadataError('STREAMINFO must be the first metadata block', 0);
  }

  // Step 4: Frame loop
  const frames: FlacFrame[] = [];
  const si = streamInfo;

  // C-2: Per-frame scan cap: 2× maxFrameSize or 1 MiB hard fallback.
  const frameScanCap =
    si.maxFrameSize > 0
      ? Math.max(si.maxFrameSize * 2, FRAME_SCAN_FALLBACK_CAP)
      : FRAME_SCAN_FALLBACK_CAP;

  // M-1: Track CRC-16 failure rate to detect fully-corrupt streams.
  let syncsAttempted = 0;
  let crc16Mismatches = 0;

  while (cursor < input.length) {
    // Find next sync
    const syncOffset = findFrameSync(input, cursor);
    if (syncOffset < 0) break;
    cursor = syncOffset;

    // Parse frame header (with CRC-8 verification)
    let parsed: ReturnType<typeof parseFrameHeader>;
    try {
      parsed = parseFrameHeader(input, cursor, si.sampleRate, si.bitsPerSample, true);
    } catch {
      // False sync — advance one byte and keep scanning
      cursor++;
      continue;
    }

    syncsAttempted++;

    // C-2: Scan forward to find the next sync, but cap the search distance.
    const frameStart = cursor;
    const searchEnd = Math.min(frameStart + parsed.headerBytes + frameScanCap, input.length);
    const nextSync = findFrameSync(input, frameStart + parsed.headerBytes, searchEnd);
    const frameEnd = nextSync < 0 ? input.length : nextSync;

    const frameData = input.subarray(frameStart, frameEnd);

    // Verify CRC-16 over the entire frame (Trap #2: includes the CRC-8 byte)
    const storedCrc16 =
      ((frameData[frameData.length - 2] ?? 0) << 8) | (frameData[frameData.length - 1] ?? 0);
    const computedCrc16 = crc16(frameData, 0, frameData.length - 2);

    if (storedCrc16 !== computedCrc16) {
      crc16Mismatches++;
      // If CRC fails and there is a next sync, this was likely a false sync — skip.
      if (nextSync >= 0) {
        cursor++;
        continue;
      }
      // C-2: No next sync found within cap — advance by 1 instead of consuming rest.
      if (nextSync < 0 && searchEnd < input.length) {
        cursor++;
        continue;
      }
      // At EOF with CRC mismatch — report the error
      throw new FlacCrc16MismatchError(frameStart, storedCrc16, computedCrc16);
    }

    frames.push({
      sampleNumber: parsed.sampleNumber,
      blockSize: parsed.blockSize,
      sampleRate: parsed.sampleRate,
      channels: parsed.channels,
      bitsPerSample: parsed.bitsPerSample,
      channelAssignment: parsed.channelAssignment,
      // Store as a copy so subarray views don't hold onto the full input buffer.
      data: frameData.slice(),
    });

    cursor = frameEnd;
  }

  // M-1: If the overwhelming majority of sync candidates had bad CRC-16 and we
  // found no valid frames, treat the file as corrupt rather than silently
  // returning an empty frames array.
  if (
    syncsAttempted > MIN_SYNCS_FOR_CORRUPT_DETECTION &&
    crc16Mismatches / syncsAttempted > 0.5 &&
    frames.length === 0
  ) {
    throw new FlacCrc16MismatchError(0, 0, 0);
  }

  return { streamInfo, blocks, frames };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scan for the 14-bit FLAC frame sync word (0x3FFE) starting at `start`.
 * Returns the byte offset of the first sync byte or -1 if not found.
 *
 * The sync word occupies the top 14 bits of a two-byte sequence:
 *   byte[i]   == 0xFF
 *   byte[i+1] == 0xF8..0xFF (with bit 1 clear for reserved=0)
 * More precisely: the 14-bit sync is 0b11111111111110 in the first 14 bits.
 *   byte[i]   = 0xFF
 *   byte[i+1] & 0xFC = 0xF8  (top 6 bits = 111110, bottom 2 bits = blocking_strategy + reserved)
 *
 * @param end - Optional exclusive upper bound (defaults to bytes.length - 1).
 */
function findFrameSync(bytes: Uint8Array, start: number, end?: number): number {
  const limit = Math.min(end !== undefined ? end : bytes.length, bytes.length) - 1;
  for (let i = start; i < limit; i++) {
    // Bounded: i < limit = bytes.length - 1 so bytes[i] and bytes[i+1] are defined.
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1] as number;
    if (b0 === 0xff && (b1 & 0xfc) === 0xf8) {
      // Verify sync by checking the 14-bit value explicitly
      const sync14 = ((b0 << 6) | (b1 >> 2)) & 0x3fff;
      if (sync14 === FRAME_SYNC_CODE) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Skip an ID3v2 tag if one is present at `offset` in `bytes`.
 * Returns the new cursor position after the tag (or unchanged if no tag).
 *
 * ID3v2 header: "ID3" (3 bytes) + version (2) + flags (1) + syncsafe-size (4)
 * Trap #3: mpg123/LAME sometimes prefix FLAC files with ID3v2 tags.
 *
 * H-1 fixes:
 * (a) Validates all 4 size bytes have MSB clear (syncsafe spec requires bit 7 = 0).
 * (b) Caps the resulting size at MAX_ID3_BODY; throws FlacInvalidMetadataError if exceeded.
 */
function skipId3v2(bytes: Uint8Array, offset: number): number {
  if (
    bytes[offset] !== ID3V2_MAGIC[0] ||
    bytes[offset + 1] !== ID3V2_MAGIC[1] ||
    bytes[offset + 2] !== ID3V2_MAGIC[2]
  ) {
    return offset;
  }
  // ID3v2 size is a 4-byte syncsafe integer at bytes 6–9
  if (offset + 10 > bytes.length) return offset;

  // H-1a: Per ID3v2 syncsafe spec, all 4 size bytes must have MSB clear.
  const s6 = bytes[offset + 6] as number;
  const s7 = bytes[offset + 7] as number;
  const s8 = bytes[offset + 8] as number;
  const s9 = bytes[offset + 9] as number;

  if ((s6 & 0x80) !== 0 || (s7 & 0x80) !== 0 || (s8 & 0x80) !== 0 || (s9 & 0x80) !== 0) {
    // Not a valid syncsafe size — treat as not-an-ID3-tag.
    return offset;
  }

  const sz = (s6 << 21) | (s7 << 14) | (s8 << 7) | s9;

  // H-1b: Cap at MAX_ID3_BODY to prevent pathologically large tag skips.
  if (sz > MAX_ID3_BODY) {
    throw new FlacInvalidMetadataError(
      `ID3v2 tag body claims ${sz} bytes, exceeding the ${MAX_ID3_BODY}-byte cap`,
      offset,
    );
  }

  // Total ID3v2 size = 10-byte header + sz
  return offset + 10 + sz;
}

/**
 * Require the 4-byte "fLaC" magic at `offset`, throw otherwise.
 */
function requireMagic(bytes: Uint8Array, offset: number): void {
  for (let i = 0; i < 4; i++) {
    if (bytes[offset + i] !== FLAC_MAGIC[i]) {
      throw new FlacInvalidMagicError(offset);
    }
  }
}
