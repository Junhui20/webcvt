/**
 * pssh (Protection System Specific Header Box) parser — ISO/IEC 23001-7
 * (Common Encryption) §8.1, layered on the ISO/IEC 14496-12 FullBox.
 *
 * A pssh box carries DRM-system-specific initialisation data (e.g. a Widevine
 * or PlayReady licence-acquisition blob). It may appear at the top level of the
 * file and/or inside `moov`. webcvt parses it READ-ONLY: it records the
 * SystemID, any declared default KIDs, and the declared length of the opaque
 * Data blob — it never copies the blob and never attempts decryption.
 *
 * Layout (FullBox 'pssh'):
 *   version(1) flags(3)
 *   SystemID(16 bytes)
 *   if (version > 0) {
 *     KID_count(u32)
 *     KID_count × KID(16 bytes)
 *   }
 *   DataSize(u32)
 *   Data(DataSize bytes)            // opaque — length recorded, bytes skipped
 *
 * All multi-byte fields are big-endian.
 *
 * Clean-room: ISO/IEC 23001-7:2016 §8.1 + ISO/IEC 14496-12 FullBox only.
 * No porting from gpac/Bento4/Shaka/mp4box.
 */

import { MAX_PSSH_DATA_SIZE, MAX_PSSH_KIDS } from '../constants.ts';
import {
  Mp4PsshDataSizeTooLargeError,
  Mp4PsshInvalidError,
  Mp4PsshKidCountTooLargeError,
} from '../errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A parsed Protection System Specific Header box (read-only metadata). */
export interface Mp4Pssh {
  /** DRM SystemID as a lowercase 32-char hex string (16 bytes). */
  readonly systemId: string;
  /**
   * Default Key IDs, each a lowercase 32-char hex string (16 bytes).
   * Always empty for version-0 pssh boxes (which carry no KID list).
   */
  readonly kids: readonly string[];
  /**
   * Declared byte length of the system-specific Data blob. The blob itself is
   * NOT retained (read-only signalling); only its length is exposed.
   */
  readonly dataSize: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a pssh box payload (the bytes following the 8-byte box header, i.e.
 * starting at the FullBox version byte).
 *
 * @throws Mp4PsshInvalidError — truncated payload, unsupported version (>1),
 *   or DataSize overrunning the box length.
 * @throws Mp4PsshKidCountTooLargeError — KID_count exceeds MAX_PSSH_KIDS.
 * @throws Mp4PsshDataSizeTooLargeError — DataSize exceeds MAX_PSSH_DATA_SIZE.
 */
export function parsePssh(payload: Uint8Array): Mp4Pssh {
  // version+flags(4) + SystemID(16) = 20 bytes minimum.
  if (payload.length < 20) {
    throw new Mp4PsshInvalidError(
      `payload too short (${payload.length} bytes); need at least 20 for version+flags+SystemID.`,
    );
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const version = payload[0] ?? 0;
  if (version > 1) {
    throw new Mp4PsshInvalidError(`version ${version} is not supported; only 0 and 1 are defined.`);
  }

  const systemId = bytesToHex(payload.subarray(4, 20));

  let cursor = 20;
  const kids: string[] = [];

  if (version > 0) {
    if (payload.length < cursor + 4) {
      throw new Mp4PsshInvalidError('payload too short for KID_count.');
    }
    const kidCount = view.getUint32(cursor, false);
    cursor += 4;
    if (kidCount > MAX_PSSH_KIDS) {
      throw new Mp4PsshKidCountTooLargeError(kidCount, MAX_PSSH_KIDS);
    }
    if (payload.length < cursor + kidCount * 16) {
      throw new Mp4PsshInvalidError(
        `payload too short for ${kidCount} KIDs (need ${kidCount * 16} more bytes).`,
      );
    }
    for (let i = 0; i < kidCount; i++) {
      kids.push(bytesToHex(payload.subarray(cursor, cursor + 16)));
      cursor += 16;
    }
  }

  if (payload.length < cursor + 4) {
    throw new Mp4PsshInvalidError('payload too short for DataSize.');
  }
  const dataSize = view.getUint32(cursor, false);
  cursor += 4;

  if (dataSize > MAX_PSSH_DATA_SIZE) {
    throw new Mp4PsshDataSizeTooLargeError(dataSize, MAX_PSSH_DATA_SIZE);
  }
  // Cap DataSize against the box length: the declared blob must fit.
  if (dataSize > payload.length - cursor) {
    throw new Mp4PsshInvalidError(
      `DataSize ${dataSize} exceeds the ${payload.length - cursor} bytes remaining in the box.`,
    );
  }

  return { systemId, kids, dataSize };
}

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

const HEX = '0123456789abcdef';

/** Convert a byte range to a lowercase hex string (no separators). */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    out += HEX[(b >> 4) & 0x0f];
    out += HEX[b & 0x0f];
  }
  return out;
}
