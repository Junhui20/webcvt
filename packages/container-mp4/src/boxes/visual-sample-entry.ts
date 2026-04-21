/**
 * VisualSampleEntry common header parser and types.
 *
 * Covers the 78-byte VisualSampleEntry common fields (ISO/IEC 14496-12 §12.1)
 * shared by avc1/avc3/hev1/hvc1/vp09/av01, plus child-box walking to locate
 * the codec-config child and collect extraBoxes.
 *
 * Wire layout (after the 8-byte box header — i.e. this is the payload):
 *   offset  size  field
 *     0      6    reserved:u8[6] = 0
 *     6      2    data_reference_index:u16
 *     8      2    pre_defined:u16 = 0
 *    10      2    reserved:u16 = 0
 *    12     12    pre_defined:u32[3] = 0
 *    24      2    width:u16
 *    26      2    height:u16
 *    28      4    horizresolution:u32 Q16.16
 *    32      4    vertresolution:u32 Q16.16
 *    36      4    reserved:u32 = 0
 *    40      2    frame_count:u16
 *    42     32    compressorname[32] (Pascal: u8 length + 31 chars)
 *    74      2    depth:u16
 *    76      2    pre_defined:i16 = -1 (0xFFFF)
 *    78      …    child boxes (avcC|hvcC|vpcC|av1C + extras)
 *
 * All multi-byte fields are big-endian.
 */

import {
  MAX_BOXES_PER_FILE,
  MAX_VIDEO_CODEC_CONFIG_BYTES,
  MAX_VIDEO_DIMENSION,
  MAX_VIDEO_EXTRA_BOXES_BYTES,
} from '../constants.ts';
import {
  Mp4Av1CMissingError,
  Mp4AvcCMissingError,
  Mp4HvcCMissingError,
  Mp4InvalidBoxError,
  Mp4TooManyBoxesError,
  Mp4UnsupportedVideoCodecError,
  Mp4VisualDimensionOutOfRangeError,
  Mp4VisualSampleEntryTooSmallError,
  Mp4VpcCMissingError,
} from '../errors.ts';
import { parseAv1C } from './av1C.ts';
import type { Mp4Av1Config } from './av1C.ts';
import { parseAvcC } from './avcC.ts';
import type { Mp4AvcConfig } from './avcC.ts';
import { deriveVideoCodecString } from './codec-string.ts';
import { parseHvcC } from './hvcC.ts';
import type { Mp4HvcConfig } from './hvcC.ts';
import { parseVpcC } from './vpcC.ts';
import type { Mp4VpcConfig } from './vpcC.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Mp4VideoFormat = 'avc1' | 'avc3' | 'hev1' | 'hvc1' | 'vp09' | 'av01';

export type Mp4VideoCodecConfig = Mp4AvcConfig | Mp4HvcConfig | Mp4VpcConfig | Mp4Av1Config;

export interface Mp4VideoSampleEntry {
  readonly format: Mp4VideoFormat;
  readonly dataReferenceIndex: number;
  readonly width: number;
  readonly height: number;
  /** Q16.16 raw u32 (0x00480000 = 72 dpi default). */
  readonly horizResolution: number;
  /** Q16.16 raw u32 (0x00480000 = 72 dpi default). */
  readonly vertResolution: number;
  readonly frameCount: number;
  /** Decoded from Pascal string, Latin-1. */
  readonly compressorName: string;
  readonly depth: number;
  readonly codecConfig: Mp4VideoCodecConfig;
  /** WebCodecs-ready codec string. */
  readonly codecString: string;
  /** Opaque trailing child boxes (btrt, pasp, colr, etc.) — round-trip verbatim. */
  readonly extraBoxes: Uint8Array;
}

/**
 * Mp4SampleEntry discriminated union — replaces Mp4Track.audioSampleEntry.
 */
export type Mp4SampleEntry =
  | { readonly kind: 'audio'; readonly entry: import('./hdlr-stsd-mp4a.ts').Mp4AudioSampleEntry }
  | { readonly kind: 'video'; readonly entry: Mp4VideoSampleEntry };

// ---------------------------------------------------------------------------
// Module-scope decoder (Latin-1 for compressorname)
// ---------------------------------------------------------------------------

const TEXT_DECODER_LATIN1 = new TextDecoder('latin1');

// ---------------------------------------------------------------------------
// VisualSampleEntry format set
// ---------------------------------------------------------------------------

const VIDEO_FORMATS = new Set<string>(['avc1', 'avc3', 'hev1', 'hvc1', 'vp09', 'av01']);

/**
 * Returns true for any of the six supported video 4ccs.
 */
