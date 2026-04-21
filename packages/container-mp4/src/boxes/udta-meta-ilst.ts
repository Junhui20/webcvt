/**
 * Parser and serializer for `moov/udta/meta/ilst` — Apple iTunes-style movie metadata.
 *
 * Spec references:
 *   - Apple QuickTime File Format Specification (Metadata chapter)
 *   - ISO/IEC 14496-12 §8.10.1 (udta), §8.11.1 (meta), §8.4.3 (hdlr)
 *
 * Clean-room: spec only. NOT derived from AtomicParsley, mp4metadata, mp4box.js,
 * gpac, Bento4, ffmpeg mov.c/movenc.c, mutagen-mp4, faad2, or taglib.
 *
 * Key implementation notes:
 *   - 4cc keys decoded as Latin-1 (NOT UTF-8): 0xA9 → '©' (Trap 1)
 *   - `meta` FullBox-vs-Box detection via §5 heuristic (Trap 2)
 *   - `data` type_indicator high byte MUST be 0 (Trap 3)
 *   - `trkn`/`disk` payload is 8-byte binary (Trap 4)
 *   - `covr` may have multiple `data` children (Trap 5)
 *   - `----` requires mean/name/data in order (Trap 6)
 *   - `hdlr.handler_type` must be 'mdir' (Trap 7)
 */

import { writeBoxHeader } from '../box-header.ts';
import {
  MAX_COVER_ART_BYTES,
  MAX_METADATA_ATOMS,
  MAX_METADATA_PAYLOAD_BYTES,
} from '../constants.ts';
import {
  Mp4InvalidBoxError,
  Mp4MetaBadDataTypeError,
  Mp4MetaBadHandlerError,
  Mp4MetaBadTrackNumberError,
  Mp4MetaCoverArtTooLargeError,
  Mp4MetaFreeformIncompleteError,
  Mp4MetaPayloadTooLargeError,
  Mp4MetaTooManyAtomsError,
  Mp4MissingBoxError,
} from '../errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MetadataValue =
  | { readonly kind: 'utf8'; readonly value: string }
  | { readonly kind: 'jpeg'; readonly bytes: Uint8Array }
  | { readonly kind: 'png'; readonly bytes: Uint8Array }
  | { readonly kind: 'beInt'; readonly value: number }
  | { readonly kind: 'trackNumber'; readonly track: number; readonly total: number }
  | { readonly kind: 'discNumber'; readonly disc: number; readonly total: number }
  | { readonly kind: 'binary'; readonly bytes: Uint8Array }
  | {
      readonly kind: 'freeform';
      readonly mean: string;
      readonly name: string;
      readonly bytes: Uint8Array;
    };

export interface MetadataAtom {
  /** 4cc key including the 0xA9 prefix where applicable (e.g. '©nam'). */
  readonly key: string;
  readonly value: MetadataValue;
}

export type MetadataAtoms = readonly MetadataAtom[];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Decode 4 bytes as Latin-1 (NOT UTF-8) to preserve the 0xA9 '©' byte correctly. */
function decodeFourCCLatin1(data: Uint8Array, offset: number): string {
  const b0 = data[offset] ?? 0;
  const b1 = data[offset + 1] ?? 0;
  const b2 = data[offset + 2] ?? 0;
  const b3 = data[offset + 3] ?? 0;
  return String.fromCharCode(b0, b1, b2, b3);
}

/** Write a 4cc string as 4 bytes (Latin-1). */
function encodeFourCCLatin1(type: string, buf: Uint8Array, offset: number): void {
  for (let i = 0; i < 4; i++) {
    buf[offset + i] = type.charCodeAt(i) & 0xff;
  }
}

/** Write a u32 big-endian. */
function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, value, false);
}

/** Read a u32 big-endian. */
function readU32BE(data: Uint8Array, offset: number): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint32(offset, false);
}

