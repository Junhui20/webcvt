/**
 * vpcC (VP Codec Configuration Box) parser.
 *
 * Spec: VP-Codec-ISOBMFF v1.0 §2.2
 *
 * vpcC is a FullBox (version + flags before the actual fields).
 *
 * Wire format (vpcC box payload — includes the FullBox 4-byte prefix):
 *   [0]    version:u8  = 1
 *   [1..3] flags:u24   = 0
 *   [4]    profile:u8
 *   [5]    level:u8
 *   [6]    bitDepth:4 | chromaSubsampling:3 | videoFullRangeFlag:1
 *   [7]    colourPrimaries:u8
 *   [8]    transferCharacteristics:u8
 *   [9]    matrixCoefficients:u8
 *   [10..11] codecInitializationDataSize:u16  (big-endian)
 *   [12..] codecInitializationData:bytes
 *
 * All multi-byte fields are big-endian.
 */

import { Mp4InvalidBoxError, Mp4VpcCBadVersionError, Mp4VpcCMissingError } from '../errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Mp4VpcConfig {
  readonly kind: 'vpcC';
  /** Verbatim vpcC payload — emitted unchanged on round-trip. */
  readonly bytes: Uint8Array;
  readonly profile: number;
  readonly level: number;
  readonly bitDepth: number;
  readonly chromaSubsampling: number;
  readonly videoFullRangeFlag: 0 | 1;
  readonly colourPrimaries: number;
  readonly transferCharacteristics: number;
  readonly matrixCoefficients: number;
  readonly codecInitializationData: Uint8Array;
}

// Re-export so caller can import from one place.
export { Mp4VpcCMissingError };

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a vpcC box payload into Mp4VpcConfig.
 *
 * @param payload  Raw bytes of the vpcC box payload (after the 8-byte box header),
 *                 including the FullBox version+flags prefix.
 * @throws Mp4VpcCBadVersionError  version != 1
 * @throws Mp4InvalidBoxError      payload too short
 */
export function parseVpcC(payload: Uint8Array): Mp4VpcConfig {
  // FullBox prefix(4) + profile(1) + level(1) + packed(1) + colour(3) + initDataSize(2) = 12
  if (payload.length < 12) {
    throw new Mp4InvalidBoxError(
      `vpcC payload too short (${payload.length} bytes); need at least 12.`,
    );
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  // Defensive copy for verbatim round-trip.
  const bytes = payload.slice();

  // [0] version:u8 (FullBox — VP-Codec-ISOBMFF §2.2)
  /* v8 ignore next */
  const version = payload[0] ?? 0;
  if (version !== 1) {
    throw new Mp4VpcCBadVersionError(version);
  }
  // [1..3] flags:u24 = 0 (ignored)

  // [4] profile:u8
  /* v8 ignore next */
  const profile = payload[4] ?? 0;
  // [5] level:u8
  /* v8 ignore next */
  const level = payload[5] ?? 0;

  // [6] bitDepth:4 | chromaSubsampling:3 | videoFullRangeFlag:1
  /* v8 ignore next */
  const packed = payload[6] ?? 0;
  const bitDepth = (packed >> 4) & 0x0f; // bits [7:4]
  const chromaSubsampling = (packed >> 1) & 0x07; // bits [3:1]
  const videoFullRangeFlag = (packed & 0x01) as 0 | 1; // bit [0]

  // [7] colourPrimaries:u8
  /* v8 ignore next */
  const colourPrimaries = payload[7] ?? 0;
  // [8] transferCharacteristics:u8
  /* v8 ignore next */
  const transferCharacteristics = payload[8] ?? 0;
  // [9] matrixCoefficients:u8
  /* v8 ignore next */
  const matrixCoefficients = payload[9] ?? 0;

  // [10..11] codecInitializationDataSize:u16 (big-endian)
  const initDataSize = view.getUint16(10, false);
  if (payload.length < 12 + initDataSize) {
    throw new Mp4InvalidBoxError(
      `vpcC codecInitializationData size=${initDataSize} overruns payload length=${payload.length}.`,
    );
  }

  // [12..] codecInitializationData:bytes (zero-copy from the defensive copy)
  const codecInitializationData = bytes.subarray(12, 12 + initDataSize);

  return {
    kind: 'vpcC',
    bytes,
    profile,
    level,
    bitDepth,
    chromaSubsampling,
    videoFullRangeFlag,
    colourPrimaries,
    transferCharacteristics,
    matrixCoefficients,
    codecInitializationData,
  };
}
