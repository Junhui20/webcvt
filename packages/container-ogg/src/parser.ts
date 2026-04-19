/**
 * Ogg demuxer — parse a Uint8Array into an OggFile.
 *
 * Algorithm (per design note §Demuxer):
 * 1. Input size guard (200 MiB cap).
 * 2. Locate "OggS" at offset 0; throw OggCaptureMissingError if absent.
 * 3. Page loop:
 *    a. Parse the fixed 27-byte header + segment table + body.
 *    b. Verify CRC-32 (Ogg polynomial, non-reflected 0x04C11DB7).
 *    c. Detect multiplexed streams (concurrent serial numbers) → throw.
 *    d. Track page_sequence_number per stream; gap → throw OggSequenceGapError.
 *    e. Feed pages to PacketAssembler to produce OggPackets via lacing.
 * 4. First page per stream (BOS): decode identification header.
 *    Vorbis: expect 3 headers; Opus: expect 2 headers.
 * 5. After headers, packets → stream.packets[].
 * 6. Chained streams (EOS then BOS): SUPPORTED (see chain.ts).
 * 7. Security caps enforced: page count, body size, packet size, packet count.
 */

import {
  CRC_CORRUPT_THRESHOLD,
  MAX_INPUT_BYTES,
  MAX_PAGES,
  MAX_TOTAL_SYNC_SCAN_BYTES,
  MIN_PAGES_FOR_CORRUPT_CHECK,
  SYNC_SCAN_CAP,
} from './constants.ts';
import {
  OggCaptureMissingError,
  OggCorruptStreamError,
  OggInputTooLargeError,
  OggMultiplexNotSupportedError,
  OggSequenceGapError,
  OggTooManyPagesError,
  OggUnsupportedCodecError,
} from './errors.ts';
import { decodeOpusHead, decodeOpusTags, isOpusHeadPacket, isOpusTagsPacket } from './opus.ts';
import { type OggPacket, PacketAssembler } from './packet.ts';
import { type OggPage, hasOggSAt, parsePage } from './page.ts';
import {
  decodeVorbisComment,
  decodeVorbisIdentification,
  isVorbisHeaderPacket,
  isVorbisSetupPacket,
} from './vorbis.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OggCodec = 'vorbis' | 'opus';

export interface OggLogicalStream {
  readonly serialNumber: number;
  readonly codec: OggCodec;
  /** First packet (codec identification header), verbatim bytes. */
  readonly identification: Uint8Array;
  /** Second packet (Vorbis-comment for Vorbis; OpusTags for Opus), verbatim. */
  readonly comments: Uint8Array | undefined;
  /** Third packet (Vorbis setup), verbatim. Undefined for Opus. */
  readonly setup: Uint8Array | undefined;
  /** Audio packets (post all headers). */
  readonly packets: OggPacket[];
  /** Opus pre_skip in 48 kHz samples; 0 for Vorbis. */
  readonly preSkip: number;
  /** Audio sample rate (Vorbis: from ident header; Opus: always 48000). */
  readonly sampleRate: number;
  readonly channels: number;
}

export interface OggFile {
  /** Parsed logical streams in file order. Phase 1: at most 1. Chained: multiple. */
  readonly streams: OggLogicalStream[];
}

// ---------------------------------------------------------------------------
// Stream parse state (private)
// ---------------------------------------------------------------------------

type HeaderStage = 'identification' | 'comment' | 'setup' | 'audio';