/** Read a u16 big-endian. */
function readU16BE(data: Uint8Array, offset: number): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint16(offset, false);
}

/** Concatenate Uint8Arrays. */
function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Wrap payload bytes in a box with 8-byte header [size:u32][type:4cc]. */
function wrapBox(type: string, payload: Uint8Array): Uint8Array {
  const size = 8 + payload.length;
  const out = new Uint8Array(size);
  writeBoxHeader(out, 0, size, type);
  out.set(payload, 8);
  return out;
}

// ---------------------------------------------------------------------------
// Internal box walker (ilst children — NOT using box-tree walker to stay independent)
// ---------------------------------------------------------------------------

interface RawBox {
  type: string;
  size: number;
  payloadOffset: number;
  payloadSize: number;
  payload: Uint8Array;
}

/**
 * Walk flat sequence of boxes within a byte span of `data`.
 * Returns array of RawBox with zero-copy payload subarrays.
 */
function walkFlatBoxes(data: Uint8Array, start: number, end: number): RawBox[] {
  const boxes: RawBox[] = [];
  let cursor = start;

  while (cursor + 8 <= end) {
    const size = readU32BE(data, cursor);
    if (size < 8) {
      throw new Mp4InvalidBoxError(
        `udta/ilst child box at offset ${cursor} has size=${size} which is less than the minimum 8-byte header.`,
      );
    }
    const boxEnd = cursor + size;
    if (boxEnd > end) {
      throw new Mp4InvalidBoxError(
        `udta/ilst child box at offset ${cursor} overruns its container (boxEnd=${boxEnd}, containerEnd=${end}).`,
      );
    }
    const type = decodeFourCCLatin1(data, cursor + 4);
    const payloadOffset = cursor + 8;
    const payloadSize = size - 8;
    boxes.push({
      type,
      size,
      payloadOffset,
      payloadSize,
      payload: data.subarray(payloadOffset, payloadOffset + payloadSize),
    });
    cursor = boxEnd;
  }

  return boxes;
}

// ---------------------------------------------------------------------------
// `data` sub-box parser
// ---------------------------------------------------------------------------

interface ParsedDataBox {
  typeIndicator: number;
  locale: number;
  payload: Uint8Array;
}

function parseDataBox(box: RawBox): ParsedDataBox {
  if (box.payloadSize < 8) {
    throw new Mp4InvalidBoxError(
      `ilst 'data' box has payload size ${box.payloadSize}; minimum is 8 bytes (type_indicator+locale).`,
    );
  }

  const typeIndicatorFull = readU32BE(box.payload, 0);
  const highByte = (typeIndicatorFull >>> 24) & 0xff;
  if (highByte !== 0) {
    throw new Mp4MetaBadDataTypeError(typeIndicatorFull);
  }
  const typeIndicator = typeIndicatorFull & 0x00ffffff;
  const locale = readU32BE(box.payload, 4);
  const payload = box.payload.subarray(8);

  return { typeIndicator, locale, payload };
}

// ---------------------------------------------------------------------------
// Atom-level value dispatch
// ---------------------------------------------------------------------------

const TEXT_DECODER_UTF8 = new TextDecoder('utf-8');

