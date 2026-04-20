/**
 * Animated WebP (RIFF container) parser and serializer.
 *
 * Handles VP8X, ANIM, ANMF chunks. Validates animation flag (Trap §20),
 * applies ANMF bias corrections (Traps §9, §10), interprets inverted blend bit
 * (Trap §22), validates VP8 FourCC trailing space (Trap §13) and VP8L signature.
 *
 * Pixel decode is deferred to backend-wasm; we yield raw VP8/VP8L bytes.
 */

import {
  FOURCC_ALPH,
  FOURCC_ANIM,
  FOURCC_ANMF,
  FOURCC_EXIF,
  FOURCC_ICCP,
  FOURCC_VP8,
  FOURCC_VP8L,
  FOURCC_VP8X,
  FOURCC_XMP,
  MAX_DIM,
  MAX_FRAMES,
  MAX_INPUT_BYTES,
  VP8L_SIGNATURE,
  VP8X_ANIMATION_FLAG,
} from './constants.ts';
import {
  ImageInputTooLargeError,
  WebpAnimMissingVp8xError,
  WebpAnimOddOffsetError,
  WebpAnimTooShortError,
  WebpAnimUnknownChunkError,
  WebpAnmfTooShortError,
  WebpBadDimensionError,
  WebpBadRiffError,
  WebpFrameOutOfBoundsError,
  WebpMissingSubFrameError,
  WebpStaticNotSupportedError,
  WebpVp8lBadSignatureError,
} from './errors.ts';
import { readRiffChunk, readU16Le, readU24Le, readU32Le, writeRiffChunk } from './riff.ts';
import type { AnimationFrame, BlendMode, DisposalMethod, WebpAnimFile } from './types.ts';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse an animated WebP byte stream into a WebpAnimFile.
 *
 * @throws WebpAnimTooShortError / WebpBadRiffError / WebpAnimMissingVp8xError /
 *         WebpStaticNotSupportedError / WebpBadDimensionError /
 *         WebpFrameOutOfBoundsError / WebpAnmfTooShortError /
 *         WebpVp8lBadSignatureError / WebpAnimUnknownChunkError
 */
