/**
 * MP4 demuxer — parse a Uint8Array into an Mp4File.
 *
 * Algorithm (per design note §Demuxer):
 * 1. Input size guard (200 MiB cap) — FIRST statement as required.
 * 2. Top-level scan: walk top-level boxes, record offsets, enforce caps.
 * 3. Locate ftyp (must be first). (Brands no longer rejected — fMP4 brands accepted.)
 * 4. Locate moov (may be after mdat — Trap §8). Throw if absent.
 * 5. Locate mdat ranges (do not copy contents).
 * 6. Descend into moov with iterative stack (depth cap = 10).
 * 7a. Classic path: parse the single trak (throw if != 1).
 * 7b. Fragmented path: parse mvex/trex; walk top-level for moof boxes.
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
 *   - MAX_FRAGMENTS (100,000) for fragmented files
 *   - MAX_TRAFS_PER_MOOF (64) per fragment
 *   - MAX_SAMPLES_PER_TRUN (1,000,000) per trun
 */

import { type Mp4Box, findChild, findChildren, walkBoxes } from './box-tree.ts';
import { type EditListEntry, parseElst } from './boxes/elst.ts';
import { type Mp4Ftyp, parseFtyp } from './boxes/ftyp.ts';
import { type Mp4SampleEntry, parseHdlr, parseStsd, validateDref } from './boxes/hdlr-stsd-mp4a.ts';
import type { Mp4MovieFragment, Mp4TrackFragment } from './boxes/moof.ts';
import { parseMoof } from './boxes/moof.ts';
import type { Mp4MvexResult, Mp4TrackExtends } from './boxes/mvex.ts';
import { parseMvex } from './boxes/mvex.ts';
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
  parseStss,
  parseStsz,
  parseStts,
} from './boxes/stbl.ts';
import type { Mp4TrackRun } from './boxes/trun.ts';
import { type MetadataAtoms, parseUdta } from './boxes/udta-meta-ilst.ts';
import { MAX_FRAGMENTS, MAX_INPUT_BYTES } from './constants.ts';
import {
  Mp4CorruptSampleError,
  Mp4FragmentCountTooLargeError,
  Mp4FragmentMixedSampleTablesError,
  Mp4InputTooLargeError,
  Mp4InvalidBoxError,
  Mp4MetaBadHandlerError,
  Mp4MissingBoxError,
  Mp4MissingFtypError,
  Mp4MissingMoovError,
  Mp4MoofSequenceOutOfOrderError,
  Mp4MultiTrackNotSupportedError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Re-export fragmented types for consumers
// ---------------------------------------------------------------------------

export type { Mp4MovieFragment, Mp4TrackFragment, Mp4TrackRun };
export type { Mp4TrackExtends };
export type { Mp4SampleEntry };

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface Mp4Track {
  trackId: number;
  handlerType: 'soun' | 'vide';
  mediaHeader: Mp4MediaHeader;
  trackHeader: Mp4TrackHeader;
  /** Discriminated union: { kind: 'audio', entry } | { kind: 'video', entry }. */
  sampleEntry: Mp4SampleEntry;
  sampleTable: Mp4SampleTable;
  /** Raw stts entries preserved for round-trip serialization. */
  sttsEntries: SttsEntry[];
  /** Raw stsc entries preserved for round-trip serialization. */
  stscEntries: StscEntry[];
  /** Chunk offsets preserved for round-trip serialization. */
  chunkOffsets: readonly number[];
  /** 'stco' or 'co64' from the original file. */
  chunkOffsetVariant: 'stco' | 'co64';
  /**
   * Parsed edit list entries from the `edts/elst` box, preserved for both
   * round-trip serialization and sample-iterator presentation-time adjustment.
   * Empty array when no `edts` box is present (most simple M4A files).
   */
  editList: readonly EditListEntry[];
  /**
   * 1-based set of keyframe sample numbers from stss box.
   * null means no stss box was present → all samples are keyframes.
   * Only populated for video tracks; always null for audio tracks.
   */
  syncSamples: ReadonlySet<number> | null;
}

export interface Mp4File {
  ftyp: Mp4Ftyp;
  movieHeader: Mp4MovieHeader;
  tracks: Mp4Track[];
  /** mdat byte ranges (offset, length) for the serializer. */
  mdatRanges: Array<{ offset: number; length: number }>;
  /** Reference to the original input buffer for zero-copy sample access. */
  fileBytes: Uint8Array;
  /**
   * Parsed iTunes-style movie metadata from moov/udta/meta/ilst.
   * Empty array when no udta/meta/ilst is present or handler is non-mdir.
   */
  metadata: MetadataAtoms;
  /**
   * Opaque bytes from `udta` when `meta` is absent or `hdlr.handler_type != 'mdir'`.
   * Null when udta was fully parsed into `metadata` or absent entirely.
   */
  udtaOpaque: Uint8Array | null;

  // ---------------------------------------------------------------------------
  // Fragmented MP4 fields (sub-pass D)
  // ---------------------------------------------------------------------------

  /**
   * True when the file contains an `mvex` box inside `moov`, indicating that
   * sample data is in `moof/mdat` pairs rather than the classic `stbl` tables.
   */
  readonly isFragmented: boolean;

  /**
   * Track extension defaults from `mvex/trex` boxes. One entry per track.
   * Empty array for classic (non-fragmented) files.
   */
  readonly trackExtends: readonly Mp4TrackExtends[];

  /**
   * Parsed `moof` (Movie Fragment) boxes, in file order.
   * Empty array for classic (non-fragmented) files.
   */
  readonly fragments: readonly Mp4MovieFragment[];

  /**
   * Parsed `sidx` (Segment Index) box. Currently always null (D.3 will parse it).
   * The sidx box is silently skipped in sub-pass D.
   */
  readonly sidx: null;

  /**
   * Bytes from end-of-moov to end-of-file for byte-equivalent round-trip (D.4).
   * null in sub-pass D; D.4 will populate this field.
   */
  readonly fragmentedTail: Uint8Array | null;

  /**
   * Opaque `mfra` payload bytes (D.3 placeholder).
   * null in sub-pass D; D.3 will parse this.
   */
  readonly mfra: Uint8Array | null;
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
 * @throws Mp4MissingMoovError — no moov box found.
 * @throws Mp4MultiTrackNotSupportedError — more than one trak box (classic path).
 * @throws Mp4UnsupportedTrackTypeError — hdlr handler is not 'soun'.
 * @throws Mp4UnsupportedSampleEntryError — sample entry is not 'mp4a'.
 * @throws Mp4ExternalDataRefError — dref is not self-contained.
 * @throws Mp4InvalidBoxError — malformed box structure.
 * @throws Mp4FragmentMixedSampleTablesError — fragmented file with non-empty stbl.
 * @throws Mp4MoofSequenceOutOfOrderError — mfhd sequence not monotonic.
 * @throws Mp4FragmentCountTooLargeError — too many moof boxes.
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

  // Step 7: detect fragmented vs classic.
  // F9: strict-reject duplicate mvex (consistent with edts/elst duplicate policy).
  const mvexBoxes = findChildren(moovBox, 'mvex');
  if (mvexBoxes.length > 1) {
    throw new Mp4InvalidBoxError(
      `moov contains ${mvexBoxes.length} mvex boxes; the spec allows exactly one.`,
    );
  }
  const mvexBox = mvexBoxes[0] ?? null;

  // Parse udta/metadata (shared between both paths).
  let metadata: MetadataAtoms = [];
  let udtaOpaque: Uint8Array | null = null;
  const udtaBox = findChild(moovBox, 'udta');
  if (udtaBox) {
    try {
      const result = parseUdta(udtaBox.payload);
      metadata = result.metadata;
      udtaOpaque = result.opaque;
    } catch (err) {
      if (err instanceof Mp4MetaBadHandlerError) {
        udtaOpaque = udtaBox.payload.slice();
      } else {
        throw err;
      }
    }
  }

  if (mvexBox) {
    // --- FRAGMENTED PATH ---
    return parseFragmented(
      input,
      ftyp,
      movieHeader,
      trakBoxes,
      moovBox,
      mvexBox,
      topLevel,
      mdatRanges,
      metadata,
      udtaOpaque,
      boxCount,
    );
  }

  // --- CLASSIC PATH ---
  return parseClassic(
    input,
    ftyp,
    movieHeader,
    trakBoxes,
    mdatRanges,
    metadata,
    udtaOpaque,
    boxCount,
  );
}

// ---------------------------------------------------------------------------
// Classic path
// ---------------------------------------------------------------------------

function parseClassic(
  input: Uint8Array,
  ftyp: Mp4Ftyp,
  movieHeader: Mp4MovieHeader,
  trakBoxes: Mp4Box[],
  mdatRanges: Array<{ offset: number; length: number }>,
  metadata: MetadataAtoms,
  udtaOpaque: Uint8Array | null,
  boxCount: { value: number },
): Mp4File {
  if (trakBoxes.length !== 1) {
    if (trakBoxes.length === 0) {
      throw new Mp4MissingBoxError('trak', 'moov');
    }
    throw new Mp4MultiTrackNotSupportedError(trakBoxes.length);
  }

  const trakBox = trakBoxes[0];
  if (!trakBox) throw new Mp4MissingBoxError('trak', 'moov');
  const track = parseTrak(trakBox, input, boxCount);

  // Validate all sample offsets + sizes against file bounds.
  const { sampleOffsets, sampleSizes, sampleCount } = track.sampleTable;
  for (let i = 0; i < sampleCount; i++) {
    const off = sampleOffsets[i] ?? 0;
    const sz = sampleSizes[i] ?? 0;
    if (off + sz > input.length) {
      throw new Mp4CorruptSampleError(i, off, sz, input.length);
    }
  }

  // Duration consistency check (Trap §9 — warn, not throw).
  const mdhdTimescale = track.mediaHeader.timescale;
  if (mdhdTimescale > 0 && sampleCount > 0) {
    const sttsTotal = track.sttsEntries.reduce((acc, e) => acc + e.sampleCount * e.sampleDelta, 0);
    const mdhdDuration = track.mediaHeader.duration;
    const delta = Math.abs(sttsTotal - mdhdDuration);
    if (delta > mdhdTimescale) {
      // One-sample tolerance exceeded — warning per spec.
    }
  }

  return {
    ftyp,
    movieHeader,
    tracks: [track],
    mdatRanges,
    fileBytes: input,
    metadata,
    udtaOpaque,
    isFragmented: false,
    trackExtends: [],
    fragments: [],
    sidx: null,
    fragmentedTail: null,
    mfra: null,
  };
}

// ---------------------------------------------------------------------------
// Fragmented path
// ---------------------------------------------------------------------------

function parseFragmented(
  input: Uint8Array,
  ftyp: Mp4Ftyp,
  movieHeader: Mp4MovieHeader,
  trakBoxes: Mp4Box[],
  moovBox: Mp4Box,
  mvexBox: Mp4Box,
  topLevel: Mp4Box[],
  mdatRanges: Array<{ offset: number; length: number }>,
  metadata: MetadataAtoms,
  udtaOpaque: Uint8Array | null,
  boxCount: { value: number },
): Mp4File {
  // Parse trak for audio sample entry info (stbl tables expected to be empty).
  // We still require exactly one trak for sub-pass D.
  if (trakBoxes.length !== 1) {
    if (trakBoxes.length === 0) {
      throw new Mp4MissingBoxError('trak', 'moov');
    }
    throw new Mp4MultiTrackNotSupportedError(trakBoxes.length);
  }
  const trakBox = trakBoxes[0];
  if (!trakBox) throw new Mp4MissingBoxError('trak', 'moov');

  // Parse trak but skip sample-table validation (stbl should be empty).
  const track = parseTrakFragmented(trakBox, input, boxCount);

  // Parse mvex → trex defaults.
  const mvexResult: Mp4MvexResult = parseMvex(mvexBox);

  // Walk top-level boxes after moov for moof, sidx, mfra (D.1 scope: skip sidx/mfra).
  const fragments: Mp4MovieFragment[] = [];
  let lastSequenceNumber = -1;

  for (const box of topLevel) {
    if (box.type === 'moof') {
      // Cap check.
      if (fragments.length >= MAX_FRAGMENTS) {
        throw new Mp4FragmentCountTooLargeError(fragments.length + 1, MAX_FRAGMENTS);
      }

      // Absolute offset of moof start = payloadOffset - headerSize.
      const moofOffset = box.payloadOffset - box.headerSize;
      const fragment = parseMoof(box, moofOffset, mvexResult.trackExtendsById);

      // Trap 6: validate monotonic sequence number.
      if (lastSequenceNumber >= 0 && fragment.sequenceNumber <= lastSequenceNumber) {
        throw new Mp4MoofSequenceOutOfOrderError(
          lastSequenceNumber,
          fragment.sequenceNumber,
          moofOffset,
        );
      }
      lastSequenceNumber = fragment.sequenceNumber;

      fragments.push(fragment);
    }
    // sidx and mfra: silently skip in sub-pass D.
  }

  return {
    ftyp,
    movieHeader,
    tracks: [track],
    mdatRanges,
    fileBytes: input,
    metadata,
    udtaOpaque,
    isFragmented: true,
    trackExtends: mvexResult.trackExtends,
    fragments,
    sidx: null,
    fragmentedTail: null,
    mfra: null,
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

  // edts / elst (optional; present in AAC files with priming silence)
  const edtsBoxes = findChildren(trakBox, 'edts');
  if (edtsBoxes.length > 1) {
    throw new Mp4InvalidBoxError(
      `trak contains ${edtsBoxes.length} edts boxes; the spec allows exactly one.`,
    );
  }
  const edtsBox = edtsBoxes[0];
  let editList: readonly EditListEntry[];
  if (edtsBox) {
    const elstBoxes = findChildren(edtsBox, 'elst');
    if (elstBoxes.length > 1) {
      throw new Mp4InvalidBoxError(
        `edts contains ${elstBoxes.length} elst boxes; the spec allows exactly one.`,
      );
    }
    const elstBox = elstBoxes[0];
    if (!elstBox) throw new Mp4MissingBoxError('elst', 'edts');
    editList = parseElst(elstBox.payload);
  } else {
    editList = [];
  }

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
  const sampleEntry = parseStsd(stsdBox.payload, fileData, boxCount);

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

  // Parse optional stss (Sync Sample Box) — video tracks only.
  let syncSamples: ReadonlySet<number> | null = null;
  const stssBox = findChild(stblBox, 'stss');
  if (stssBox) {
    syncSamples = parseStss(stssBox.payload);
  }

  return {
    trackId: trackHeader.trackId,
    handlerType: handler.handlerType as 'soun' | 'vide',
    mediaHeader,
    trackHeader,
    sampleEntry,
    sampleTable,
    sttsEntries,
    stscEntries,
    chunkOffsets,
    chunkOffsetVariant,
    editList,
    syncSamples,
  };
}

/**
 * Parse a trak box from a fragmented file. The stbl tables are expected to be
 * zero-sample. We validate that and return the track.
 */
function parseTrakFragmented(
  trakBox: Mp4Box,
  fileData: Uint8Array,
  boxCount: { value: number },
): Mp4Track {
  // Parse the full trak (same as classic) to extract codec info from stsd.
  const tkhdBox = findChild(trakBox, 'tkhd');
  if (!tkhdBox) throw new Mp4MissingBoxError('tkhd', 'trak');
  const trackHeader = parseTkhd(tkhdBox.payload);

  const edtsBoxes = findChildren(trakBox, 'edts');
  if (edtsBoxes.length > 1) {
    throw new Mp4InvalidBoxError(
      `trak contains ${edtsBoxes.length} edts boxes; the spec allows exactly one.`,
    );
  }
  const edtsBox = edtsBoxes[0];
  let editList: readonly EditListEntry[] = [];
  if (edtsBox) {
    const elstBoxes = findChildren(edtsBox, 'elst');
    if (elstBoxes.length > 1) {
      throw new Mp4InvalidBoxError(
        `edts contains ${elstBoxes.length} elst boxes; the spec allows exactly one.`,
      );
    }
    const elstBox = elstBoxes[0];
    if (!elstBox) throw new Mp4MissingBoxError('elst', 'edts');
    editList = parseElst(elstBox.payload);
  }

  const mdiaBox = findChild(trakBox, 'mdia');
  if (!mdiaBox) throw new Mp4MissingBoxError('mdia', 'trak');

  const mdhdBox = findChild(mdiaBox, 'mdhd');
  if (!mdhdBox) throw new Mp4MissingBoxError('mdhd', 'mdia');
  const mediaHeader = parseMdhd(mdhdBox.payload);

  const hdlrBox = findChild(mdiaBox, 'hdlr');
  if (!hdlrBox) throw new Mp4MissingBoxError('hdlr', 'mdia');
  const handler = parseHdlr(hdlrBox.payload);

  const minfBox = findChild(mdiaBox, 'minf');
  if (!minfBox) throw new Mp4MissingBoxError('minf', 'mdia');

  const dinfBox = findChild(minfBox, 'dinf');
  if (!dinfBox) throw new Mp4MissingBoxError('dinf', 'minf');
  const drefBox = findChild(dinfBox, 'dref');
  if (!drefBox) throw new Mp4MissingBoxError('dref', 'dinf');
  validateDref(drefBox.payload);

  const stblBox = findChild(minfBox, 'stbl');
  if (!stblBox) throw new Mp4MissingBoxError('stbl', 'minf');

  const stsdBox = findChild(stblBox, 'stsd');
  if (!stsdBox) throw new Mp4MissingBoxError('stsd', 'stbl');
  const sampleEntry = parseStsd(stsdBox.payload, fileData, boxCount);

  // stts/stsc/stsz — parse but validate zero-sample (fragmented contract).
  const sttsBox = findChild(stblBox, 'stts');
  if (!sttsBox) throw new Mp4MissingBoxError('stts', 'stbl');
  const sttsEntries = parseStts(sttsBox.payload);

  const stscBox = findChild(stblBox, 'stsc');
  if (!stscBox) throw new Mp4MissingBoxError('stsc', 'stbl');
  const stscEntries = parseStsc(stscBox.payload);

  const stszBox = findChild(stblBox, 'stsz');
  if (!stszBox) throw new Mp4MissingBoxError('stsz', 'stbl');
  const sampleSizes = parseStsz(stszBox.payload);

  // Validate empty stbl (design §4: non-empty → Mp4FragmentMixedSampleTablesError).
  if (sttsEntries.length > 0 || stscEntries.length > 0 || sampleSizes.length > 0) {
    throw new Mp4FragmentMixedSampleTablesError(trackHeader.trackId);
  }

  // stco required by schema even if empty.
  const stcoBox = findChild(stblBox, 'stco');
  const co64Box = findChild(stblBox, 'co64');
  let chunkOffsetVariant: 'stco' | 'co64' = 'stco';
  let chunkOffsets: readonly number[] = [];

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

  // stss optional (video only).
  let syncSamples: ReadonlySet<number> | null = null;
  const stssBox = findChild(stblBox, 'stss');
  if (stssBox) {
    syncSamples = parseStss(stssBox.payload);
  }

  return {
    trackId: trackHeader.trackId,
    handlerType: handler.handlerType as 'soun' | 'vide',
    mediaHeader,
    trackHeader,
    sampleEntry,
    sampleTable,
    sttsEntries,
    stscEntries,
    chunkOffsets,
    chunkOffsetVariant,
    editList,
    syncSamples,
  };
}
