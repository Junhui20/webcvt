/**
 * esds (Elementary Stream Descriptor) parser — ISO/IEC 14496-1 §7.2.6.
 *
 * The esds box body is a tree of MPEG-4 descriptor tags. Each tag:
 *   tag_id (u8) + variable_length_size (1–4 bytes) + payload
 *
 * Variable-length size encoding (Trap §6):
 *   Each byte contributes 7 payload bits; top bit == 1 means more bytes follow.
 *   e.g. 0x80 0x80 0x80 0x22 decodes to 34 (0x22), NOT 0x80808022.
 *   Capped at 4 bytes (max 28-bit size) and MAX_DESCRIPTOR_BYTES (16 MiB).
 *
 * Tag hierarchy we parse:
 *   ES_DescrTag (0x03)
 *     ES_ID (u16) + flags (u8) + [optional fields per flag bits]
 *     DecoderConfigDescriptor (0x04)
 *       objectTypeIndication (u8) + streamType (u8) + bufferSizeDB (u24)
 *       + maxBitrate (u32) + avgBitrate (u32)
 *       DecoderSpecificInfo (0x05)
 *         bytes — this IS the AudioSpecificConfig
 *     SLConfigDescriptor (0x06)
 *       predefined (u8)
 *
 * NOTE: AudioSpecificConfig reuse decision (Trap §11):
 *   The DecoderSpecificInfo bytes here are the same AudioSpecificConfig
 *   structure that packages/container-aac/src/asc.ts already parses.
 *   For first-pass simplicity we re-implement minimal extraction here
 *   (~30 LOC) rather than creating a new @webcvt/codec-aac shared package.
 *   The shared-helper refactor is planned for Phase 3.5+.
 *   See packages/container-aac/src/asc.ts for the canonical implementation.
 */

import { MAX_DESCRIPTOR_BYTES } from '../constants.ts';
import { Mp4DescriptorTooLargeError, Mp4InvalidBoxError } from '../errors.ts';

// ---------------------------------------------------------------------------
// Tag IDs
// ---------------------------------------------------------------------------