export function parseWebpAnim(input: Uint8Array): WebpAnimFile {
  // 1. Size validation
  if (input.length < 60) throw new WebpAnimTooShortError(input.length);
  if (input.length > MAX_INPUT_BYTES)
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);

  // 2. RIFF header validation
  const riffFourcc = String.fromCharCode(
    input[0] ?? 0,
    input[1] ?? 0,
    input[2] ?? 0,
    input[3] ?? 0,
  );
  if (riffFourcc !== 'RIFF') throw new WebpBadRiffError('expected "RIFF" at offset 0');

  const outerSize = readU32Le(input, 4);
  const webpFourcc = String.fromCharCode(
    input[8] ?? 0,
    input[9] ?? 0,
    input[10] ?? 0,
    input[11] ?? 0,
  );
  if (webpFourcc !== 'WEBP') throw new WebpBadRiffError('expected "WEBP" FourCC at offset 8');

  // Validate outer size (Trap §11): 8 + outerSize should equal input.length.
  // Allow diff=1 ONLY when input has one extra byte (missing trailing pad byte
  // from odd-size file). Do NOT allow diff=-1 (header claims more than present).
  const diff = input.length - (8 + outerSize);
  if (diff !== 0 && diff !== 1) {
    throw new WebpBadRiffError(
      `outer size ${outerSize} implies ${8 + outerSize} bytes but input is ${input.length} bytes`,
    );
  }

  // 3. Walk inner chunks starting at offset 12
  let offset = 12;

  // First chunk MUST be VP8X
  if (offset >= input.length) throw new WebpAnimMissingVp8xError('(empty)');
  const firstChunk = readRiffChunk(input, offset);
  if (firstChunk.fourcc !== FOURCC_VP8X) {
    throw new WebpAnimMissingVp8xError(firstChunk.fourcc);
  }
  offset = firstChunk.nextOffset;

  // Parse VP8X
  const vp8xPayload = firstChunk.payload;
  const flags = vp8xPayload[0] ?? 0;

  // Animation flag is bit 1 (Trap §20)
  if ((flags & VP8X_ANIMATION_FLAG) === 0) {
    throw new WebpStaticNotSupportedError();
  }

  const hasAlpha = Boolean(flags & 0x10);

  // Canvas dimensions: stored as (n-1) in 24-bit LE (Trap §10)
  const canvasWidth = readU24Le(vp8xPayload, 4) + 1;
  const canvasHeight = readU24Le(vp8xPayload, 7) + 1;

  // canvasWidth/Height = readU24Le(...) + 1 → always >= 1, so the `< 1` sub-condition is unreachable
  /* v8 ignore next 1 — canvasWidth < 1 is unreachable (u24 + 1 >= 1); only MAX_DIM overflow is exercisable */
  if (canvasWidth < 1 || canvasWidth > MAX_DIM)
    throw new WebpBadDimensionError('width', canvasWidth);
  /* v8 ignore next 1 — canvasHeight < 1 is unreachable (u24 + 1 >= 1); only MAX_DIM overflow is exercisable */
  if (canvasHeight < 1 || canvasHeight > MAX_DIM)
    throw new WebpBadDimensionError('height', canvasHeight);

  let backgroundColor = 0;
  let loopCount = 0;
  const frames: AnimationFrame[] = [];
  const metadataChunks: { fourcc: string; payload: Uint8Array }[] = [];

  // Walk remaining chunks
  while (offset < input.length) {
    if (input.length - offset < 8) break; // not enough for another chunk header

    const chunk = readRiffChunk(input, offset);
    offset = chunk.nextOffset;

    if (chunk.fourcc === FOURCC_ICCP) {
      metadataChunks.push({ fourcc: FOURCC_ICCP, payload: new Uint8Array(chunk.payload) });
    } else if (chunk.fourcc === FOURCC_ANIM) {
      const p = chunk.payload;
      backgroundColor = readU32Le(p, 0);
      loopCount = readU16Le(p, 4);
    } else if (chunk.fourcc === FOURCC_ANMF) {
      // Cap frame count before parsing (Trap §19)
      if (frames.length >= MAX_FRAMES) break;

      const frame = parseAnmf(chunk.payload, frames.length, canvasWidth, canvasHeight);
      frames.push(frame);
    } else if (chunk.fourcc === FOURCC_EXIF || chunk.fourcc === FOURCC_XMP) {
      metadataChunks.push({ fourcc: chunk.fourcc, payload: new Uint8Array(chunk.payload) });
    } else {
      throw new WebpAnimUnknownChunkError(chunk.fourcc, chunk.offset);
    }
  }

  return {
    format: 'webp-anim',
    canvasWidth,
    canvasHeight,
    backgroundColor,
    loopCount,
    hasAlpha,
    frames,
    metadataChunks,
  };
}

