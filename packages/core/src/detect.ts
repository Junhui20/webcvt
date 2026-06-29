import { findByExt } from './formats.ts';
import type { FormatDescriptor } from './types.ts';

/**
 * Magic-byte signatures for common formats. Each signature is a list of
 * bytes at specific offsets that must match. This avoids relying on file
 * extensions which users can lie about.
 *
 * References:
 * - PNG: RFC 2083 §12.11 ("89 50 4E 47 0D 0A 1A 0A")
 * - JPEG: JFIF/EXIF marker "FF D8 FF"
 * - WebP: RIFF container with "WEBP" at offset 8
 * - BMP: "BM" at offset 0
 * - ICO: "00 00 01 00" (resource type 1 = icon)
 * - GIF: "GIF87a" or "GIF89a"
 * - MP4: "ftyp" box marker at offset 4
 * - WebM: EBML header "1A 45 DF A3" — shared with MKV
 * - WAV: RIFF container with "WAVE" at offset 8
 * - OGG: "OggS" at offset 0
 * - MP3: ID3 tag ("ID3") or MPEG frame sync (0xFF 0xFB/0xFA/0xF3/0xF2)
 * - FLAC: "fLaC" at offset 0
 * - ZIP: "PK\x03\x04" at offset 0 (PKWARE APPNOTE.TXT)
 * - CBR (Comic Book RAR): "Rar!\x1a\x07" at offset 0 (RAR 1.5–5; the 7th byte
 *   distinguishes RAR4/RAR5). A plain .rar shares this magic — acceptable.
 * - CB7 (Comic Book 7z): "7z\xbc\xaf\x27\x1c" at offset 0. A plain .7z shares
 *   this magic — acceptable. (CBZ shares ZIP magic and relies on the filename
 *   hint, exactly like EPUB before its OCF marker, so it has no signature here.)
 * - GZip: 0x1F 0x8B at offset 0 (RFC 1952)
 * - bzip2: "BZh" (0x42 0x5A 0x68) at offset 0
 * - xz: 0xFD 0x37 0x7A 0x58 0x5A 0x00 at offset 0 (XZ file format spec)
 * - TAR (ustar): "ustar\0" at offset 257 (POSIX 1003.1); requires reading 263+ bytes
 * - WOFF: "wOFF" at offset 0 (WOFF 1.0 W3C Recommendation)
 * - OTF (CFF sfnt): "OTTO" at offset 0 (OpenType / ISO 14496-22)
 * - TTF (sfnt): version 0x00010000 OR "true" at offset 0. 0x00010000 differs from
 *   ICO ("00 00 01 00") at byte 1, so the two never collide.
 */
interface Signature {
  readonly ext: string;
  readonly offset: number;
  readonly bytes: readonly number[];
}

