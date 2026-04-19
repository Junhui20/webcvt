/**
 * Cluster element (ID 0x1F43B675) and SimpleBlock decode and encode for Matroska.
 *
 * Implements:
 * - Timecode (required in Matroska — Trap §8)
 * - SimpleBlock with unlaced (00) and Xiph-laced (01) frames (Trap §5/§6)
 * - EBML and fixed-size lacing (modes 10/11) rejected (Trap §6)
 * - Absolute timestamp computation (Trap §4/§5)
 * - Track number 2-byte VINT support for tracks > 127 (Trap §24)
 * - Per-track block count cap
 */

import {
  ID_CLUSTER,
  ID_SIMPLE_BLOCK,
  ID_TIMECODE,
  ID_VOID,
  MAX_BLOCKS_PER_TRACK,
  MAX_BLOCK_PAYLOAD_BYTES,
  MAX_ELEMENTS_PER_FILE,
  MAX_ELEMENT_PAYLOAD_BYTES,
} from '../constants.ts';
import type { EbmlElement } from '../ebml-element.ts';
import { concatBytes, readUint, writeUint } from '../ebml-types.ts';
import { readVintId, readVintSize, writeVintId, writeVintSize } from '../ebml-vint.ts';
import {
  MkvCorruptStreamError,
  MkvElementTooLargeError,
  MkvLacingNotSupportedError,
  MkvMissingTimecodeError,
  MkvTooManyBlocksError,
  MkvTooManyElementsError,
} from '../errors.ts';
import { encodeMasterElement, encodeUintElement } from './header.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MkvSimpleBlock {
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

