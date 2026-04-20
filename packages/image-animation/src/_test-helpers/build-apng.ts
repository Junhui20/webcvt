/**
 * Synthetic APNG builder for tests.
 *
 * Builds valid APNG byte streams using the production writePngChunk/crc32Two
 * helpers, so the resulting bytes are valid input for parseApng.
 */

import { writePngChunk } from '../png-chunks.ts';
import { concat } from './bytes.ts';

export interface ApngFrameSpec {
  x?: number;
  y?: number;
  w: number;
  h: number;
  delayNum?: number;
  delayDen?: number;
  dispose?: number; // 0=NONE, 1=BACKGROUND, 2=PREVIOUS
  blend?: number; // 0=SOURCE, 1=OVER
  /** Raw zlib-compressed payload bytes for this frame. */
  payload: Uint8Array;
}

export interface BuildApngOptions {
  w: number;
  h: number;
  numPlays?: number;
  frames: ApngFrameSpec[];
  /**
   * If true, the first fcTL appears before IDAT (first frame IS the IDAT).
   * If false, IDAT appears before all fcTL (IDAT is a hidden default).
   */
  idatIsFirstFrame?: boolean;
  /** Extra ancillary chunks to include (e.g. PLTE, gAMA). */
  ancillary?: { type: string; data: Uint8Array }[];
}

/** Build a minimal zlib-wrapped payload for testing (just the zlib header bytes). */
export function minimalZlibPayload(length = 2): Uint8Array {
  // Minimal valid "zlib" payload: CMF=0x78 FLG=0x01 (no actual data, adler32 checksum)
  // For testing parsers that don't decode; just needs to be non-empty
  const out = new Uint8Array(length + 6);
  out[0] = 0x78; // zlib CMF (deflate, window size 32K)
  out[1] = 0x9c; // FLG (default compression, no dict)
  // rest: 0x00 bytes (invalid but parsers checking structure only pass this)
  // Adler-32 of empty data: 1 = 0x00 0x00 0x00 0x01 at end
  out[out.length - 1] = 0x01;
  return out;
}

/**
 * Build a complete APNG byte stream from the given spec.
 * The resulting bytes are valid input for parseApng.
 */
export function buildApng(opts: BuildApngOptions): Uint8Array {
  const idatIsFirst = opts.idatIsFirstFrame !== false; // default true
  const numFrames = opts.frames.length;
  const numPlays = opts.numPlays ?? 0;

  const parts: Uint8Array[] = [];

  // PNG signature
  parts.push(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  // IHDR chunk (13 bytes)
  const ihdr = new Uint8Array(13);
  ihdr[0] = (opts.w >> 24) & 0xff;
  ihdr[1] = (opts.w >> 16) & 0xff;
  ihdr[2] = (opts.w >> 8) & 0xff;
  ihdr[3] = opts.w & 0xff;
  ihdr[4] = (opts.h >> 24) & 0xff;
  ihdr[5] = (opts.h >> 16) & 0xff;
  ihdr[6] = (opts.h >> 8) & 0xff;
  ihdr[7] = opts.h & 0xff;
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  parts.push(writePngChunk('IHDR', ihdr));

  // acTL chunk (8 bytes)
  const actl = new Uint8Array(8);
  actl[0] = (numFrames >> 24) & 0xff;
  actl[1] = (numFrames >> 16) & 0xff;
  actl[2] = (numFrames >> 8) & 0xff;
  actl[3] = numFrames & 0xff;
  actl[4] = (numPlays >> 24) & 0xff;
  actl[5] = (numPlays >> 16) & 0xff;
  actl[6] = (numPlays >> 8) & 0xff;
  actl[7] = numPlays & 0xff;
  parts.push(writePngChunk('acTL', actl));

  // Extra ancillary chunks before frames
  if (opts.ancillary) {
    for (const c of opts.ancillary) {
      parts.push(writePngChunk(c.type, c.data));
    }
  }

  let seqNum = 0;

  if (idatIsFirst) {
    // fcTL for frame 0 (seq=0) before IDAT
    for (let i = 0; i < numFrames; i++) {
      const frame = opts.frames[i]!;

      // fcTL
      parts.push(buildFctl(seqNum, frame));
      seqNum++;

      if (i === 0) {
        // First frame: use IDAT
        parts.push(writePngChunk('IDAT', frame.payload));
      } else {
        // Subsequent frames: fdAT
        parts.push(buildFdat(seqNum, frame.payload));
        seqNum++;
      }
    }
  } else {
    // IDAT is a hidden default image (occurs before any fcTL)
    // Use the first frame's payload as the IDAT content
    const defaultPayload = opts.frames[0]?.payload ?? new Uint8Array(0);
    parts.push(writePngChunk('IDAT', defaultPayload));

    // All frames are fdAT-based
    for (let i = 0; i < numFrames; i++) {
      const frame = opts.frames[i]!;

      // fcTL
      parts.push(buildFctl(seqNum, frame));
      seqNum++;

      // fdAT
      parts.push(buildFdat(seqNum, frame.payload));
      seqNum++;
    }
  }

  // IEND
  parts.push(writePngChunk('IEND', new Uint8Array(0)));

  return concat(...parts);
}

function buildFctl(seqNum: number, frame: ApngFrameSpec): Uint8Array {
  const x = frame.x ?? 0;
  const y = frame.y ?? 0;
  const delayNum = frame.delayNum ?? 1;
  const delayDen = frame.delayDen ?? 10;
  const dispose = frame.dispose ?? 0;
  const blend = frame.blend ?? 0;

  const data = new Uint8Array(26);
  let off = 0;
  data[off++] = (seqNum >> 24) & 0xff;
  data[off++] = (seqNum >> 16) & 0xff;
  data[off++] = (seqNum >> 8) & 0xff;
  data[off++] = seqNum & 0xff;
  data[off++] = (frame.w >> 24) & 0xff;
  data[off++] = (frame.w >> 16) & 0xff;
  data[off++] = (frame.w >> 8) & 0xff;
  data[off++] = frame.w & 0xff;
  data[off++] = (frame.h >> 24) & 0xff;
  data[off++] = (frame.h >> 16) & 0xff;
  data[off++] = (frame.h >> 8) & 0xff;
  data[off++] = frame.h & 0xff;
  data[off++] = (x >> 24) & 0xff;
  data[off++] = (x >> 16) & 0xff;
  data[off++] = (x >> 8) & 0xff;
  data[off++] = x & 0xff;
  data[off++] = (y >> 24) & 0xff;
  data[off++] = (y >> 16) & 0xff;
  data[off++] = (y >> 8) & 0xff;
  data[off++] = y & 0xff;
  data[off++] = (delayNum >> 8) & 0xff;
  data[off++] = delayNum & 0xff;
  data[off++] = (delayDen >> 8) & 0xff;
  data[off++] = delayDen & 0xff;
  data[off++] = dispose & 0xff;
  data[off++] = blend & 0xff;
  return writePngChunk('fcTL', data);
}

function buildFdat(seqNum: number, payload: Uint8Array): Uint8Array {
  // fdAT = 4-byte sequence_number prefix + payload bytes (Trap §2)
  const data = new Uint8Array(4 + payload.length);
  data[0] = (seqNum >> 24) & 0xff;
  data[1] = (seqNum >> 16) & 0xff;
  data[2] = (seqNum >> 8) & 0xff;
  data[3] = seqNum & 0xff;
  data.set(payload, 4);
  return writePngChunk('fdAT', data);
}
