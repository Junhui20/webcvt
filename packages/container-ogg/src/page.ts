/**
 * Ogg page parser and serializer.
 *
 * Ogg page layout (RFC 3533 §6):
 *   offset  bytes  field
 *    0       4     capture_pattern             "OggS"
 *    4       1     stream_structure_version    must be 0
 *    5       1     header_type_flags           bit0=continued, bit1=BOS, bit2=EOS
 *    6       8     granule_position            LE int64
 *   14       4     bitstream_serial_number     LE uint32
 *   18       4     page_sequence_number        LE uint32
 *   22       4     checksum                    LE uint32 (zeroed during CRC computation)
 *   26       1     page_segments               N (1..255)
 *   27       N     segment_table               each entry 0..255 bytes
 *   27+N    ...    body                        sum(segment_table) bytes
 */

import {
  MAX_PAGE_BODY_BYTES,
  OGG_CAPTURE_PATTERN,
  OGG_PAGE_HEADER_BASE,
  OGG_STREAM_VERSION,
} from './constants.ts';
import { computeCrc32 } from './crc32.ts';
import {
  OggCorruptStreamError,
  OggInvalidVersionError,
  OggPageBodyTooLargeError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OggPage {
  /** header_type bit 0: this page continues a packet from the previous page. */
  readonly continuedPacket: boolean;
  /** header_type bit 1: beginning of stream. */
  readonly bos: boolean;
  /** header_type bit 2: end of stream. */
  readonly eos: boolean;
  /** Raw LE int64 granule position. Use 0xFFFFFFFFFFFFFFFFn for "none". */
  readonly granulePosition: bigint;
  /** Logical stream serial number (LE uint32). */
  readonly serialNumber: number;
  /** Page sequence number (LE uint32). */
  readonly pageSequenceNumber: number;
  /** Raw segment table (N entries, each 0..255). sum(segmentTable) === body.length. */
  readonly segmentTable: Uint8Array;
  /** Page body bytes (zero-copy subarray of the input buffer when parsed). */
  readonly body: Uint8Array;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Check whether offset points to the "OggS" capture pattern.
 */
export function hasOggSAt(data: Uint8Array, offset: number): boolean {
  if (offset + 4 > data.length) return false;
  return (
    data[offset] === OGG_CAPTURE_PATTERN[0] &&
    data[offset + 1] === OGG_CAPTURE_PATTERN[1] &&
    data[offset + 2] === OGG_CAPTURE_PATTERN[2] &&
    data[offset + 3] === OGG_CAPTURE_PATTERN[3]
  );
}

/**
 * Parse a single Ogg page from `data` starting at `offset`.
 *
 * Returns an OggPage (zero-copy views into `data`) and the offset of the
 * first byte AFTER this page.
 *
 * @throws OggInvalidVersionError — stream_structure_version != 0
 * @throws OggPageBodyTooLargeError — segment table body sum > 65,025
 * @throws OggCorruptStreamError — CRC mismatch
 */
export function parsePage(data: Uint8Array, offset: number): { page: OggPage; nextOffset: number } {
  // Need at least the base header.
  if (offset + OGG_PAGE_HEADER_BASE > data.length) {
    throw new OggCorruptStreamError(
      `Truncated page header at offset ${offset}: need ${OGG_PAGE_HEADER_BASE} bytes, got ${data.length - offset}.`,
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // version check
  const version = data[offset + 4] ?? 0;
  if (version !== OGG_STREAM_VERSION) {
    throw new OggInvalidVersionError(version, offset);
  }

  const headerTypeFlags = data[offset + 5] ?? 0;
  const continuedPacket = (headerTypeFlags & 0x01) !== 0;
  const bos = (headerTypeFlags & 0x02) !== 0;
  const eos = (headerTypeFlags & 0x04) !== 0;

  const granulePosition = view.getBigInt64(offset + 6, true);
  const serialNumber = view.getUint32(offset + 14, true);
  const pageSequenceNumber = view.getUint32(offset + 18, true);
  // stored checksum (bytes 22..25) — read for verification
  const storedChecksum = view.getUint32(offset + 22, true);

  const pageSegments = data[offset + 26] ?? 0;
  if (pageSegments === 0) {
    throw new OggCorruptStreamError(`Page at offset ${offset} has 0 segments.`);
  }

  const segTableStart = offset + OGG_PAGE_HEADER_BASE;
  if (segTableStart + pageSegments > data.length) {
    throw new OggCorruptStreamError(
      `Truncated segment table at offset ${offset}: need ${pageSegments} bytes.`,
    );
  }

  const segmentTable = data.subarray(segTableStart, segTableStart + pageSegments);

  // Sum segment table to get body size.
  let bodySize = 0;
  for (let i = 0; i < segmentTable.length; i++) {
    bodySize += segmentTable[i] ?? 0;
  }

  if (bodySize > MAX_PAGE_BODY_BYTES) {
    throw new OggPageBodyTooLargeError(bodySize, MAX_PAGE_BODY_BYTES);
  }

  const bodyStart = segTableStart + pageSegments;
  if (bodyStart + bodySize > data.length) {
    throw new OggCorruptStreamError(
      `Truncated page body at offset ${bodyStart}: need ${bodySize} bytes, got ${data.length - bodyStart}.`,
    );
  }

  const body = data.subarray(bodyStart, bodyStart + bodySize);
  const nextOffset = bodyStart + bodySize;
  const pageLength = nextOffset - offset;

  // CRC verification: copy page bytes, zero out checksum field, recompute.
  const pageBytes = data.slice(offset, nextOffset);
  // Zero the checksum field (bytes 22..25 relative to page start).
  pageBytes[22] = 0;
  pageBytes[23] = 0;
  pageBytes[24] = 0;
  pageBytes[25] = 0;
  const computedChecksum = computeCrc32(pageBytes);

  if (computedChecksum !== storedChecksum) {
    throw new OggCorruptStreamError(
      `CRC-32 mismatch at page offset ${offset} (page length ${pageLength}): ` +
        `stored=0x${storedChecksum.toString(16).padStart(8, '0')}, ` +
        `computed=0x${computedChecksum.toString(16).padStart(8, '0')}.`,
    );
  }

  const page: OggPage = {
    continuedPacket,
    bos,
    eos,
    granulePosition,
    serialNumber,
    pageSequenceNumber,
    segmentTable,
    body,
  };

  return { page, nextOffset };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize an OggPage to bytes, computing and patching the CRC-32 checksum.
 *
 * Creates a fresh Uint8Array — does not mutate the page object.
 */
export function serializePage(page: OggPage): Uint8Array {
  const segCount = page.segmentTable.length;
  const pageLength = OGG_PAGE_HEADER_BASE + segCount + page.body.length;
  const out = new Uint8Array(pageLength);
  const view = new DataView(out.buffer);

  // capture_pattern
  out[0] = 0x4f; // O
  out[1] = 0x67; // g
  out[2] = 0x67; // g
  out[3] = 0x53; // S

  // version
  out[4] = OGG_STREAM_VERSION;

  // header_type_flags
  let flags = 0;
  if (page.continuedPacket) flags |= 0x01;
  if (page.bos) flags |= 0x02;
  if (page.eos) flags |= 0x04;
  out[5] = flags;

  // granule_position (LE int64)
  view.setBigInt64(6, page.granulePosition, true);

  // serial_number (LE uint32)
  view.setUint32(14, page.serialNumber, true);

  // page_sequence_number (LE uint32)
  view.setUint32(18, page.pageSequenceNumber, true);

  // checksum = 0 (filled in after CRC computation)
  view.setUint32(22, 0, true);

  // page_segments count
  out[26] = segCount;

  // segment_table
  out.set(page.segmentTable, OGG_PAGE_HEADER_BASE);

  // body
  out.set(page.body, OGG_PAGE_HEADER_BASE + segCount);

  // Compute and patch CRC-32.
  const crc = computeCrc32(out);
  view.setUint32(22, crc, true);

  return out;
}

// ---------------------------------------------------------------------------
// Lacing helpers
// ---------------------------------------------------------------------------

/**
 * Build a lacing segment table for a packet of `packetLength` bytes.
 *
 * RFC 3533 §6 lacing encoding:
 *   - Emit 255-byte segments for each full 255-byte chunk.
 *   - Terminate with a segment < 255 (including 0 for exact multiples).
 */
export function buildSegmentTable(packetLength: number): Uint8Array {
  const fullSegments = Math.floor(packetLength / 255);
  const remainder = packetLength % 255;
  // When packet is exact multiple of 255, we still need a trailing 0.
  const totalSegments = fullSegments + 1;
  const table = new Uint8Array(totalSegments);
  for (let i = 0; i < fullSegments; i++) {
    table[i] = 255;
  }
  table[fullSegments] = remainder;
  return table;
}

/**
 * Compute the total page bytes for a given segment table and body size.
 */
export function computePageSize(segmentCount: number, bodySize: number): number {
  return OGG_PAGE_HEADER_BASE + segmentCount + bodySize;
}
