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
 * - ZIP: "PK\x03\x04" at offset 0
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
];

// For MPEG-TS detection we need 189 bytes (offset 0 + offset 188).
const HEADER_BYTES_TO_READ = 189;

function matchesAt(buf: Uint8Array, offset: number, bytes: readonly number[]): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
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
      return findByExt(sig.ext);
    }
  }

  // MPEG-TS: sync byte 0x47 at offset 0 AND at offset 188 (two-anchor confirmation).
  // This disambiguates from GIF ('GIF8' starts with 0x47 = 'G') and other 0x47-starting formats.
  // Note: GIF is already checked above; but GIF[188] is unlikely to also be 0x47 in random data.
  if (head[0] === 0x47 && head.length >= 189 && head[188] === 0x47) {
    return findByExt('ts');
  }

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
