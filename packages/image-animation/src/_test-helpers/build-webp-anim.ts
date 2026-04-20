/**
 * Synthetic animated WebP builder for tests.
 *
 * Builds valid animated WebP byte streams using the production writeRiffChunk
 * helper, so the resulting bytes are valid input for parseWebpAnim.
 */

import { writeRiffChunk } from '../riff.ts';
import { concat } from './bytes.ts';

export interface WebpFrameSpec {
  x: number; // must be even (stored as x/2)
  y: number; // must be even (stored as y/2)
  w: number; // stored as w-1
  h: number; // stored as h-1
  durationMs: number; // 24-bit value (max ~16.7M)
  /** 'none' or 'background'. */
  dispose?: 'none' | 'background';
  /** 'source' or 'over'. Source = no blend (bit set), over = blend (bit clear). Trap §22. */
  blend?: 'source' | 'over';
  subFormat: 'VP8' | 'VP8L';
  /** Raw sub-frame payload bytes. */
  payload: Uint8Array;
}

export interface BuildWebpAnimOptions {
  canvasW: number;
  canvasH: number;
  loopCount?: number;
  backgroundColor?: number; // u32 ARGB LE
  frames: WebpFrameSpec[];
  /** If true, sets the hasAlpha flag in VP8X. */
  hasAlpha?: boolean;
  /** Optional ICCP payload to include as a metadata chunk. */
  iccp?: Uint8Array;
  /** Optional EXIF payload. */
  exif?: Uint8Array;
  /** Optional XMP payload. */
  xmp?: Uint8Array;
}

/** Build a minimal fake VP8 payload (key frame, show_frame set). */
export function minimalVp8Payload(): Uint8Array {
  // VP8 frame tag: 3 bytes
  // bit 0 = key_frame (0 = key frame)
  // bit 1-3 = version (0)
  // bit 4 = show_frame (1 = shown)
  // bits 5-23 = first_part_size (0)
  const tag = 0x10; // bit 4 set (show_frame), key_frame = 0
  // Key frame: next 3 bytes must be 0x9D, 0x01, 0x2A (start code)
  return new Uint8Array([tag, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x02, 0x00, 0x02, 0x00]);
}

/** Build a minimal fake VP8L payload (starts with 0x2F signature). */
export function minimalVp8lPayload(): Uint8Array {
  return new Uint8Array([0x2f, 0x00, 0x00, 0x00, 0x00]);
}

/**
 * Build a complete animated WebP byte stream from the given spec.
 */
export function buildWebpAnim(opts: BuildWebpAnimOptions): Uint8Array {
  const bgColor = opts.backgroundColor ?? 0x00000000;
  const loopCount = opts.loopCount ?? 0;
  const hasAlpha = opts.hasAlpha ?? false;

  const chunks: Uint8Array[] = [];

  // VP8X chunk (10-byte payload)
  // flags: bit 1 = animation, bit 4 = alpha, bit 2 = XMP, bit 3 = EXIF, bit 5 = ICC
  let flags = 0x02; // animation flag always set
  if (hasAlpha) flags |= 0x10;
  if (opts.iccp) flags |= 0x20;
  if (opts.exif) flags |= 0x08;
  if (opts.xmp) flags |= 0x04;

  const vp8xPayload = new Uint8Array(10);
  vp8xPayload[0] = flags;
  // reserved: bytes 1-3 = 0
  const cw = opts.canvasW - 1;
  const ch = opts.canvasH - 1;
  vp8xPayload[4] = cw & 0xff;
  vp8xPayload[5] = (cw >> 8) & 0xff;
  vp8xPayload[6] = (cw >> 16) & 0xff;
  vp8xPayload[7] = ch & 0xff;
  vp8xPayload[8] = (ch >> 8) & 0xff;
  vp8xPayload[9] = (ch >> 16) & 0xff;
  chunks.push(writeRiffChunk('VP8X', vp8xPayload));

  // Optional ICCP
  if (opts.iccp) {
    chunks.push(writeRiffChunk('ICCP', opts.iccp));
  }

  // ANIM chunk (6 bytes)
  const animPayload = new Uint8Array(6);
  animPayload[0] = bgColor & 0xff;
  animPayload[1] = (bgColor >> 8) & 0xff;
  animPayload[2] = (bgColor >> 16) & 0xff;
  animPayload[3] = (bgColor >> 24) & 0xff;
  animPayload[4] = loopCount & 0xff;
  animPayload[5] = (loopCount >> 8) & 0xff;
  chunks.push(writeRiffChunk('ANIM', animPayload));

  // ANMF chunks
  for (const frame of opts.frames) {
    const frameChunks: Uint8Array[] = [];

    // ANMF 16-byte header
    const hdr = new Uint8Array(16);
    const fx2 = frame.x >> 1; // x/2 (Trap §9)
    const fy2 = frame.y >> 1; // y/2
    const fw1 = frame.w - 1; // w-1 (Trap §10)
    const fh1 = frame.h - 1; // h-1
    const dur = frame.durationMs & 0x00ffffff;

    // blending bit: Trap §22 — bit 0: 0 = blend (over), 1 = no blend (source)
    const blendBit = frame.blend === 'source' ? 1 : 0;
    const disposeBit = frame.dispose === 'background' ? 1 : 0;
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
    const subFourcc = frame.subFormat === 'VP8L' ? 'VP8L' : 'VP8 ';
    const subChunk = writeRiffChunk(subFourcc, frame.payload);

    // ANMF payload = header + sub-frame chunk
    const anmfPayload = concat(hdr, subChunk);
    chunks.push(writeRiffChunk('ANMF', anmfPayload));
  }

  // Optional EXIF / XMP
  if (opts.exif) chunks.push(writeRiffChunk('EXIF', opts.exif));
  if (opts.xmp) chunks.push(writeRiffChunk('XMP ', opts.xmp));

  // Assemble all chunks
  const allChunks = concat(...chunks);

  // RIFF outer wrapper: RIFF | size | WEBP | chunks
  // Size = 4 ('WEBP') + allChunks.length (Trap §11)
  const outerSize = 4 + allChunks.length;
  const outer = new Uint8Array(12 + allChunks.length);
  outer[0] = 0x52;
  outer[1] = 0x49;
  outer[2] = 0x46;
  outer[3] = 0x46; // 'RIFF'
  outer[4] = outerSize & 0xff;
  outer[5] = (outerSize >> 8) & 0xff;
  outer[6] = (outerSize >> 16) & 0xff;
  outer[7] = (outerSize >> 24) & 0xff;
  outer[8] = 0x57;
  outer[9] = 0x45;
  outer[10] = 0x42;
  outer[11] = 0x50; // 'WEBP'
  outer.set(allChunks, 12);

  return outer;
}
