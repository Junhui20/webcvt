/**
 * MP4 muxer — serialize an Mp4File back to a Uint8Array.
 *
 * Algorithm (per design note §Muxer):
 * 1. Emit in canonical faststart order: ftyp → moov → mdat.
 * 2. Fixed-point offset computation (per-track, Trap §16):
 *    a. Serialize moov once with placeholder offsets (all zeros) to determine
 *       its byte size.
 *    b. Compute where mdat payload starts (ftyp + moov + mdat_header).
 *    c. For each track, compute cumulative write position of its samples.
 *    d. Patch stco/co64 chunk offsets per-track.
 *    e. Re-serialize moov. If moov size changes (stco→co64 promotion), iterate.
 * 3. mdat payload: track 0 samples, then track 1, etc. (flat layout, file order).
 * 4. mvhd.next_track_ID = max(trackId) + 1 unless input already has larger value.
 *
 * Round-trip property: parse → serialize produces byte-identical moov/ftyp
 * content (sample data is copied verbatim from the original fileBytes).
 *
 * The serializer does NOT mutate any field on the input Mp4File (immutable
 * pattern per coding-style.md).
 */

import { writeBoxHeader, writeLargeBoxHeader } from './box-header.ts';
import { isEditListTrivial, serializeElst } from './boxes/elst.ts';
import { serializeEsdsPayload } from './boxes/esds.ts';
import { type Mp4Ftyp, serializeFtyp } from './boxes/ftyp.ts';
import { serializeHdlr, serializeMp4a } from './boxes/hdlr-stsd-mp4a.ts';
import { serializeMdhd, serializeMvhd, serializeTkhd } from './boxes/mvhd-tkhd-mdhd.ts';
import {
  type StscEntry,
  type SttsEntry,
  serializeCo64,
  serializeStco,
  serializeStsc,
  serializeStss,
  serializeStsz,
  serializeStts,
} from './boxes/stbl.ts';
import { buildUdtaBox } from './boxes/udta-meta-ilst.ts';
import { serializeVisualSampleEntry } from './boxes/visual-sample-entry.ts';
import { Mp4FragmentedSerializeNotSupportedError, Mp4InvalidBoxError } from './errors.ts';
import type { Mp4File, Mp4Track } from './parser.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize an Mp4File to a canonical MP4 byte stream.
 *
 * Always emits faststart layout (ftyp → moov → mdat) regardless of the
 * original box order. Tracks are emitted in the same order as file.tracks
 * (file order, not sorted by trackId).
 *
 * mdat layout: track 0 samples, then track 1, etc. (flat, contiguous per track).
 *
 * @throws Mp4FragmentedSerializeNotSupportedError — input is a fragmented file (D.4).
 */
