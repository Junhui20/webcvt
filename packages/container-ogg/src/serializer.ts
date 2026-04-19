/**
 * Ogg muxer — serialize an OggFile back to a Uint8Array.
 *
 * Algorithm (per design note §Muxer):
 * 1. For each logical stream (Phase 1: exactly one):
 *    a. Emit identification packet on a BOS page (page_sequence_number = 0,
 *       granule_position = 0).
 *    b. Emit comment packet (+ setup for Vorbis) on subsequent pages.
 *       Each header packet gets its own page to aid seeking.
 *    c. For each audio packet: accumulate segments; emit a new page when
 *       adding the packet would exceed targetPageBodySize.
 *    d. When a packet is larger than targetPageBodySize, split across pages
 *       using 255-byte lacing segments with continued-packet flag set on
 *       follow-on pages.
 *    e. Set EOS flag on the final page.
 * 2. For each page:
 *    a. Build segment_table from current packet lengths.
 *    b. Assemble full page with checksum = 0, compute CRC-32, patch field.
 * 3. Concatenate all page bytes.
 *
 * Round-trip property:
 *   parse → serialize produces byte-identical pages to the source
 *   (same segment tables, same granule positions, same CRC values).
 *   This holds when packets are serialized one-per-page and the original
 *   file used one-per-page layout (which libvorbis / libopus default to
 *   for header packets, and approximately for audio packets).
 */

import { DEFAULT_PAGE_BODY_SIZE } from './constants.ts';
import { OggCorruptStreamError } from './errors.ts';
import type { OggPacket } from './packet.ts';
import { type OggPage, buildSegmentTable, serializePage } from './page.ts';
import type { OggFile, OggLogicalStream } from './parser.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SerializeOggOptions {
  /**
   * Target page body size in bytes for audio packets.
   * Header packets each get their own page regardless of this setting.
   * Default: 4096. Maximum: 65,025 (255 segments × 255 bytes).
   */
  readonly targetPageBodySize?: number;
}

/**
 * Serialize an OggFile to a canonical Ogg byte stream.
 *
 * Emits one Ogg page per header packet (for maximum decoder compatibility),
 * and packs audio packets greedily into pages up to targetPageBodySize.
 *
 * Granule positions are preserved verbatim from OggPacket.granulePosition —
 * the serializer does NOT recompute them. Callers that synthesise new audio
 * packets must set correct granule positions before calling this function.
 */
export function serializeOgg(file: OggFile, options: SerializeOggOptions = {}): Uint8Array {
  // Clamp to [255, 255*255]. Below 255 the splitter computes
  // maxSegments = floor(size/255) = 0 → bodySize = 0 → infinite loop on any
  // packet that needs splitting. The minimum useful page body is one full
  // segment (255 bytes).
  const targetPageBodySize = Math.min(
    Math.max(options.targetPageBodySize ?? DEFAULT_PAGE_BODY_SIZE, 255),
    255 * 255,
  );

  const allPages: Uint8Array[] = [];

  for (const stream of file.streams) {
    const streamPages = serializeStream(stream, targetPageBodySize);
    for (const page of streamPages) {
      allPages.push(serializePage(page));
    }
  }

  return concatBytes(allPages);
}

// ---------------------------------------------------------------------------
// Per-stream serialization
// ---------------------------------------------------------------------------

