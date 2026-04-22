/**
 * Synthetic ICNS builder for @catlabtech/webcvt-image-legacy tests.
 *
 * Constructs minimal but spec-valid ICNS byte sequences entirely in memory.
 * NO binary fixtures are committed to disk — every test fixture is built here.
 *
 * All multi-byte integers are big-endian (Trap #13).
 * Trap #10: element size counts the 8-byte header.
 * Trap #9: FourCC is byte-exact including trailing space.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IcnsElement {
  fourcc: string;
  payload: Uint8Array;
}

// ---------------------------------------------------------------------------
// buildIcns — top-level builder
// ---------------------------------------------------------------------------

/**
 * Build a minimal ICNS file from a list of {fourcc, payload} elements.
 * Computes the correct totalSize and writes the 8-byte file header.
 */
export function buildIcns(opts: { elements: IcnsElement[] }): Uint8Array {
  const icnsMagic = new Uint8Array([0x69, 0x63, 0x6e, 0x73]);

  // Compute total size: 8 (file header) + sum(8 + payload.length per element)
  let totalSize = 8;
  for (const el of opts.elements) {
    totalSize += 8 + el.payload.length;
  }

  const out = new Uint8Array(totalSize);
  const dv = new DataView(out.buffer);

  // File header
  out.set(icnsMagic, 0);
  dv.setUint32(4, totalSize, false);

  let offset = 8;
  for (const el of opts.elements) {
    // FourCC (4 bytes, byte-exact)
    out[offset] = el.fourcc.charCodeAt(0);
    out[offset + 1] = el.fourcc.charCodeAt(1);
    out[offset + 2] = el.fourcc.charCodeAt(2);
    out[offset + 3] = el.fourcc.charCodeAt(3);
    // Element size (header + payload, big-endian)
    dv.setUint32(offset + 4, 8 + el.payload.length, false);
    // Payload
    out.set(el.payload, offset + 8);
    offset += 8 + el.payload.length;
  }

  return out;
}

// ---------------------------------------------------------------------------
// buildIcnHashPayload — ICN# payload builder
// ---------------------------------------------------------------------------

/**
 * Build an ICN# payload (256 bytes): 128 bytes 1-bit bitmap + 128 bytes 1-bit mask.
 * `bitmap` and `mask` must each be 32×32 = 1024 bits packed MSB-first into 128 bytes.
 */
export function buildIcnHashPayload(bitmap: Uint8Array, mask: Uint8Array): Uint8Array {
  if (bitmap.length !== 128 || mask.length !== 128) {
    throw new Error(
      `buildIcnHashPayload: bitmap and mask must each be 128 bytes (got ${bitmap.length}, ${mask.length})`,
    );
  }
  const payload = new Uint8Array(256);
  payload.set(bitmap, 0);
  payload.set(mask, 128);
  return payload;
}

/**
 * Build a simple 32×32 1-bit plane where all pixels have the given bit value (0 or 1).
 */
export function buildIcnHashPlane(bitValue: 0 | 1): Uint8Array {
  return new Uint8Array(128).fill(bitValue === 1 ? 0xff : 0x00);
}

// ---------------------------------------------------------------------------
// packBitsEncode — test-only greedy PackBits encoder
// ---------------------------------------------------------------------------

/**
 * Encode a byte sequence using PackBits (greedy literal encoder).
 * This is NOT the production encoder — it emits everything as literal runs,
 * which is valid PackBits but not compressed. Used only for test fixtures.
 */
export function packBitsEncode(plane: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < plane.length) {
    // Emit literal runs of up to 128 bytes (header 0x7F = 127 → copy 128)
    const runLen = Math.min(128, plane.length - i);
    out.push(runLen - 1); // header byte n ∈ [0, 127]: copy n+1 bytes
    for (let j = 0; j < runLen; j++) {
      out.push(plane[i + j] ?? 0);
    }
    i += runLen;
  }
  return new Uint8Array(out);
}

/**
 * Encode a byte sequence using PackBits run-length encoding (RLE runs only).
 * All bytes must be the same value; used for producing compact repeat runs.
 * For a mixed plane, use packBitsEncode (literal).
 */