function dispatchAtomValue(key: string, typeIndicator: number, payload: Uint8Array): MetadataValue {
  // trkn and disk: binary type (0), 8-byte special layout
  if ((key === 'trkn' || key === 'disk') && typeIndicator === 0) {
    if (payload.length !== 8) {
      throw new Mp4MetaBadTrackNumberError(key, payload.length);
    }
    // Layout: [u16 0][u16 cur][u16 total][u16 0]
    const cur = readU16BE(payload, 2);
    const total = readU16BE(payload, 4);
    if (key === 'trkn') {
      return { kind: 'trackNumber', track: cur, total };
    }
    return { kind: 'discNumber', disc: cur, total };
    // typeIndicator !== 0: fall through to beInt/binary handling below
  }

  switch (typeIndicator) {
    case 0: {
      // Binary
      return { kind: 'binary', bytes: payload.slice() };
    }
    case 1: {
      // UTF-8
      return { kind: 'utf8', value: TEXT_DECODER_UTF8.decode(payload) };
    }
    case 13: {
      // JPEG
      return { kind: 'jpeg', bytes: payload.slice() };
    }
    case 14: {
      // PNG
      return { kind: 'png', bytes: payload.slice() };
    }
    case 21: {
      // BE signed integer (1–4 bytes only). 0 or >4 bytes → preserve as binary.
      if (payload.length === 0 || payload.length > 4) {
        return { kind: 'binary', bytes: payload.slice() };
      }
      let value = 0;
      for (let i = 0; i < payload.length; i++) {
        value = (value << 8) | (payload[i] ?? 0);
      }
      // Sign-extend if top byte has bit set and length < 4
      if (payload.length === 1 && (payload[0] ?? 0) & 0x80) {
        value = value - 256;
      } else if (payload.length === 2 && (payload[0] ?? 0) & 0x80) {
        value = value - 65536;
      } else if (payload.length === 3 && (payload[0] ?? 0) & 0x80) {
        value = value - 16777216;
      }
      return { kind: 'beInt', value };
    }
    default: {
      // Unknown type indicator — preserve as binary
      return { kind: 'binary', bytes: payload.slice() };
    }
  }
}

// ---------------------------------------------------------------------------
// `----` freeform atom parser
// ---------------------------------------------------------------------------

function parseFreeformAtom(atomBox: RawBox): MetadataValue {
  const children = walkFlatBoxes(atomBox.payload, 0, atomBox.payloadSize);

  // Require: mean, name, data in order
  if (children.length < 3) {
    throw new Mp4MetaFreeformIncompleteError(
      `'----' atom has ${children.length} children; need mean, name, and data in order.`,
    );
  }

  const meanBox = children[0];
  const nameBox = children[1];
  const dataBox = children[2];

  if (!meanBox || meanBox.type !== 'mean') {
    throw new Mp4MetaFreeformIncompleteError(
      `'----' first child is '${meanBox?.type ?? 'missing'}'; expected 'mean'.`,
    );
  }
  if (!nameBox || nameBox.type !== 'name') {
    throw new Mp4MetaFreeformIncompleteError(
      `'----' second child is '${nameBox?.type ?? 'missing'}'; expected 'name'.`,
    );
  }
  if (!dataBox || dataBox.type !== 'data') {
    throw new Mp4MetaFreeformIncompleteError(
      `'----' third child is '${dataBox?.type ?? 'missing'}'; expected 'data'.`,
    );
  }

  // mean and name are FullBoxes: skip 4 bytes (version+flags), rest is UTF-8
  const meanPayload = meanBox.payload.length >= 4 ? meanBox.payload.subarray(4) : meanBox.payload;
  const namePayload = nameBox.payload.length >= 4 ? nameBox.payload.subarray(4) : nameBox.payload;

  if (meanPayload.length > MAX_METADATA_PAYLOAD_BYTES) {
    throw new Mp4MetaPayloadTooLargeError(
      '----/mean',
      meanPayload.length,
      MAX_METADATA_PAYLOAD_BYTES,
    );
  }
  if (namePayload.length > MAX_METADATA_PAYLOAD_BYTES) {
    throw new Mp4MetaPayloadTooLargeError(
      '----/name',
      namePayload.length,
      MAX_METADATA_PAYLOAD_BYTES,
    );
  }

  const mean = TEXT_DECODER_UTF8.decode(meanPayload);
  const name = TEXT_DECODER_UTF8.decode(namePayload);

  const parsed = parseDataBox(dataBox);

  return { kind: 'freeform', mean, name, bytes: parsed.payload.slice() };
}

// ---------------------------------------------------------------------------
// `ilst` parser
// ---------------------------------------------------------------------------