export function serializeMp4(file: Mp4File): Uint8Array {
  // Sub-pass D guard: fragmented round-trip serialization is not yet supported.
  if (file.isFragmented) {
    throw new Mp4FragmentedSerializeNotSupportedError();
  }

  if (file.tracks.length === 0) {
    return new Uint8Array(0);
  }

  const ftypBytes = buildFtypBox(file.ftyp);

  // Compute total mdat payload size (all tracks combined).
  const totalMdatPayloadSize = computeTotalMdatPayloadSize(file);
  const useLargesize = totalMdatPayloadSize + 8 > 0xffffffff;
  const mdatHeaderSize = useLargesize ? 16 : 8;

  // Fixed-point offset computation (Trap §16):
  // Start with placeholder offsets (all zeros) to get initial moov size, then
  // iterate until mdatPayloadOffset stabilises. A stco→co64 promotion can change
  // moov size by (N chunks × 4 bytes) per affected track, so two normal passes
  // are sufficient; we cap at 4 for safety and throw on non-convergence.
  const placeholderOffsetsPerTrack = file.tracks.map((t) =>
    Array<number>(t.chunkOffsets.length).fill(0),
  );
  const placeholderUseCo64PerTrack = file.tracks.map(() => false);

  let moovBytes = buildMoovBox(file, placeholderOffsetsPerTrack, placeholderUseCo64PerTrack);
  let mdatPayloadOffset = ftypBytes.length + moovBytes.length + mdatHeaderSize;

  let patchedOffsetsPerTrack: number[][] = [];
  let useCo64PerTrack: boolean[] = [];
  let iterations = 0;

  while (iterations < 4) {
    let trackWriteStart = mdatPayloadOffset;
    patchedOffsetsPerTrack = [];
    useCo64PerTrack = [];

    for (const track of file.tracks) {
      const patched = computePatchedOffsets(track, file.fileBytes, trackWriteStart);
      patchedOffsetsPerTrack.push(patched);
      useCo64PerTrack.push(patched.some((o) => o > 0xffffffff));
      trackWriteStart += computeMdatPayloadSizeForTrack(track);
    }

    moovBytes = buildMoovBox(file, patchedOffsetsPerTrack, useCo64PerTrack);
    const newOffset = ftypBytes.length + moovBytes.length + mdatHeaderSize;

    if (newOffset === mdatPayloadOffset) {
      break; // converged
    }
    mdatPayloadOffset = newOffset;
    iterations++;
  }

  if (iterations === 4) {
    throw new Mp4InvalidBoxError(
      'Serializer did not converge after 4 passes; pathological file layout.',
    );
  }

  // Assemble output.
  const mdatBox = buildMdatBox(file, useLargesize, totalMdatPayloadSize);

  return concatBytes([ftypBytes, moovBytes, mdatBox]);
}

// ---------------------------------------------------------------------------
// ftyp box
// ---------------------------------------------------------------------------

function buildFtypBox(ftyp: Mp4Ftyp): Uint8Array {
  const ftypPayload = serializeFtyp(ftyp);
  const boxSize = 8 + ftypPayload.length;
  const out = new Uint8Array(boxSize);
  writeBoxHeader(out, 0, boxSize, 'ftyp');
  out.set(ftypPayload, 8);
  return out;
}

// ---------------------------------------------------------------------------
// moov box (and children)
// ---------------------------------------------------------------------------

function buildMoovBox(
  file: Mp4File,
  chunkOffsetsPerTrack: readonly (readonly number[])[],
  useCo64PerTrack: readonly boolean[],
): Uint8Array {
  // C.2: mvhd.next_track_ID = max(trackId) + 1 unless input already has larger value.
  const maxTrackId = file.tracks.reduce((m, t) => Math.max(m, t.trackId), 0);
  const recomputedNextTrackId = maxTrackId + 1;
  const movieHeader = {
    ...file.movieHeader,
    nextTrackId:
      file.movieHeader.nextTrackId > recomputedNextTrackId
        ? file.movieHeader.nextTrackId
        : recomputedNextTrackId,
  };

  const mvhdBytes = buildFullBox('mvhd', serializeMvhd(movieHeader));

  // Emit all tracks in file order.
  const trakParts: Uint8Array[] = [];
  for (let i = 0; i < file.tracks.length; i++) {
    const track = file.tracks[i];
    if (!track) continue;
    const offsets = chunkOffsetsPerTrack[i] ?? [];
    const co64 = useCo64PerTrack[i] ?? false;
    trakParts.push(buildTrakBox(track, offsets, co64, file.movieHeader.duration));
  }

  // Insert udta after trak boxes (canonical ffmpeg/mp4box order).
  const udtaBytes = buildUdtaBox(file.metadata, file.udtaOpaque);

  const parts: Uint8Array[] = [mvhdBytes, ...trakParts];
  if (udtaBytes) {
    parts.push(udtaBytes);
  }

  const moovPayload = concatBytes(parts);
  const moovSize = 8 + moovPayload.length;
  const out = new Uint8Array(moovSize);
  writeBoxHeader(out, 0, moovSize, 'moov');
  out.set(moovPayload, 8);
  return out;
}

