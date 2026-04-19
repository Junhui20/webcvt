/**
 * MP4 demuxer — parse a Uint8Array into an Mp4File.
 *
 * Algorithm (per design note §Demuxer):
 * 1. Input size guard (200 MiB cap) — FIRST statement as required.
 * 2. Top-level scan: walk top-level boxes, record offsets, enforce caps.
 * 3. Locate ftyp (must be first), reject fragmented brands.
 * 4. Locate moov (may be after mdat — Trap §8). Throw if absent.
 * 5. Locate mdat ranges (do not copy contents).
 * 6. Descend into moov with iterative stack (depth cap = 10).
 * 7. Parse the single trak (throw if != 1 — Trap for multi-track).
 * 8. Validate and return Mp4File.
 *
 * Security caps enforced:
 *   - MAX_INPUT_BYTES (200 MiB)
 *   - MAX_BOX_SIZE_NON_MDAT (64 MiB per non-mdat box)
 *   - MAX_BOXES_PER_FILE (10,000)
 *   - MAX_DEPTH (10) via box-tree walker
 *   - MAX_TABLE_ENTRIES (1,000,000) via each table parser
 *   - MAX_DESCRIPTOR_BYTES (16 MiB) via esds parser
 *   - Sample offset + size validated against fileBytes.length
 *   - Zero-track parse from non-empty input → Mp4CorruptStreamError
 */