function parseIlst(ilstPayload: Uint8Array): MetadataAtoms {
  const atoms: MetadataAtom[] = [];
  const atomBoxes = walkFlatBoxes(ilstPayload, 0, ilstPayload.length);

  for (const atomBox of atomBoxes) {
    if (atoms.length >= MAX_METADATA_ATOMS) {
      throw new Mp4MetaTooManyAtomsError(atoms.length, MAX_METADATA_ATOMS);
    }

    const key = atomBox.type;

    if (key === '----') {
      const value = parseFreeformAtom(atomBox);
      atoms.push({ key, value });
      continue;
    }

    // covr: one or more data children
    if (key === 'covr') {
      const dataBoxes = walkFlatBoxes(atomBox.payload, 0, atomBox.payloadSize).filter(
        (b) => b.type === 'data',
      );
      for (const dataBox of dataBoxes) {
        if (atoms.length >= MAX_METADATA_ATOMS) {
          throw new Mp4MetaTooManyAtomsError(atoms.length, MAX_METADATA_ATOMS);
        }
        const parsed = parseDataBox(dataBox);
        if (parsed.payload.length > MAX_COVER_ART_BYTES) {
          throw new Mp4MetaCoverArtTooLargeError(parsed.payload.length, MAX_COVER_ART_BYTES);
        }
        const value = dispatchAtomValue(key, parsed.typeIndicator, parsed.payload);
        atoms.push({ key, value });
      }
      continue;
    }

    // All other atoms: exactly one data child
    const dataBoxes = walkFlatBoxes(atomBox.payload, 0, atomBox.payloadSize).filter(
      (b) => b.type === 'data',
    );

    for (const dataBox of dataBoxes) {
      if (atoms.length >= MAX_METADATA_ATOMS) {
        throw new Mp4MetaTooManyAtomsError(atoms.length, MAX_METADATA_ATOMS);
      }
      const parsed = parseDataBox(dataBox);

      if (parsed.payload.length > MAX_METADATA_PAYLOAD_BYTES) {
        throw new Mp4MetaPayloadTooLargeError(
          key,
          parsed.payload.length,
          MAX_METADATA_PAYLOAD_BYTES,
        );
      }

      const value = dispatchAtomValue(key, parsed.typeIndicator, parsed.payload);
      atoms.push({ key, value });
    }
  }

  return atoms;
}

// ---------------------------------------------------------------------------
// `hdlr` validator (mdir variant)
// ---------------------------------------------------------------------------

function validateHdlr(hdlrPayload: Uint8Array): void {
  // FullBox: version(1)+flags(3)+pre_defined(4)+handler_type(4)+reserved(12)+name
  // Total minimum: 1+3+4+4 = 12 bytes before name
  if (hdlrPayload.length < 12) {
    throw new Mp4InvalidBoxError(
      `hdlr payload is ${hdlrPayload.length} bytes; minimum is 12 for version+flags+pre_defined+handler_type.`,
    );
  }

  // handler_type is at offset 8 (after version[1]+flags[3]+pre_defined[4])
  const handlerType = decodeFourCCLatin1(hdlrPayload, 8);
  if (handlerType !== 'mdir') {
    throw new Mp4MetaBadHandlerError(handlerType);
  }
}

// ---------------------------------------------------------------------------
// `meta` payload walker (§5 FullBox-vs-Box detection)
// ---------------------------------------------------------------------------