export interface MkvCluster {
  /** Absolute file offset of the Cluster element start. */
  fileOffset: number;
  /** Cluster.Timecode in TimecodeScale units. */
  timecode: bigint;
  blocks: MkvSimpleBlock[];
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
 * @param elementCount  Global element counter reference threaded from parseMkv (Sec-H-1).
 *                      Defaults to a fresh counter when called outside parseMkv (e.g. tests).
 */
export function decodeCluster(
  bytes: Uint8Array,
  clusterElem: EbmlElement,
  timecodeScale: number,
  blockCounts: Map<number, number>,
  elementCount: { value: number } = { value: 0 },
): MkvCluster {
  let timecode: bigint | undefined;
  const blocks: MkvSimpleBlock[] = [];

  let cursor = clusterElem.payloadOffset;
  const end = clusterElem.nextOffset;

  while (cursor < end) {
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

    // Sec-H-1: increment global element count for every inner-Cluster element and
    // enforce the per-file cap. Without this, a 256 MiB Cluster packed with ~16M
    // tiny 4-byte Void elements would spin the event loop indefinitely.
    elementCount.value++;
    if (elementCount.value > MAX_ELEMENTS_PER_FILE) {
      throw new MkvTooManyElementsError(MAX_ELEMENTS_PER_FILE);
    }

    const id = idVint.value;

    // Sec-M-1: enforce per-element size cap for SimpleBlock inside Cluster.
    // A single SimpleBlock with a 200 MiB payload size claim is already pathological;
    // 64 MiB matches MAX_ELEMENT_PAYLOAD_BYTES used for all other non-Cluster elements.
    if (id === ID_SIMPLE_BLOCK && elemSize > MAX_ELEMENT_PAYLOAD_BYTES) {
      throw new MkvElementTooLargeError(id, BigInt(elemSize), MAX_ELEMENT_PAYLOAD_BYTES);
    }

    if (id === ID_TIMECODE) {
      timecode = readUint(bytes.subarray(payloadOffset, nextOffset));
    } else if (id === ID_SIMPLE_BLOCK) {
      // Phase-1 strictness: Timecode-first ordering required.
      // Pre-2010 mkvtoolnix files may place Timecode after SimpleBlock; those are
      // deferred to Phase 3.5. For Phase 1 we require Timecode before SimpleBlock
      // (Trap §8, same as WebM). This matches the post-loop throw below which fires
      // when Timecode is absent entirely.
      if (timecode === undefined) {
        throw new MkvMissingTimecodeError(clusterElem.payloadOffset);
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
    throw new MkvMissingTimecodeError(clusterElem.payloadOffset);
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
 * Trap §5: track_number VINT (size-style, marker stripped) + 2-byte signed BE int16
 * timecode_delta + 1-byte flags + payload.
 * Trap §6: lacing modes 10 and 11 throw MkvLacingNotSupportedError.
 * Trap §24: track number may be 2-byte VINT for tracks > 127.
 */
function decodeSimpleBlock(
  bytes: Uint8Array,
  payloadOffset: number,
  payloadSize: number,
  clusterTimecode: bigint,
  timecodeScale: number,
  blockCounts: Map<number, number>,
): MkvSimpleBlock | null {
  if (payloadSize < 4) return null;

  // Track number VINT (size-style: marker stripped — Trap §24 use readVintSize not hardcoded byte).
  const trackVint = readVintSize(bytes, payloadOffset);
  const trackNumber = Number(trackVint.value);
  const afterTrack = payloadOffset + trackVint.width;

  if (afterTrack + 3 > payloadOffset + payloadSize) return null;

  // 2-byte signed big-endian timecode delta (Trap §5 and §17).
  const view = new DataView(bytes.buffer, bytes.byteOffset + afterTrack, 2);
  const timecodeDelta = view.getInt16(0, false); // false = big-endian
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

  const payloadEnd = payloadOffset + payloadSize;

  // Block count cap (per-track).
  const prevCount = blockCounts.get(trackNumber) ?? 0;
  if (prevCount >= MAX_BLOCKS_PER_TRACK) {
    throw new MkvTooManyBlocksError(trackNumber, MAX_BLOCKS_PER_TRACK);
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
    throw new MkvLacingNotSupportedError(lacing);
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
 * Per Sec-H-3 lesson: THROWS on malformed lace (do not return []).
 */
function decodeXiphLacing(bytes: Uint8Array, frameStart: number, payloadEnd: number): Uint8Array[] {
  if (frameStart >= payloadEnd) {
    throw new MkvCorruptStreamError(
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
        throw new MkvCorruptStreamError(
          `Xiph lacing size table extends beyond SimpleBlock payload at lace index ${i}`,
        );
      }
      b = bytes[cursor] as number;
      size += b;
      cursor++;
      // Sec-M-3: cap individual Xiph frame size to prevent DoS via tight accumulation loop
      // within a legitimately-sized SimpleBlock payload.
      if (size > MAX_BLOCK_PAYLOAD_BYTES) {
        throw new MkvCorruptStreamError(
          `Xiph lacing per-frame size at lace index ${i} exceeds maximum ${MAX_BLOCK_PAYLOAD_BYTES} bytes`,
        );
      }
    } while (b === 255);
    sizes.push(size);
  }

  const sumSizes = sizes.reduce((a, b) => a + b, 0);
  const lastFrameSize = payloadEnd - cursor - sumSizes;
  if (lastFrameSize < 0) {
    throw new MkvCorruptStreamError(
      `Xiph lacing sum-of-sizes (${sumSizes}) exceeds remaining payload (${payloadEnd - cursor}); malformed lace`,
    );
  }

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
 * First pass: emits one SimpleBlock per frame (no lacing on write path).
 */
export function encodeCluster(cluster: MkvCluster, timecodeScale: number): Uint8Array {
  const parts: Uint8Array[] = [encodeUintElement(ID_TIMECODE, cluster.timecode)];

  for (const block of cluster.blocks) {
    parts.push(encodeSimpleBlock(block, cluster.timecode, timecodeScale));
  }

  return encodeMasterElement(ID_CLUSTER, concatBytes(parts));
}

/**
 * Encode one MkvSimpleBlock to wire bytes.
 *
 * First-pass limitation: laced input frames are emitted as separate unlaced
 * SimpleBlocks. Semantic equivalence (same frames, same timestamps, same codec)
 * is preserved; byte-identity is not.
 */
function encodeSimpleBlock(
  block: MkvSimpleBlock,
  clusterTimecode: bigint,
  timecodeScale: number,
): Uint8Array {
  const absoluteTimecode =
    timecodeScale > 0 ? block.timestampNs / BigInt(timecodeScale) : block.timestampNs;
  const delta = Number(absoluteTimecode - clusterTimecode);

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
  block: MkvSimpleBlock,
  frame: Uint8Array,
): Uint8Array {
  // Track number as 1-byte VINT for tracks 1..127, 2-byte for 128..16383 (Trap §24).
  const trackVint =
    trackNumber <= 127
      ? writeVintSize(BigInt(trackNumber), 1)
      : writeVintSize(BigInt(trackNumber), 2);

  // 2-byte big-endian signed int16 timecode delta (Trap §17: false = big-endian required).
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