const TAG_ES_DESCR = 0x03;
const TAG_DECODER_CONFIG = 0x04;
const TAG_DECODER_SPECIFIC_INFO = 0x05;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EsdsInfo {
  objectTypeIndication: number;
  /** AudioSpecificConfig bytes (DecoderSpecificInfo payload). */
  decoderSpecificInfo: Uint8Array;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the payload of an esds FullBox.
 *
 * esds payload starts with version(u8)+flags(u24) = 4 bytes, then the
 * ES_Descriptor tag tree.
 *
 * @param payload  The esds payload bytes (after the 8-byte box header).
 * @returns        Extracted objectTypeIndication and decoderSpecificInfo.
 */
export function parseEsdsPayload(payload: Uint8Array): EsdsInfo {
  // FullBox prefix: version(1) + flags(3) = 4 bytes.
  if (payload.length < 5) {
    throw new Mp4InvalidBoxError('esds payload too short.');
  }

  let cursor = 4; // skip version+flags

  // Expect ES_DescrTag (0x03).
  const { tagId, payloadStart, payloadEnd } = readDescriptor(payload, cursor);
  if (tagId !== TAG_ES_DESCR) {
    throw new Mp4InvalidBoxError(`esds: expected ES_DescrTag (0x03), got 0x${tagId.toString(16)}.`);
  }

  // ES_Descriptor body:
  //   ES_ID (u16) + flags (u8)
  //   If flags & 0x80: stream_dependence_flag → ES_ID (u16) follows
  //   If flags & 0x40: URL_flag → URL_length (u8) + URL string follows
  //   If flags & 0x20: OCRstreamFlag → OCR_ES_Id (u16) follows
  cursor = payloadStart;
  if (payloadEnd - cursor < 3) {
    throw new Mp4InvalidBoxError('esds ES_Descr too short.');
  }

  // ES_ID (skip)
  cursor += 2;
  const esFlags = payload[cursor] ?? 0;
  cursor += 1;

  // Skip optional fields.
  if (esFlags & 0x80) cursor += 2; // stream_dependence ES_ID
  if (esFlags & 0x40) {
    const urlLen = payload[cursor] ?? 0;
    cursor += 1 + urlLen;
  }
  if (esFlags & 0x20) cursor += 2; // OCR_ES_Id

  // Expect DecoderConfigDescriptor (0x04).
  if (cursor >= payloadEnd) {
    throw new Mp4InvalidBoxError('esds: missing DecoderConfigDescriptor.');
  }
  const dcDescr = readDescriptor(payload, cursor);
  if (dcDescr.tagId !== TAG_DECODER_CONFIG) {
    throw new Mp4InvalidBoxError(
      `esds: expected DecoderConfigDescriptor (0x04), got 0x${dcDescr.tagId.toString(16)}.`,
    );
  }

  // DecoderConfigDescriptor body:
  //   objectTypeIndication (u8) + streamType (u8, high 6 bits) + bufferSizeDB (u24)
  //   + maxBitrate (u32) + avgBitrate (u32) = 13 bytes
  cursor = dcDescr.payloadStart;
  if (dcDescr.payloadEnd - cursor < 13) {
    throw new Mp4InvalidBoxError('esds DecoderConfigDescriptor too short.');
  }
  const objectTypeIndication = payload[cursor] ?? 0;
  cursor += 13; // skip to child descriptor

  // Expect DecoderSpecificInfo (0x05).
  if (cursor >= dcDescr.payloadEnd) {
    throw new Mp4InvalidBoxError('esds: missing DecoderSpecificInfo.');
  }
  const dsiDescr = readDescriptor(payload, cursor);
  if (dsiDescr.tagId !== TAG_DECODER_SPECIFIC_INFO) {
    throw new Mp4InvalidBoxError(
      `esds: expected DecoderSpecificInfo (0x05), got 0x${dsiDescr.tagId.toString(16)}.`,
    );
  }

  // DecoderSpecificInfo payload IS the AudioSpecificConfig bytes.
  // Use subarray for zero-copy storage (Lesson #3).
  // Slice only at API boundary when handing to caller — here we return the
  // raw bytes that will be placed in Mp4AudioSampleEntry.decoderSpecificInfo.
  const decoderSpecificInfo = payload.subarray(dsiDescr.payloadStart, dsiDescr.payloadEnd);

  return { objectTypeIndication, decoderSpecificInfo };
}

/**
 * Serialize esds FullBox payload from objectTypeIndication and
 * AudioSpecificConfig bytes.
 *
 * Writes the minimal descriptor tree:
 *   ES_DescrTag → DecoderConfigDescriptor → DecoderSpecificInfo
 *   + SLConfigDescriptor (predefined=2)
 */
export function serializeEsdsPayload(
  objectTypeIndication: number,
  decoderSpecificInfo: Uint8Array,
): Uint8Array {
  // Build bottom-up.
  const dsiPayload = decoderSpecificInfo;
  const dsiBlock = wrapDescriptor(TAG_DECODER_SPECIFIC_INFO, dsiPayload);

  // DecoderConfigDescriptor payload: 13 bytes fixed + DecoderSpecificInfo block
  const dcPayloadFixed = new Uint8Array(13);
  const dcView = new DataView(dcPayloadFixed.buffer);
  dcView.setUint8(0, objectTypeIndication);
  dcView.setUint8(1, 0x15); // streamType=AudioStream (0x05 << 2 | 1)
  // bufferSizeDB(u24), maxBitrate(u32), avgBitrate(u32) = 0
  const dcPayload = concatBytes([dcPayloadFixed, dsiBlock]);
  const dcBlock = wrapDescriptor(TAG_DECODER_CONFIG, dcPayload);

  // SLConfigDescriptor: predefined=2 (MP4)
  const slPayload = new Uint8Array([0x02]);
  const slBlock = wrapDescriptor(0x06, slPayload);

  // ES_Descriptor payload: ES_ID(u16=1) + flags(u8=0) + DecoderConfig + SL
  const esFixed = new Uint8Array([0x00, 0x01, 0x00]); // ES_ID=1, flags=0
  const esPayload = concatBytes([esFixed, dcBlock, slBlock]);
  const esBlock = wrapDescriptor(TAG_ES_DESCR, esPayload);

  // FullBox prefix: version(1)+flags(3)
  const fullBoxPrefix = new Uint8Array(4); // all zeros
  return concatBytes([fullBoxPrefix, esBlock]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DescriptorHeader {
  tagId: number;
  payloadStart: number;
  payloadEnd: number;
}

/**
 * Read a descriptor tag+variable-length-size at `cursor` within `data`.
 *
 * Returns the tagId, the byte offset of the first payload byte (payloadStart),
 * and the exclusive end of the payload (payloadEnd).
 *
 * Trap §6: the size is encoded as 1–4 bytes, 7 bits per byte, top bit = more.
 * e.g. [0x80, 0x80, 0x80, 0x22] → size 0x22 = 34.
 */
function readDescriptor(data: Uint8Array, startOffset: number): DescriptorHeader {
  let pos = startOffset;
  if (pos >= data.length) {
    throw new Mp4InvalidBoxError('esds: descriptor read past end of buffer.');
  }
  const tagId = data[pos] ?? 0;
  pos += 1;

  // Variable-length size: up to 4 bytes, 7-bit payload, top bit = more.
  let size = 0;
  let bytesRead = 0;
  while (bytesRead < 4) {
    if (pos >= data.length) {
      throw new Mp4InvalidBoxError('esds: truncated descriptor size field.');
    }
    const b = data[pos] ?? 0;
    pos += 1;
    bytesRead += 1;
    size = (size << 7) | (b & 0x7f);
    if (!(b & 0x80)) break; // top bit clear = last size byte
  }

  if (size > MAX_DESCRIPTOR_BYTES) {
    throw new Mp4DescriptorTooLargeError(size, MAX_DESCRIPTOR_BYTES);
  }

  const payloadStart = pos;
  const payloadEnd = pos + size;

  if (payloadEnd > data.length) {
    throw new Mp4InvalidBoxError(
      `esds: descriptor tag 0x${tagId.toString(16)} claims size ${size} but only ${data.length - pos} bytes remain.`,
    );
  }

  return { tagId, payloadStart, payloadEnd };
}

/**
 * Wrap payload bytes in a descriptor tag + 1-byte length encoding.
 * (We always use 1-byte length since we control the sizes, and the
 * max AudioSpecificConfig + DecoderConfig combo is well under 127 bytes
 * in practice. For robustness, use multi-byte if needed.)
 */
function wrapDescriptor(tagId: number, payload: Uint8Array): Uint8Array {
  const size = payload.length;
  const sizeBytes = encodeDescriptorSize(size);
  const out = new Uint8Array(1 + sizeBytes.length + size);
  out[0] = tagId;
  out.set(sizeBytes, 1);
  out.set(payload, 1 + sizeBytes.length);
  return out;
}

/**
 * Encode a descriptor payload size using the variable-length encoding.
 * Uses the minimum number of bytes needed (1–4).
 */
function encodeDescriptorSize(size: number): Uint8Array {
  if (size < 0x80) {
    return new Uint8Array([size]);
  }
  if (size < 0x4000) {
    return new Uint8Array([((size >> 7) & 0x7f) | 0x80, size & 0x7f]);
  }
  if (size < 0x200000) {
    return new Uint8Array([((size >> 14) & 0x7f) | 0x80, ((size >> 7) & 0x7f) | 0x80, size & 0x7f]);
  }
  return new Uint8Array([
    ((size >> 21) & 0x7f) | 0x80,
    ((size >> 14) & 0x7f) | 0x80,
    ((size >> 7) & 0x7f) | 0x80,
    size & 0x7f,
  ]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