function parseMetaContent(metaPayload: Uint8Array): MetadataAtoms {
  if (metaPayload.length < 4) {
    return [];
  }

  // §5 heuristic: peek first 4 bytes
  const firstWord = readU32BE(metaPayload, 0);
  let innerStart: number;

  if (firstWord === 0x00000000) {
    // FullBox v0 (version=0, flags=0): skip 4 bytes
    innerStart = 4;
  } else {
    // Plain Box (QuickTime-style): advance 0 bytes
    innerStart = 0;
  }

  // Walk inner boxes to find hdlr and ilst
  const innerBoxes = walkFlatBoxes(metaPayload, innerStart, metaPayload.length);

  const hdlrBox = innerBoxes.find((b) => b.type === 'hdlr');
  if (!hdlrBox) {
    throw new Mp4MissingBoxError('hdlr', 'meta');
  }
  validateHdlr(hdlrBox.payload);

  const ilstBoxes = innerBoxes.filter((b) => b.type === 'ilst');
  if (ilstBoxes.length > 1) {
    throw new Mp4InvalidBoxError(
      `meta contains ${ilstBoxes.length} 'ilst' children; at most 1 is allowed.`,
    );
  }

  const ilstBox = ilstBoxes[0];
  if (!ilstBox) {
    // No ilst → empty metadata (preserve verbatim is handled by caller)
    return [];
  }

  return parseIlst(ilstBox.payload);
}

// ---------------------------------------------------------------------------
// Public parser entry point
// ---------------------------------------------------------------------------

export interface UdtaParseResult {
  metadata: MetadataAtoms;
  opaque: Uint8Array | null;
}

/**
 * Parse a `udta` box's payload into structured metadata and/or opaque bytes.
 *
 * - If `meta` child is absent → metadata=[], opaque=full udta payload bytes.
 * - If `hdlr.handler_type` != 'mdir' → Mp4MetaBadHandlerError; caller must
 *   catch and preserve udta as opaque.
 * - Otherwise → metadata from ilst, opaque=null.
 */
export function parseUdta(udtaPayload: Uint8Array): UdtaParseResult {
  // Find meta child in udta payload
  const udtaChildren = walkFlatBoxes(udtaPayload, 0, udtaPayload.length);

  const metaBoxes = udtaChildren.filter((b) => b.type === 'meta');
  if (metaBoxes.length > 1) {
    throw new Mp4InvalidBoxError(
      `udta contains ${metaBoxes.length} 'meta' children; at most 1 is allowed.`,
    );
  }

  const metaBox = metaBoxes[0];
  if (!metaBox) {
    // No meta → preserve entire udta payload as opaque
    return { metadata: [], opaque: udtaPayload.slice() };
  }

  const metadata = parseMetaContent(metaBox.payload);
  return { metadata, opaque: null };
}

// ---------------------------------------------------------------------------
// Serializer helpers
// ---------------------------------------------------------------------------

/** Map MetadataValue kind to type_indicator for the `data` sub-box. */
function typeIndicatorForValue(value: MetadataValue): number {
  switch (value.kind) {
    case 'utf8':
      return 1;
    case 'jpeg':
      return 13;
    case 'png':
      return 14;
    case 'beInt':
      return 21;
    case 'trackNumber':
    case 'discNumber':
    case 'binary':
    case 'freeform':
      return 0;
  }
}

/** Build a `data` sub-box for a MetadataValue. */
function buildDataBox(value: MetadataValue): Uint8Array {
  const typeIndicator = typeIndicatorForValue(value);
  let payload: Uint8Array;

  switch (value.kind) {
    case 'utf8': {
      payload = new TextEncoder().encode(value.value);
      break;
    }
    case 'jpeg':
    case 'png':
    case 'binary': {
      payload = value.bytes;
      break;
    }
    case 'beInt': {
      // Always 4-byte BE signed
      payload = new Uint8Array(4);
      const view = new DataView(payload.buffer);
      view.setInt32(0, value.value, false);
      break;
    }
    case 'trackNumber': {
      // [u16 0][u16 cur][u16 total][u16 0]
      payload = new Uint8Array(8);
      const v = new DataView(payload.buffer);
      v.setUint16(2, value.track, false);
      v.setUint16(4, value.total, false);
      break;
    }
    case 'discNumber': {
      // [u16 0][u16 disc][u16 total][u16 0]
      payload = new Uint8Array(8);
      const v = new DataView(payload.buffer);
      v.setUint16(2, value.disc, false);
      v.setUint16(4, value.total, false);
      break;
    }
    case 'freeform': {
      payload = value.bytes;
      break;
    }
  }

  // data header: [type_indicator:u32][locale:u32=0] = 8 bytes
  const dataHeader = new Uint8Array(8);
  writeU32BE(dataHeader, 0, typeIndicator);
  // locale stays 0

  const dataPayload = concatBytes([dataHeader, payload]);
  return wrapBox('data', dataPayload);
}