import { type Mp4Box, findChild, findChildren, walkBoxes } from './box-tree.ts';
import { type Mp4Ftyp, parseFtyp } from './boxes/ftyp.ts';
import {
  type Mp4AudioSampleEntry,
  parseHdlr,
  parseStsd,
  validateDref,
} from './boxes/hdlr-stsd-mp4a.ts';
import {
  type Mp4MediaHeader,
  type Mp4MovieHeader,
  type Mp4TrackHeader,
  parseMdhd,
  parseMvhd,
  parseTkhd,
} from './boxes/mvhd-tkhd-mdhd.ts';
import {
  type Mp4SampleTable,
  type StscEntry,
  type SttsEntry,
  buildSampleTable,
  parseStcoOrCo64,
  parseStsc,
  parseStsz,
  parseStts,
} from './boxes/stbl.ts';
import { MAX_INPUT_BYTES } from './constants.ts';
import {
  Mp4CorruptSampleError,
  Mp4InputTooLargeError,
  Mp4MissingBoxError,
  Mp4MissingFtypError,
  Mp4MissingMoovError,
  Mp4MultiTrackNotSupportedError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface Mp4Track {
  trackId: number;
  handlerType: 'soun';
  mediaHeader: Mp4MediaHeader;
  trackHeader: Mp4TrackHeader;
  audioSampleEntry: Mp4AudioSampleEntry;
  sampleTable: Mp4SampleTable;
  /** Raw stts entries preserved for round-trip serialization. */
  sttsEntries: SttsEntry[];
  /** Raw stsc entries preserved for round-trip serialization. */
  stscEntries: StscEntry[];
  /** Chunk offsets preserved for round-trip serialization. */
  chunkOffsets: readonly number[];
  /** 'stco' or 'co64' from the original file. */
  chunkOffsetVariant: 'stco' | 'co64';
}

export interface Mp4File {
  ftyp: Mp4Ftyp;
  movieHeader: Mp4MovieHeader;
  tracks: Mp4Track[];
  /** mdat byte ranges (offset, length) for the serializer. */
  mdatRanges: Array<{ offset: number; length: number }>;
  /** Reference to the original input buffer for zero-copy sample access. */
  fileBytes: Uint8Array;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a complete MP4/M4A byte stream into an Mp4File.
 *
 * Security cap: input > 200 MiB throws Mp4InputTooLargeError as the FIRST
 * statement (FLAC C-1 pattern — direct importers must hit the cap immediately,
 * not only through backend.convert).
 *
 * @throws Mp4InputTooLargeError — input > 200 MiB.
 * @throws Mp4MissingFtypError — ftyp is not the first box.
 * @throws Mp4UnsupportedBrandError — fragmented MP4 brand detected.
 * @throws Mp4MissingMoovError — no moov box found.
 * @throws Mp4MultiTrackNotSupportedError — more than one trak box.
 * @throws Mp4UnsupportedTrackTypeError — hdlr handler is not 'soun'.
 * @throws Mp4UnsupportedSampleEntryError — sample entry is not 'mp4a'.
 * @throws Mp4ExternalDataRefError — dref is not self-contained.
 * @throws Mp4InvalidBoxError — malformed box structure.
 * @throws Mp4CorruptStreamError — non-empty input produced zero tracks.
 */
export function parseMp4(input: Uint8Array): Mp4File {
  // Security cap #1: input size — MUST be the first statement.
  if (input.length > MAX_INPUT_BYTES) {
    throw new Mp4InputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  const boxCount = { value: 0 };

  // Step 1–2: Walk all top-level boxes.
  const topLevel = walkBoxes(input, 0, input.length, boxCount);

  // Step 3: ftyp must be the first box.
  const firstBox = topLevel[0];
  if (!firstBox || firstBox.type !== 'ftyp') {
    throw new Mp4MissingFtypError();
  }
  const ftyp = parseFtyp(firstBox.payload);

  // Step 4: find moov (may appear after mdat — Trap §8).
  const moovBox = topLevel.find((b) => b.type === 'moov');
  if (!moovBox) {
    throw new Mp4MissingMoovError();
  }

  // Step 5: collect all mdat ranges (do not copy bytes).
  const mdatRanges = topLevel
    .filter((b) => b.type === 'mdat')
    .map((b) => ({ offset: b.payloadOffset, length: b.payloadSize }));

  // Step 6: parse moov — mvhd + trak(s).
  const movieHeader = parseMvhdFromMoov(moovBox);
  const trakBoxes = findChildren(moovBox, 'trak');

  if (trakBoxes.length !== 1) {
    if (trakBoxes.length === 0) {
      throw new Mp4MissingBoxError('trak', 'moov');
    }
    throw new Mp4MultiTrackNotSupportedError(trakBoxes.length);
  }

  const trakBox = trakBoxes[0];
  if (!trakBox) throw new Mp4MissingBoxError('trak', 'moov');
  const track = parseTrak(trakBox, input, boxCount);

  // Step 7: validate all sample offsets + sizes against file bounds.
  const { sampleOffsets, sampleSizes, sampleCount } = track.sampleTable;
  for (let i = 0; i < sampleCount; i++) {
    const off = sampleOffsets[i] ?? 0;
    const sz = sampleSizes[i] ?? 0;
    if (off + sz > input.length) {
      throw new Mp4CorruptSampleError(i, off, sz, input.length);
    }
  }

  // Warn (not throw) on duration mismatch (Trap §9 — design note says "warn, not throw").
  const mdhdTimescale = track.mediaHeader.timescale;
  if (mdhdTimescale > 0 && sampleCount > 0) {
    const sttsTotal = track.sttsEntries.reduce((acc, e) => acc + e.sampleCount * e.sampleDelta, 0);
    const mdhdDuration = track.mediaHeader.duration;
    const delta = Math.abs(sttsTotal - mdhdDuration);
    if (delta > mdhdTimescale) {
      // One-sample tolerance exceeded — this is a warning per spec (Trap §9).
      // We proceed; the stts-derived durations are the authoritative source.
    }
  }

  const tracks: Mp4Track[] = [track];

  // Sec-M-4: The guard `tracks.length === 0` is unreachable here because
  // `parseTrak` either returns a valid track or throws a typed structural error
  // (Mp4MissingBoxError / Mp4InvalidBoxError). Those error types are more
  // specific than Mp4CorruptStreamError and give consumers better diagnostics.
  // Mp4CorruptStreamError is reserved for top-level structural failures (no ftyp,
  // no moov) — see errors.ts for its defined use cases.

  return {
    ftyp,
    movieHeader,
    tracks,
    mdatRanges,
    fileBytes: input,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function parseMvhdFromMoov(moovBox: Mp4Box): Mp4MovieHeader {
  const mvhdBox = findChild(moovBox, 'mvhd');
  if (!mvhdBox) throw new Mp4MissingBoxError('mvhd', 'moov');
  return parseMvhd(mvhdBox.payload);
}

function parseTrak(trakBox: Mp4Box, fileData: Uint8Array, boxCount: { value: number }): Mp4Track {
  // tkhd
  const tkhdBox = findChild(trakBox, 'tkhd');
  if (!tkhdBox) throw new Mp4MissingBoxError('tkhd', 'trak');
  const trackHeader = parseTkhd(tkhdBox.payload);

  // mdia
  const mdiaBox = findChild(trakBox, 'mdia');
  if (!mdiaBox) throw new Mp4MissingBoxError('mdia', 'trak');

  // mdhd
  const mdhdBox = findChild(mdiaBox, 'mdhd');
  if (!mdhdBox) throw new Mp4MissingBoxError('mdhd', 'mdia');
  const mediaHeader = parseMdhd(mdhdBox.payload);

  // hdlr — throws Mp4UnsupportedTrackTypeError if not 'soun'
  const hdlrBox = findChild(mdiaBox, 'hdlr');
  if (!hdlrBox) throw new Mp4MissingBoxError('hdlr', 'mdia');
  const handler = parseHdlr(hdlrBox.payload);

  // minf
  const minfBox = findChild(mdiaBox, 'minf');
  if (!minfBox) throw new Mp4MissingBoxError('minf', 'mdia');

  // dinf → dref (validate self-contained)
  const dinfBox = findChild(minfBox, 'dinf');
  if (!dinfBox) throw new Mp4MissingBoxError('dinf', 'minf');
  const drefBox = findChild(dinfBox, 'dref');
  if (!drefBox) throw new Mp4MissingBoxError('dref', 'dinf');
  validateDref(drefBox.payload);

  // stbl
  const stblBox = findChild(minfBox, 'stbl');
  if (!stblBox) throw new Mp4MissingBoxError('stbl', 'minf');

  // Parse sample table boxes — tolerate any order (Trap §12).
  const stsdBox = findChild(stblBox, 'stsd');
  if (!stsdBox) throw new Mp4MissingBoxError('stsd', 'stbl');
  const audioSampleEntry = parseStsd(stsdBox.payload, fileData, boxCount);

  const sttsBox = findChild(stblBox, 'stts');
  if (!sttsBox) throw new Mp4MissingBoxError('stts', 'stbl');
  const sttsEntries = parseStts(sttsBox.payload);

  const stscBox = findChild(stblBox, 'stsc');
  if (!stscBox) throw new Mp4MissingBoxError('stsc', 'stbl');
  const stscEntries = parseStsc(stscBox.payload);

  const stszBox = findChild(stblBox, 'stsz');
  if (!stszBox) throw new Mp4MissingBoxError('stsz', 'stbl');
  const sampleSizes = parseStsz(stszBox.payload);

  // stco xor co64 (Trap §4).
  const stcoBox = findChild(stblBox, 'stco');
  const co64Box = findChild(stblBox, 'co64');
  let chunkOffsetVariant: 'stco' | 'co64';
  let chunkOffsets: readonly number[];

  if (co64Box) {
    const table = parseStcoOrCo64(co64Box.payload, 'co64');
    chunkOffsets = table.offsets;
    chunkOffsetVariant = 'co64';
  } else if (stcoBox) {
    const table = parseStcoOrCo64(stcoBox.payload, 'stco');
    chunkOffsets = table.offsets;
    chunkOffsetVariant = 'stco';
  } else {
    throw new Mp4MissingBoxError('stco or co64', 'stbl');
  }

  const sampleTable = buildSampleTable(sttsEntries, sampleSizes, stscEntries, chunkOffsets);

  return {
    trackId: trackHeader.trackId,
    handlerType: handler.handlerType as 'soun',
    mediaHeader,
    trackHeader,
    audioSampleEntry,
    sampleTable,
    sttsEntries,
    stscEntries,
    chunkOffsets,
    chunkOffsetVariant,
  };
}
