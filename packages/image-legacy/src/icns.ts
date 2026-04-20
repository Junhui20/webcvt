/**
 * ICNS (Apple Icon Image) parser and serializer for @webcvt/image-legacy.
 *
 * Implements the Apple Icon Composer format: IFF-style multi-resolution icon
 * container. All multi-byte integers are big-endian (Trap #13).
 *
 * Spec references (clean-room):
 *   - Apple Icon Composer Guide
 *   - Apple Technical Note TN2166
 *   - Wikipedia tabular summary of ICNS element types
 *
 * Supported element types (decode):
 *   ICN#          — 32×32 1-bit + mask (256 bytes payload)
 *   is32/s8mk     — 16×16 PackBits RGB + 8-bit alpha
 *   il32/l8mk     — 32×32 PackBits RGB + 8-bit alpha
 *   ih32/h8mk     — 48×48 PackBits RGB + 8-bit alpha
 *   it32/t8mk     — 128×128 PackBits RGB + 8-bit alpha (Trap #1: 4-byte zero prefix)
 *   ic07–ic14     — PNG or JPEG 2000 payload (Trap #3: sniff magic)
 *   TOC           — parsed/cross-checked; discarded on decode; regenerated on serialize
 *   All others    — preserved as opaque elements
 *
 * All 14 traps from the design note are honoured.
 */

import {
  ICNS_HEADER_SIZE,
  ICNS_MAGIC,
  ICNS_TOC_FOURCC,
  JP2_SIGNATURE,
  MAX_ICNS_ELEMENTS,
  MAX_INPUT_BYTES,
  MAX_PIXEL_BYTES,
  PNG_SIGNATURE,
} from './constants.ts';
import {
  IcnsBadElementError,
  IcnsBadHeaderSizeError,
  IcnsBadMagicError,
  IcnsMaskSizeMismatchError,
  IcnsPackBitsDecodeError,
  IcnsTooManyElementsError,
  IcnsUnsupportedFeatureError,
  ImageInputTooLargeError,
} from './errors.ts';
import { packBitsDecodeConsume } from './icns-packbits.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type IcnsIconKind = 'mono-1bit-mask' | 'lowres-packbits' | 'highres-encoded';
export type IcnsHighResSubFormat = 'png' | 'jpeg2000';
export type IcnsFourCC = string; // 4 ASCII bytes including trailing space

export interface IcnsOpaqueElement {
  type: IcnsFourCC;
  rawBytes: Uint8Array;
}

export interface IcnsIcon {
  type: IcnsFourCC;
  kind: IcnsIconKind;
  pixelSize: number;
  subFormat?: IcnsHighResSubFormat;
  /** Non-null for mono and lowres-packbits. */
  pixelData: Uint8Array | null;
  /** Non-null for highres-encoded. */
  payloadBytes: Uint8Array | null;
}

export type IcnsNormalisation =
  | 'lowres-element-dropped'
  | 'classic-icon-dropped'
  | 'highres-jpeg2000-dropped'
  | 'retina-variant-dropped'
  | 'toc-regenerated'
  | 'opaque-element-preserved';

export interface IcnsFile {
  format: 'icns';
  declaredTotalSize: number;
  icons: IcnsIcon[];
  otherElements: IcnsOpaqueElement[];
  normalisations: IcnsNormalisation[];
}

// ---------------------------------------------------------------------------
// Internal lookup tables
// ---------------------------------------------------------------------------

/** Low-res RGB FourCCs → pixel dimension. */
const LOWRES_DIM: Readonly<Record<string, number>> = {
  is32: 16,
  il32: 32,
  ih32: 48,
  it32: 128,
};

/** Mask FourCC → corresponding RGB FourCC. */
const MASK_TO_RGB: Readonly<Record<string, string>> = {
  s8mk: 'is32',
  l8mk: 'il32',
  h8mk: 'ih32',
  t8mk: 'it32',
};

/** RGB FourCC → corresponding mask FourCC. */
const RGB_TO_MASK: Readonly<Record<string, string>> = {
  is32: 's8mk',
  il32: 'l8mk',
  ih32: 'h8mk',
  it32: 't8mk',
};

/** High-res FourCCs → pixel dimension. */
const HIGHRES_DIM: Readonly<Record<string, number>> = {
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  ic11: 32,
  ic12: 64,
  ic13: 256,
  ic14: 512,
};

/** Retina (doubled pixel density) high-res FourCCs that are dropped on serialize. */
const RETINA_FOURCCS = new Set(['ic11', 'ic12', 'ic13', 'ic14']);