const SIGNATURES: readonly Signature[] = [
  { ext: 'png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: 'jpg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { ext: 'webp', offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF — check 'WEBP' at 8 separately
  { ext: 'bmp', offset: 0, bytes: [0x42, 0x4d] },
  { ext: 'ico', offset: 0, bytes: [0x00, 0x00, 0x01, 0x00] },
  { ext: 'gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }, // 'GIF8' (7a or 9a)
  { ext: 'mp4', offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // 'ftyp'
  { ext: 'webm', offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }, // EBML, shared with MKV
  { ext: 'wav', offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF — check 'WAVE' at 8 separately
  { ext: 'ogg', offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53] },
  { ext: 'mp3', offset: 0, bytes: [0x49, 0x44, 0x33] }, // ID3v2
  { ext: 'flac', offset: 0, bytes: [0x66, 0x4c, 0x61, 0x43] },
  { ext: 'zip', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  // CBR (Comic Book RAR): "Rar!\x1a\x07" — shared by RAR4 and RAR5 (and plain .rar).
  { ext: 'cbr', offset: 0, bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] },
  // CB7 (Comic Book 7z): "7z\xbc\xaf\x27\x1c" (and plain .7z).
  { ext: 'cb7', offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { ext: 'gz', offset: 0, bytes: [0x1f, 0x8b] },
  { ext: 'bz2', offset: 0, bytes: [0x42, 0x5a, 0x68] }, // 'BZh'
  { ext: 'xz', offset: 0, bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] },
  // TAR ustar: magic "ustar\0" at offset 257 (POSIX 1003.1).
  // HEADER_BYTES_TO_READ must be >= 263 to reach this offset.
  { ext: 'tar', offset: 257, bytes: [0x75, 0x73, 0x74, 0x61, 0x72, 0x00] }, // "ustar\0"
  // QOI: 4-byte magic "qoif" at offset 0 (image/qoi)
  { ext: 'qoi', offset: 0, bytes: [0x71, 0x6f, 0x69, 0x66] },
  // WOFF 1.0: "wOFF" at offset 0.
  { ext: 'woff', offset: 0, bytes: [0x77, 0x4f, 0x46, 0x46] },
  // OpenType/CFF sfnt: "OTTO" at offset 0.
  { ext: 'otf', offset: 0, bytes: [0x4f, 0x54, 0x54, 0x4f] },
  // TrueType sfnt: version 0x00010000 at offset 0 (does NOT collide with ICO "00 00 01 00").
  { ext: 'ttf', offset: 0, bytes: [0x00, 0x01, 0x00, 0x00] },
  // Apple legacy TrueType sfnt: "true" at offset 0.
  { ext: 'ttf', offset: 0, bytes: [0x74, 0x72, 0x75, 0x65] },
];

// For MPEG-TS detection we need 189 bytes (offset 0 + offset 188).
// For TAR ustar detection we need 263 bytes (offset 257 + 6-byte magic = 263).
// Bumped to 264 to provide one byte of safety margin.
// Bumped to 1024 so SVG detection can scan the full SVG_SCAN_BYTES window.
// Previously 264 (just enough for ustar magic at offset 257); SVGs with long
// XML preambles + comments would push <svg past byte 264 and silently fail
// core format detection.
const HEADER_BYTES_TO_READ = 1024;

// Number of bytes decoded as UTF-8 text for SVG root-element scanning.
// 1024 characters is more than enough to encompass a BOM + XML decl + comments + <svg.
const SVG_SCAN_BYTES = 1024;

function matchesAt(buf: Uint8Array, offset: number, bytes: readonly number[]): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

// EPUB OCF marker bytes: the ASCII filename "mimetype" and its required content
// "application/epub+zip" (EPUB 3.3 OCF §4 — abbreviated container signature).
const EPUB_MIMETYPE_NAME: readonly number[] = [0x6d, 0x69, 0x6d, 0x65, 0x74, 0x79, 0x70, 0x65];
const EPUB_MIMETYPE_VALUE: readonly number[] = [
  0x61, 0x70, 0x70, 0x6c, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x2f, 0x65, 0x70, 0x75, 0x62,
  0x2b, 0x7a, 0x69, 0x70,
];

/**
 * Disambiguate a ZIP as an EPUB. A conformant EPUB is an OCF ZIP whose first
 * entry is an uncompressed `mimetype` file. The 30-byte local file header is
 * followed by the filename "mimetype" at offset 30 and — with no extra field,
 * as the OCF spec mandates for this entry — its content "application/epub+zip"
 * at offset 38. A normal ZIP fails this check and stays a ZIP.
 */
function isEpubOcf(buf: Uint8Array): boolean {
  return matchesAt(buf, 30, EPUB_MIMETYPE_NAME) && matchesAt(buf, 38, EPUB_MIMETYPE_VALUE);
}

/**
 * Detect SVG from a byte buffer by scanning the first SVG_SCAN_BYTES bytes as UTF-8
 * text for an `<svg` root element preceded only by BOM, XML declaration, whitespace,
 * or XML/HTML comments.
 *
 * SVG has no fixed-offset binary magic signature. We decode the head of the buffer
 * with a replacement-mode TextDecoder (non-fatal — we only need ASCII text matching,
 * not strict UTF-8 validation) and look for the structural preamble.
 *
 * Returns the SVG FormatDescriptor when detected, undefined otherwise.
 */
function detectSvgFromBytes(buf: Uint8Array): FormatDescriptor | undefined {
  // Quick heuristic: first byte must be printable ASCII or BOM (0xEF for UTF-8 BOM,
  // 0x3C for '<', 0x20/0x09/0x0A/0x0D for whitespace, 0x3F for '?').
  // Binary formats (PNG, JPEG, etc.) will have high bytes or non-text bytes here.
  const first = buf[0];
  if (first === undefined) return undefined;
  const isLikelyText =
    first === 0x3c || // '<'
    first === 0x20 || // space
    first === 0x09 || // tab
    first === 0x0a || // LF
    first === 0x0d || // CR
    first === 0xef || // UTF-8 BOM byte 1
    first === 0xff || // UTF-16 BOM — handled by replacement decode
    first === 0xfe; // UTF-16 BOM BE
  if (!isLikelyText) return undefined;

  const sliceLen = Math.min(buf.length, SVG_SCAN_BYTES);
  // Use replacement mode so malformed UTF-8 does not throw.
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, sliceLen));

  // Strip UTF-8 BOM (U+FEFF).
  const stripped = text.replace(/^\uFEFF/, '');
  // Strip XML declaration: <?xml ... ?>
  const afterXml = stripped.replace(/^<\?xml[^?]*\?>\s*/i, '');
  // Strip leading XML/HTML comments.
  const afterComments = afterXml.replace(/^(<!--[\s\S]*?-->\s*)*/g, '');
  const trimmed = afterComments.trimStart();

  if (trimmed.startsWith('<svg') || trimmed.startsWith('<SVG')) {
    return findByExt('svg');
  }
  return undefined;
}

/**
 * Detect Netpbm formats (PBM/PGM/PPM/PFM) from magic bytes.
 *
 * All Netpbm magics start with 'P' (0x50) at offset 0:
 *   P1 → pbm (ASCII PBM)
 *   P4 → pbm (binary PBM)
 *   P2 → pgm (ASCII PGM)
 *   P5 → pgm (binary PGM)
 *   P3 → ppm (ASCII PPM)
 *   P6 → ppm (binary PPM)
 *   Pf → pfm (grayscale PFM)
 *   PF → pfm (RGB PFM)
 */
function detectNetpbmFromBytes(buf: Uint8Array): FormatDescriptor | undefined {
  if (buf.length < 2) return undefined;
  if ((buf[0] ?? 0) !== 0x50) return undefined; // must start with 'P'
  const b1 = buf[1] ?? 0;
  switch (b1) {
    case 0x31: // '1'
    case 0x34: // '4'
      return findByExt('pbm');
    case 0x32: // '2'
    case 0x35: // '5'
      return findByExt('pgm');
    case 0x33: // '3'
    case 0x36: // '6'
      return findByExt('ppm');
    case 0x66: // 'f'
    case 0x46: // 'F'
      return findByExt('pfm');
  }
  return undefined;
}

function disambiguateRiff(buf: Uint8Array): 'webp' | 'wav' | undefined {
  // RIFF containers: "RIFF" at 0, "WEBP"/"WAVE" at 8
  if (buf.length < 12) return undefined;
  const fourcc = String.fromCharCode(buf[8] ?? 0, buf[9] ?? 0, buf[10] ?? 0, buf[11] ?? 0);
  if (fourcc === 'WEBP') return 'webp';
  if (fourcc === 'WAVE') return 'wav';
  return undefined;
}

/**
 * Disambiguate an ISOBMFF `ftyp`-boxed file (HEIC / HEIF / AVIF / MP4) by brand.
 *
 * All four share the `ftyp` box ('ftyp' at offset 4), so the major_brand (offset 8)
 * and compatible_brands (offset 16 onward) decide the real format. Without this,
 * an iPhone HEIC or an AVIF would be mis-detected as MP4.
 *
 * AVIF takes priority over HEIC over HEIF when multiple brands are present (an AVIF
 * file often lists 'mif1' as a compatible brand). Falls back to 'mp4'.
 */
function disambiguateFtyp(buf: Uint8Array): 'heic' | 'heif' | 'avif' | 'mp4' {
  // ftyp box size: big-endian u32 at offset 0. Clamp the scan to the box (and buffer).
  const boxSize =
    (((buf[0] ?? 0) << 24) | ((buf[1] ?? 0) << 16) | ((buf[2] ?? 0) << 8) | (buf[3] ?? 0)) >>> 0;
  const end = Math.min(boxSize > 8 ? boxSize : buf.length, buf.length);
  let sawHeif = false;
  // Brands are 4-byte ASCII: major_brand at 8, minor_version at 12 (skip), compatibles at 16+.
  for (let off = 8; off + 4 <= end; off += 4) {
    if (off === 12) continue; // minor_version, not a brand
    const brand = String.fromCharCode(
      buf[off] ?? 0,
      buf[off + 1] ?? 0,
      buf[off + 2] ?? 0,
      buf[off + 3] ?? 0,
    );
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'heim' || brand === 'heis') return 'heic';
    if (brand === 'mif1' || brand === 'msf1' || brand === 'heif') sawHeif = true;
  }
  return sawHeif ? 'heif' : 'mp4';
}

/**
 * Disambiguate PNG vs APNG by scanning for an 'acTL' chunk type within the
 * first HEADER_BYTES_TO_READ bytes. APNG spec requires acTL before IDAT.
 * Returns 'apng' if acTL found, 'png' otherwise.
 */
function disambiguatePng(buf: Uint8Array): 'apng' | 'png' {
  // PNG signature is 8 bytes; chunks start at offset 8.
  let offset = 8;
  while (offset + 12 <= buf.length) {
    // PNG chunk length is big-endian u32 at offset
    const length =
      (((buf[offset] ?? 0) << 24) |
        ((buf[offset + 1] ?? 0) << 16) |
        ((buf[offset + 2] ?? 0) << 8) |
        (buf[offset + 3] ?? 0)) >>>
      0;
    const type = String.fromCharCode(
      buf[offset + 4] ?? 0,
      buf[offset + 5] ?? 0,
      buf[offset + 6] ?? 0,
      buf[offset + 7] ?? 0,
    );
    if (type === 'acTL') return 'apng';
    // acTL must appear before IDAT per APNG spec
    if (type === 'IDAT' || type === 'IEND') break;
    // Advance past this chunk: length + type(4) + data(length) + crc(4)
    offset += 4 + 4 + length + 4;
  }
  return 'png';
}

/**
 * Detect the format of a Blob or byte buffer by inspecting magic bytes.
 * Returns the matching FormatDescriptor or undefined if unknown.
 */
export async function detectFormat(
  input: Blob | Uint8Array,
): Promise<FormatDescriptor | undefined> {
  const head =
    input instanceof Uint8Array
      ? input.subarray(0, HEADER_BYTES_TO_READ)
      : new Uint8Array(await input.slice(0, HEADER_BYTES_TO_READ).arrayBuffer());

  // RIFF needs disambiguation
  if (matchesAt(head, 0, [0x52, 0x49, 0x46, 0x46])) {
    const kind = disambiguateRiff(head);
    if (kind) return findByExt(kind);
  }

  for (const sig of SIGNATURES) {
    if (sig.ext === 'webp' || sig.ext === 'wav') continue; // handled above
    if (matchesAt(head, sig.offset, sig.bytes)) {
      // PNG needs further disambiguation: APNG files contain an acTL chunk
      if (sig.ext === 'png') return findByExt(disambiguatePng(head));
      // 'ftyp' is shared by MP4 / HEIC / HEIF / AVIF — decide by brand.
      if (sig.ext === 'mp4') return findByExt(disambiguateFtyp(head));
      // ZIP may actually be an EPUB OCF container (first entry == "mimetype").
      if (sig.ext === 'zip' && isEpubOcf(head)) return findByExt('epub');
      return findByExt(sig.ext);
    }
  }

  // MPEG-TS: sync byte 0x47 at offset 0 AND at offset 188 (two-anchor confirmation).
  // This disambiguates from GIF ('GIF8' starts with 0x47 = 'G') and other 0x47-starting formats.
  // Note: GIF is already checked above; but GIF[188] is unlikely to also be 0x47 in random data.
  if (head[0] === 0x47 && head.length >= 189 && head[188] === 0x47) {
    return findByExt('ts');
  }

  // M2TS (Blu-ray .m2ts / AVCHD .mts): each 188-byte TS packet is prefixed by a
  // 4-byte TP_extra_header, so the sync byte sits at offset 4 and repeats every
  // 192 bytes. Two-anchor confirmation at offsets 4 and 196 (container-ts strips
  // the prefixes and parses it as TS, so it maps to the same 'ts' format).
  if (head[4] === 0x47 && head.length >= 197 && head[196] === 0x47) {
    return findByExt('ts');
  }

  // Netpbm detection: all magics start with 'P' (0x50) followed by a digit or 'f'/'F'.
  // P1..P6 → 2-byte ASCII magic; Pf/PF → 2-byte ASCII magic.
  // These are checked as text patterns because the signatures overlap with 'P' at offset 0.
  {
    const netpbmResult = detectNetpbmFromBytes(head);
    if (netpbmResult) return netpbmResult;
  }

  // SVG detection: text-based XML format — no fixed-offset binary magic.
  // Scan the first 1 KiB for `<svg` preceded only by BOM, XML declaration,
  // whitespace, or XML/HTML comments. Must come BEFORE the MP3 fallback so
  // that text inputs never accidentally match a byte-level pattern.
  {
    const svgResult = detectSvgFromBytes(head);
    if (svgResult) return svgResult;
  }

  // NOTE: JSON / CSV / TSV / INI / ENV (the five @catlabtech/webcvt-data-text formats) are NOT
  // detectable by magic bytes. They are all UTF-8 text that may share the same byte
  // patterns (all can start with a BOM or printable ASCII). Attempting to auto-detect
  // them from bytes would cause silent data corruption — e.g. a JSON array starting
  // with '[' is indistinguishable from CSV with '[' in the first cell without schema
  // knowledge. Callers MUST pass an explicit format string to parseDataText(). There
  // is no detectFormat() support for these formats.

  // MP3 fallback: frame sync 0xFF 0xFB/0xFA/0xF3/0xF2
  if (head[0] === 0xff) {
    const b1 = head[1];
    if (b1 !== undefined && (b1 === 0xfb || b1 === 0xfa || b1 === 0xf3 || b1 === 0xf2)) {
      return findByExt('mp3');
    }
  }

  // AAC ADTS fallback: sync word is top 12 bits = 0xFFF.
  // Allowed low nibbles of byte 1 for ADTS: {0x0, 0x1, 0x8, 0x9}
  // (12-bit sync + id(1 bit) + layer=00(2 bits) + protection_absent(1 bit))
  // These do NOT overlap with the MP3 fallback nibbles above (0xFB/0xFA/0xF3/0xF2).
  if (head[0] === 0xff) {
    const b1 = head[1];
    if (b1 !== undefined && (b1 & 0xf0) === 0xf0) {
      const lowNibble = b1 & 0x0f;
      // Valid ADTS low nibbles: layer=0 means bits 2-1 of b1 = 0b00, so nibble & 0x06 === 0.
      // Combined with protection_absent bit: nibbles 0x0 (id=0,pa=0), 0x1 (id=0,pa=1),
      // 0x8 (id=1,pa=0), 0x9 (id=1,pa=1) are valid ADTS.
      if (lowNibble === 0x0 || lowNibble === 0x1 || lowNibble === 0x8 || lowNibble === 0x9) {
        return findByExt('aac');
      }
    }
  }

  return undefined;
}

/**
 * Best-effort detect: try magic bytes first, fall back to filename extension.
 * Useful for subtitle / text formats that have no reliable magic bytes.
 */
export async function detectFormatWithHint(
  input: Blob | Uint8Array,
  filenameHint?: string,
): Promise<FormatDescriptor | undefined> {
  const byMagic = await detectFormat(input);
  if (byMagic) return byMagic;
  if (filenameHint) {
    const dot = filenameHint.lastIndexOf('.');
    if (dot >= 0) {
      return findByExt(filenameHint.slice(dot + 1));
    }
  }
  return undefined;
}
