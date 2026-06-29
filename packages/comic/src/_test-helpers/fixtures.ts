/**
 * Test-only fixture builders (excluded from coverage and the published build).
 *
 * No binary fixtures are committed: CBZ archives are zipped IN-TEST from
 * synthetic page images with archive-zip's `serializeZip`, and the page images
 * themselves are hand-built minimal-but-valid JPEG / PNG bytes (the same
 * technique doc-pdf's own suite uses, so the produced PDF embeds real data).
 */

import { type ZipEntry, serializeZip } from '@catlabtech/webcvt-archive-zip';

// ---------------------------------------------------------------------------
// Synthetic page images
// ---------------------------------------------------------------------------

/** Build a minimal JPEG with a valid SOF0 marker for the given size/components. */
export function makeJpeg(width: number, height: number, components = 3): Uint8Array {
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
    0x01,
    0x01,
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

/**
 * Build a valid opaque RGB PNG with solid pixels. `colorType` defaults to 2
 * (truecolour) which `imagesToPdf` embeds; pass 6 (RGBA) to exercise the
 * unsupported-source path.
 */
export function makePng(width: number, height: number, colorType = 2): Uint8Array {
  const channels = colorType === 6 ? 4 : colorType === 0 ? 1 : 3;
  const rowSampleBytes = width * channels;
  const ihdr = Uint8Array.from([...u32be(width), ...u32be(height), 8, colorType, 0, 0, 0]);

  const raw = new Uint8Array(height * (1 + rowSampleBytes));
  for (let y = 0; y < height; y++) {
    const base = y * (1 + rowSampleBytes);
    raw[base] = 0; // filter: None
    for (let x = 0; x < rowSampleBytes; x++) raw[base + 1 + x] = 0x80;
  }
  const idat = zlibStore(raw);

  const parts: Uint8Array[] = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ];
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

// ---------------------------------------------------------------------------
// Synthetic CBZ builder
// ---------------------------------------------------------------------------

/** Build a stored ZipEntry from a name + raw bytes. */
function binEntry(name: string, bytes: Uint8Array): ZipEntry {
  return {
    name,
    method: 0,
    crc32: 0,
    compressedSize: bytes.length,
    uncompressedSize: bytes.length,
    modified: new Date('2024-01-01T00:00:00Z'),
    isDirectory: name.endsWith('/'),
    localHeaderOffset: 0,
    data: async () => bytes,
    stream: () => new ReadableStream<Uint8Array>(),
  };
}

/** Zip a list of [name, bytes] entries into raw CBZ (ZIP) bytes. */
export function buildCbz(
  entries: ReadonlyArray<readonly [string, Uint8Array]>,
): Promise<Uint8Array> {
  return serializeZip({
    entries: entries.map(([name, bytes]) => binEntry(name, bytes)),
    comment: '',
  });
}

// ---------------------------------------------------------------------------
// Non-ZIP container fixtures (magic-byte prefixes)
// ---------------------------------------------------------------------------

/** A minimal CBR (RAR4) byte blob: "Rar!\x1a\x07\x00" + padding. */
export function makeRar(): Uint8Array {
  return new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0x00, 0x00, 0x00]);
}

/** A minimal CB7 (7z) byte blob: "7z\xbc\xaf\x27\x1c" + padding. */
export function makeSevenZip(): Uint8Array {
  return new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x00, 0x00, 0x00]);
}
