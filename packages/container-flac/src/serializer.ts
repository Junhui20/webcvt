/**
 * FLAC muxer — serialize a FlacFile back to a Uint8Array.
 *
 * Algorithm (per design note §Muxer):
 * 1. Write "fLaC" magic.
 * 2. Write metadata blocks in order; set last_block flag on the final block.
 *    Ensure STREAMINFO (type 0) is first (Trap #10).
 *    Recompute totalSamples from frames if it was 0 in the original.
 * 3. Write each frame's data bytes verbatim (lossless).
 */

import { FlacInvalidMetadataError } from './errors.ts';
import type { FlacFrame } from './frame.ts';
import type { FlacMetadataBlock } from './metadata.ts';
import { BLOCK_TYPE_STREAMINFO, encodeBlockHeader } from './metadata.ts';
import type { FlacFile } from './parser.ts';
import { encodeStreamInfo } from './streaminfo.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLAC_MAGIC = new Uint8Array([0x66, 0x4c, 0x61, 0x43]); // "fLaC"

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize a FlacFile to a canonical FLAC byte stream.
 *
 * Throws:
 * - FlacInvalidMetadataError — STREAMINFO is not the first block.
 */
export function serializeFlac(file: FlacFile): Uint8Array {
  const { blocks, frames, streamInfo } = file;

  // Validate STREAMINFO is first (Trap #10)
  if (blocks[0]?.type !== BLOCK_TYPE_STREAMINFO) {
    throw new FlacInvalidMetadataError('STREAMINFO must be the first metadata block', 0);
  }

  // Recompute totalSamples if it was 0 (unknown) in the original
  let effectiveStreamInfo = streamInfo;
  if (streamInfo.totalSamples === 0 && frames.length > 0) {
    const counted = frames.reduce((acc: number, f: FlacFrame) => acc + f.blockSize, 0);
    effectiveStreamInfo = { ...streamInfo, totalSamples: counted };
  }

  const parts: Uint8Array[] = [FLAC_MAGIC];

  // Write metadata blocks
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block === undefined) continue;
    const isLast = i === blocks.length - 1;

    let bodyBytes: Uint8Array;
    if (block.type === BLOCK_TYPE_STREAMINFO) {
      // Re-encode STREAMINFO with potentially updated totalSamples
      bodyBytes = encodeStreamInfo(effectiveStreamInfo);
    } else {
      bodyBytes = block.data;
    }

    const header = encodeBlockHeader(isLast, block.type, bodyBytes.length);
    parts.push(header);
    parts.push(bodyBytes);
  }

  // Write audio frames verbatim
  for (const frame of frames) {
    parts.push(frame.data);
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
