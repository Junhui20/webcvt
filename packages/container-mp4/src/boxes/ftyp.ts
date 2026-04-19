/**
 * ftyp (File Type Box) parser — ISO/IEC 14496-12 §4.3.
 *
 * Layout:
 *   offset  bytes  field
 *     0      4     major_brand        e.g. 'M4A ', 'mp42', 'isom'
 *     4      4     minor_version      u32 (informational)
 *     8     4*N    compatible_brands  list of 4-char codes until end of payload
 *
 * Rejection rules (first pass):
 *   - Brands in REJECTED_BRANDS (iso5, iso6, dash) → Mp4UnsupportedBrandError
 *   - If neither major_brand nor any compatible brand is in ACCEPTED_BRANDS,
 *     we proceed (the brand list on mp4ra.org is vast; we only hard-reject
 *     fragmented brands).
 */

import { ACCEPTED_BRANDS, REJECTED_BRANDS } from '../constants.ts';
import { Mp4UnsupportedBrandError } from '../errors.ts';

// Module-scope decoder (Lesson #2).
const TEXT_DECODER = new TextDecoder('latin1');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Mp4Ftyp {
  majorBrand: string;
  minorVersion: number;
  compatibleBrands: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the payload of an ftyp box.
 *
 * @param payload  The ftyp payload bytes (after the 8-byte box header).
 * @throws Mp4UnsupportedBrandError when a fragmented brand is found.
 */
export function parseFtyp(payload: Uint8Array): Mp4Ftyp {
  // Minimum: 4 (major_brand) + 4 (minor_version) = 8 bytes.
  if (payload.length < 8) {
    // Tolerate truncated ftyp by filling defaults (some encoders omit compatible brands).
    const majorBrand = payload.length >= 4 ? decodeBrand(payload, 0) : 'isom';
    return { majorBrand, minorVersion: 0, compatibleBrands: [] };
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const majorBrand = decodeBrand(payload, 0);
  const minorVersion = view.getUint32(4, false);

  const compatibleBrands: string[] = [];
  for (let off = 8; off + 4 <= payload.length; off += 4) {
    compatibleBrands.push(decodeBrand(payload, off));
  }

  // Rejection: if major brand is fragmented, throw immediately.
  if (REJECTED_BRANDS.has(majorBrand)) {
    throw new Mp4UnsupportedBrandError(majorBrand);
  }

  // Rejection: if ANY compatible brand implies fragmented MP4, throw.
  for (const brand of compatibleBrands) {
    if (REJECTED_BRANDS.has(brand)) {
      throw new Mp4UnsupportedBrandError(brand);
    }
  }

  return { majorBrand, minorVersion, compatibleBrands };
}

/**
 * Serialize an Mp4Ftyp to bytes.
 * Output: 8 + 4 * compatibleBrands.length bytes.
 */
export function serializeFtyp(ftyp: Mp4Ftyp): Uint8Array {
  const total = 8 + ftyp.compatibleBrands.length * 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  encodeBrand(out, 0, ftyp.majorBrand);
  view.setUint32(4, ftyp.minorVersion, false);

  let off = 8;
  for (const brand of ftyp.compatibleBrands) {
    encodeBrand(out, off, brand);
    off += 4;
  }

  return out;
}

/**
 * Return true if the ftyp contains at least one accepted brand
 * (major or compatible). Used by canHandle in backend.ts to decide
 * whether we should attempt to parse this file as M4A.
 */
export function isAcceptedBrand(ftyp: Mp4Ftyp): boolean {
  if (ACCEPTED_BRANDS.has(ftyp.majorBrand)) return true;
  for (const brand of ftyp.compatibleBrands) {
    if (ACCEPTED_BRANDS.has(brand)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodeBrand(payload: Uint8Array, offset: number): string {
  return TEXT_DECODER.decode(payload.subarray(offset, offset + 4));
}

function encodeBrand(out: Uint8Array, offset: number, brand: string): void {
  for (let i = 0; i < 4; i++) {
    out[offset + i] = (brand.charCodeAt(i) ?? 0x20) & 0xff;
  }
}
