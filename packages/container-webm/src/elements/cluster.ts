/**
 * Cluster element (ID 0x1F43B675) and SimpleBlock decode and encode.
 *
 * Implements:
 * - Timecode (required in WebM — Trap §8)
 * - SimpleBlock with unlaced (00) and Xiph-laced (01) frames (Trap §5/§6)
 * - Absolute timestamp computation (Trap §4/§5)
 * - Per-track block count cap
 */

import { findChild } from '@webcvt/ebml';
import type { EbmlElement } from '@webcvt/ebml';
import {
  concatBytes,
  readUint,
  readVintId,
  readVintSize,
  writeUint,
  writeVintId,
  writeVintSize,
} from '@webcvt/ebml';
import {
  ID_CLUSTER,
  ID_SIMPLE_BLOCK,
  ID_TIMECODE,
  ID_VOID,
  MAX_BLOCKS_PER_TRACK,
} from '../constants.ts';
import {
  WebmCorruptStreamError,
  WebmLacingNotSupportedError,
  WebmMissingTimecodeError,
  WebmTooManyBlocksError,
} from '../errors.ts';
import { encodeMasterElement, encodeUintElement } from './header.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebmSimpleBlock {
  trackNumber: number;
  /**
   * Absolute timestamp in nanoseconds.
   * = (Cluster.Timecode + timecode_delta) * timecodeScale
   */
  timestampNs: bigint;
  keyframe: boolean;
  invisible: boolean;
  discardable: boolean;
  /**
   * Frame payloads: 1 for unlaced, N for Xiph-laced.
   * Each is a zero-copy subarray into fileBytes.
   */
  frames: Uint8Array[];
}

