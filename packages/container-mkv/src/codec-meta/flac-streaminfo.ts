/**
 * FLAC STREAMINFO CodecPrivate normaliser for A_FLAC tracks. Trap §22.
 *
 * Matroska A_FLAC CodecPrivate ambiguity: some encoders write the full
 * 'fLaC' magic + 4-byte metadata-block header + 34-byte STREAMINFO body
 * (38 bytes total, or 42 with the full stream prefix), while others write
 * just the raw 34-byte STREAMINFO body.
 *
 * Decision: autodetect by inspecting the first 4 bytes:
 *   - If bytes[0..3] == 'fLaC' (0x66, 0x4C, 0x61, 0x43): strip the 4-byte
 *     stream marker and parse the following metadata block header to locate
 *     the 34-byte STREAMINFO body; normalise to canonical 42-byte form.
 *   - If length == 34: treat as raw STREAMINFO body; normalise to canonical 42-byte form.
 *   - Otherwise: throw MkvInvalidCodecPrivateError.
 *
 * Canonical 42-byte form:
 *   bytes 0-3:  'fLaC' magic
 *   bytes 4-7:  metadata block header (last=1, type=0, length=34 → 0x80 0x00 0x00 0x22)
 *   bytes 8-41: 34-byte STREAMINFO body
 */

import { MkvInvalidCodecPrivateError } from '../errors.ts';

// FLAC magic bytes: 'fLaC'
const FLAC_MAGIC = new Uint8Array([0x66, 0x4c, 0x61, 0x43]);

// STREAMINFO block: last-metadata-block=1, block_type=0, length=34 (0x22)
// Header: (last=1 | type=0) << 24 | 34 = 0x80000022
const STREAMINFO_BLOCK_HEADER = new Uint8Array([0x80, 0x00, 0x00, 0x22]);

const STREAMINFO_BODY_LEN = 34;
const CANONICAL_LEN = 42; // 4 + 4 + 34

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalise a FLAC CodecPrivate to the canonical 42-byte form.
 *
 * Accepts:
 *   - 42-byte full form: 'fLaC' + 4-byte block header + 34-byte body
 *   - 38-byte abbreviated: 'fLaC' + 4-byte block header (no stream-prefix recount)
 *     Note: some encoders write exactly 38 bytes meaning fLaC + header but header
 *     encodes the STREAMINFO body inline — this is actually same as 42 if body present.
 *   - 34-byte raw STREAMINFO body (no magic, no header)
 *
 * @throws MkvInvalidCodecPrivateError if the input cannot be normalised.
 */
export function normaliseFlacCodecPrivate(codecPrivate: Uint8Array): Uint8Array {
  if (codecPrivate.length === 0) {
    throw new MkvInvalidCodecPrivateError('A_FLAC', 'CodecPrivate is empty');
  }

  // Check for 'fLaC' magic at offset 0.
  if (
    codecPrivate.length >= 4 &&
    codecPrivate[0] === 0x66 &&
    codecPrivate[1] === 0x4c &&
    codecPrivate[2] === 0x61 &&
    codecPrivate[3] === 0x43
  ) {
    return normaliseFromFlaC(codecPrivate);
  }

  // No magic: expect raw 34-byte STREAMINFO body.
  if (codecPrivate.length === STREAMINFO_BODY_LEN) {
    return buildCanonical(codecPrivate);
  }

  throw new MkvInvalidCodecPrivateError(
    'A_FLAC',
    `Unrecognised CodecPrivate format: length=${codecPrivate.length}, expected 34, 38, or 42 bytes (or starting with fLaC)`,
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normaliseFromFlaC(codecPrivate: Uint8Array): Uint8Array {
  // After 'fLaC' (4 bytes): metadata block header (4 bytes) + body.
  if (codecPrivate.length < 8) {
    throw new MkvInvalidCodecPrivateError(
      'A_FLAC',
      `fLaC prefix present but CodecPrivate too short for metadata block header: ${codecPrivate.length} bytes`,
    );
  }

  // Parse metadata block header at offset 4.
  // Format: (last_metadata_block_flag(1) | block_type(7)) | length(24 big-endian)
  const blockType = (codecPrivate[4] as number) & 0x7f;
  if (blockType !== 0) {
    throw new MkvInvalidCodecPrivateError(
      'A_FLAC',
      `First metadata block type is ${blockType}; expected 0 (STREAMINFO)`,
    );
  }

  const blockLen =
    ((codecPrivate[5] as number) << 16) |
    ((codecPrivate[6] as number) << 8) |
    (codecPrivate[7] as number);

  if (blockLen !== STREAMINFO_BODY_LEN) {
    throw new MkvInvalidCodecPrivateError(
      'A_FLAC',
      `STREAMINFO block length is ${blockLen}; expected ${STREAMINFO_BODY_LEN}`,
    );
  }

  if (codecPrivate.length < 8 + STREAMINFO_BODY_LEN) {
    throw new MkvInvalidCodecPrivateError(
      'A_FLAC',
      `CodecPrivate too short for STREAMINFO body: ${codecPrivate.length} < ${8 + STREAMINFO_BODY_LEN}`,
    );
  }

  // Body is at offset 8, length 34.
  const body = codecPrivate.subarray(8, 8 + STREAMINFO_BODY_LEN);
  return buildCanonical(body);
}

function buildCanonical(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(CANONICAL_LEN);
  out.set(FLAC_MAGIC, 0);
  out.set(STREAMINFO_BLOCK_HEADER, 4);
  out.set(body.subarray(0, STREAMINFO_BODY_LEN), 8);
  return out;
}