/** Expected uncompressed mask sizes by RGB FourCC (dim × dim). */
const MASK_EXPECTED_BYTES: Readonly<Record<string, number>> = {
  is32: 16 * 16, // 256
  il32: 32 * 32, // 1024
  ih32: 48 * 48, // 2304
  it32: 128 * 128, // 16384
};

// ---------------------------------------------------------------------------
// Internal: raw element record
// ---------------------------------------------------------------------------

interface RawElement {
  fourcc: string;
  /** Full element size including the 8-byte header (Trap #10). */
  elementSize: number;
  /** Byte offset of the payload start within input. */
  payloadOffset: number;
  /** Payload byte length = elementSize - 8. */
  payloadLength: number;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseIcns(input: Uint8Array): IcnsFile {
  // Step 1: input size validation
  if (input.length > MAX_INPUT_BYTES) {
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }
  if (input.length < ICNS_HEADER_SIZE) {
    throw new IcnsBadMagicError();
  }

  // Step 2: magic validation (Trap #9, #13)
  if (
    (input[0] ?? 0) !== ICNS_MAGIC[0] ||
    (input[1] ?? 0) !== ICNS_MAGIC[1] ||
    (input[2] ?? 0) !== ICNS_MAGIC[2] ||
    (input[3] ?? 0) !== ICNS_MAGIC[3]
  ) {
    throw new IcnsBadMagicError();
  }

  // Step 3: totalSize check (Trap #7)
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const declaredTotalSize = dv.getUint32(4, false); // big-endian (Trap #13)
  if (declaredTotalSize !== 0 && declaredTotalSize !== input.length) {
    throw new IcnsBadHeaderSizeError(declaredTotalSize, input.length);
  }

  // Step 4: walk elements from offset 8 (Trap #10)
  const rawElements: RawElement[] = [];
  let offset = ICNS_HEADER_SIZE;

  while (offset < input.length) {
    // Validate 8-byte header fits
    if (offset + 8 > input.length) {
      throw new IcnsBadElementError(
        `element header at offset ${offset} extends past input end (${input.length})`,
      );
    }

    // Read FourCC (Trap #9: byte-exact, no trimming)
    const fourcc =
      String.fromCharCode(input[offset] ?? 0) +
      String.fromCharCode(input[offset + 1] ?? 0) +
      String.fromCharCode(input[offset + 2] ?? 0) +
      String.fromCharCode(input[offset + 3] ?? 0);

    const elementSize = dv.getUint32(offset + 4, false); // big-endian (Trap #13)

    // Validate elementSize >= 8 (Trap #10)
    if (elementSize < 8) {
      throw new IcnsBadElementError(`element at offset ${offset} has size ${elementSize} < 8`);
    }

    // Validate element fits within input
    if (offset + elementSize > input.length) {
      throw new IcnsBadElementError(
        `element '${fourcc}' at offset ${offset} with size ${elementSize} extends past input end (${input.length})`,
      );
    }

    // Cap element count (step 5)
    if (rawElements.length >= MAX_ICNS_ELEMENTS) {
      throw new IcnsTooManyElementsError(MAX_ICNS_ELEMENTS);
    }

    rawElements.push({
      fourcc,
      elementSize,
      payloadOffset: offset + 8,
      payloadLength: elementSize - 8,
    });

    offset += elementSize;
  }

  // Build element map (first occurrence wins, preserves order)
  const elementMap = new Map<string, RawElement>();
  for (const el of rawElements) {
    if (!elementMap.has(el.fourcc)) {
      elementMap.set(el.fourcc, el);
    }
  }

  // Step 5: If TOC present, parse for cross-check only (discard on decode — Trap #6)
  // TOC validation is intentionally lenient; we just skip it.

  // Step 6: decode recognised elements
  const icons: IcnsIcon[] = [];
  const otherElements: IcnsOpaqueElement[] = [];
  const normalisations: IcnsNormalisation[] = [];
  const processedFourccs = new Set<string>();

  for (const el of rawElements) {
    const { fourcc } = el;

    // Skip already-consumed elements (masks consumed alongside their RGB sibling)
    if (processedFourccs.has(fourcc)) continue;
    processedFourccs.add(fourcc);

    if (fourcc === ICNS_TOC_FOURCC) {
      // TOC: discard (Trap #6)
      continue;
    }

    if (fourcc === 'ICN#') {
      const icon = decodeIcnHash(input, el);
      icons.push(icon);
      continue;
    }

    if (fourcc in LOWRES_DIM) {
      // Mark mask FourCC as processed
      const maskFourcc = RGB_TO_MASK[fourcc];
      if (maskFourcc !== undefined) {
        processedFourccs.add(maskFourcc);
      }
      const maskEl = maskFourcc !== undefined ? elementMap.get(maskFourcc) : undefined;
      const icon = decodeLowresPackBits(input, el, maskEl);
      icons.push(icon);
      continue;
    }

    // Orphan mask: mask element present but no matching RGB sibling
    if (fourcc in MASK_TO_RGB) {
      // No icon emitted; just a diagnostic (Trap #11)
      continue;
    }

    if (fourcc in HIGHRES_DIM) {
      const icon = decodeHighres(input, el);
      icons.push(icon);
      continue;
    }

    if (fourcc === 'icon') {
      throw new IcnsUnsupportedFeatureError('icon-classic');
    }

    // Unknown element: preserve as opaque (Trap #14: copy, not view)
    otherElements.push({
      type: fourcc,
      rawBytes: input.slice(el.payloadOffset, el.payloadOffset + el.payloadLength),
    });
  }

  return {
    format: 'icns',
    declaredTotalSize,
    icons,
    otherElements,
    normalisations,
  };
}

// ---------------------------------------------------------------------------
// Per-element decoders
// ---------------------------------------------------------------------------

/** Decode ICN# (32×32 1-bit bitmap + 1-bit mask = 256 bytes payload). */
function decodeIcnHash(input: Uint8Array, el: RawElement): IcnsIcon {
  // Trap #4: ICN# must be exactly 256 bytes
  if (el.payloadLength !== 256) {
    throw new IcnsBadElementError(
      `ICN# element payload is ${el.payloadLength} bytes; expected 256`,
    );
  }

  const pixelCount = 32 * 32;
  const pixelData = new Uint8Array(pixelCount * 4);

  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const bitIndex = y * 32 + x;
      const byteIndex = Math.floor(bitIndex / 8);
      const bitPos = 7 - (bitIndex % 8); // MSB-first

      const iconByte = input[el.payloadOffset + byteIndex] ?? 0;
      const maskByte = input[el.payloadOffset + 128 + byteIndex] ?? 0;

      const iconBit = (iconByte >> bitPos) & 1;
      const maskBit = (maskByte >> bitPos) & 1;

      const pixelOffset = (y * 32 + x) * 4;
      const colorValue = iconBit === 1 ? 0 : 255;
      pixelData[pixelOffset] = colorValue;
      pixelData[pixelOffset + 1] = colorValue;
      pixelData[pixelOffset + 2] = colorValue;
      pixelData[pixelOffset + 3] = maskBit === 1 ? 255 : 0;
    }
  }

  return {
    type: 'ICN#',
    kind: 'mono-1bit-mask',
    pixelSize: 32,
    pixelData,
    payloadBytes: null,
  };
}

