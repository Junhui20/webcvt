/**
 * APNG container parser and serializer.
 *
 * Parses PNG chunk stream, validates acTL/fcTL/fdAT structure,
 * identifies idatIsFirstFrame, validates sequence_number invariant (Trap §1),
 * strips fdAT 4-byte prefix (Trap §2), and yields raw zlib payloads.
 *
 * Pixel decode is deferred to backend-wasm (we return payloadBytes).
 */

import {
  APNG_BLEND_OP_OVER,
  APNG_DISPOSE_OP_BACKGROUND,
  APNG_DISPOSE_OP_PREVIOUS,
  CHUNK_ACTL,
  CHUNK_FCTL,
  CHUNK_FDAT,
  CHUNK_IDAT,
  CHUNK_IEND,
  CHUNK_IHDR,
  MAX_DIM,
  MAX_FRAMES,
  MAX_IDAT_CHUNK_SIZE,
  MAX_INPUT_BYTES,
  MAX_TOTAL_FRAME_BYTES,
  PNG_MAGIC,
} from './constants.ts';
import {
  ApngBadDimensionError,
  ApngBadSequenceError,
  ApngBadSignatureError,
  ApngChunkOrderError,
  ApngFdatTooShortError,
  ApngFirstFramePreviousError,
  ApngFrameCountMismatchError,
  ApngFrameOutOfBoundsError,
  ApngFramesBytesExceededError,
  ApngHiddenDefaultNotSupportedError,
  ApngTooManyFramesError,
  ApngTooShortError,
  ApngUnknownCriticalChunkError,
  ApngZeroFramesError,
  ImageInputTooLargeError,
} from './errors.ts';
import { readPngChunk, writePngChunk } from './png-chunks.ts';
import type { AnimationFrame, ApngFile, BlendMode, DisposalMethod } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readU32Be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readU16Be(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)) >>> 0;
}

function mapApngDispose(op: number): DisposalMethod {
  switch (op) {
    case APNG_DISPOSE_OP_BACKGROUND:
      return 'background';
    case APNG_DISPOSE_OP_PREVIOUS:
      return 'previous';
    default:
      return 'none';
  }
}

function mapApngBlend(op: number): BlendMode {
  return op === APNG_BLEND_OP_OVER ? 'over' : 'source';
}

/** True if the chunk type's first letter is uppercase (= critical chunk). */
function isCritical(type: string): boolean {
  const code = type.charCodeAt(0);
  return code >= 0x41 && code <= 0x5a;
}

// Known non-critical ancillary chunk types we accept
const KNOWN_ANCILLARY = new Set([
  'PLTE',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'bKGD',
  'hIST',
  'pHYs',
  'sBIT',
  'sPLT',
  'tIME',
  'tEXt',
  'zTXt',
  'iTXt',
]);

// Known critical chunk types we handle
const HANDLED_CRITICAL = new Set([
  CHUNK_IHDR,
  CHUNK_IDAT,
  CHUNK_IEND,
  CHUNK_ACTL,
  CHUNK_FCTL,
  CHUNK_FDAT,
]);

// ---------------------------------------------------------------------------
// Mutable frame state during parsing
// ---------------------------------------------------------------------------