function buildTrakBox(
  track: Mp4Track,
  chunkOffsets: readonly number[],
  useCo64: boolean,
  movieDuration: number,
): Uint8Array {
  const tkhdBytes = buildFullBox('tkhd', serializeTkhd(track.trackHeader));
  const edtsBytes = buildEdtsBoxIfNeeded(track, movieDuration);
  const mdiaBytes = buildMdiaBox(track, chunkOffsets, useCo64);

  const parts = edtsBytes ? [tkhdBytes, edtsBytes, mdiaBytes] : [tkhdBytes, mdiaBytes];
  const trakPayload = concatBytes(parts);
  return wrapContainer('trak', trakPayload);
}

/**
 * Build the `edts` container (with `elst` child) when the edit list is
 * non-trivial. Returns null when trivial so the caller omits `edts` entirely.
 *
 * Trivial = empty list, or single identity edit (mediaTime=0,
 * segmentDuration=movieDuration, rate=1). Mirrors the existing stco→co64
 * promotion pattern.
 */
function buildEdtsBoxIfNeeded(track: Mp4Track, movieDuration: number): Uint8Array | null {
  const { editList } = track;

  if (isEditListTrivial(editList, movieDuration)) {
    return null;
  }

  const elstPayload = serializeElst(editList);
  if (!elstPayload) {
    return null;
  }

  const elstBox = buildFullBox('elst', elstPayload);
  return wrapContainer('edts', elstBox);
}

function buildMdiaBox(
  track: Mp4Track,
  chunkOffsets: readonly number[],
  useCo64: boolean,
): Uint8Array {
  const mdhdBytes = buildFullBox('mdhd', serializeMdhd(track.mediaHeader));

  // hdlr — use the handler type from the track.
  const handlerName = track.handlerType === 'vide' ? 'VideoHandler' : 'SoundHandler';
  const hdlrPayload = serializeHdlr({ handlerType: track.handlerType, name: handlerName });
  const hdlrBytes = buildFullBox('hdlr', hdlrPayload);

  const minfBytes = buildMinfBox(track, chunkOffsets, useCo64);

  const mdiaPayload = concatBytes([mdhdBytes, hdlrBytes, minfBytes]);
  return wrapContainer('mdia', mdiaPayload);
}

function buildMinfBox(
  track: Mp4Track,
  chunkOffsets: readonly number[],
  useCo64: boolean,
): Uint8Array {
  // smhd (audio) or vmhd (video) media header box.
  let mediaInfoBytes: Uint8Array;
  if (track.handlerType === 'vide') {
    // vmhd: version(1)+flags(3)+graphicsMode(2)+opcolor(6) = 12 bytes payload
    const vmhdPayload = new Uint8Array(12); // all zeros
    mediaInfoBytes = buildFullBox('vmhd', vmhdPayload);
  } else {
    // smhd: version(1)+flags(3)+balance(2)+reserved(2) = 8 bytes payload
    const smhdPayload = new Uint8Array(8); // all zeros = centered balance
    mediaInfoBytes = buildFullBox('smhd', smhdPayload);
  }
  const smhdBytes = mediaInfoBytes;

  // dinf → dref with single self-contained url  entry.
  const drefBytes = buildDref();
  const dinfPayload = concatBytes([drefBytes]);
  const dinfBytes = wrapContainer('dinf', dinfPayload);

  // stbl
  const stblBytes = buildStblBox(track, chunkOffsets, useCo64);

  const minfPayload = concatBytes([smhdBytes, dinfBytes, stblBytes]);
  return wrapContainer('minf', minfPayload);
}