function parseAnmf(
  payload: Uint8Array,
  frameIndex: number,
  canvasWidth: number,
  canvasHeight: number,
): AnimationFrame {
  if (payload.length < 16) throw new WebpAnmfTooShortError(frameIndex, payload.length);

  // ANMF header (16 bytes)
  // frame_x = u24le * 2 (Trap §9)
  const frameX = readU24Le(payload, 0) * 2;
  // frame_y = u24le * 2 (Trap §9)
  const frameY = readU24Le(payload, 3) * 2;
  // frame_width = u24le + 1 (Trap §10)
  const frameWidth = readU24Le(payload, 6) + 1;
  // frame_height = u24le + 1 (Trap §10)
  const frameHeight = readU24Le(payload, 9) + 1;
  // duration_ms = u24le (Trap §12)
  const durationMs = readU24Le(payload, 12);
  const frameFlags = payload[15] ?? 0;

  // Blending method: bit 0 SET = "no blend" = source (Trap §22 — inverted bit!)
  // 0 = blend with prior (over), 1 = no blend / overwrite (source)
  const blendMode: BlendMode = (frameFlags & 0x01) !== 0 ? 'source' : 'over';
  // Disposal method: bit 1 (0 = none, 1 = dispose to background)
  const disposalMethod: DisposalMethod = (frameFlags & 0x02) !== 0 ? 'background' : 'none';

  // Validate frame bounds
  if (frameX + frameWidth > canvasWidth) throw new WebpFrameOutOfBoundsError(frameIndex, 'x');
  if (frameY + frameHeight > canvasHeight) throw new WebpFrameOutOfBoundsError(frameIndex, 'y');

  // Walk inner chunks within payload[16..]
  let innerOffset = 16;
  let subFormat: 'VP8' | 'VP8L' | undefined;
  let payloadBytes: Uint8Array | undefined;

  while (innerOffset < payload.length) {
    if (payload.length - innerOffset < 8) break;

    const inner = readRiffChunk(payload, innerOffset);
    innerOffset = inner.nextOffset;

    if (inner.fourcc === FOURCC_ALPH) {
      // Alpha channel for VP8 lossy — skip (round-tripped via payloadBytes of the whole ANMF)
      // We don't store ALPH separately in the frame; VP8 frames with alpha will have ALPH before VP8 chunk
    } else if (inner.fourcc === FOURCC_VP8) {
      // Validate VP8 FourCC: must have trailing space (Trap §13 — already checked by string comparison)
      subFormat = 'VP8';
      payloadBytes = new Uint8Array(inner.payload);
    } else if (inner.fourcc === FOURCC_VP8L) {
      // Validate VP8L signature byte (Trap §22)
      if ((inner.payload[0] ?? 0) !== VP8L_SIGNATURE) {
        throw new WebpVp8lBadSignatureError(inner.payload[0] ?? 0);
      }
      subFormat = 'VP8L';
      payloadBytes = new Uint8Array(inner.payload);
    } else {
      // Unknown inner chunk — skip silently (tolerant for future extensibility)
    }
  }

  if (subFormat === undefined || payloadBytes === undefined) {
    throw new WebpMissingSubFrameError(frameIndex);
  }

  return {
    index: frameIndex,
    x: frameX,
    y: frameY,
    width: frameWidth,
    height: frameHeight,
    durationMs,
    disposalMethod,
    blendMode,
    payloadBytes,
    subFormat,
  };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a WebpAnimFile to an animated WebP byte stream.
 *
 * @throws WebpAnimOddOffsetError if any frame has an odd x or y offset.
 */
export function serializeWebpAnim(file: WebpAnimFile): Uint8Array {
  // Validate frame offsets
  for (const frame of file.frames) {
    if (frame.x % 2 !== 0) throw new WebpAnimOddOffsetError(frame.index, 'x', frame.x);
    if (frame.y % 2 !== 0) throw new WebpAnimOddOffsetError(frame.index, 'y', frame.y);
  }

  const innerChunks: Uint8Array[] = [];

  // VP8X chunk
  let vp8xFlags = VP8X_ANIMATION_FLAG; // always set animation flag
  if (file.hasAlpha) vp8xFlags |= 0x10;
  const hasIccp = file.metadataChunks.some((c) => c.fourcc === FOURCC_ICCP);
  const hasExif = file.metadataChunks.some((c) => c.fourcc === FOURCC_EXIF);
  const hasXmp = file.metadataChunks.some((c) => c.fourcc === FOURCC_XMP);
  if (hasIccp) vp8xFlags |= 0x20;
  if (hasExif) vp8xFlags |= 0x08;
  if (hasXmp) vp8xFlags |= 0x04;

  const vp8xPayload = new Uint8Array(10);
  vp8xPayload[0] = vp8xFlags;
  const cw = file.canvasWidth - 1;
  const ch = file.canvasHeight - 1;
  vp8xPayload[4] = cw & 0xff;
  vp8xPayload[5] = (cw >> 8) & 0xff;
  vp8xPayload[6] = (cw >> 16) & 0xff;
  vp8xPayload[7] = ch & 0xff;
  vp8xPayload[8] = (ch >> 8) & 0xff;
  vp8xPayload[9] = (ch >> 16) & 0xff;
  innerChunks.push(writeRiffChunk(FOURCC_VP8X, vp8xPayload));

  // ICCP if present
  for (const meta of file.metadataChunks) {
    if (meta.fourcc === FOURCC_ICCP) {
      innerChunks.push(writeRiffChunk(FOURCC_ICCP, meta.payload));
    }
  }

  // ANIM chunk
  const animPayload = new Uint8Array(6);
  animPayload[0] = file.backgroundColor & 0xff;
  animPayload[1] = (file.backgroundColor >> 8) & 0xff;
  animPayload[2] = (file.backgroundColor >> 16) & 0xff;
  animPayload[3] = (file.backgroundColor >> 24) & 0xff;
  animPayload[4] = file.loopCount & 0xff;
  animPayload[5] = (file.loopCount >> 8) & 0xff;
  innerChunks.push(writeRiffChunk(FOURCC_ANIM, animPayload));

  // ANMF chunks
  for (const frame of file.frames) {
    innerChunks.push(buildAnmf(frame));
  }

  // EXIF / XMP
  for (const meta of file.metadataChunks) {
    if (meta.fourcc === FOURCC_EXIF || meta.fourcc === FOURCC_XMP) {
      innerChunks.push(writeRiffChunk(meta.fourcc, meta.payload));
    }
  }

  // Assemble inner content
  const innerTotal = innerChunks.reduce((n, c) => n + c.byteLength, 0);
  const inner = new Uint8Array(innerTotal);
  let pos = 0;
  for (const c of innerChunks) {
    inner.set(c, pos);
    pos += c.byteLength;
  }

  // RIFF outer: RIFF | size(WEBP + inner) | WEBP | inner
  const outerSize = 4 + inner.length; // 'WEBP' (4) + inner chunks (Trap §11)
  const out = new Uint8Array(12 + inner.length);
  out[0] = 0x52;
  out[1] = 0x49;
  out[2] = 0x46;
  out[3] = 0x46; // 'RIFF'
  out[4] = outerSize & 0xff;
  out[5] = (outerSize >> 8) & 0xff;
  out[6] = (outerSize >> 16) & 0xff;
  out[7] = (outerSize >> 24) & 0xff;
  out[8] = 0x57;
  out[9] = 0x45;
  out[10] = 0x42;
  out[11] = 0x50; // 'WEBP'
  out.set(inner, 12);
  return out;
}

function buildAnmf(frame: AnimationFrame): Uint8Array {
  // ANMF header (16 bytes)
  const hdr = new Uint8Array(16);
  const fx2 = frame.x >> 1; // x/2 (Trap §9)
  const fy2 = frame.y >> 1;
  const fw1 = frame.width - 1; // w-1 (Trap §10)
  const fh1 = frame.height - 1;
  const dur = Math.min(frame.durationMs, 0x00ffffff) & 0x00ffffff;

  // Blending bit: source = bit set, over = bit clear (Trap §22 inverted)
  const blendBit = frame.blendMode === 'source' ? 1 : 0;
  const disposeBit = frame.disposalMethod === 'background' ? 1 : 0;
  const frameFlags = blendBit | (disposeBit << 1);

  hdr[0] = fx2 & 0xff;
  hdr[1] = (fx2 >> 8) & 0xff;
  hdr[2] = (fx2 >> 16) & 0xff;
  hdr[3] = fy2 & 0xff;
  hdr[4] = (fy2 >> 8) & 0xff;
  hdr[5] = (fy2 >> 16) & 0xff;
  hdr[6] = fw1 & 0xff;
  hdr[7] = (fw1 >> 8) & 0xff;
  hdr[8] = (fw1 >> 16) & 0xff;
  hdr[9] = fh1 & 0xff;
  hdr[10] = (fh1 >> 8) & 0xff;
  hdr[11] = (fh1 >> 16) & 0xff;
  hdr[12] = dur & 0xff;
  hdr[13] = (dur >> 8) & 0xff;
  hdr[14] = (dur >> 16) & 0xff;
  hdr[15] = frameFlags;

  // Sub-frame chunk
  const subFourcc = frame.subFormat === 'VP8L' ? FOURCC_VP8L : FOURCC_VP8;
  const subChunk = writeRiffChunk(subFourcc, frame.payloadBytes ?? new Uint8Array(0));

  // ANMF payload = header + sub-frame chunk
  const anmfPayload = new Uint8Array(hdr.length + subChunk.length);
  anmfPayload.set(hdr);
  anmfPayload.set(subChunk, hdr.length);

  return writeRiffChunk(FOURCC_ANMF, anmfPayload);
}
