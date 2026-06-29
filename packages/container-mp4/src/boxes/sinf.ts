/**
 * Track encryption signalling parsers — ISO/IEC 23001-7 (Common Encryption)
 * §4, §8, layered on the ISO/IEC 14496-12 Protection Scheme Information box.
 *
 * An encrypted track replaces its real sample-entry 4cc with `encv` (video) or
 * `enca` (audio). The original sample entry is preserved verbatim (its codec
 * config boxes are still present), and a `sinf` (Protection Scheme Information)
 * box is appended that records how the track was encrypted:
 *
 *   encv | enca (a VisualSampleEntry / AudioSampleEntry)
 *     <original codec config boxes: avcC, hvcC, esds, …>
 *     sinf
 *       frma   — OriginalFormat: the real 4cc (e.g. 'avc1', 'mp4a')
 *       schm   — SchemeType: 'cenc' | 'cbc1' | 'cens' | 'cbcs' + version
 *       schi   — Scheme Information container
 *         tenc — TrackEncryption: default_isProtected, IV size, default_KID, …
 *
 * webcvt parses this READ-ONLY: it exposes the scheme/format/KID signalling so
 * callers can detect DRM; it never decrypts. The boxes here are NOT reached by
 * the box-tree walker (they live inside `stsd`/`encv`, which the walker treats
 * as leaves), so this module scans the raw payload bytes directly.
 *
 * Clean-room: ISO/IEC 23001-7:2016 §4, §8 + ISO/IEC 14496-12 only. No porting
 * from gpac/Bento4/Shaka/mp4box.
 */

import { MAX_SINF_CHILD_BOXES } from '../constants.ts';
import { Mp4ProtectionInvalidError } from '../errors.ts';
import { bytesToHex } from './pssh.ts';

// Module-scope decoder (Lesson #2).
const TEXT_DECODER_LATIN1 = new TextDecoder('latin1');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Parsed `tenc` (TrackEncryption) defaults. */
export interface Mp4TrackEncryption {
  /** default_isProtected — whether samples are encrypted by default. */
  readonly isProtected: boolean;
  /** default_Per_Sample_IV_Size — 0, 8, or 16 (0 implies a constant IV). */
  readonly perSampleIvSize: number;
  /** default_KID as a lowercase 32-char hex string (16 bytes). */
  readonly defaultKid: string;
  /** default_crypt_byte_block — pattern-encryption crypt block count (v1 only; 0 otherwise). */
  readonly cryptByteBlock: number;
  /** default_skip_byte_block — pattern-encryption skip block count (v1 only; 0 otherwise). */
  readonly skipByteBlock: number;
}

/** Parsed `sinf` (Protection Scheme Information) box. */
export interface Mp4ProtectionSchemeInfo {
  /** SchemeType 4cc from `schm` (e.g. 'cenc', 'cbcs'); '' when no schm is present. */
  readonly schemeType: string;
  /** scheme_version from `schm` (0 when no schm is present). */
  readonly schemeVersion: number;
  /** OriginalFormat 4cc from `frma` — the real sample-entry type. */
  readonly originalFormat: string;
  /** Parsed `schi/tenc` defaults, or null when absent. */
  readonly tenc: Mp4TrackEncryption | null;
}

