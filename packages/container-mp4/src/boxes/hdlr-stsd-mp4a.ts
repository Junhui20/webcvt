/**
 * Handler, sample description, and MP4 audio sample entry parsers.
 *
 * hdlr — Handler Reference Box (ISO/IEC 14496-12 §8.4.3)
 *   FullBox: version(u8) + flags(u24) + pre_defined(u32) + handler_type(4 bytes)
 *            + reserved(12 bytes) + name(null-terminated UTF-8 string)
 *
 * stsd — Sample Description Box (§8.5.2)
 *   FullBox: version(u8) + flags(u24) + entry_count(u32) + sample_entry_boxes[]
 *   (Trap §13: entry_count is BEFORE the child boxes)
 *
 * mp4a — MP4 Audio Sample Entry (ISO/IEC 14496-14 §5.6, §12.2.3)
 *   SampleEntry (NOT FullBox): reserved(6 bytes) + data_reference_index(u16)
 *   AudioSampleEntry: reserved(8 bytes) + channelcount(u16) + samplesize(u16)
 *                     + pre_defined(u16) + reserved(u16) + samplerate(u32 Q16.16)
 *   (Trap §14: SampleEntry is 8 bytes, not a FullBox)
 *   (Trap §15: QuickTime v1/v2 sound description rejected, assert v0)
 *   Followed by child boxes — exactly one esds for mp4a.
 *
 * All fields big-endian (Trap §7).
 */

import { MAX_BOXES_PER_FILE, MAX_TABLE_ENTRIES } from '../constants.ts';
import {
  Mp4ExternalDataRefError,
  Mp4InvalidBoxError,
  Mp4TableTooLargeError,
  Mp4TooManyBoxesError,
  Mp4UnsupportedSampleEntryError,
  Mp4UnsupportedSoundVersionError,
  Mp4UnsupportedTrackTypeError,
  Mp4UnsupportedVideoCodecError,
} from '../errors.ts';
import { parseEsdsPayload } from './esds.ts';
import {
  type Mp4SampleEntry,
  type Mp4VideoFormat,
  isVideoFormat,
  parseVisualSampleEntry,
} from './visual-sample-entry.ts';

// Module-scope decoders (Lesson #2).
const TEXT_DECODER_UTF8 = new TextDecoder('utf-8');
const TEXT_DECODER_LATIN1 = new TextDecoder('latin1');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Mp4Handler {
  handlerType: string; // 4-char, e.g. 'soun'
  name: string; // UTF-8 null-terminated name string
}

export interface Mp4AudioSampleEntry {
  channelCount: number;
  sampleSize: number; // Legacy field, typically 16
  sampleRate: number; // Integer sample rate from Q16.16 high 16 bits
  /** AudioSpecificConfig bytes from esds DecoderSpecificInfo. */
  decoderSpecificInfo: Uint8Array;
  objectTypeIndication: number; // 0x40 = MPEG-4 Audio
}

// ---------------------------------------------------------------------------
// hdlr parser
// ---------------------------------------------------------------------------

// Re-export for parser.ts callers.
export type { Mp4SampleEntry };

/**
 * Parse an hdlr FullBox payload.
 *
 * @throws Mp4UnsupportedTrackTypeError when handler_type is not 'soun' or 'vide'.
 */
export function parseHdlr(payload: Uint8Array): Mp4Handler {
  // FullBox: 1(version) + 3(flags) = 4 bytes prefix
  // pre_defined: 4 bytes, handler_type: 4 bytes, reserved: 12 bytes = 20 bytes payload start
  if (payload.length < 4 + 4 + 4) {
    throw new Mp4InvalidBoxError('hdlr payload too short.');
  }

  const handlerType = TEXT_DECODER_LATIN1.decode(payload.subarray(8, 12));

  if (handlerType !== 'soun' && handlerType !== 'vide') {
    throw new Mp4UnsupportedTrackTypeError(handlerType);
  }

  // Name is a null-terminated UTF-8 string starting at offset 4+4+4+12=24.
  let name = '';
  if (payload.length > 24) {
    const nameBytes = payload.subarray(24);
    // Find null terminator.
    const nullIdx = nameBytes.indexOf(0);
    const nameSlice = nullIdx >= 0 ? nameBytes.subarray(0, nullIdx) : nameBytes;
    name = TEXT_DECODER_UTF8.decode(nameSlice);
  }

  return { handlerType, name };
}