/**
 * Decode a low-res PackBits element (is32/il32/ih32/it32) with its optional mask.
 * Trap #1: it32 has a 4-byte zero prefix before PackBits data.
 * Trap #2: R, G, B channels are packed sequentially, NOT interleaved.
 * Trap #5: mask is uncompressed 8-bit alpha; exact byte count required.
 * Trap #11: missing mask tolerated (alpha = 255 default).
 */
function decodeLowresPackBits(
  input: Uint8Array,
  el: RawElement,
  maskEl: RawElement | undefined,
): IcnsIcon {
  const dim = LOWRES_DIM[el.fourcc];
  if (dim === undefined) {
    /* v8 ignore next */
    throw new IcnsBadElementError(`unknown lowres FourCC '${el.fourcc}'`);
  }

  const pixelCount = dim * dim;

  // Validate RGBA byte count against security cap before allocation
  const rgbaBytes = pixelCount * 4;
  if (rgbaBytes > MAX_PIXEL_BYTES) {
    throw new IcnsBadElementError(
      `element '${el.fourcc}' would produce ${rgbaBytes} RGBA bytes exceeding cap`,
    );
  }

  let cursor = el.payloadOffset;
  const payloadEnd = el.payloadOffset + el.payloadLength;

  // Trap #1: it32 has 4-byte zero prefix before PackBits
  if (el.fourcc === 'it32') {
    cursor += 4;
  }

  // Trap #2: decode R, G, B planes sequentially
  let rResult: ReturnType<typeof packBitsDecodeConsume>;
  let gResult: ReturnType<typeof packBitsDecodeConsume>;
  let bResult: ReturnType<typeof packBitsDecodeConsume>;

  try {
    rResult = packBitsDecodeConsume(input, cursor, payloadEnd, pixelCount);
    cursor += rResult.consumed;

    gResult = packBitsDecodeConsume(input, cursor, payloadEnd, pixelCount);
    cursor += gResult.consumed;

    bResult = packBitsDecodeConsume(input, cursor, payloadEnd, pixelCount);
  } catch (err) {
    if (err instanceof IcnsPackBitsDecodeError) throw err;
    /* v8 ignore next */
    throw new IcnsPackBitsDecodeError(`unexpected error decoding '${el.fourcc}': ${String(err)}`);
  }

  // Trap #5: validate mask size before use (Trap #11: tolerate missing mask)
  let alpha: Uint8Array | null = null;
  if (maskEl !== undefined) {
    const expectedMaskBytes = MASK_EXPECTED_BYTES[el.fourcc];
    if (expectedMaskBytes === undefined) {
      /* v8 ignore next */
      throw new IcnsBadElementError(`no mask size mapping for FourCC '${el.fourcc}'`);
    }
    if (maskEl.payloadLength !== expectedMaskBytes) {
      throw new IcnsMaskSizeMismatchError(maskEl.fourcc, maskEl.payloadLength, expectedMaskBytes);
    }
    alpha = input.subarray(maskEl.payloadOffset, maskEl.payloadOffset + maskEl.payloadLength);
  }

  // Assemble RGBA: R, G, B planes + alpha (Trap #14: only need slice for pixelData)
  const pixelData = new Uint8Array(rgbaBytes);
  const rPlane = rResult.output;
  const gPlane = gResult.output;
  const bPlane = bResult.output;

  for (let i = 0; i < pixelCount; i++) {
    const base = i * 4;
    pixelData[base] = rPlane[i] ?? 0;
    pixelData[base + 1] = gPlane[i] ?? 0;
    pixelData[base + 2] = bPlane[i] ?? 0;
    // Trap #11: no mask → alpha = 255 default
    pixelData[base + 3] = alpha !== null ? (alpha[i] ?? 255) : 255;
  }

  return {
    type: el.fourcc,
    kind: 'lowres-packbits',
    pixelSize: dim,
    pixelData,
    payloadBytes: null,
  };
}