function serializeStream(stream: OggLogicalStream, targetPageBodySize: number): OggPage[] {
  const pages: OggPage[] = [];
  let pageSeqNum = 0;

  // -------------------------------------------------------------------------
  // 1. BOS page: identification header.
  // -------------------------------------------------------------------------
  pages.push(
    buildSinglePacketPage({
      packetData: stream.identification,
      bos: true,
      eos: false,
      continuedPacket: false,
      granulePosition: 0n,
      serialNumber: stream.serialNumber,
      pageSequenceNumber: pageSeqNum++,
    }),
  );

  // -------------------------------------------------------------------------
  // 2. Comment packet on its own page.
  // -------------------------------------------------------------------------
  if (stream.comments !== undefined) {
    pages.push(
      buildSinglePacketPage({
        packetData: stream.comments,
        bos: false,
        eos: false,
        continuedPacket: false,
        granulePosition: 0n,
        serialNumber: stream.serialNumber,
        pageSequenceNumber: pageSeqNum++,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // 3. Setup packet (Vorbis only) on its own page(s).
  //    Setup packets may exceed a page — emit with splitting.
  // -------------------------------------------------------------------------
  if (stream.setup !== undefined) {
    const setupPages = splitPacketToPages({
      packetData: stream.setup,
      bos: false,
      eos: false,
      serialNumber: stream.serialNumber,
      startSeqNum: pageSeqNum,
      granulePosition: 0n,
      targetPageBodySize,
    });
    for (const p of setupPages) {
      pages.push(p);
      pageSeqNum++;
    }
  }

  // -------------------------------------------------------------------------
  // 4. Audio packets — pack greedily into pages.
  // -------------------------------------------------------------------------
  const audioPages = serializeAudioPackets(
    stream.packets,
    stream.serialNumber,
    pageSeqNum,
    targetPageBodySize,
  );
  for (const p of audioPages) {
    pages.push(p);
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Audio packet packing
// ---------------------------------------------------------------------------

/**
 * Pack audio packets greedily into Ogg pages, splitting oversized packets
 * with 255-byte lacing segments and continued-packet flags.
 */
function serializeAudioPackets(
  packets: OggPacket[],
  serialNumber: number,
  startSeqNum: number,
  targetPageBodySize: number,
): OggPage[] {
  const pages: OggPage[] = [];
  let seqNum = startSeqNum;

  // We need a two-pass approach: collect segments per packet, then paginate.
  // Build all segments first to handle page continuation correctly.
  const allSegments: Array<{
    bytes: Uint8Array;
    terminating: boolean;
    granulePosition: bigint;
  }> = [];

  for (const pkt of packets) {
    const data = pkt.data;
    const pktLen = data.length;
    let pktOffset = 0;

    while (pktOffset < pktLen) {
      const segLen = Math.min(255, pktLen - pktOffset);
      const segData = data.subarray(pktOffset, pktOffset + segLen);
      const isLast = pktOffset + segLen >= pktLen;
      allSegments.push({
        bytes: segData,
        terminating: isLast && segLen < 255,
        granulePosition: pkt.granulePosition,
      });
      pktOffset += segLen;

      // If we wrote an exact multiple of 255, we need a trailing 0-length segment
      // to terminate the packet (lacing rules: packet terminates on <255 segment).
      if (isLast && segLen === 255) {
        allSegments.push({
          bytes: new Uint8Array(0),
          terminating: true,
          granulePosition: pkt.granulePosition,
        });
      }
    }

    // Zero-byte packet: needs a single 0-length segment.
    if (pktLen === 0) {
      allSegments.push({
        bytes: new Uint8Array(0),
        terminating: true,
        granulePosition: pkt.granulePosition,
      });
    }
  }

  // Now pack segments into pages.
  const MAX_SEGS_PER_PAGE = 255;
  let currentPageSegs: Array<{ bytes: Uint8Array; terminating: boolean; granulePosition: bigint }> =
    [];
  let currentBodySize = 0;
  let currentPageGranule = 0n;
  let isContinued = false; // Does this page start with a continuation segment?
  // Track the last granule position from a completed packet for EOS fallback (Q-3).
  let lastCompletedGranule: bigint | null = null;

  function flushCurrentPage(eos: boolean): void {
    if (currentPageSegs.length === 0 && !eos) return;

    const segTable = new Uint8Array(currentPageSegs.length);
    const bodyTotal = currentPageSegs.reduce((s, sg) => s + sg.bytes.length, 0);
    const body = new Uint8Array(bodyTotal);
    let off = 0;
    for (let idx = 0; idx < currentPageSegs.length; idx++) {
      const sg = currentPageSegs[idx];
      if (sg === undefined) continue;
      segTable[idx] = sg.bytes.length;
      body.set(sg.bytes, off);
      off += sg.bytes.length;
      if (sg.terminating) {
        currentPageGranule = sg.granulePosition;
        lastCompletedGranule = sg.granulePosition;
      }
    }

    // Q-3: If this is the EOS page and the accumulated granulePosition is still -1n
    // (no packet completed on this final page), fall back to the last known completed
    // granule. If no packet was ever completed, the stream is adversarially malformed.
    let pageGranule = currentPageGranule;
    if (eos && pageGranule === -1n) {
      if (lastCompletedGranule === null) {
        throw new OggCorruptStreamError(
          'EOS page has granule_position -1n but no packet was ever completed in the stream.',
        );
      }
      pageGranule = lastCompletedGranule;
    }

    pages.push({
      continuedPacket: isContinued,
      bos: false,
      eos,
      granulePosition: pageGranule,
      serialNumber,
      pageSequenceNumber: seqNum++,
      segmentTable: segTable,
      body,
    });

    // Next page starts as continuation if the last segment was not terminating.
    const lastSeg = currentPageSegs[currentPageSegs.length - 1];
    isContinued = lastSeg !== undefined && !lastSeg.terminating;

    currentPageSegs = [];
    currentBodySize = 0;
    // Reset granule; will be updated when a terminating segment is encountered.
    // If isContinued, granule stays as -1n until the next terminating segment.
    if (isContinued) {
      currentPageGranule = -1n;
    }
  }

  for (let idx = 0; idx < allSegments.length; idx++) {
    const seg = allSegments[idx];
    if (seg === undefined) continue;

    const wouldExceedBody = currentBodySize + seg.bytes.length > targetPageBodySize;
    const wouldExceedSegs = currentPageSegs.length >= MAX_SEGS_PER_PAGE;

    if ((wouldExceedBody || wouldExceedSegs) && currentPageSegs.length > 0) {
      flushCurrentPage(false);
    }

    currentPageSegs.push(seg);
    currentBodySize += seg.bytes.length;
    if (seg.terminating) {
      currentPageGranule = seg.granulePosition;
    }
  }

  // Flush remaining segments as the final (EOS) page.
  // If there are no segments at all (empty packet list), emit a single 0-byte
  // segment to satisfy RFC 3533's requirement that page_segments >= 1.
  if (currentPageSegs.length === 0) {
    currentPageSegs.push({ bytes: new Uint8Array(0), terminating: true, granulePosition: 0n });
  }
  flushCurrentPage(true);

  return pages;
}

// ---------------------------------------------------------------------------
// Single-packet page builder
// ---------------------------------------------------------------------------

interface SinglePacketPageArgs {
  packetData: Uint8Array;
  bos: boolean;
  eos: boolean;
  continuedPacket: boolean;
  granulePosition: bigint;
  serialNumber: number;
  pageSequenceNumber: number;
}

function buildSinglePacketPage(args: SinglePacketPageArgs): OggPage {
  return {
    continuedPacket: args.continuedPacket,
    bos: args.bos,
    eos: args.eos,
    granulePosition: args.granulePosition,
    serialNumber: args.serialNumber,
    pageSequenceNumber: args.pageSequenceNumber,
    segmentTable: buildSegmentTable(args.packetData.length),
    body: args.packetData,
  };
}

// ---------------------------------------------------------------------------
// Multi-page packet splitter (for large packets like Vorbis setup)
// ---------------------------------------------------------------------------

interface SplitPacketArgs {
  packetData: Uint8Array;
  bos: boolean;
  eos: boolean;
  serialNumber: number;
  startSeqNum: number;
  granulePosition: bigint;
  targetPageBodySize: number;
}

function splitPacketToPages(args: SplitPacketArgs): OggPage[] {
  const pages: OggPage[] = [];
  const { packetData, serialNumber, targetPageBodySize } = args;
  const maxBodySize = Math.min(targetPageBodySize, 255 * 255);
  let offset = 0;
  let seqNum = args.startSeqNum;
  let isFirst = true;

  while (offset < packetData.length) {
    const remaining = packetData.length - offset;
    // Use full 255*floor(targetPageBodySize/255) to align with segment table.
    const maxSegments = Math.floor(maxBodySize / 255);
    const bodySize = Math.min(maxSegments * 255, remaining);

    // Build segment table for this chunk.
    const isLast = offset + bodySize >= packetData.length;
    const body = packetData.subarray(offset, offset + bodySize);

    // Compute segments: full 255-byte segs + possible remainder.
    const fullSegs = Math.floor(bodySize / 255);
    const remainder = bodySize % 255;
    let segCount: number;
    if (!isLast) {
      // All segments are 255; the packet continues to the next page.
      segCount = fullSegs;
    } else {
      // Terminating segments for last chunk.
      segCount = fullSegs + 1; // remainder (0..254) terminates the packet
    }

    const segTable = new Uint8Array(segCount);
    for (let i = 0; i < fullSegs && i < segCount; i++) {
      segTable[i] = 255;
    }
    if (isLast) {
      segTable[fullSegs] = remainder;
    }

    pages.push({
      continuedPacket: !isFirst,
      bos: isFirst && args.bos,
      eos: isLast && args.eos,
      granulePosition: isLast ? args.granulePosition : -1n,
      serialNumber,
      pageSequenceNumber: seqNum++,
      segmentTable: segTable,
      body,
    });

    offset += bodySize;
    isFirst = false;
  }

  // If the packet is empty, emit one page with a single 0-byte segment.
  if (pages.length === 0) {
    pages.push({
      continuedPacket: false,
      bos: args.bos,
      eos: args.eos,
      granulePosition: args.granulePosition,
      serialNumber,
      pageSequenceNumber: seqNum,
      segmentTable: new Uint8Array([0]),
      body: new Uint8Array(0),
    });
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