function buildDref(): Uint8Array {
  // dref FullBox: version(1)+flags(3)+entry_count(4) + url  entry
  // url  entry: size(4)+type(4)+version(1)+flags(3=self-contained)
  const urlEntry = new Uint8Array(12);
  const urlView = new DataView(urlEntry.buffer);
  urlView.setUint32(0, 12, false); // size = 12
  urlEntry[4] = 0x75;
  urlEntry[5] = 0x72;
  urlEntry[6] = 0x6c;
  urlEntry[7] = 0x20; // 'url '
  // version=0, flags=0x000001 (self-contained)
  urlEntry[11] = 0x01;

  const drefPayload = new Uint8Array(8 + urlEntry.length);
  const drefView = new DataView(drefPayload.buffer);
  // version=0, flags=0
  drefView.setUint32(4, 1, false); // entry_count = 1
  drefPayload.set(urlEntry, 8);

  return buildFullBox('dref', drefPayload);
}

function buildStblBox(
  track: Mp4Track,
  chunkOffsets: readonly number[],
  useCo64: boolean,
): Uint8Array {
  // Build stsd dispatching on sample entry kind.
  const stsdBytes = buildStsdBox(track);

  const sttsBytes = serializeStts(track.sttsEntries);
  const stscBytes = serializeStsc(track.stscEntries);
  const stszBytes = serializeStsz(track.sampleTable.sampleSizes);
  const offsetBytes = useCo64 ? serializeCo64(chunkOffsets) : serializeStco(chunkOffsets);

  // Emit stss (sync sample table) between stsz and stco/co64 per ISO 14496-12 §8.6 ordering.
  // Only video tracks with B/P frames have a non-null syncSamples set; audio tracks omit it.
  const stblParts: Uint8Array[] = [stsdBytes, sttsBytes, stscBytes, stszBytes];
  if (track.syncSamples !== null) {
    stblParts.push(serializeStss(track.syncSamples));
  }
  stblParts.push(offsetBytes);

  const stblPayload = concatBytes(stblParts);
  return wrapContainer('stbl', stblPayload);
}

/**
 * Build the stsd box from a track's sample entry (audio or video).
 */
function buildStsdBox(track: Mp4Track): Uint8Array {
  const { sampleEntry } = track;

  let sampleEntryBytes: Uint8Array;

  if (sampleEntry.kind === 'audio') {
    const { entry } = sampleEntry;
    const esdsPayload = serializeEsdsPayload(entry.objectTypeIndication, entry.decoderSpecificInfo);
    sampleEntryBytes = serializeMp4a(entry, esdsPayload);
  } else {
    // video
    sampleEntryBytes = serializeVisualSampleEntry(sampleEntry.entry);
  }

  // stsd FullBox: version(1)+flags(3)+entry_count(4) + sample entry bytes
  const payloadSize = 8 + sampleEntryBytes.length;
  const boxSize = 8 + payloadSize;
  const out = new Uint8Array(boxSize);
  const view = new DataView(out.buffer);
  view.setUint32(0, boxSize, false);
  out[4] = 0x73;
  out[5] = 0x74;
  out[6] = 0x73;
  out[7] = 0x64; // 'stsd'
  // version=0, flags=0 at 8-11 (already zero)
  view.setUint32(12, 1, false); // entry_count = 1
  out.set(sampleEntryBytes, 16);
  return out;
}

// ---------------------------------------------------------------------------
// mdat box
// ---------------------------------------------------------------------------

/**
 * Build the mdat box for all tracks in file order (flat layout).
 * Track 0 samples are written first, then track 1, etc.
 */