interface StreamState {
  serialNumber: number;
  codec: OggCodec | null;
  identification: Uint8Array | null;
  comments: Uint8Array | null;
  setup: Uint8Array | null;
  packets: OggPacket[];
  preSkip: number;
  sampleRate: number;
  channels: number;
  stage: HeaderStage;
  assembler: PacketAssembler;
  nextExpectedSeq: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a complete Ogg byte stream into an OggFile.
 *
 * Supports:
 * - Single logical stream (Vorbis or Opus).
 * - Chained streams (sequential: one EOS, then another BOS).
 *
 * Rejects:
 * - Multiplexed streams (concurrent serial numbers interleaved).
 * - Non-Vorbis, non-Opus codecs (Theora, Speex, Skeleton, FLAC-in-Ogg).
 *
 * @throws OggInputTooLargeError — input > 200 MiB.
 * @throws OggCaptureMissingError — no "OggS" at offset 0 or anywhere.
 * @throws OggInvalidVersionError — non-zero stream_structure_version.
 * @throws OggSequenceGapError — page sequence gap detected.
 * @throws OggMultiplexNotSupportedError — concurrent serial numbers.
 * @throws OggCorruptStreamError — CRC failures or structural corruption.
 * @throws OggUnsupportedCodecError — codec other than Vorbis/Opus.
 * @throws OggTooManyPagesError — page count exceeds 2 million.
 * @throws OggPacketTooLargeError — packet exceeds 16 MiB.
 * @throws OggTooManyPacketsError — packet count exceeds 1 million per stream.
 */
export function parseOgg(input: Uint8Array): OggFile {
  // Security cap #1: input size.
  if (input.length > MAX_INPUT_BYTES) {
    throw new OggInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  // Must start with "OggS".
  if (!hasOggSAt(input, 0)) {
    throw new OggCaptureMissingError();
  }

  const completedStreams: OggLogicalStream[] = [];
  // Currently active streams by serial number (at most 1 in Phase 2).
  const activeStreams = new Map<number, StreamState>();

  let cursor = 0;
  let pageCount = 0;
  let crcAttempts = 0;
  let crcFailures = 0;
  let packetsEmittedTotal = 0;
  // H-1: cumulative bytes scanned during sync recovery to bound O(n²) CPU burn.
  let totalSyncBytes = 0;

  while (cursor < input.length) {
    // Sync recovery: find "OggS" from current position.
    if (!hasOggSAt(input, cursor)) {
      const { offset: next, bytesScanned } = scanForOggS(input, cursor);
      totalSyncBytes += bytesScanned;
      if (totalSyncBytes > MAX_TOTAL_SYNC_SCAN_BYTES) {
        throw new OggCorruptStreamError(
          `Cumulative sync scan exceeded ${MAX_TOTAL_SYNC_SCAN_BYTES} bytes (16 MiB). Stream is likely corrupt or adversarially crafted.`,
        );
      }
      if (next < 0) break; // No more pages.
      cursor = next;
    }

    // Security cap #2: page count.
    if (pageCount >= MAX_PAGES) {
      throw new OggTooManyPagesError(MAX_PAGES);
    }

    // Parse page — may throw on corrupt data.
    let page: OggPage;
    let nextOffset: number;

    crcAttempts++;
    try {
      ({ page, nextOffset } = parsePage(input, cursor));
    } catch (err) {
      // CRC mismatch or structural error: track failure, skip 4 bytes and resync.
      crcFailures++;

      // Security cap #9: majority-corrupt detection.
      if (
        crcAttempts >= MIN_PAGES_FOR_CORRUPT_CHECK &&
        crcFailures / crcAttempts > CRC_CORRUPT_THRESHOLD &&
        packetsEmittedTotal === 0
      ) {
        throw new OggCorruptStreamError(
          `${crcFailures} of ${crcAttempts} pages failed CRC and no packets were emitted. Stream is corrupt.`,
        );
      }

      cursor += 4; // Skip past the bad OggS and try to resync.
      continue;
    }

    pageCount++;
    cursor = nextOffset;

    const sn = page.serialNumber;

    // -----------------------------------------------------------------------
    // BOS handling: start of a new logical stream.
    // -----------------------------------------------------------------------
    if (page.bos) {
      // Check for multiplexed streams: if any active stream exists, this is multiplex.
      if (activeStreams.size > 0) {
        // Multiplexed: two BOS pages seen before the first stream's EOS.
        const existingSerials = Array.from(activeStreams.keys());
        throw new OggMultiplexNotSupportedError([...existingSerials, sn]);
      }

      // New stream — create state.
      const state: StreamState = {
        serialNumber: sn,
        codec: null,
        identification: null,
        comments: null,
        setup: null,
        packets: [],
        preSkip: 0,
        sampleRate: 0,
        channels: 0,
        stage: 'identification',
        assembler: new PacketAssembler(sn),
        nextExpectedSeq: 0,
      };
      activeStreams.set(sn, state);
    }

    // Look up the active stream state.
    const state = activeStreams.get(sn);
    if (state === undefined) {
      // Page belongs to an unknown stream — either after EOS or corrupt; skip.
      continue;
    }

    // -----------------------------------------------------------------------
    // Sequence number validation (design note Trap §3).
    // -----------------------------------------------------------------------
    if (page.pageSequenceNumber !== state.nextExpectedSeq) {
      throw new OggSequenceGapError(sn, state.nextExpectedSeq, page.pageSequenceNumber);
    }
    state.nextExpectedSeq = page.pageSequenceNumber + 1;

    // -----------------------------------------------------------------------
    // Packet reassembly via lacing.
    // -----------------------------------------------------------------------
    const newPackets = state.assembler.feedPage(page);

    // -----------------------------------------------------------------------
    // Route packets to headers or audio bucket.
    // -----------------------------------------------------------------------
    for (const pkt of newPackets) {
      processPacket(pkt.data, pkt.granulePosition, state);
      packetsEmittedTotal++;
    }

    // -----------------------------------------------------------------------
    // EOS handling: finalize stream.
    // -----------------------------------------------------------------------
    if (page.eos) {
      if (state.codec === null) {
        throw new OggCorruptStreamError(
          `Stream 0x${sn.toString(16)} ended (EOS) before codec was identified.`,
        );
      }

      const stream = finalizeStream(state);
      completedStreams.push(stream);
      activeStreams.delete(sn);
    }
  }

  // Any streams that never saw EOS are implicitly terminated (truncated file).
  // Add them to output so partial data is not silently lost.
  for (const [, state] of activeStreams) {
    if (state.codec !== null) {
      completedStreams.push(finalizeStream(state));
    } else {
      // M-1: BOS was seen but no usable identification packet arrived — the stream
      // is corrupt (unknown codec, truncated before first packet, etc.). Throw
      // rather than silently returning empty streams to the caller.
      throw new OggCorruptStreamError(
        `truncated stream: no codec identification packet seen for stream 0x${state.serialNumber.toString(16)}.`,
      );
    }
  }

  // Security cap #8: if input is non-empty and no pages were parsed.
  if (input.length > 0 && pageCount === 0 && crcAttempts === 0) {
    throw new OggCaptureMissingError();
  }

  if (
    input.length > 0 &&
    completedStreams.length === 0 &&
    crcFailures > 0 &&
    packetsEmittedTotal === 0
  ) {
    throw new OggCorruptStreamError(
      `${crcFailures} page parse failures and no usable packets decoded.`,
    );
  }

  return { streams: completedStreams };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Route a single packet to the appropriate header slot or audio packets array.
 */
function processPacket(data: Uint8Array, granulePosition: bigint, state: StreamState): void {
  // -------------------------------------------------------------------------
  // Stage: identification — first packet of the stream.
  // -------------------------------------------------------------------------
  if (state.stage === 'identification') {
    if (isOpusHeadPacket(data)) {
      const head = decodeOpusHead(data);
      state.codec = 'opus';
      state.identification = data;
      state.preSkip = head.preSkip;
      state.sampleRate = 48000; // Opus always outputs at 48 kHz.
      state.channels = head.channelCount;
      state.stage = 'comment';
    } else if (isVorbisHeaderPacket(data)) {
      const ident = decodeVorbisIdentification(data);
      state.codec = 'vorbis';
      state.identification = data;
      state.preSkip = 0;
      state.sampleRate = ident.audioSampleRate;
      state.channels = ident.audioChannels;
      state.stage = 'comment';
    } else {
      // Unknown codec — determine hint from magic bytes.
      const hint = identifyUnknownCodec(data);
      throw new OggUnsupportedCodecError(hint);
    }
    return;
  }

  // -------------------------------------------------------------------------
  // Stage: comment — second packet.
  // -------------------------------------------------------------------------
  if (state.stage === 'comment') {
    // H-3: Validate comment packet before storing so security caps in
    // decodeVorbisComment / decodeOpusTags are exercised on the parse path.
    // The decoded result is discarded — raw bytes are kept for round-trip preservation.
    if (state.codec === 'vorbis') {
      decodeVorbisComment(data); // throws on malformed / oversized fields
      state.stage = 'setup';
    } else {
      decodeOpusTags(data); // throws on malformed / oversized fields
      state.stage = 'audio';
    }
    state.comments = data;
    return;
  }

  // -------------------------------------------------------------------------
  // Stage: setup — third packet (Vorbis only).
  // -------------------------------------------------------------------------
  if (state.stage === 'setup') {
    if (isVorbisSetupPacket(data)) {
      state.setup = data;
      state.stage = 'audio';
    } else {
      // Unexpected packet before setup — could be a large setup spanning pages.
      // Treat as setup continuation (large setup packets span pages but are
      // reassembled by the lacing layer before reaching here). If we get here
      // with a non-setup packet, the stream is malformed.
      throw new OggCorruptStreamError(
        `Expected Vorbis setup packet but got a packet with type 0x${(data[0] ?? 0).toString(16)}.`,
      );
    }
    return;
  }

  // -------------------------------------------------------------------------
  // Stage: audio — all subsequent packets are audio.
  // -------------------------------------------------------------------------
  state.packets.push({ data, granulePosition, serialNumber: state.serialNumber });
}

/**
 * Convert a completed StreamState into an OggLogicalStream.
 */
function finalizeStream(state: StreamState): OggLogicalStream {
  return {
    serialNumber: state.serialNumber,
    codec: state.codec as OggCodec,
    identification: state.identification ?? new Uint8Array(0),
    comments: state.comments ?? undefined,
    setup: state.setup ?? undefined,
    packets: state.packets,
    preSkip: state.preSkip,
    sampleRate: state.sampleRate,
    channels: state.channels,
  };
}

/**
 * Scan forward for "OggS" capture pattern from `start`, capped at SYNC_SCAN_CAP.
 * Returns an object with:
 *   offset — offset of "OggS" or -1 if not found within the cap.
 *   bytesScanned — number of bytes actually examined (used for H-1 cumulative cap).
 */
function scanForOggS(data: Uint8Array, start: number): { offset: number; bytesScanned: number } {
  const limit = Math.min(start + SYNC_SCAN_CAP, data.length);
  for (let i = start; i < limit; i++) {
    if (hasOggSAt(data, i)) return { offset: i, bytesScanned: i - start };
  }
  return { offset: -1, bytesScanned: limit - start };
}

/**
 * Identify the codec from unknown first-packet magic bytes for error messages.
 */
function identifyUnknownCodec(data: Uint8Array): string {
  if (data.length >= 7) {
    // Theora: packet_type=0x80, "theora"
    if (
      data[0] === 0x80 &&
      data[1] === 0x74 &&
      data[2] === 0x68 &&
      data[3] === 0x65 &&
      data[4] === 0x6f &&
      data[5] === 0x72 &&
      data[6] === 0x61
    ) {
      return 'Theora (video; out of scope)';
    }
    // Speex: "Speex   " (8 bytes)
    if (data.length >= 8 && data[0] === 0x53 && data[1] === 0x70 && data[2] === 0x65) {
      return 'Speex (audio; out of scope)';
    }
    // Skeleton: "fishead\0" (8 bytes)
    if (data.length >= 8 && data[0] === 0x66 && data[1] === 0x69 && data[2] === 0x73) {
      return 'Skeleton metadata (out of scope)';
    }
  }
  const hex = Array.from(data.subarray(0, Math.min(8, data.length)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  return `unknown (first bytes: ${hex})`;
}
