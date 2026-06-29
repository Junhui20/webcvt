/**
 * Synthetic, in-test fixture builders — no committed binaries.
 *
 * - makeJpegHeader: a minimal JPEG with a valid SOF marker (enough for
 *   parseJpegInfo / DCTDecode embedding; not a fully decodable image).
 * - makePng: a genuinely valid PNG (correct IHDR, CRC32s, a real zlib stored
 *   stream over filtered scanlines) so the produced PDF embeds real data.
 * - latin1 / bytes: tiny helpers for hand-building PDFs as bytes.
 */

/** Build a minimal JPEG with a valid SOF0 marker for the given size/components. */
export function makeJpegHeader(width: number, height: number, components: number): Uint8Array {
  const len = 8 + components * 3;
  const compSpecs: number[] = [];
  for (let i = 0; i < components; i++) compSpecs.push(i + 1, 0x11, 0);
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xc0, // SOF0
    (len >> 8) & 0xff,
    len & 0xff,
    0x08, // precision
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    components,
    ...compSpecs,
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC_TABLE[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + (bytes[i] ?? 0)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** Wrap raw bytes in a zlib stream using a single stored (uncompressed) block. */
function zlibStore(raw: Uint8Array): Uint8Array {
  const len = raw.length;
  const nlen = ~len & 0xffff;
  const out: number[] = [
    0x78,
    0x01, // zlib header (CM=8, no preset dict, fastest)
    0x01, // BFINAL=1, BTYPE=00 (stored)
    len & 0xff,
    (len >> 8) & 0xff,
    nlen & 0xff,
    (nlen >> 8) & 0xff,
  ];
  for (let i = 0; i < raw.length; i++) out.push(raw[i] ?? 0);
  out.push(...u32be(adler32(raw)));
  return Uint8Array.from(out);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  ]);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out: number[] = [...u32be(data.length)];
  for (let i = 0; i < body.length; i++) out.push(body[i] ?? 0);
  out.push(...u32be(crc32(body)));
  return Uint8Array.from(out);
}

export interface MakePngOptions {
  /** PNG colour type (0 grayscale, 2 RGB, 6 RGBA, …). Default 2. */
  readonly colorType?: number;
  /** Bit depth (8 or 16). Default 8. */
  readonly bitDepth?: number;
  /** Interlace method (0 none, 1 Adam7). Default 0. */
  readonly interlace?: number;
  /** Omit the IDAT chunk entirely (to exercise the "no IDAT" path). */
  readonly omitIdat?: boolean;
  /** Split the IDAT data across two chunks (to exercise concatenation). */
  readonly splitIdat?: boolean;
}

const COMPONENTS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Build a valid PNG with solid pixels for the requested colour model. */
export function makePng(width: number, height: number, opts?: MakePngOptions): Uint8Array {
  const colorType = opts?.colorType ?? 2;
  const bitDepth = opts?.bitDepth ?? 8;
  const interlace = opts?.interlace ?? 0;
  const channels = COMPONENTS[colorType] ?? 3;
  const bytesPerSample = bitDepth === 16 ? 2 : 1;
  const rowSampleBytes = width * channels * bytesPerSample;

  const ihdr = Uint8Array.from([
    ...u32be(width),
    ...u32be(height),
    bitDepth,
    colorType,
    0, // compression
    0, // filter method
    interlace,
  ]);

  // Filtered scanlines: filter byte 0 (None) + sample bytes set to a constant.
  const raw = new Uint8Array(height * (1 + rowSampleBytes));
  for (let y = 0; y < height; y++) {
    const base = y * (1 + rowSampleBytes);
    raw[base] = 0;
    for (let x = 0; x < rowSampleBytes; x++) raw[base + 1 + x] = 0x80;
  }
  const idatData = zlibStore(raw);

  const parts: Uint8Array[] = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
  ];
  if (opts?.omitIdat !== true) {
    if (opts?.splitIdat === true) {
      const mid = Math.floor(idatData.length / 2);
      parts.push(pngChunk('IDAT', idatData.subarray(0, mid)));
      parts.push(pngChunk('IDAT', idatData.subarray(mid)));
    } else {
      parts.push(pngChunk('IDAT', idatData));
    }
  }
  parts.push(pngChunk('IEND', new Uint8Array(0)));

  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

/** Encode an ASCII string to bytes (for hand-building PDFs). */
export function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
