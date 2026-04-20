/**
 * QOI (Quite OK Image) parser/serializer.
 *
 * Key traps handled:
 *   Trap §6: 8-byte end marker validated BEFORE decode loop AND pos checked AFTER.
 *   Trap §7: previousPixel=(0,0,0,255) but index slots=(0,0,0,0) — different alpha.
 *   Trap §8: 8-bit QOI_OP_RGB/RGBA checked FIRST before 2-bit tag dispatch.
 *            QOI_OP_RUN length capped 1..62.
 *   Trap §10: dimensions validated before typed-array allocation.
 *   Trap §11: channels in {3,4}, colorspace in {0,1} validated.
 */

import {
  MAX_DIM,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
  MAX_PIXEL_BYTES,
  QOI_END_MARKER,
  QOI_HEADER_SIZE,
  QOI_MAGIC,
  QOI_MAX_RUN,
  QOI_OP_RGB,
  QOI_OP_RGBA,
  QOI_TAG_DIFF,
  QOI_TAG_INDEX,
  QOI_TAG_LUMA,
  QOI_TAG_RUN,
} from './constants.ts';
import {
  ImageInputTooLargeError,
  ImagePixelCapError,
  QoiBadHeaderError,
  QoiBadMagicError,
  QoiMissingEndMarkerError,
  QoiSizeMismatchError,
  QoiTooShortError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QoiFile {
  format: 'qoi';
  width: number;
  height: number;
  channels: 3 | 4;
  /** 0 = sRGB with linear alpha; 1 = all linear. Round-tripped verbatim. */
  colorspace: 0 | 1;
  /** Decoded interleaved RGB or RGBA, row-major top-down. */
  pixelData: Uint8Array;
}

// ---------------------------------------------------------------------------
// QOI hash function
// ---------------------------------------------------------------------------

function qoiHash(r: number, g: number, b: number, a: number): number {
  return (r * 3 + g * 5 + b * 7 + a * 11) & 0x3f;
}

// ---------------------------------------------------------------------------
// QOI parser
// ---------------------------------------------------------------------------

export function parseQoi(input: Uint8Array): QoiFile {
  if (input.length > MAX_INPUT_BYTES)
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);

  // Minimum: 14-byte header + 8-byte end marker
  if (input.length < QOI_HEADER_SIZE + 8) throw new QoiTooShortError(input.length);

  // Validate magic (Trap §11 / Trap §6 ordering)
  for (let i = 0; i < 4; i++) {
    if ((input[i] ?? 0) !== (QOI_MAGIC[i] ?? 0)) throw new QoiBadMagicError();
  }

  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const width = dv.getUint32(4, false);
  const height = dv.getUint32(8, false);
  const channelsByte = input[12] ?? 0;
  const colorspaceByte = input[13] ?? 0;

  // Trap §11: validate channels and colorspace
  if (channelsByte !== 3 && channelsByte !== 4)
    throw new QoiBadHeaderError('channels', channelsByte);
  if (colorspaceByte !== 0 && colorspaceByte !== 1)
    throw new QoiBadHeaderError('colorspace', colorspaceByte);

  const channels = channelsByte as 3 | 4;
  const colorspace = colorspaceByte as 0 | 1;

  // Dimension and pixel-byte caps before allocation — Trap §10
  if (width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) {
    throw new ImagePixelCapError(
      `QOI: dimensions ${width}×${height} out of range [1, ${MAX_DIM}].`,
    );
  }
  const pixelCount = width * height;
  if (pixelCount > MAX_PIXELS) {
    throw new ImagePixelCapError(
      `QOI: pixel count ${pixelCount} exceeds MAX_PIXELS ${MAX_PIXELS}.`,
    );
  }
  const pixelBytes = pixelCount * channels;
  if (pixelBytes > MAX_PIXEL_BYTES) {
    throw new ImagePixelCapError(
      `QOI: pixel byte count ${pixelBytes} exceeds MAX_PIXEL_BYTES ${MAX_PIXEL_BYTES}.`,
    );
  }

  // Trap §6: validate end marker BEFORE decode loop
  const endOffset = input.length - 8;
  for (let i = 0; i < 8; i++) {
    if ((input[endOffset + i] ?? 0) !== (QOI_END_MARKER[i] ?? 0)) {
      throw new QoiMissingEndMarkerError();
    }
  }

  const pixelData = new Uint8Array(pixelBytes);

  // Decoder state — Trap §7: previousPixel has alpha=255; index slots have alpha=0
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 255;
  const index = new Uint8Array(64 * 4); // all zeros (alpha=0 in each slot)

  let pos = QOI_HEADER_SIZE;
  let dst = 0;

  while (dst < pixelData.length) {
    const byte = input[pos++] ?? 0;

    // Trap §8: check 8-bit opcodes FIRST
    if (byte === QOI_OP_RGB) {
      r = input[pos++] ?? 0;
      g = input[pos++] ?? 0;
      b = input[pos++] ?? 0;
      // alpha unchanged
    } else if (byte === QOI_OP_RGBA) {
      r = input[pos++] ?? 0;
      g = input[pos++] ?? 0;
      b = input[pos++] ?? 0;
      a = input[pos++] ?? 0;
    } else {
      // 2-bit tag dispatch
      const tag = byte & 0xc0;

      if (tag === QOI_TAG_INDEX) {
        const slot = (byte & 0x3f) * 4;
        r = index[slot] ?? 0;
        g = index[slot + 1] ?? 0;
        b = index[slot + 2] ?? 0;
        a = index[slot + 3] ?? 0;
      } else if (tag === QOI_TAG_DIFF) {
        const dr = ((byte >> 4) & 0x03) - 2;
        const dg = ((byte >> 2) & 0x03) - 2;
        const db = (byte & 0x03) - 2;
        r = (r + dr) & 0xff;
        g = (g + dg) & 0xff;
        b = (b + db) & 0xff;
        // alpha unchanged
      } else if (tag === QOI_TAG_LUMA) {
        const second = input[pos++] ?? 0;
        const dg = (byte & 0x3f) - 32;
        const dr = ((second >> 4) & 0x0f) - 8 + dg;
        const db = (second & 0x0f) - 8 + dg;
        r = (r + dr) & 0xff;
        g = (g + dg) & 0xff;
        b = (b + db) & 0xff;
        // alpha unchanged
      } else {
        // QOI_TAG_RUN (tag === 0xC0) — Trap §8: length 1..62 only.
        // Sec-H-3: explicitly reject run-length values 63 and 64 — those bit
        // patterns (0xFE, 0xFF) are reserved for QOI_OP_RGB / QOI_OP_RGBA at
        // the 8-bit level (caught earlier above), so a RUN op with those low-6
        // bits is malformed. Note: we already early-return for 0xFE/0xFF
        // above, so this branch can only see byte ∈ [0xC0, 0xFD], giving
        // runLen ∈ [1, 62] inherently — but defence-in-depth assertion guards
        // against any future refactor breaking the early-return invariant.
        const runLen = (byte & 0x3f) + 1;
        /* v8 ignore next 5 — defence-in-depth; unreachable while RGB/RGBA early-return holds */
        if (runLen > 62) {
          throw new QoiSizeMismatchError(
            `QOI_OP_RUN length ${runLen} exceeds maximum 62; bytes 0xFE/0xFF reserved for RGB/RGBA opcodes.`,
          );
        }
        for (let run = 0; run < runLen; run++) {
          pixelData[dst++] = r;
          pixelData[dst++] = g;
          pixelData[dst++] = b;
          if (channels === 4) pixelData[dst++] = a;
        }
        // Update index for the run pixel
        const slot = qoiHash(r, g, b, a) * 4;
        index[slot] = r;
        index[slot + 1] = g;
        index[slot + 2] = b;
        index[slot + 3] = a;
        continue;
      }
    }

    // Update index — Trap §7
    const slot = qoiHash(r, g, b, a) * 4;
    index[slot] = r;
    index[slot + 1] = g;
    index[slot + 2] = b;
    index[slot + 3] = a;

    // Write pixel
    pixelData[dst++] = r;
    pixelData[dst++] = g;
    pixelData[dst++] = b;
    if (channels === 4) pixelData[dst++] = a;
  }

  // Trap §6: pos must be exactly at end marker start after decode
  if (pos !== input.length - 8) {
    throw new QoiSizeMismatchError(
      `stream position ${pos} after decode does not equal input.length - 8 = ${input.length - 8}.`,
    );
  }

  return { format: 'qoi', width, height, channels, colorspace, pixelData };
}