/**
 * Serialize an Mp4Handler to hdlr FullBox payload bytes.
 */
export function serializeHdlr(h: Mp4Handler): Uint8Array {
  // version(1) + flags(3) + pre_defined(4) + handler_type(4) + reserved(12) + name + null
  const nameBytes = new TextEncoder().encode(h.name);
  const out = new Uint8Array(4 + 4 + 4 + 12 + nameBytes.length + 1);
  const view = new DataView(out.buffer);
  // version=0, flags=0 already zero
  // pre_defined at 4 = 0
  // handler_type at 8
  for (let i = 0; i < 4; i++) {
    out[8 + i] = (h.handlerType.charCodeAt(i) ?? 0) & 0xff;
  }
  // reserved 12 bytes at 12 = 0
  // name at 24
  out.set(nameBytes, 24);
  // null terminator at 24+nameBytes.length is already 0
  return out;
}

// ---------------------------------------------------------------------------
// dref validator
// ---------------------------------------------------------------------------

/**
 * Parse a dref (Data Reference Box) FullBox payload and assert self-contained.
 *
 * dref layout:
 *   version(u8) + flags(u24) + entry_count(u32) + entries[]
 * Each entry is an 'url ' FullBox:
 *   size(u32) + type(4) + version(u8) + flags(u24) [+ url string if flags&1==0]
 *
 * @throws Mp4ExternalDataRefError when the single url  entry has flags & 1 == 0.
 * @throws Mp4TableTooLargeError when entry_count exceeds MAX_TABLE_ENTRIES.
 */