export function isVideoFormat(fourCC: string): fourCC is Mp4VideoFormat {
  return VIDEO_FORMATS.has(fourCC);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a VisualSampleEntry payload into Mp4VideoSampleEntry.
 *
 * The payload is everything after the 8-byte box header (size + type).
 *
 * @param format    The 4cc of the sample entry box (e.g. 'avc1').
 * @param payload   Raw payload bytes (after the 8-byte size+type header).
 * @param boxCount  Shared mutable box counter for global MAX_BOXES_PER_FILE cap.
 * @throws Mp4VisualSampleEntryTooSmallError  payload < 78 bytes
 * @throws Mp4VisualDimensionOutOfRangeError  width or height > MAX_VIDEO_DIMENSION
 * @throws Mp4AvcCMissingError / Mp4HvcCMissingError / ... when codec config absent
 * @throws Mp4UnsupportedVideoCodecError      format not in supported set
 */
export function parseVisualSampleEntry(
  format: Mp4VideoFormat,
  payload: Uint8Array,
  boxCount: { value: number },
): Mp4VideoSampleEntry {
  // VisualSampleEntry fixed header is 78 bytes.
  if (payload.length < 78) {
    throw new Mp4VisualSampleEntryTooSmallError(payload.length);
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  // offset 0–5: reserved (6 bytes, ignored)
  // offset 6: data_reference_index:u16 (big-endian)
  const dataReferenceIndex = view.getUint16(6, false); // bytes 6..7

  // offset 8–9: pre_defined (u16, ignored)
  // offset 10–11: reserved (u16, ignored)
  // offset 12–23: pre_defined[3] (u32[3], ignored)

  // offset 24: width:u16 (big-endian)
  const width = view.getUint16(24, false); // bytes 24..25
  // offset 26: height:u16 (big-endian)
  const height = view.getUint16(26, false); // bytes 26..27

  if (width < 1 || width > MAX_VIDEO_DIMENSION) {
    throw new Mp4VisualDimensionOutOfRangeError('width', width, MAX_VIDEO_DIMENSION);
  }
  if (height < 1 || height > MAX_VIDEO_DIMENSION) {
    throw new Mp4VisualDimensionOutOfRangeError('height', height, MAX_VIDEO_DIMENSION);
  }

  // offset 28: horizresolution:u32 Q16.16 (big-endian)
  const horizResolution = view.getUint32(28, false); // bytes 28..31
  // offset 32: vertresolution:u32 Q16.16 (big-endian)
  const vertResolution = view.getUint32(32, false); // bytes 32..35

  // offset 36–39: reserved (u32, ignored)

  // offset 40: frame_count:u16 (big-endian)
  const frameCount = view.getUint16(40, false); // bytes 40..41

  // offset 42–73: compressorname[32] — Pascal string
  // First byte is string length (clamped to 0..31); next 31 bytes are Latin-1 chars.
  const nameLen = Math.min(payload[42] ?? 0, 31); // byte 42 = length prefix
  const compressorName = TEXT_DECODER_LATIN1.decode(payload.subarray(43, 43 + nameLen)); // bytes 43..73

  // offset 74: depth:u16 (big-endian)
  const depth = view.getUint16(74, false); // bytes 74..75

  // offset 76–77: pre_defined:i16 = -1 (0xFFFF, ignored)

  // offset 78+: child boxes
  // Walk child boxes to find the codec-config child and collect extraBoxes.
  const childStart = 78;
  let cursor = childStart;

  // Variables to accumulate parsed results.
  let codecConfig: Mp4VideoCodecConfig | null = null;
  // Extra boxes are concatenated bytes of all children EXCEPT the codec-config child.
  const extraParts: Uint8Array[] = [];
  let extraTotalBytes = 0;

  while (cursor + 8 <= payload.length) {
    boxCount.value += 1;
    if (boxCount.value > MAX_BOXES_PER_FILE) {
      throw new Mp4TooManyBoxesError(MAX_BOXES_PER_FILE);
    }

    const childSize = view.getUint32(cursor, false); // box size (big-endian)
    if (childSize < 8) {
      // Invalid box size — stop walking.
      break;
    }
    if (cursor + childSize > payload.length) {
      // Truncated box — stop walking.
      break;
    }

    const childType = TEXT_DECODER_LATIN1.decode(payload.subarray(cursor + 4, cursor + 8));
    const childPayload = payload.subarray(cursor + 8, cursor + childSize);

    if (childPayload.length > MAX_VIDEO_CODEC_CONFIG_BYTES) {
      // Silently skip; don't let malformed config allocate memory.
      cursor += childSize;
      continue;
    }

    let isCodecBox = false;

    switch (childType) {
      case 'avcC':
        if (format === 'avc1' || format === 'avc3') {
          codecConfig = parseAvcC(childPayload);
          isCodecBox = true;
        }
        break;
      case 'hvcC':
        if (format === 'hev1' || format === 'hvc1') {
          codecConfig = parseHvcC(childPayload);
          isCodecBox = true;
        }
        break;
      case 'vpcC':
        if (format === 'vp09') {
          codecConfig = parseVpcC(childPayload);
          isCodecBox = true;
        }
        break;
      case 'av1C':
        if (format === 'av01') {
          codecConfig = parseAv1C(childPayload);
          isCodecBox = true;
        }
        break;
      default:
        break;
    }

    if (!isCodecBox) {
      // Accumulate as extra boxes (opaque round-trip), capped.
      const boxBytes = payload.subarray(cursor, cursor + childSize);
      if (extraTotalBytes + childSize <= MAX_VIDEO_EXTRA_BOXES_BYTES) {
        extraParts.push(boxBytes);
        extraTotalBytes += childSize;
      }
    }

    cursor += childSize;
  }

  // Validate required codec config was found.
  if (codecConfig === null) {
    switch (format) {
      case 'avc1':
      case 'avc3':
        throw new Mp4AvcCMissingError();
      case 'hev1':
      case 'hvc1':
        throw new Mp4HvcCMissingError();
      case 'vp09':
        throw new Mp4VpcCMissingError();
      case 'av01':
        throw new Mp4Av1CMissingError();
      default:
        throw new Mp4UnsupportedVideoCodecError(format);
    }
  }

  // Concatenate extraBoxes.
  let extraBoxes: Uint8Array;
  if (extraParts.length === 0) {
    extraBoxes = new Uint8Array(0);
  } else if (extraParts.length === 1 && extraParts[0]) {
    extraBoxes = extraParts[0].slice();
  } else {
    extraBoxes = new Uint8Array(extraTotalBytes);
    let off = 0;
    for (const part of extraParts) {
      extraBoxes.set(part, off);
      off += part.length;
    }
  }

  const codecString = deriveVideoCodecString(format, codecConfig);

  return {
    format,
    dataReferenceIndex,
    width,
    height,
    horizResolution,
    vertResolution,
    frameCount,
    compressorName,
    depth,
    codecConfig,
    codecString,
    extraBoxes,
  };
}

/**
 * Serialize a Mp4VideoSampleEntry back to bytes (size + type + 78-byte header
 * + codec-config box verbatim + extraBoxes verbatim).
 *
 * The codec config bytes are ALWAYS emitted verbatim — we never rebuild from
 * parsed fields (design §9: round-trip verbatim).
 */
export function serializeVisualSampleEntry(entry: Mp4VideoSampleEntry): Uint8Array {
  const configBoxType = configBoxTypeFor(entry.format);
  const configBoxSize = 8 + entry.codecConfig.bytes.length;
  const payloadSize = 78 + configBoxSize + entry.extraBoxes.length;
  const boxSize = 8 + payloadSize;

  const out = new Uint8Array(boxSize);
  const view = new DataView(out.buffer);

  // Box header: size + type
  view.setUint32(0, boxSize, false);
  const typeBytes = entry.format;
  for (let i = 0; i < 4; i++) {
    out[4 + i] = (typeBytes.charCodeAt(i) ?? 0x20) & 0xff;
  }

  // VisualSampleEntry fixed header (payload starts at offset 8 in `out`).
  const p = 8; // payload base offset in `out`

  // offset p+0 to p+5: reserved (already zero)
  // offset p+6: data_reference_index
  view.setUint16(p + 6, entry.dataReferenceIndex, false);
  // offset p+8 to p+23: pre_defined / reserved (zero)
  // offset p+24: width
  view.setUint16(p + 24, entry.width, false);
  // offset p+26: height
  view.setUint16(p + 26, entry.height, false);
  // offset p+28: horizresolution Q16.16
  view.setUint32(p + 28, entry.horizResolution, false);
  // offset p+32: vertresolution Q16.16
  view.setUint32(p + 32, entry.vertResolution, false);
  // offset p+36: reserved (zero)
  // offset p+40: frame_count
  view.setUint16(p + 40, entry.frameCount, false);

  // offset p+42: compressorname[32] Pascal string
  // Encode byte-by-byte taking low 8 bits to preserve Latin-1 round-trip.
  // Using TextEncoder (UTF-8) would corrupt non-ASCII bytes (e.g. 0xE9 'é').
  const nameLen = Math.min(entry.compressorName.length, 31);
  out[p + 42] = nameLen; // length prefix byte
  for (let i = 0; i < nameLen; i++) {
    out[p + 43 + i] = entry.compressorName.charCodeAt(i) & 0xff;
  }
  // bytes p+43+nameLen..p+73 remain zero

  // offset p+74: depth
  view.setUint16(p + 74, entry.depth, false);
  // offset p+76: pre_defined = -1 (0xFFFF)
  view.setInt16(p + 76, -1, false);

  // Codec config box at offset p+78: [size:u32][type:4cc][payload...]
  const cfgStart = p + 78;
  view.setUint32(cfgStart, configBoxSize, false);
  for (let i = 0; i < 4; i++) {
    out[cfgStart + 4 + i] = (configBoxType.charCodeAt(i) ?? 0x20) & 0xff;
  }
  out.set(entry.codecConfig.bytes, cfgStart + 8);

  // Extra boxes after codec config.
  out.set(entry.extraBoxes, cfgStart + configBoxSize);

  return out;
}

/** Map video format 4cc → codec-config child box 4cc. */
function configBoxTypeFor(format: Mp4VideoFormat): string {
  switch (format) {
    case 'avc1':
    case 'avc3':
      return 'avcC';
    case 'hev1':
    case 'hvc1':
      return 'hvcC';
    case 'vp09':
      return 'vpcC';
    case 'av01':
      return 'av1C';
  }
}