interface FrameBuilder {
  seqNum: number;
  x: number;
  y: number;
  width: number;
  height: number;
  delayNum: number;
  delayDen: number;
  disposeOp: number;
  blendOp: number;
  payloadChunks: Uint8Array[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse an APNG byte stream into an ApngFile.
 *
 * @throws ApngTooShortError / ApngBadSignatureError / ApngBadCrcError /
 *         ApngChunkTooLargeError / ApngBadSequenceError / ApngFdatTooShortError /
 *         ApngUnknownCriticalChunkError / ApngZeroFramesError /
 *         ApngFirstFramePreviousError / ApngFrameCountMismatchError
 */
export function parseApng(input: Uint8Array): ApngFile {
  // 1. Size validation
  if (input.length < 44) throw new ApngTooShortError(input.length);
  if (input.length > MAX_INPUT_BYTES)
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);

  // 2. PNG signature check
  for (let i = 0; i < 8; i++) {
    if ((input[i] ?? 0) !== (PNG_MAGIC[i] ?? 0)) throw new ApngBadSignatureError();
  }

  // 3. Walk chunks
  let offset = 8;

  let canvasWidth = 0;
  let canvasHeight = 0;
  let numFrames = 0;
  let numPlays = 0;

  // IHDR must be first chunk (CRIT-2: enforce ordering)
  let ihdrSeen = false;
  let firstChunkSeen = false;

  // idatIsFirstFrame detection: becomes true if we see a fcTL before any IDAT
  let fcTLSeenBeforeIdat = false;
  let idatSeen = false;
  let idatIsFirstFrame = false;

  let expectedSeq = 0;

  // In-progress frame
  let currentFrame: FrameBuilder | null = null;

  const completedFrames: FrameBuilder[] = [];
  const ancillaryChunks: { type: string; data: Uint8Array }[] = [];

  // Default image payload (when IDAT is hidden default)
  const defaultImagePayload: Uint8Array[] = [];

  while (offset < input.length) {
    const chunk = readPngChunk(input, offset);
    offset = chunk.nextOffset;
    const { type, data } = chunk;

    // Enforce IHDR-first ordering (CRIT-2)
    if (!firstChunkSeen) {
      firstChunkSeen = true;
      if (type !== CHUNK_IHDR) {
        throw new ApngChunkOrderError(type);
      }
    }

    if (type === CHUNK_IHDR) {
      ihdrSeen = true;
      canvasWidth = readU32Be(data, 0);
      canvasHeight = readU32Be(data, 4);
      // Validate canvas dimensions immediately after parsing (CRIT-2)
      if (canvasWidth < 1 || canvasWidth > MAX_DIM)
        throw new ApngBadDimensionError('canvas-width', canvasWidth);
      if (canvasHeight < 1 || canvasHeight > MAX_DIM)
        throw new ApngBadDimensionError('canvas-height', canvasHeight);
      ancillaryChunks.push({ type, data: new Uint8Array(data) });
    } else if (type === CHUNK_ACTL) {
      numFrames = readU32Be(data, 0);
      numPlays = readU32Be(data, 4);
      if (numFrames === 0) throw new ApngZeroFramesError();
      if (numFrames > MAX_FRAMES) throw new ApngTooManyFramesError(numFrames, MAX_FRAMES);
      // Multiplicative cap check (Trap §19) — only valid once IHDR (and thus canvas dims) is known
      if (ihdrSeen) {
        const totalBytes = numFrames * canvasWidth * canvasHeight * 4;
        if (totalBytes > MAX_TOTAL_FRAME_BYTES) {
          throw new ApngFramesBytesExceededError(totalBytes, MAX_TOTAL_FRAME_BYTES);
        }
      }
    } else if (type === CHUNK_FCTL) {
      // Finish previous frame if any
      if (currentFrame !== null) {
        completedFrames.push(currentFrame);
      }

      // Parse fcTL (26 bytes)
      const seqNum = readU32Be(data, 0);
      if (seqNum !== expectedSeq) throw new ApngBadSequenceError('fcTL', expectedSeq, seqNum);
      expectedSeq++;

      const fWidth = readU32Be(data, 4);
      const fHeight = readU32Be(data, 8);
      const fX = readU32Be(data, 12);
      const fY = readU32Be(data, 16);
      const delayNum = readU16Be(data, 20);
      const delayDen = readU16Be(data, 22);
      const disposeOp = data[24] ?? 0;
      const blendOp = data[25] ?? 0;

      // Per-frame fcTL bounds validation (CRIT-2 point 3)
      if (fWidth < 1 || fWidth > MAX_DIM) throw new ApngBadDimensionError('frame-width', fWidth);
      if (fHeight < 1 || fHeight > MAX_DIM)
        throw new ApngBadDimensionError('frame-height', fHeight);
      if (fX + fWidth > canvasWidth)
        throw new ApngFrameOutOfBoundsError(seqNum, 'x', fX + fWidth, canvasWidth);
      if (fY + fHeight > canvasHeight)
        throw new ApngFrameOutOfBoundsError(seqNum, 'y', fY + fHeight, canvasHeight);

      currentFrame = {
        seqNum,
        x: fX,
        y: fY,
        width: fWidth,
        height: fHeight,
        delayNum,
        delayDen,
        disposeOp,
        blendOp,
        payloadChunks: [],
      };

      if (!idatSeen) {
        fcTLSeenBeforeIdat = true;
      }
    } else if (type === CHUNK_IDAT) {
      idatSeen = true;
      if (fcTLSeenBeforeIdat && currentFrame !== null && completedFrames.length === 0) {
        // The IDAT is the first animation frame's data
        idatIsFirstFrame = true;
        currentFrame.payloadChunks.push(new Uint8Array(data));
      } else if (!fcTLSeenBeforeIdat) {
        // IDAT is a hidden default image
        idatIsFirstFrame = false;
        defaultImagePayload.push(new Uint8Array(data));
      } else if (currentFrame !== null) {
        // Subsequent IDAT chunks for the same frame (frame 0 can have multiple IDATs)
        currentFrame.payloadChunks.push(new Uint8Array(data));
      }
    } else if (type === CHUNK_FDAT) {
      // fdAT: 4-byte sequence prefix + zlib data (Trap §2)
      if (data.length < 4) throw new ApngFdatTooShortError(data.length);
      const seqNum = readU32Be(data, 0);
      if (seqNum !== expectedSeq) throw new ApngBadSequenceError('fdAT', expectedSeq, seqNum);
      expectedSeq++;

      if (currentFrame !== null) {
        // Strip 4-byte prefix (Trap §2)
        currentFrame.payloadChunks.push(new Uint8Array(data.subarray(4)));
      }
    } else if (type === CHUNK_IEND) {
      // Finalize current frame
      if (currentFrame !== null) {
        completedFrames.push(currentFrame);
        currentFrame = null;
      }
      break;
    } else {
      // Ancillary or unknown
      // PLTE and other known ancillary chunks must NOT be rejected even though
      // their first letter is uppercase (critical-bit set) — they are well-defined.
      if (isCritical(type) && !HANDLED_CRITICAL.has(type) && !KNOWN_ANCILLARY.has(type)) {
        throw new ApngUnknownCriticalChunkError(type);
      }
      ancillaryChunks.push({ type, data: new Uint8Array(data) });
    }
  }

  // Build frames array
  const frames: AnimationFrame[] = completedFrames.map((fb, index) => {
    // Concatenate payload chunks
    const totalLen = fb.payloadChunks.reduce((n, c) => n + c.length, 0);
    const payloadBytes = new Uint8Array(totalLen);
    let dst = 0;
    for (const c of fb.payloadChunks) {
      payloadBytes.set(c, dst);
      dst += c.length;
    }

    const delayDenActual = fb.delayDen === 0 ? 100 : fb.delayDen;
    const durationMs = Math.round((fb.delayNum / delayDenActual) * 1000);

    return {
      index,
      x: fb.x,
      y: fb.y,
      width: fb.width,
      height: fb.height,
      durationMs,
      disposalMethod: mapApngDispose(fb.disposeOp),
      blendMode: mapApngBlend(fb.blendOp),
      payloadBytes,
    };
  });

  // Validate frame count
  if (numFrames > 0 && frames.length !== numFrames) {
    throw new ApngFrameCountMismatchError(numFrames, frames.length);
  }

  // Validate first frame dispose_op (Trap §5 first-frame-previous)
  if (frames.length > 0 && frames[0]!.disposalMethod === 'previous') {
    throw new ApngFirstFramePreviousError();
  }

  return {
    format: 'apng',
    canvasWidth,
    canvasHeight,
    numPlays,
    numFrames: frames.length,
    idatIsFirstFrame,
    frames,
    ancillaryChunks,
  };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize an ApngFile to a PNG byte stream.
 *
 * @throws ApngHiddenDefaultNotSupportedError if idatIsFirstFrame=false.
 */
export function serializeApng(file: ApngFile): Uint8Array {
  if (!file.idatIsFirstFrame) {
    throw new ApngHiddenDefaultNotSupportedError();
  }

  const parts: Uint8Array[] = [];

  // PNG signature
  parts.push(new Uint8Array(PNG_MAGIC));

  // IHDR: find in ancillaryChunks, else build default
  const ihdrChunk = file.ancillaryChunks.find((c) => c.type === CHUNK_IHDR);
  if (ihdrChunk) {
    parts.push(writePngChunk(CHUNK_IHDR, ihdrChunk.data));
  } else {
    // Build minimal IHDR: width, height, 8-bit RGBA
    const ihdr = new Uint8Array(13);
    ihdr[0] = (file.canvasWidth >> 24) & 0xff;
    ihdr[1] = (file.canvasWidth >> 16) & 0xff;
    ihdr[2] = (file.canvasWidth >> 8) & 0xff;
    ihdr[3] = file.canvasWidth & 0xff;
    ihdr[4] = (file.canvasHeight >> 24) & 0xff;
    ihdr[5] = (file.canvasHeight >> 16) & 0xff;
    ihdr[6] = (file.canvasHeight >> 8) & 0xff;
    ihdr[7] = file.canvasHeight & 0xff;
    ihdr[8] = 8;
    ihdr[9] = 6; // 8-bit RGBA
    parts.push(writePngChunk(CHUNK_IHDR, ihdr));
  }

  // acTL
  const actl = new Uint8Array(8);
  actl[0] = (file.frames.length >> 24) & 0xff;
  actl[1] = (file.frames.length >> 16) & 0xff;
  actl[2] = (file.frames.length >> 8) & 0xff;
  actl[3] = file.frames.length & 0xff;
  actl[4] = (file.numPlays >> 24) & 0xff;
  actl[5] = (file.numPlays >> 16) & 0xff;
  actl[6] = (file.numPlays >> 8) & 0xff;
  actl[7] = file.numPlays & 0xff;
  parts.push(writePngChunk(CHUNK_ACTL, actl));

  // Emit ancillary chunks that aren't IHDR (skip fcTL, fdAT, IDAT, IEND we handle manually)
  const skipTypes = new Set([
    CHUNK_IHDR,
    CHUNK_IDAT,
    CHUNK_IEND,
    CHUNK_ACTL,
    CHUNK_FCTL,
    CHUNK_FDAT,
  ]);
  for (const c of file.ancillaryChunks) {
    if (!skipTypes.has(c.type)) {
      parts.push(writePngChunk(c.type, c.data));
    }
  }

  let seqNum = 0;

  for (let i = 0; i < file.frames.length; i++) {
    const frame = file.frames[i]!;

    // fcTL
    parts.push(buildFctl(seqNum, frame));
    seqNum++;

    const payload = frame.payloadBytes ?? new Uint8Array(0);

    if (i === 0) {
      // Frame 0: emit as IDAT chunk(s). The `|| off === 0` condition handles
      // the zero-length payload case (emits exactly one empty IDAT chunk).
      for (let off = 0; off < payload.length || off === 0; off += MAX_IDAT_CHUNK_SIZE) {
        const slice = payload.subarray(off, off + MAX_IDAT_CHUNK_SIZE);
        parts.push(writePngChunk(CHUNK_IDAT, slice));
        if (off + MAX_IDAT_CHUNK_SIZE >= payload.length) break;
      }
    } else {
      // Frames 1+: emit as fdAT chunk(s) with sequence prefix (Trap §2).
      // The `|| off === 0` condition handles the zero-length payload case
      // (emits exactly one fdAT chunk with only the sequence-number prefix).
      for (let off = 0; off < payload.length || off === 0; off += MAX_IDAT_CHUNK_SIZE) {
        const slice = payload.subarray(off, off + MAX_IDAT_CHUNK_SIZE);
        const fdatData = new Uint8Array(4 + slice.length);
        fdatData[0] = (seqNum >> 24) & 0xff;
        fdatData[1] = (seqNum >> 16) & 0xff;
        fdatData[2] = (seqNum >> 8) & 0xff;
        fdatData[3] = seqNum & 0xff;
        fdatData.set(slice, 4);
        parts.push(writePngChunk(CHUNK_FDAT, fdatData));
        seqNum++;
        if (off + MAX_IDAT_CHUNK_SIZE >= payload.length) break;
      }
    }
  }

  // IEND
  parts.push(writePngChunk(CHUNK_IEND, new Uint8Array(0)));

  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mapDisposalToOp(d: DisposalMethod): number {
  switch (d) {
    case 'background':
      return APNG_DISPOSE_OP_BACKGROUND;
    case 'previous':
      return APNG_DISPOSE_OP_PREVIOUS;
    default:
      return 0;
  }
}

function mapBlendToOp(b: BlendMode): number {
  return b === 'over' ? APNG_BLEND_OP_OVER : 0;
}

function buildFctl(seqNum: number, frame: AnimationFrame): Uint8Array {
  // Compute delayNum/delayDen from durationMs
  // Use 100 as denominator (centiseconds), numerator = durationMs / 10
  const delayNum = Math.round(frame.durationMs / 10);
  const delayDen = 100;

  const data = new Uint8Array(26);
  let off = 0;
  data[off++] = (seqNum >> 24) & 0xff;
  data[off++] = (seqNum >> 16) & 0xff;
  data[off++] = (seqNum >> 8) & 0xff;
  data[off++] = seqNum & 0xff;
  data[off++] = (frame.width >> 24) & 0xff;
  data[off++] = (frame.width >> 16) & 0xff;
  data[off++] = (frame.width >> 8) & 0xff;
  data[off++] = frame.width & 0xff;
  data[off++] = (frame.height >> 24) & 0xff;
  data[off++] = (frame.height >> 16) & 0xff;
  data[off++] = (frame.height >> 8) & 0xff;
  data[off++] = frame.height & 0xff;
  data[off++] = (frame.x >> 24) & 0xff;
  data[off++] = (frame.x >> 16) & 0xff;
  data[off++] = (frame.x >> 8) & 0xff;
  data[off++] = frame.x & 0xff;
  data[off++] = (frame.y >> 24) & 0xff;
  data[off++] = (frame.y >> 16) & 0xff;
  data[off++] = (frame.y >> 8) & 0xff;
  data[off++] = frame.y & 0xff;
  data[off++] = (delayNum >> 8) & 0xff;
  data[off++] = delayNum & 0xff;
  data[off++] = (delayDen >> 8) & 0xff;
  data[off++] = delayDen & 0xff;
  data[off++] = mapDisposalToOp(frame.disposalMethod);
  data[off++] = mapBlendToOp(frame.blendMode);
  return writePngChunk(CHUNK_FCTL, data);
}