function buildMdatBox(file: Mp4File, useLargesize: boolean, mdatPayloadSize: number): Uint8Array {
  const { fileBytes } = file;
  const headerSize = useLargesize ? 16 : 8;
  const out = new Uint8Array(headerSize + mdatPayloadSize);

  if (useLargesize) {
    writeLargeBoxHeader(out, 0, headerSize + mdatPayloadSize, 'mdat');
  } else {
    writeBoxHeader(out, 0, headerSize + mdatPayloadSize, 'mdat');
  }

  // Copy each track's samples contiguously in file order.
  let writePos = headerSize;
  for (const track of file.tracks) {
    const { sampleOffsets, sampleSizes, sampleCount } = track.sampleTable;
    for (let i = 0; i < sampleCount; i++) {
      const offset = sampleOffsets[i] ?? 0;
      const size = sampleSizes[i] ?? 0;
      // Use subarray for zero-copy read (Lesson #3).
      out.set(fileBytes.subarray(offset, offset + size), writePos);
      writePos += size;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Offset computation
// ---------------------------------------------------------------------------

/**
 * Compute the new chunk offsets given the position of mdat payload in
 * the output file. Uses sample offset deltas within each chunk to
 * reconstruct the mapping.
 */
function computePatchedOffsets(
  track: Mp4Track,
  fileBytes: Uint8Array,
  mdatPayloadStart: number,
): number[] {
  // Re-derive chunk boundaries from the stsc/sampleOffsets.
  const { stscEntries, sampleTable } = track;
  const { sampleOffsets, sampleSizes, sampleCount } = sampleTable;
  const chunkCount = track.chunkOffsets.length;

  // Find the start of each chunk in the new mdat (samples are written in order).
  // In the output mdat, sample i starts at mdatPayloadStart + sum(sampleSizes[0..i-1]).
  // The chunk offset is the new position of the first sample in that chunk.

  // Build cumulative output byte position per sample.
  const outputPositions = new Float64Array(sampleCount);
  let cumulative = mdatPayloadStart;
  for (let i = 0; i < sampleCount; i++) {
    outputPositions[i] = cumulative;
    cumulative += sampleSizes[i] ?? 0;
  }

  // Map original chunk offsets to their first sample, then to new output positions.
  const patchedChunkOffsets: number[] = [];
  let stscIdx = 0;
  let sampleIdx = 0;

  for (let chunkIdx = 1; chunkIdx <= chunkCount; chunkIdx++) {
    // Advance stscIdx.
    while (
      stscIdx + 1 < stscEntries.length &&
      (stscEntries[stscIdx + 1]?.firstChunk ?? Number.POSITIVE_INFINITY) <= chunkIdx
    ) {
      stscIdx++;
    }

    const samplesInChunk = stscEntries[stscIdx]?.samplesPerChunk ?? 0;

    // New chunk offset = output position of first sample in this chunk.
    patchedChunkOffsets.push(outputPositions[sampleIdx] ?? mdatPayloadStart);

    sampleIdx += samplesInChunk;
  }

  return patchedChunkOffsets;
}

/** Compute the mdat payload size for a single track. */
function computeMdatPayloadSizeForTrack(track: Mp4Track): number {
  let total = 0;
  const { sampleSizes, sampleCount } = track.sampleTable;
  for (let i = 0; i < sampleCount; i++) {
    total += sampleSizes[i] ?? 0;
  }
  return total;
}

/** Compute the total mdat payload size summed over all tracks. */
function computeTotalMdatPayloadSize(file: Mp4File): number {
  return file.tracks.reduce((acc, t) => acc + computeMdatPayloadSizeForTrack(t), 0);
}

// ---------------------------------------------------------------------------
// Box building utilities
// ---------------------------------------------------------------------------

/**
 * Wrap payload in a FullBox (prepend 8-byte box header where payload already
 * contains version+flags as its first 4 bytes).
 *
 * Actually: a FullBox is just a regular box whose payload starts with
 * version(u8)+flags(u24). The payload passed here is the raw FullBox body
 * (already includes version+flags). We just add the 8-byte box header.
 */
function buildFullBox(type: string, payload: Uint8Array): Uint8Array {
  const boxSize = 8 + payload.length;
  const out = new Uint8Array(boxSize);
  writeBoxHeader(out, 0, boxSize, type);
  out.set(payload, 8);
  return out;
}

/**
 * Wrap payload in a container box (size + type + children payload).
 */
function wrapContainer(type: string, payload: Uint8Array): Uint8Array {
  const boxSize = 8 + payload.length;
  const out = new Uint8Array(boxSize);
  writeBoxHeader(out, 0, boxSize, type);
  out.set(payload, 8);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