export interface WebmCluster {
  /** Absolute file offset of the Cluster element start. */
  fileOffset: number;
  /** Cluster.Timecode in TimecodeScale units. */
  timecode: bigint;
  blocks: WebmSimpleBlock[];
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

/**
 * Decode a single Cluster element.
 *
 * @param bytes         Full file buffer.
 * @param clusterElem   The Cluster element descriptor.
 * @param timecodeScale Info.timecodeScale (ns per tick).
 * @param blockCounts   Mutable map of trackNumber → block count (cap enforcement).
 */
export function decodeCluster(
  bytes: Uint8Array,
  clusterElem: EbmlElement,
  timecodeScale: number,
  blockCounts: Map<number, number>,
): WebmCluster {
  let timecode: bigint | undefined;
  const blocks: WebmSimpleBlock[] = [];

  let cursor = clusterElem.payloadOffset;
  const end = clusterElem.nextOffset;

  while (cursor < end) {
    // Read element header manually (avoid full walker overhead in hot path).
    if (end - cursor < 2) break;

    const idVint = readVintId(bytes, cursor);
    const sizeOffset = cursor + idVint.width;
    const sizeVint = readVintSize(bytes, sizeOffset);
    const payloadOffset = sizeOffset + sizeVint.width;

    if (sizeVint.value === -1n) {
      // Unknown size inside cluster: advance to end (best-effort).
      break;
    }

    const elemSize = Number(sizeVint.value);
    const nextOffset = payloadOffset + elemSize;

    if (nextOffset > end) break; // truncated element, stop

    const id = idVint.value;

    if (id === ID_TIMECODE) {
      timecode = readUint(bytes.subarray(payloadOffset, nextOffset));
    } else if (id === ID_SIMPLE_BLOCK) {
      if (timecode === undefined) {
        // Must have seen Timecode before any SimpleBlock (Trap §8).
        throw new WebmMissingTimecodeError(clusterElem.payloadOffset);
      }
      const block = decodeSimpleBlock(
        bytes,
        payloadOffset,
        elemSize,
        timecode,
        timecodeScale,
        blockCounts,
      );
      if (block !== null) {
        blocks.push(block);
      }
    }
    // All other IDs (Void, BlockGroup, PrevSize, Position, etc.) are skipped (Trap §14).

    cursor = nextOffset;
  }

  if (timecode === undefined) {
    throw new WebmMissingTimecodeError(clusterElem.payloadOffset);
  }

  return {
    fileOffset: clusterElem.payloadOffset - clusterElem.idWidth - clusterElem.sizeWidth,
    timecode,
    blocks,
  };
}

/**
 * Decode one SimpleBlock from its raw payload bytes.
 *
 * Returns null if the block is for a track not in our set (ignored).
 *
 * Trap §5: track_number VINT (size-style, marker stripped) + 2-byte signed BE int16
 * timecode_delta + 1-byte flags + payload.
 * Trap §6: lacing modes 10 and 11 throw WebmLacingNotSupportedError.
 */
function decodeSimpleBlock(
  bytes: Uint8Array,
  payloadOffset: number,
  payloadSize: number,
  clusterTimecode: bigint,
  timecodeScale: number,
  blockCounts: Map<number, number>,
): WebmSimpleBlock | null {
  if (payloadSize < 4) return null; // too small for any valid block

  // Track number VINT (size-style: marker stripped).
  const trackVint = readVintSize(bytes, payloadOffset);
  const trackNumber = Number(trackVint.value);
  const afterTrack = payloadOffset + trackVint.width;

  if (afterTrack + 3 > payloadOffset + payloadSize) return null;

  // 2-byte signed big-endian timecode delta (Trap §5).
  const view = new DataView(bytes.buffer, bytes.byteOffset + afterTrack, 2);
  const timecodeDelta = view.getInt16(0, false); // big-endian (false = big-endian)
  const afterDelta = afterTrack + 2;

  // Flags byte.
  const flags = bytes[afterDelta] as number;
  const keyframe = (flags & 0x80) !== 0;
  const invisible = (flags & 0x08) !== 0;
  const lacing = (flags >> 1) & 0x03;
  const discardable = (flags & 0x01) !== 0;
  const frameStart = afterDelta + 1;

  // Compute absolute timestamp (Trap §5).
  const absoluteTimecode = clusterTimecode + BigInt(timecodeDelta);
  const timestampNs = absoluteTimecode * BigInt(timecodeScale);

  // Validate remaining payload.
  const payloadEnd = payloadOffset + payloadSize;
  const framePayloadSize = payloadEnd - frameStart;

  // Block count cap (per-track).
  const prevCount = blockCounts.get(trackNumber) ?? 0;
  if (prevCount >= MAX_BLOCKS_PER_TRACK) {
    throw new WebmTooManyBlocksError(trackNumber, MAX_BLOCKS_PER_TRACK);
  }
  blockCounts.set(trackNumber, prevCount + 1);

  let frames: Uint8Array[];

  if (lacing === 0) {
    // No lacing: single frame is the entire remaining payload.
    frames = [bytes.subarray(frameStart, payloadEnd)];
  } else if (lacing === 1) {
    // Xiph lacing (Trap §6).
    frames = decodeXiphLacing(bytes, frameStart, payloadEnd);
  } else {
    // Lacing modes 10 (fixed-size) and 11 (EBML) are deferred (Trap §6).
    throw new WebmLacingNotSupportedError(lacing);
  }

  return {
    trackNumber,
    timestampNs,
    keyframe,
    invisible,
    discardable,
    frames,
  };
}

/**
 * Decode Xiph-laced frames from a SimpleBlock payload.
 *
 * Xiph lacing layout (after flags byte):
 *   1 byte: lace_count_minus_one
 *   N-1 frame sizes: each size is a Xiph-style chain of 0xFF bytes followed by
 *     a non-0xFF terminating byte. Size = sum(0xFF bytes) * 255 + ... actually:
 *     each group of 255-bytes means +255 to the running sum, until a byte < 255
 *     terminates the group. More precisely: each frame's size is the sum of
 *     consecutive 255-value bytes plus the first non-255 byte.
 *   Last frame's size = remaining payload bytes.
 *
 * Per the Matroska spec: lace_count_minus_one gives how many frames minus one.
 * So lace_count = lace_count_minus_one + 1.
 */
function decodeXiphLacing(bytes: Uint8Array, frameStart: number, payloadEnd: number): Uint8Array[] {
  if (frameStart >= payloadEnd) {
    throw new WebmCorruptStreamError(
      'Xiph lacing size table extends beyond SimpleBlock payload at lace index 0',
    );
  }

  const laceCountMinusOne = bytes[frameStart] as number;
  const frameCount = laceCountMinusOne + 1;
  let cursor = frameStart + 1;

  // Read N-1 Xiph-encoded frame sizes.
  const sizes: number[] = [];
  for (let i = 0; i < frameCount - 1; i++) {
    let size = 0;
    let b: number;
    do {
      if (cursor >= payloadEnd) {
        // Sec-H-3: malformed lace table extends beyond SimpleBlock payload.
        throw new WebmCorruptStreamError(
          `Xiph lacing size table extends beyond SimpleBlock payload at lace index ${i}`,
        );
      }
      b = bytes[cursor] as number;
      size += b;
      cursor++;
    } while (b === 255);
    sizes.push(size);
  }

  // Last frame size = remaining payload after the size table, minus all explicit frame sizes.
  const sumSizes = sizes.reduce((a, b) => a + b, 0);
  const lastFrameSize = payloadEnd - cursor - sumSizes;
  // Validate: last frame size must be non-negative.
  if (lastFrameSize < 0) {
    // Sec-H-3: sum of laced frame sizes exceeds remaining payload.
    throw new WebmCorruptStreamError(
      `Xiph lacing sum-of-sizes (${sumSizes}) exceeds remaining payload (${payloadEnd - cursor}); malformed lace`,
    );
  }

  // Extract frame subarrays (zero-copy).
  const frames: Uint8Array[] = [];
  let frameOffset = cursor;
  for (const sz of sizes) {
    frames.push(bytes.subarray(frameOffset, frameOffset + sz));
    frameOffset += sz;
  }
  frames.push(bytes.subarray(frameOffset, frameOffset + lastFrameSize));

  return frames;
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/**
 * Encode a single Cluster element to bytes.
 *
 * First pass: emits one SimpleBlock per frame (no lacing on write path).
 */
export function encodeCluster(cluster: WebmCluster, timecodeScale: number): Uint8Array {
  const parts: Uint8Array[] = [encodeUintElement(ID_TIMECODE, cluster.timecode)];

  for (const block of cluster.blocks) {
    // Each frame becomes its own SimpleBlock; see encodeSimpleBlock JSDoc.
    parts.push(encodeSimpleBlock(block, cluster.timecode, timecodeScale));
  }

  return encodeMasterElement(ID_CLUSTER, concatBytes(parts));
}

/**
 * Encode one WebmSimpleBlock to wire bytes.
 *
 * First-pass limitation: laced input frames are emitted as separate unlaced
 * SimpleBlocks. The wire representation of the input cluster is therefore not
 * preserved across serialize; semantic equivalence (same frames, same
 * timestamps, same codec) is preserved.
 */
function encodeSimpleBlock(
  block: WebmSimpleBlock,
  clusterTimecode: bigint,
  timecodeScale: number,
): Uint8Array {
  // Compute timecode_delta = block.timestampNs / timecodeScale - clusterTimecode.
  const absoluteTimecode =
    timecodeScale > 0 ? block.timestampNs / BigInt(timecodeScale) : block.timestampNs;
  const delta = Number(absoluteTimecode - clusterTimecode);

  // Build one SimpleBlock per frame (no lacing on write).
  const blockParts: Uint8Array[] = [];
  for (const frame of block.frames) {
    const payload = buildSimpleBlockPayload(block.trackNumber, delta, block, frame);
    const idBytes = writeVintId(ID_SIMPLE_BLOCK);
    const sizeBytes = writeVintSize(BigInt(payload.length));
    blockParts.push(concatBytes([idBytes, sizeBytes, payload]));
  }

  return concatBytes(blockParts);
}

function buildSimpleBlockPayload(
  trackNumber: number,
  timecodeDelta: number,
  block: WebmSimpleBlock,
  frame: Uint8Array,
): Uint8Array {
  // Track number as 1-byte VINT for tracks 1..127 (common case).
  const trackVint = writeVintSize(BigInt(trackNumber), 1);

  // 2-byte big-endian signed int16 timecode delta (Trap §17).
  const deltaBytes = new Uint8Array(2);
  const deltaView = new DataView(deltaBytes.buffer);
  deltaView.setInt16(0, Math.max(-32768, Math.min(32767, timecodeDelta)), false);

  // Flags byte.
  let flags = 0;
  if (block.keyframe) flags |= 0x80;
  if (block.invisible) flags |= 0x08;
  // lacing = 00 (no lacing on write path)
  if (block.discardable) flags |= 0x01;
  const flagsByte = new Uint8Array([flags]);

  return concatBytes([trackVint, deltaBytes, flagsByte, frame]);
}