// ---------------------------------------------------------------------------
// QOI serializer
// ---------------------------------------------------------------------------

export function serializeQoi(file: QoiFile): Uint8Array {
  const { width, height, channels, colorspace, pixelData } = file;

  // Maximum possible size: header + (channels + 1 byte per pixel) + end marker
  const maxSize = QOI_HEADER_SIZE + width * height * (channels + 1) + 8;
  const out = new Uint8Array(maxSize);
  let pos = 0;

  // Write 14-byte header
  const dv = new DataView(out.buffer);
  out[pos++] = QOI_MAGIC[0] ?? 0x71;
  out[pos++] = QOI_MAGIC[1] ?? 0x6f;
  out[pos++] = QOI_MAGIC[2] ?? 0x69;
  out[pos++] = QOI_MAGIC[3] ?? 0x66;
  dv.setUint32(pos, width, false);
  pos += 4;
  dv.setUint32(pos, height, false);
  pos += 4;
  out[pos++] = channels;
  out[pos++] = colorspace;

  // Encoder state — Trap §7
  let pr = 0;
  let pg = 0;
  let pb = 0;
  let pa = 255;
  const index = new Uint8Array(64 * 4); // all zeros
  let runLen = 0;

  const pixelCount = width * height;

  const emitRun = (): void => {
    out[pos++] = QOI_TAG_RUN | (runLen - 1);
    runLen = 0;
  };

  for (let i = 0; i < pixelCount; i++) {
    const base = i * channels;
    const cr = pixelData[base] ?? 0;
    const cg = pixelData[base + 1] ?? 0;
    const cb = pixelData[base + 2] ?? 0;
    const ca = channels === 4 ? (pixelData[base + 3] ?? 0) : 255;

    if (cr === pr && cg === pg && cb === pb && ca === pa) {
      runLen++;
      // Trap §8: cap at 62, emit immediately when at max
      if (runLen === QOI_MAX_RUN) emitRun();
      continue;
    }

    if (runLen > 0) emitRun();

    // Check index
    const hashSlot = qoiHash(cr, cg, cb, ca);
    const slot = hashSlot * 4;
    const ir = index[slot] ?? 0;
    const ig = index[slot + 1] ?? 0;
    const ib = index[slot + 2] ?? 0;
    const ia = index[slot + 3] ?? 0;

    if (ir === cr && ig === cg && ib === cb && ia === ca) {
      out[pos++] = QOI_TAG_INDEX | hashSlot;
    } else {
      // Update index
      index[slot] = cr;
      index[slot + 1] = cg;
      index[slot + 2] = cb;
      index[slot + 3] = ca;

      if (ca !== pa) {
        // Must use RGBA opcode
        out[pos++] = QOI_OP_RGBA;
        out[pos++] = cr;
        out[pos++] = cg;
        out[pos++] = cb;
        out[pos++] = ca;
      } else {
        // Compute signed deltas (wrap around 256)
        const dr = ((cr - pr + 256) & 0xff) > 127 ? cr - pr + 256 - 256 : (cr - pr + 256) & 0xff;
        const dg = ((cg - pg + 256) & 0xff) > 127 ? cg - pg + 256 - 256 : (cg - pg + 256) & 0xff;
        const db = ((cb - pb + 256) & 0xff) > 127 ? cb - pb + 256 - 256 : (cb - pb + 256) & 0xff;

        if (dr >= -2 && dr <= 1 && dg >= -2 && dg <= 1 && db >= -2 && db <= 1) {
          // QOI_OP_DIFF
          out[pos++] = QOI_TAG_DIFF | ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2);
        } else if (
          dg >= -32 &&
          dg <= 31 &&
          dr - dg >= -8 &&
          dr - dg <= 7 &&
          db - dg >= -8 &&
          db - dg <= 7
        ) {
          // QOI_OP_LUMA
          out[pos++] = QOI_TAG_LUMA | (dg + 32);
          out[pos++] = ((dr - dg + 8) << 4) | (db - dg + 8);
        } else {
          // QOI_OP_RGB
          out[pos++] = QOI_OP_RGB;
          out[pos++] = cr;
          out[pos++] = cg;
          out[pos++] = cb;
        }
      }
    }

    pr = cr;
    pg = cg;
    pb = cb;
    pa = ca;
  }

  // Flush any pending run
  if (runLen > 0) emitRun();

  // Append 8-byte end marker
  for (let i = 0; i < 8; i++) {
    out[pos++] = QOI_END_MARKER[i] ?? 0;
  }

  return out.subarray(0, pos);
}