export function validateDref(payload: Uint8Array): void {
  if (payload.length < 8) {
    throw new Mp4InvalidBoxError('dref payload too short.');
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const entryCount = view.getUint32(4, false);

  if (entryCount > MAX_TABLE_ENTRIES) {
    throw new Mp4TableTooLargeError('dref', entryCount, MAX_TABLE_ENTRIES);
  }

  // Sec-M-6: first-pass supports exactly one self-contained entry (url  with flags&1).
  // External references and multiple entries are Phase 3.5+.
  if (entryCount !== 1) {
    throw new Mp4InvalidBoxError(
      `dref entry_count=${entryCount}; first-pass supports exactly 1 self-contained entry.`,
    );
  }

  // We expect exactly one self-contained url  entry.
  let cursor = 8; // past version+flags+entry_count
  for (let i = 0; i < entryCount; i++) {
    if (cursor + 12 > payload.length) {
      throw new Mp4InvalidBoxError('dref entry truncated.');
    }
    // Each child entry: size(4) + type(4) + version(1) + flags(3)
    const entrySize = view.getUint32(cursor, false);
    // flags of the url  entry are at cursor+8 (3 bytes, big-endian)
    const entryFlags =
      ((payload[cursor + 9] ?? 0) << 16) |
      ((payload[cursor + 10] ?? 0) << 8) |
      (payload[cursor + 11] ?? 0);

    // flags & 1 == 1 means self-contained (no URL follows)
    if ((entryFlags & 1) === 0) {
      throw new Mp4ExternalDataRefError();
    }
    cursor += entrySize > 0 ? entrySize : 12;
  }
}

// ---------------------------------------------------------------------------
// stsd / mp4a parser
// ---------------------------------------------------------------------------

/**
 * Parse the stsd FullBox payload and return a discriminated Mp4SampleEntry.
 *
 * stsd layout:
 *   version(u8) + flags(u24) + entry_count(u32) + sample_entry_boxes[]
 *
 * Dispatches on the sample entry 4cc:
 *   'mp4a'                       → { kind: 'audio', entry: Mp4AudioSampleEntry }
 *   'avc1'|'avc3'|'hev1'|'hvc1'
 *   |'vp09'|'av01'               → { kind: 'video', entry: Mp4VideoSampleEntry }
 *   other                        → Mp4UnsupportedSampleEntryError (unknown) or
 *                                   Mp4UnsupportedVideoCodecError (known-video-but-unsupported)
 *
 * @param payload   stsd box payload (after the 8-byte box header).
 * @param fileData  Full file buffer (needed to parse esds child of mp4a).
 * @param boxCount  Mutable counter shared across the walk for MAX_BOXES cap (Sec-H-3).
 * @throws Mp4UnsupportedSampleEntryError when entry is unknown.
 * @throws Mp4TableTooLargeError when entry_count > MAX_TABLE_ENTRIES.
 */
export function parseStsd(
  payload: Uint8Array,
  fileData: Uint8Array,
  boxCount: { value: number } = { value: 0 },
): Mp4SampleEntry {
  if (payload.length < 8) {
    throw new Mp4InvalidBoxError('stsd payload too short.');
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  // version(1) + flags(3) + entry_count(4) = 8 bytes (Trap §13)
  const entryCount = view.getUint32(4, false);

  if (entryCount > MAX_TABLE_ENTRIES) {
    throw new Mp4TableTooLargeError('stsd', entryCount, MAX_TABLE_ENTRIES);
  }

  // Read the first (and expected only) sample entry box.
  // It starts at offset 8 within the stsd payload.
  if (payload.length < 16) {
    throw new Mp4InvalidBoxError('stsd has no sample entry.');
  }

  // Sample entry box header: size(4) + type(4).
  const entrySize = view.getUint32(8, false);
  const entryType = TEXT_DECODER_LATIN1.decode(payload.subarray(12, 16));

  if (entrySize < 8 || 8 + entrySize > payload.length) {
    throw new Mp4InvalidBoxError(`${entryType} sample entry size overruns stsd payload.`);
  }

  // Dispatch on 4cc.
  if (entryType === 'mp4a') {
    // mp4a payload starts at offset 16 within stsd payload.
    const mp4aPayload = payload.subarray(16, 8 + entrySize);
    const entry = parseMp4aPayload(mp4aPayload, fileData, boxCount);
    return { kind: 'audio', entry };
  }

  if (isVideoFormat(entryType)) {
    // Visual sample entry payload starts at offset 16 within stsd payload.
    const visualPayload = payload.subarray(16, 8 + entrySize);
    const entry = parseVisualSampleEntry(entryType as Mp4VideoFormat, visualPayload, boxCount);
    return { kind: 'video', entry };
  }

  // Unknown 4cc — check if it looks like a video format we don't support (dvh1, etc.)
  // The spec-defined video formats that we explicitly do NOT support yet:
  const KNOWN_UNSUPPORTED_VIDEO = new Set(['dvh1', 'dvhe', 'dva1', 'dvav', 'encv', 'sinf']);
  if (KNOWN_UNSUPPORTED_VIDEO.has(entryType)) {
    throw new Mp4UnsupportedVideoCodecError(entryType);
  }

  throw new Mp4UnsupportedSampleEntryError(entryType);
}

/**
 * Parse the mp4a sample entry payload (after the 8-byte size+type header).
 *
 * Trap §14: the first 8 bytes are SampleEntry header:
 *   reserved(6 bytes, zero) + data_reference_index(u16)
 * Then AudioSampleEntry:
 *   reserved(u32+u32 = 8 bytes) + channelcount(u16) + samplesize(u16)
 *   + pre_defined(u16) + reserved(u16) + samplerate(u32 Q16.16)
 * Total before child boxes: 8 + 20 = 28 bytes.
 *
 * Trap §15: QuickTime extends the reserved[6] field with a 'version' u16.
 *   ISO MP4 always has zeros here. We assert v0 (first 2 reserved bytes == 0).
 *
 * Child boxes follow at offset 28.
 */
function parseMp4aPayload(
  mp4aPayload: Uint8Array,
  fileData: Uint8Array,
  boxCount: { value: number },
): Mp4AudioSampleEntry {
  if (mp4aPayload.length < 28) {
    throw new Mp4InvalidBoxError('mp4a payload too short (need ≥28 bytes for SampleEntry header).');
  }
  const view = new DataView(mp4aPayload.buffer, mp4aPayload.byteOffset, mp4aPayload.byteLength);

  // Trap §15: QuickTime sound description version is in the first 2 bytes of reserved[6].
  const qtVersion = view.getUint16(0, false);
  if (qtVersion !== 0) {
    throw new Mp4UnsupportedSoundVersionError(qtVersion);
  }

  // data_reference_index at offset 6 (we don't validate it here; dref validates separately)

  // AudioSampleEntry starts at offset 8:
  // reserved(u32+u32) at 8, channelcount at 16, samplesize at 18
  // pre_defined at 20, reserved at 22, samplerate(Q16.16) at 24
  const channelCount = view.getUint16(16, false);
  const sampleSize = view.getUint16(18, false);
  // samplerate Q16.16: high 16 bits = integer rate (Trap §7)
  const sampleRateRaw = view.getUint32(24, false);
  const sampleRate = (sampleRateRaw >> 16) & 0xffff;

  // Child boxes start at offset 28.
  // We look for exactly one esds child.
  // Sec-H-3: count every child box against the global MAX_BOXES_PER_FILE cap
  // to prevent CPU DoS from a crafted mp4a with millions of 8-byte stub children.
  let esdsOffset = -1;
  let esdsSize = 0;
  let cursor = 28;

  while (cursor + 8 <= mp4aPayload.length) {
    boxCount.value += 1;
    if (boxCount.value > MAX_BOXES_PER_FILE) {
      throw new Mp4TooManyBoxesError(MAX_BOXES_PER_FILE);
    }
    const childSize = view.getUint32(cursor, false);
    const childType = TEXT_DECODER_LATIN1.decode(mp4aPayload.subarray(cursor + 4, cursor + 8));
    if (childSize < 8) break;
    if (childType === 'esds') {
      esdsOffset = cursor;
      esdsSize = childSize;
      break;
    }
    cursor += childSize;
  }

  if (esdsOffset < 0) {
    throw new Mp4InvalidBoxError('mp4a sample entry is missing the esds child box.');
  }

  // Parse esds payload (after the 8-byte esds box header).
  const esdsPayload = mp4aPayload.subarray(esdsOffset + 8, esdsOffset + esdsSize);
  const { decoderSpecificInfo, objectTypeIndication } = parseEsdsPayload(esdsPayload);

  return {
    channelCount,
    sampleSize,
    sampleRate,
    decoderSpecificInfo,
    objectTypeIndication,
  };
}

// ---------------------------------------------------------------------------
// Serializer helpers
// ---------------------------------------------------------------------------

/**
 * Serialize an Mp4AudioSampleEntry to mp4a sample entry bytes
 * (size + type + SampleEntry + AudioSampleEntry header + esds child).
 *
 * The stsd wrapper (entry_count) is added by the serializer.
 */
export function serializeMp4a(entry: Mp4AudioSampleEntry, esdsBytes: Uint8Array): Uint8Array {
  // mp4a payload: SampleEntry(8) + AudioSampleEntry(20) + esds box
  const esdsBoxSize = 8 + esdsBytes.length;
  const mp4aPayloadSize = 28 + esdsBoxSize;
  const mp4aBoxSize = 8 + mp4aPayloadSize; // size(4) + type(4) + payload

  const out = new Uint8Array(mp4aBoxSize);
  const view = new DataView(out.buffer);

  // Box header
  view.setUint32(0, mp4aBoxSize, false);
  out[4] = 0x6d;
  out[5] = 0x70;
  out[6] = 0x34;
  out[7] = 0x61; // 'mp4a'

  // SampleEntry: reserved(6) + data_reference_index(u16=1)
  // bytes 8-13: zero (reserved)
  view.setUint16(14, 1, false); // data_reference_index

  // AudioSampleEntry: reserved(8) at 16, channelcount at 24, samplesize at 26
  // pre_defined at 28, reserved at 30, samplerate at 32
  view.setUint16(24, entry.channelCount, false);
  view.setUint16(26, entry.sampleSize, false);
  // samplerate Q16.16: integer rate in high 16 bits
  view.setUint32(32, (entry.sampleRate & 0xffff) << 16, false);

  // esds child box at offset 36
  view.setUint32(36, esdsBoxSize, false);
  out[40] = 0x65;
  out[41] = 0x73;
  out[42] = 0x64;
  out[43] = 0x73; // 'esds'
  out.set(esdsBytes, 44);

  return out;
}

/**
 * Serialize stsd FullBox wrapping a single mp4a sample entry.
 */
export function serializeStsd(mp4aBytes: Uint8Array): Uint8Array {
  // stsd payload: version(1)+flags(3)+entry_count(4) + mp4a bytes
  const payloadSize = 8 + mp4aBytes.length;
  const boxSize = 8 + payloadSize;
  const out = new Uint8Array(boxSize);
  const view = new DataView(out.buffer);

  view.setUint32(0, boxSize, false);
  out[4] = 0x73;
  out[5] = 0x74;
  out[6] = 0x73;
  out[7] = 0x64; // 'stsd'
  // version=0, flags=0 at 8-11
  // entry_count=1 at 12
  view.setUint32(12, 1, false);
  out.set(mp4aBytes, 16);
  return out;
}