/**
 * Decode a high-res element (ic07–ic14).
 * Trap #3: sniff PNG or JP2 magic to determine subFormat.
 */
function decodeHighres(input: Uint8Array, el: RawElement): IcnsIcon {
  const pixelSize = HIGHRES_DIM[el.fourcc];
  if (pixelSize === undefined) {
    /* v8 ignore next */
    throw new IcnsBadElementError(`unknown highres FourCC '${el.fourcc}'`);
  }

  const payload = input.subarray(el.payloadOffset, el.payloadOffset + el.payloadLength);

  // Trap #3: detect PNG vs JP2
  const subFormat = sniffHighresFormat(payload);
  if (subFormat === null) {
    throw new IcnsUnsupportedFeatureError('highres-unknown-signature');
  }

  // Trap #14: return copy, not view
  return {
    type: el.fourcc,
    kind: 'highres-encoded',
    pixelSize,
    subFormat,
    pixelData: null,
    payloadBytes: payload.slice(),
  };
}

/** Sniff PNG or JP2 magic bytes. Returns null if neither matches. */
function sniffHighresFormat(payload: Uint8Array): IcnsHighResSubFormat | null {
  // Check PNG (8 bytes)
  if (payload.length >= PNG_SIGNATURE.length) {
    let isPng = true;
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
      if ((payload[i] ?? 0) !== (PNG_SIGNATURE[i] ?? 0)) {
        isPng = false;
        break;
      }
    }
    if (isPng) return 'png';
  }

  // Check JP2 (12 bytes)
  if (payload.length >= JP2_SIGNATURE.length) {
    let isJp2 = true;
    for (let i = 0; i < JP2_SIGNATURE.length; i++) {
      if ((payload[i] ?? 0) !== (JP2_SIGNATURE[i] ?? 0)) {
        isJp2 = false;
        break;
      }
    }
    if (isJp2) return 'jpeg2000';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize an IcnsFile to a canonical byte sequence.
 *
 * Only PNG-bearing ic08/ic09/ic10 icons are emitted. All others are dropped
 * with appropriate normalisation flags. Opaque elements are preserved verbatim.
 * A fresh TOC record is always generated.
 */
export function serializeIcns(file: IcnsFile): Uint8Array {
  const normalisations: IcnsNormalisation[] = [];

  // Step 1: filter icons — keep only PNG-bearing ic08/ic09/ic10
  const PNG_EMIT_FOURCCS = new Set(['ic08', 'ic09', 'ic10']);

  const emittableIcons: IcnsIcon[] = [];
  for (const icon of file.icons) {
    if (
      icon.kind === 'highres-encoded' &&
      icon.subFormat === 'png' &&
      PNG_EMIT_FOURCCS.has(icon.type)
    ) {
      emittableIcons.push(icon);
    } else if (icon.kind === 'lowres-packbits') {
      addNormIfAbsent(normalisations, 'lowres-element-dropped');
    } else if (icon.kind === 'mono-1bit-mask') {
      addNormIfAbsent(normalisations, 'classic-icon-dropped');
    } else if (icon.kind === 'highres-encoded' && icon.subFormat === 'jpeg2000') {
      addNormIfAbsent(normalisations, 'highres-jpeg2000-dropped');
    } else if (icon.kind === 'highres-encoded' && RETINA_FOURCCS.has(icon.type)) {
      addNormIfAbsent(normalisations, 'retina-variant-dropped');
    } else if (icon.kind === 'highres-encoded') {
      // ic07 or other non-emittable — also retina or lowres for non-PNG
      addNormIfAbsent(normalisations, 'retina-variant-dropped');
    }
  }

  // Opaque elements always preserved
  if (file.otherElements.length > 0) {
    addNormIfAbsent(normalisations, 'opaque-element-preserved');
  }

  // TOC always regenerated (Trap #6)
  normalisations.push('toc-regenerated');

  // Step 2: build records

  // Compute total element count for TOC (emittable icons + opaque)
  const tocEntryCount = emittableIcons.length + file.otherElements.length;

  // TOC payload: N × 8 bytes (FourCC + uint32 elementSize for each entry)
  const tocPayloadSize = tocEntryCount * 8;
  const tocElementSize = 8 + tocPayloadSize; // header + payload

  // Build list of (fourcc, payload) pairs for final assembly
  const records: Array<{ fourcc: string; payload: Uint8Array }> = [];

  for (const icon of emittableIcons) {
    if (icon.payloadBytes === null) continue;
    records.push({ fourcc: icon.type, payload: icon.payloadBytes });
  }
  for (const opaque of file.otherElements) {
    records.push({ fourcc: opaque.type, payload: opaque.rawBytes });
  }

  // Step 3: compute total size
  // 8 (file header) + tocElementSize + sum(8 + payload.length for each record)
  let totalSize = 8 + tocElementSize;
  for (const rec of records) {
    totalSize += 8 + rec.payload.length;
  }

  // Step 4: allocate and write
  const out = new Uint8Array(totalSize);
  const dvOut = new DataView(out.buffer);

  // Write file header: magic + totalSize (big-endian)
  out[0] = ICNS_MAGIC[0] ?? 0x69;
  out[1] = ICNS_MAGIC[1] ?? 0x63;
  out[2] = ICNS_MAGIC[2] ?? 0x6e;
  out[3] = ICNS_MAGIC[3] ?? 0x73;
  dvOut.setUint32(4, totalSize, false);

  let writeOffset = 8;

  // Write TOC element
  writeFourCC(out, writeOffset, ICNS_TOC_FOURCC);
  dvOut.setUint32(writeOffset + 4, tocElementSize, false);
  writeOffset += 8;

  // Write TOC entries
  for (const rec of records) {
    const recSize = 8 + rec.payload.length;
    writeFourCC(out, writeOffset, rec.fourcc);
    dvOut.setUint32(writeOffset + 4, recSize, false);
    writeOffset += 8;
  }

  // Write each record element
  for (const rec of records) {
    const recSize = 8 + rec.payload.length;
    writeFourCC(out, writeOffset, rec.fourcc);
    dvOut.setUint32(writeOffset + 4, recSize, false);
    writeOffset += 8;
    out.set(rec.payload, writeOffset);
    writeOffset += rec.payload.length;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Write a 4-character ASCII FourCC at the given offset (Trap #9). */
function writeFourCC(out: Uint8Array, offset: number, fourcc: string): void {
  out[offset] = fourcc.charCodeAt(0);
  out[offset + 1] = fourcc.charCodeAt(1);
  out[offset + 2] = fourcc.charCodeAt(2);
  out[offset + 3] = fourcc.charCodeAt(3);
}

/** Add a normalisation flag if not already present. */
function addNormIfAbsent(normalisations: IcnsNormalisation[], flag: IcnsNormalisation): void {
  if (!normalisations.includes(flag)) {
    normalisations.push(flag);
  }
}