export function packBitsEncodeRle(value: number, count: number): Uint8Array {
  const out: number[] = [];
  let remaining = count;
  while (remaining > 0) {
    const runLen = Math.min(128, remaining);
    // Header byte for repeat: n ∈ [-127, -1] → emit (1 - n) times
    // So for runLen copies: n = 1 - runLen. As unsigned byte: 256 + n = 257 - runLen
    out.push((257 - runLen) & 0xff);
    out.push(value);
    remaining -= runLen;
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// buildLowresPayload — PackBits RGB payload builder
// ---------------------------------------------------------------------------

export interface BuildLowresPayloadOpts {
  fourcc: string;
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
}

/**
 * Build a low-res RGB element payload.
 * - For 'it32': prepends 4 zero bytes before the PackBits data (Trap #1).
 * - Encodes each of R, G, B planes with PackBits sequentially (Trap #2).
 */
export function buildLowresPayload(opts: BuildLowresPayloadOpts): Uint8Array {
  const rEncoded = packBitsEncode(opts.r);
  const gEncoded = packBitsEncode(opts.g);
  const bEncoded = packBitsEncode(opts.b);

  const parts: Uint8Array[] = [];

  // Trap #1: it32 requires 4-byte zero prefix
  if (opts.fourcc === 'it32') {
    parts.push(new Uint8Array(4));
  }

  parts.push(rEncoded, gEncoded, bEncoded);

  return concat(...parts);
}

// ---------------------------------------------------------------------------
// buildMaskPayload — uncompressed mask builder
// ---------------------------------------------------------------------------

/**
 * Return the mask alpha bytes verbatim (uncompressed 8-bit alpha, Trap #5).
 */
export function buildMaskPayload(alpha: Uint8Array): Uint8Array {
  return alpha.slice();
}

// ---------------------------------------------------------------------------
// tinyPng — minimal 1×1 PNG for ic08+ tests
// ---------------------------------------------------------------------------

/**
 * Returns a minimal but spec-valid 1×1 RGBA PNG.
 * Constructed byte-by-byte from spec; no external dependencies.
 * Used to produce a valid PNG payload for highres-encoded icon tests.
 */
export function tinyPng(): Uint8Array {
  // Minimal 1×1 RGBA PNG built from scratch.
  // The PNG consists of: signature + IHDR + IDAT + IEND chunks.
  //
  // This is a pre-computed valid 1×1 transparent PNG (67 bytes).
  return new Uint8Array([
    // PNG signature
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    // IHDR chunk (13 bytes data + 4 len + 4 type + 4 crc = 25 bytes)
    0x00,
    0x00,
    0x00,
    0x0d, // length = 13
    0x49,
    0x48,
    0x44,
    0x52, // 'IHDR'
    0x00,
    0x00,
    0x00,
    0x01, // width = 1
    0x00,
    0x00,
    0x00,
    0x01, // height = 1
    0x08, // bit depth = 8
    0x02, // color type = 2 (RGB)
    0x00, // compression = 0
    0x00, // filter = 0
    0x00, // interlace = 0
    0x90,
    0x77,
    0x53,
    0xde, // CRC32 of type+data
    // IDAT chunk
    0x00,
    0x00,
    0x00,
    0x0c, // length = 12
    0x49,
    0x44,
    0x41,
    0x54, // 'IDAT'
    0x08,
    0xd7, // zlib header
    0x63,
    0xf8,
    0xcf,
    0xc0, // deflate stream (1 pixel, filter byte 0, RGB 0,0,0)
    0x00,
    0x00,
    0x00,
    0x02,
    0x00,
    0x01,
    0xe2,
    0x21,
    0xbc,
    0x33, // CRC32
    // IEND chunk
    0x00,
    0x00,
    0x00,
    0x00, // length = 0
    0x49,
    0x45,
    0x4e,
    0x44, // 'IEND'
    0xae,
    0x42,
    0x60,
    0x82, // CRC32
  ]);
}

/**
 * Returns a minimal JPEG 2000 payload (just enough to trigger JP2 signature detection).
 * Not a complete valid JP2 file — only the signature box header is present.
 */
export function tinyJp2(): Uint8Array {
  // JP2 signature: 12-byte ftyp-like signature box
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
    // Minimal subsequent bytes (won't be decoded, just returned as payloadBytes)
    0x00, 0x00, 0x00, 0x14,
  ]);
}

// ---------------------------------------------------------------------------
// concat helper (inline to avoid importing from bytes.ts)
// ---------------------------------------------------------------------------

function concat(...parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