/** Build a single ilst atom box (e.g. ©nam, trkn). */
function buildIlstAtom(atom: MetadataAtom): Uint8Array {
  if (atom.value.kind === 'freeform') {
    // ---- atom: [mean FullBox][name FullBox][data box]
    const encoder = new TextEncoder();

    const meanStr = encoder.encode(atom.value.mean);
    const meanFullPayload = new Uint8Array(4 + meanStr.length);
    meanFullPayload.set(meanStr, 4);
    const meanBox = wrapBox('mean', meanFullPayload);

    const nameStr = encoder.encode(atom.value.name);
    const nameFullPayload = new Uint8Array(4 + nameStr.length);
    nameFullPayload.set(nameStr, 4);
    const nameBox = wrapBox('name', nameFullPayload);

    const dataBox = buildDataBox(atom.value);
    return wrapBox('----', concatBytes([meanBox, nameBox, dataBox]));
  }

  const dataBox = buildDataBox(atom.value);
  return wrapBox(atom.key, dataBox);
}

/** Build the full `ilst` box from a MetadataAtoms array. */
function buildIlstBox(metadata: MetadataAtoms): Uint8Array {
  const atomBytes = metadata.map(buildIlstAtom);
  const ilstPayload = concatBytes(atomBytes);
  return wrapBox('ilst', ilstPayload);
}

/** Build the `hdlr` box for mdir (metadata handler). */
function buildHdlrBox(): Uint8Array {
  // FullBox: version(1)+flags(3)+pre_defined(4)+handler_type(4)+reserved(12)+name
  // name = empty (0 bytes)
  const payload = new Uint8Array(4 + 4 + 4 + 12);
  // version=0, flags=0: first 4 bytes stay 0
  // pre_defined: bytes 4-7 stay 0
  // handler_type at offset 8: 'mdir'
  encodeFourCCLatin1('mdir', payload, 8);
  // reserved[0..2] at offsets 12,16,20: stay 0
  return wrapBox('hdlr', payload);
}

/** Build the `meta` FullBox v0 containing hdlr + ilst. */
function buildMetaBox(metadata: MetadataAtoms): Uint8Array {
  const hdlrBox = buildHdlrBox();
  const ilstBox = buildIlstBox(metadata);

  // meta FullBox v0: [version:u8=0][flags:u24=0][hdlr][ilst]
  const innerPayload = concatBytes([hdlrBox, ilstBox]);
  const metaPayload = new Uint8Array(4 + innerPayload.length);
  // version=0, flags=0 already zero
  metaPayload.set(innerPayload, 4);
  return wrapBox('meta', metaPayload);
}

/** Build the full `udta` box. Returns null when nothing to emit. */
export function buildUdtaBox(
  metadata: MetadataAtoms,
  udtaOpaque: Uint8Array | null,
): Uint8Array | null {
  if (metadata.length === 0 && udtaOpaque === null) {
    // Trap 11: drop empty udta
    return null;
  }

  if (metadata.length === 0 && udtaOpaque !== null) {
    // Preserve verbatim opaque bytes wrapped in fresh udta header
    return wrapBox('udta', udtaOpaque);
  }

  // Build fresh udta/meta(FullBox v0)/hdlr/ilst
  const metaBox = buildMetaBox(metadata);
  return wrapBox('udta', metaBox);
}
