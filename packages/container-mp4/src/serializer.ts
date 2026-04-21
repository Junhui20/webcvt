/**
 * MP4 muxer — serialize an Mp4File back to a Uint8Array.
 *
 * Algorithm (per design note §Muxer):
 * 1. Validate: only single-track audio files are supported.
 * 2. Emit in canonical faststart order: ftyp → moov → mdat.
 * 3. Fixed-point offset computation (Trap §16):
 *    a. Serialize moov once to determine its byte size.
 *    b. Compute where mdat payload will start.
 *    c. Patch stco/co64 chunk offsets to the new file positions.
 *    d. Re-serialize moov with patched offsets.
 *    e. If switching stco→co64 changes moov size, iterate (max 2 passes).
 * 4. Write ftyp box (8 + ftyp payload).
 * 5. Write moov box with patched offsets.
 * 6. Write mdat box: 8-byte (or 16-byte largesize) header + raw sample bytes.
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
import { serializeHdlr, serializeMp4a, serializeStsd } from './boxes/hdlr-stsd-mp4a.ts';
import { serializeMdhd, serializeMvhd, serializeTkhd } from './boxes/mvhd-tkhd-mdhd.ts';
import {
  type StscEntry,
  type SttsEntry,
  serializeCo64,
  serializeStco,
  serializeStsc,
  serializeStsz,
  serializeStts,
} from './boxes/stbl.ts';
import { buildUdtaBox } from './boxes/udta-meta-ilst.ts';
import type { Mp4File, Mp4Track } from './parser.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize an Mp4File to a canonical MP4 byte stream.
 *
 * Always emits faststart layout (ftyp → moov → mdat) regardless of the
 * original box order.
 *
 * @throws Mp4EncodeNotImplementedError — input has >1 track or video tracks.
 */
export function serializeMp4(file: Mp4File): Uint8Array {
  const track = file.tracks[0];
  if (!track) {
    return new Uint8Array(0);
  }

  // Step 3a: Fixed-point offset computation.
  // First pass: compute moov size with placeholder offsets (all zeros).
  const ftypBytes = buildFtypBox(file.ftyp);
  const mdatPayloadSize = computeMdatPayloadSize(track, file.fileBytes);
  const useLargesize = mdatPayloadSize + 8 > 0xffffffff;

  // First pass moov (with placeholder chunk offsets = 0).
  let moovBytes = buildMoovBox(track, file, Array(track.chunkOffsets.length).fill(0), false);

  // Compute where mdat payload starts (after ftyp + moov + mdat_header).
  const mdatHeaderSize = useLargesize ? 16 : 8;
  let mdatPayloadOffset = ftypBytes.length + moovBytes.length + mdatHeaderSize;

  // Compute patched chunk offsets.
  let patchedChunkOffsets = computePatchedOffsets(track, file.fileBytes, mdatPayloadOffset);

  // Check if we need co64 (any offset > u32 max).
  const needsCo64 = patchedChunkOffsets.some((o) => o > 0xffffffff);
  // Second pass: re-serialize moov with patched offsets.
  moovBytes = buildMoovBox(track, file, patchedChunkOffsets, needsCo64);

  // If moov size changed (rare — only when switching stco→co64), recompute.
  const mdatPayloadOffset2 = ftypBytes.length + moovBytes.length + mdatHeaderSize;
  if (mdatPayloadOffset2 !== mdatPayloadOffset) {
    mdatPayloadOffset = mdatPayloadOffset2;
    patchedChunkOffsets = computePatchedOffsets(track, file.fileBytes, mdatPayloadOffset);
    moovBytes = buildMoovBox(track, file, patchedChunkOffsets, needsCo64);
  }

  // Assemble output.
  const mdatBox = buildMdatBox(track, file.fileBytes, useLargesize, mdatPayloadSize);

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
  track: Mp4Track,
  file: Mp4File,
  chunkOffsets: readonly number[],
  useCo64: boolean,
): Uint8Array {
  const mvhdBytes = buildFullBox('mvhd', serializeMvhd(file.movieHeader));
  const trakBytes = buildTrakBox(track, chunkOffsets, useCo64, file.movieHeader.duration);

  // Insert udta after trak (canonical ffmpeg/mp4box order). Returns null when empty.
  const udtaBytes = buildUdtaBox(file.metadata, file.udtaOpaque);

  const parts: Uint8Array[] = [mvhdBytes, trakBytes];
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

  // hdlr
  const hdlrPayload = serializeHdlr({ handlerType: 'soun', name: 'SoundHandler' });
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
  // smhd: version(1)+flags(3)+balance(2)+reserved(2) = 8 bytes payload
  const smhdPayload = new Uint8Array(8); // all zeros = centered balance
  const smhdBytes = buildFullBox('smhd', smhdPayload);

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
  // Build stsd (with mp4a → esds).
  const esdsPayload = serializeEsdsPayload(
    track.audioSampleEntry.objectTypeIndication,
    track.audioSampleEntry.decoderSpecificInfo,
  );
  const mp4aBytes = serializeMp4a(track.audioSampleEntry, esdsPayload);
  const stsdBytes = serializeStsd(mp4aBytes);

  const sttsBytes = serializeStts(track.sttsEntries);
  const stscBytes = serializeStsc(track.stscEntries);
  const stszBytes = serializeStsz(track.sampleTable.sampleSizes);
  const offsetBytes = useCo64 ? serializeCo64(chunkOffsets) : serializeStco(chunkOffsets);

  const stblPayload = concatBytes([stsdBytes, sttsBytes, stscBytes, stszBytes, offsetBytes]);
  return wrapContainer('stbl', stblPayload);
}

// ---------------------------------------------------------------------------
// mdat box
// ---------------------------------------------------------------------------

function buildMdatBox(
  track: Mp4Track,
  fileBytes: Uint8Array,
  useLargesize: boolean,
  mdatPayloadSize: number,
): Uint8Array {
  const headerSize = useLargesize ? 16 : 8;
  const out = new Uint8Array(headerSize + mdatPayloadSize);

  if (useLargesize) {
    writeLargeBoxHeader(out, 0, headerSize + mdatPayloadSize, 'mdat');
  } else {
    writeBoxHeader(out, 0, headerSize + mdatPayloadSize, 'mdat');
  }

  // Copy sample bytes in sample order from original fileBytes.
  let writePos = headerSize;
  const { sampleOffsets, sampleSizes, sampleCount } = track.sampleTable;
  for (let i = 0; i < sampleCount; i++) {
    const offset = sampleOffsets[i] ?? 0;
    const size = sampleSizes[i] ?? 0;
    // Use subarray for zero-copy read, then set into output (Lesson #3).
    out.set(fileBytes.subarray(offset, offset + size), writePos);
    writePos += size;
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

function computeMdatPayloadSize(track: Mp4Track, _fileBytes: Uint8Array): number {
  let total = 0;
  const { sampleSizes, sampleCount } = track.sampleTable;
  for (let i = 0; i < sampleCount; i++) {
    total += sampleSizes[i] ?? 0;
  }
  return total;
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