/** Per-track protection summary surfaced on `Mp4File.protection.tracks`. */
export interface Mp4TrackProtection {
  readonly trackId: number;
  /** SchemeType 4cc (e.g. 'cenc', 'cbcs'); '' when no schm box. */
  readonly schemeType: string;
  /** OriginalFormat 4cc — the real (decrypted) sample-entry type. */
  readonly originalFormat: string;
  /** default_KID hex (16 bytes) from tenc; undefined when no tenc box. */
  readonly defaultKid?: string;
  /** default_isProtected from tenc (false when no tenc box). */
  readonly isProtected: boolean;
  /** default_Per_Sample_IV_Size from tenc (0 when no tenc box). */
  readonly perSampleIvSize: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The child-box start offset within an `encv`/`enca` sample-entry payload
 * (i.e. after its 8-byte size+type header). A VisualSampleEntry fixed header is
 * 78 bytes; an AudioSampleEntry (version 0) fixed header is 28 bytes.
 */
export function sampleEntryChildStart(entryType: 'encv' | 'enca'): number {
  return entryType === 'encv' ? 78 : 28;
}

/**
 * Locate the `sinf` box inside an `encv`/`enca` sample-entry payload and return
 * its content bytes (after the 8-byte box header), or null when absent.
 *
 * @param entryType   'encv' or 'enca' (selects the fixed-header size).
 * @param entryPayload  Sample-entry payload (after the 8-byte size+type header).
 */
export function findSinfPayload(
  entryType: 'encv' | 'enca',
  entryPayload: Uint8Array,
): Uint8Array | null {
  const start = sampleEntryChildStart(entryType);
  for (const child of rawChildBoxes(entryPayload, start)) {
    if (child.type === 'sinf') {
      return child.body;
    }
  }
  return null;
}

/**
 * Parse a `sinf` (Protection Scheme Information) box content (after the 8-byte
 * box header) into its scheme, original-format, and track-encryption defaults.
 *
 * @throws Mp4ProtectionInvalidError — missing/short frma, schm, or tenc, or a
 *   child-box count exceeding MAX_SINF_CHILD_BOXES.
 */
export function parseSinf(sinfPayload: Uint8Array): Mp4ProtectionSchemeInfo {
  let originalFormat = '';
  let schemeType = '';
  let schemeVersion = 0;
  let tenc: Mp4TrackEncryption | null = null;

  for (const child of rawChildBoxes(sinfPayload, 0)) {
    switch (child.type) {
      case 'frma':
        originalFormat = parseFrma(child.body);
        break;
      case 'schm': {
        const schm = parseSchm(child.body);
        schemeType = schm.schemeType;
        schemeVersion = schm.schemeVersion;
        break;
      }
      case 'schi':
        tenc = findTenc(child.body);
        break;
      default:
        break;
    }
  }

  if (originalFormat === '') {
    throw new Mp4ProtectionInvalidError('sinf is missing the required frma (OriginalFormat) box.');
  }

  return { schemeType, schemeVersion, originalFormat, tenc };
}

/**
 * Parse the per-track protection summary from an `stsd` payload (after its
 * 8-byte box header). Returns null when the first sample entry is NOT an
 * `encv`/`enca` protected entry (the common, unencrypted case).
 *
 * @throws Mp4ProtectionInvalidError — the entry is `encv`/`enca` but its sinf
 *   subtree is missing or malformed.
 */
export function parseStsdTrackProtection(
  stsdPayload: Uint8Array,
  trackId: number,
): Mp4TrackProtection | null {
  // stsd: version+flags(4) + entry_count(4) + first sample entry (size(4)+type(4)+…).
  if (stsdPayload.length < 16) {
    return null;
  }
  const view = new DataView(stsdPayload.buffer, stsdPayload.byteOffset, stsdPayload.byteLength);
  const entrySize = view.getUint32(8, false);
  const entryType = TEXT_DECODER_LATIN1.decode(stsdPayload.subarray(12, 16));

  if (entryType !== 'encv' && entryType !== 'enca') {
    return null;
  }
  if (entrySize < 8 || 8 + entrySize > stsdPayload.length) {
    throw new Mp4ProtectionInvalidError(
      `${entryType} sample entry size overruns the stsd payload.`,
    );
  }

  const entryPayload = stsdPayload.subarray(16, 8 + entrySize);
  const sinfPayload = findSinfPayload(entryType, entryPayload);
  if (sinfPayload === null) {
    throw new Mp4ProtectionInvalidError(
      `${entryType} sample entry has no sinf (Protection Scheme Information) box.`,
    );
  }

  const scheme = parseSinf(sinfPayload);
  const result: Mp4TrackProtection = {
    trackId,
    schemeType: scheme.schemeType,
    originalFormat: scheme.originalFormat,
    isProtected: scheme.tenc?.isProtected ?? false,
    perSampleIvSize: scheme.tenc?.perSampleIvSize ?? 0,
  };
  // Only attach defaultKid when a tenc box was present (keeps the field optional).
  if (scheme.tenc) {
    return { ...result, defaultKid: scheme.tenc.defaultKid };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Private parsers
// ---------------------------------------------------------------------------

/** Parse `frma` (OriginalFormat): a bare box carrying a single 4cc data_format. */
function parseFrma(body: Uint8Array): string {
  if (body.length < 4) {
    throw new Mp4ProtectionInvalidError('frma payload too short (need ≥4 bytes for data_format).');
  }
  return TEXT_DECODER_LATIN1.decode(body.subarray(0, 4));
}

/** Parse `schm` (SchemeType): FullBox + scheme_type(4cc) + scheme_version(u32). */
function parseSchm(body: Uint8Array): { schemeType: string; schemeVersion: number } {
  // version+flags(4) + scheme_type(4) + scheme_version(4) = 12 bytes minimum.
  if (body.length < 12) {
    throw new Mp4ProtectionInvalidError('schm payload too short (need ≥12 bytes).');
  }
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const schemeType = TEXT_DECODER_LATIN1.decode(body.subarray(4, 8));
  const schemeVersion = view.getUint32(8, false);
  return { schemeType, schemeVersion };
}

/** Locate and parse the `tenc` box inside a `schi` container, or null when absent. */
function findTenc(schiPayload: Uint8Array): Mp4TrackEncryption | null {
  for (const child of rawChildBoxes(schiPayload, 0)) {
    if (child.type === 'tenc') {
      return parseTenc(child.body);
    }
  }
  return null;
}

/**
 * Parse `tenc` (TrackEncryption) defaults — ISO/IEC 23001-7 §8.2.
 *
 * Layout (FullBox 'tenc', after the version+flags prefix):
 *   reserved(1)
 *   if (version == 0) reserved(1)
 *   else              crypt_byte_block(4 bits) | skip_byte_block(4 bits)
 *   default_isProtected(1)
 *   default_Per_Sample_IV_Size(1)
 *   default_KID(16)
 *   [ optional constant-IV fields when isProtected && IV size == 0 — ignored ]
 */
function parseTenc(body: Uint8Array): Mp4TrackEncryption {
  // version+flags(4) + reserved(1) + reserved/pattern(1) + isProtected(1)
  //   + ivSize(1) + default_KID(16) = 24 bytes minimum.
  if (body.length < 24) {
    throw new Mp4ProtectionInvalidError('tenc payload too short (need ≥24 bytes).');
  }
  const version = body[0] ?? 0;
  const patternByte = body[5] ?? 0;
  let cryptByteBlock = 0;
  let skipByteBlock = 0;
  if (version >= 1) {
    cryptByteBlock = (patternByte >> 4) & 0x0f;
    skipByteBlock = patternByte & 0x0f;
  }
  const isProtected = (body[6] ?? 0) === 1;
  const perSampleIvSize = body[7] ?? 0;
  const defaultKid = bytesToHex(body.subarray(8, 24));
  return { isProtected, perSampleIvSize, defaultKid, cryptByteBlock, skipByteBlock };
}

// ---------------------------------------------------------------------------
// Raw child-box scanner
// ---------------------------------------------------------------------------

/**
 * Iterate the direct child boxes of a raw payload starting at `start`, yielding
 * `{ type, body }` for each well-formed box. Stops on a truncated or zero-size
 * box. Caps iteration at MAX_SINF_CHILD_BOXES to bound adversarial repetition.
 */
function* rawChildBoxes(
  payload: Uint8Array,
  start: number,
): Generator<{ type: string; body: Uint8Array }> {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let cursor = start;
  let count = 0;

  while (cursor + 8 <= payload.length) {
    count += 1;
    if (count > MAX_SINF_CHILD_BOXES) {
      throw new Mp4ProtectionInvalidError(
        `protection subtree has more than ${MAX_SINF_CHILD_BOXES} child boxes.`,
      );
    }
    const size = view.getUint32(cursor, false);
    if (size < 8 || cursor + size > payload.length) {
      // Truncated or invalid box size — stop scanning.
      break;
    }
    const type = TEXT_DECODER_LATIN1.decode(payload.subarray(cursor + 4, cursor + 8));
    yield { type, body: payload.subarray(cursor + 8, cursor + size) };
    cursor += size;
  }
}
