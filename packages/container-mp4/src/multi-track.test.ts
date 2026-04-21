/**
 * Multi-track support tests — sub-pass C.
 *
 * Test plan (22 tests per design spec §14):
 *  1.  Parse 2-track (audio+video) — order preserved
 *  2.  Parse 3-track (audio+video+audio dub) — distinct trackIds
 *  3.  Parse multi-audio-only
 *  4.  Parse multi-video-only
 *  5.  Parse fragmented multi-track (moof with 2 traf)
 *  6.  findAudioTrack returns first soun
 *  7.  findVideoTrack returns first vide
 *  8.  findTrackById positive + negative
 *  9.  findTracksByKind 2-dub returns length 2
 *  10. Round-trip 2-track byte-identical (parse→serialize→re-parse)
 *  11. Reject duplicate track_ID
 *  12. Reject track_ID = 0
 *  13. Reject empty moov (0 trak)
 *  14. Reject track count > 64
 *  15. Reject unsupported handler ('subt')
 *  16. Mp4AmbiguousTrackError on multi-track iterator without selector
 *  17. Iterator with explicit audio track yields audio samples only
 *  18. Iterator with explicit video track yields video samples, correct isKeyframe
 *  19. Per-track timescales respected (audio@44100, video@30000)
 *  20. Regression: single-track M4A fixtures still pass
 *  21. Backend audio/mp4 → audio/mp4 on 2-track input drops video
 *  22. Backend throws Mp4NoAudioTrackError when no audio track
 */

import { loadFixture } from '@webcvt/test-utils';
import { describe, expect, it } from 'vitest';
import {
  buildAvcCPayload,
  buildAvcSampleEntry,
  buildVisualSampleEntryHeader,
} from './_test-helpers/build-video-stsd.ts';
import { Mp4Backend } from './backend.ts';
import {
  Mp4AmbiguousTrackError,
  Mp4DuplicateTrackIdError,
  Mp4InvalidBoxError,
  Mp4NoAudioTrackError,
  Mp4NoTracksError,
  Mp4TooManyTracksError,
  Mp4TrackIdZeroError,
  Mp4TrackNotFoundError,
  Mp4UnsupportedTrackTypeError,
} from './errors.ts';
import { parseMp4 } from './parser.ts';
import {
  iterateAudioSamplesAuto,
  iterateFragmentedAudioSamples,
  iterateSamples,
  iterateVideoSamples,
} from './sample-iterator.ts';
import { serializeMp4 } from './serializer.ts';
import {
  findAudioTrack,
  findTrackById,
  findTracksByKind,
  findVideoTrack,
} from './track-selectors.ts';

// ---------------------------------------------------------------------------
// Minimal multi-track MP4 byte builder
// ---------------------------------------------------------------------------

/**
 * Low-level byte helpers (mirrors the pattern in build-fmp4.ts and build-video-stsd.ts).
 * Defined locally to keep the test file self-contained per the clean-room requirement.
 */

function u32be(buf: Uint8Array, offset: number, v: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, v >>> 0, false);
}

function u16be(buf: Uint8Array, offset: number, v: number): void {
  buf[offset] = (v >> 8) & 0xff;
  buf[offset + 1] = v & 0xff;
}

function fourCC(buf: Uint8Array, offset: number, s: string): void {
  for (let i = 0; i < 4; i++) {
    buf[offset + i] = (s.charCodeAt(i) ?? 0x20) & 0xff;
  }
}

function wrapBox(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const total = payloads.reduce((s, p) => s + p.length, 0);
  const size = 8 + total;
  const out = new Uint8Array(size);
  u32be(out, 0, size);
  fourCC(out, 4, type);
  let off = 8;
  for (const p of payloads) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Build an ftyp box with M4A brand for classic MP4. */
function buildFtyp(majorBrand = 'isom'): Uint8Array {
  const compatible = ['isom', 'mp42'];
  const payload = new Uint8Array(8 + compatible.length * 4);
  fourCC(payload, 0, majorBrand);
  u32be(payload, 4, 0);
  for (let i = 0; i < compatible.length; i++) {
    fourCC(payload, 8 + i * 4, compatible[i] ?? 'isom');
  }
  return wrapBox('ftyp', payload);
}

/** Build mvhd v0 with minimal required fields. */
function buildMvhd(timescale = 1000, duration = 0, nextTrackId = 3): Uint8Array {
  const payload = new Uint8Array(100);
  u32be(payload, 12, timescale);
  u32be(payload, 16, duration);
  u32be(payload, 20, 0x00010000); // rate=1.0
  payload[24] = 0x01; // volume
  u32be(payload, 36, 0x00010000); // matrix a
  u32be(payload, 52, 0x00010000); // matrix d
  u32be(payload, 68, 0x40000000); // matrix w
  u32be(payload, 96, nextTrackId);
  return wrapBox('mvhd', payload);
}

/** Build tkhd v0 for a given trackId. */
function buildTkhd(trackId: number, duration = 0, volume = 0x0100): Uint8Array {
  const payload = new Uint8Array(92);
  payload[3] = 0x03; // flags: track_enabled | track_in_movie
  u32be(payload, 12, trackId);
  u32be(payload, 20, duration);
  u16be(payload, 32, volume);
  u32be(payload, 36, 0x00010000); // matrix a
  u32be(payload, 52, 0x00010000); // matrix d
  u32be(payload, 68, 0x40000000); // matrix w
  return wrapBox('tkhd', payload);
}

/** Build mdhd v0. */
function buildMdhd(timescale: number, duration = 0): Uint8Array {
  const payload = new Uint8Array(24);
  u32be(payload, 12, timescale);
  u32be(payload, 16, duration);
  payload[20] = 0x55;
  payload[21] = 0xc4; // 'und'
  return wrapBox('mdhd', payload);
}

/** Build hdlr FullBox with given handler type. */
function buildHdlr(handlerType: string, name = 'Handler'): Uint8Array {
  const nameBytes = new TextEncoder().encode(`${name}\0`);
  const payload = new Uint8Array(4 + 4 + 4 + 12 + nameBytes.length);
  fourCC(payload, 8, handlerType);
  payload.set(nameBytes, 24);
  return wrapBox('hdlr', payload);
}

/** Build smhd (audio media header). */
function buildSmhd(): Uint8Array {
  return wrapBox('smhd', new Uint8Array(8));
}

/** Build vmhd (video media header). */
function buildVmhd(): Uint8Array {
  return wrapBox('vmhd', new Uint8Array(12));
}

/** Build dref with single self-contained url  entry. */
function buildDref(): Uint8Array {
  const urlEntry = new Uint8Array(12);
  u32be(urlEntry, 0, 12);
  fourCC(urlEntry, 4, 'url ');
  urlEntry[11] = 0x01;
  const payload = new Uint8Array(8 + 12);
  u32be(payload, 4, 1);
  payload.set(urlEntry, 8);
  return wrapBox('dref', payload);
}

/**
 * Build a minimal esds FullBox.
 * Uses the same byte construction as build-fmp4.ts to guarantee parser acceptance.
 */
function buildEsds(objectTypeIndication = 0x40): Uint8Array {
  // AudioSpecificConfig: AAC-LC 44100 Hz mono (2 bytes).
  const asc = new Uint8Array([0x11, 0x90]);
  const decoderSpecificInfo = new Uint8Array([0x05, asc.length, ...asc]);
  const decoderConfig = new Uint8Array([
    0x04,
    13 + decoderSpecificInfo.length,
    objectTypeIndication,
    0x15, // streamType=audio(5)<<2|upstream=0|reserved=1
    0x00,
    0x00,
    0x00, // bufferSizeDB
    0x00,
    0x00,
    0x00,
    0x00, // maxBitrate
    0x00,
    0x00,
    0x00,
    0x00, // avgBitrate
    ...decoderSpecificInfo,
  ]);
  const slConfig = new Uint8Array([0x06, 0x01, 0x02]);
  const esDescriptor = new Uint8Array([
    0x03,
    3 + decoderConfig.length + slConfig.length,
    0x00,
    0x01, // ES_ID
    0x00, // flags
    ...decoderConfig,
    ...slConfig,
  ]);
  const payload = new Uint8Array(4 + esDescriptor.length);
  payload.set(esDescriptor, 4);
  return wrapBox('esds', payload);
}

/** Build mp4a sample entry box. */
function buildMp4a(channelCount = 1, sampleRate = 44100): Uint8Array {
  const esdsBox = buildEsds(0x40);
  const payload = new Uint8Array(28 + esdsBox.length);
  payload[7] = 0x01; // data_reference_index=1
  u32be(payload, 16, (channelCount << 16) | 16); // channelcount | samplesize=16
  u32be(payload, 24, sampleRate << 16); // samplerate Q16.16
  payload.set(esdsBox, 28);
  return wrapBox('mp4a', payload);
}

/** Build stsd FullBox with one sample entry. */
function buildStsdAudio(channelCount = 1, _sampleRate = 44100): Uint8Array {
  const mp4aBox = buildMp4a(channelCount, _sampleRate);
  const payload = new Uint8Array(8 + mp4aBox.length);
  u32be(payload, 4, 1); // entry_count
  payload.set(mp4aBox, 8);
  return wrapBox('stsd', payload);
}

/** Build stsd FullBox with one avc1 video sample entry. */
function buildStsdVideo(width = 320, height = 240): Uint8Array {
  const avcCPayload = buildAvcCPayload(0x42, 0xe0, 0x1e);
  const avcEntry = buildAvcSampleEntry('avc1', width, height, avcCPayload);
  const payload = new Uint8Array(8 + avcEntry.length);
  u32be(payload, 4, 1);
  payload.set(avcEntry, 8);
  return wrapBox('stsd', payload);
}

/** Build an empty FullBox table (stts/stsc/stco with entry_count=0, or stsz). */
function buildEmptyTable(type: string): Uint8Array {
  if (type === 'stsz') return wrapBox('stsz', new Uint8Array(12));
  return wrapBox(type, new Uint8Array(8));
}

interface TrackSample {
  data: Uint8Array;
  durationTicks: number;
}

interface BuildTrackOptions {
  trackId: number;
  handlerType: 'soun' | 'vide' | string;
  mediaTimescale: number;
  samples: TrackSample[];
  /** Provide pre-built stsd box bytes; if omitted, a default is built. */
  stsdBytes?: Uint8Array;
  /** Width/height for video tracks (for stsd). */
  width?: number;
  height?: number;
  channelCount?: number;
}

/**
 * Build a complete trak box with a classic sample table.
 * Returns {trakBox, sampleDataParts} where sampleDataParts is the ordered
 * list of sample Uint8Arrays to be placed in mdat.
 */
function buildClassicTrak(
  opts: BuildTrackOptions,
  mdatStart: number,
): { trakBox: Uint8Array; sampleData: Uint8Array } {
  const { trackId, handlerType, mediaTimescale, samples } = opts;

  // Build sample tables.
  // stts: one entry per distinct delta (simplified: one entry for all samples).
  // Using uniform duration for simplicity.
  const sampleDuration = samples[0]?.durationTicks ?? 1024;
  const sttsPayload = new Uint8Array(8 + 8); // entry_count=1 + (sample_count, delta)
  u32be(sttsPayload, 4, 1); // entry_count=1
  u32be(sttsPayload, 8, samples.length); // sample_count
  u32be(sttsPayload, 12, sampleDuration); // sample_delta
  const sttsBox = wrapBox('stts', sttsPayload);

  // stsc: one chunk per sample for simplicity (chunk_count = sample_count).
  const stscPayload = new Uint8Array(8 + 12); // 1 entry
  u32be(stscPayload, 4, 1); // entry_count=1
  u32be(stscPayload, 8, 1); // first_chunk=1
  u32be(stscPayload, 12, 1); // samples_per_chunk=1
  u32be(stscPayload, 16, 1); // sample_description_index=1
  const stscBox = wrapBox('stsc', stscPayload);

  // stsz: one size per sample.
  const stszPayload = new Uint8Array(12 + samples.length * 4);
  // sample_size=0 (variable), sample_count
  u32be(stszPayload, 8, samples.length);
  for (let i = 0; i < samples.length; i++) {
    u32be(stszPayload, 12 + i * 4, samples[i]?.data.length ?? 0);
  }
  const stszBox = wrapBox('stsz', stszPayload);

  // stco: one offset per sample/chunk.
  const stcoPayload = new Uint8Array(8 + samples.length * 4);
  u32be(stcoPayload, 4, samples.length);
  let bytePos = mdatStart;
  for (let i = 0; i < samples.length; i++) {
    u32be(stcoPayload, 8 + i * 4, bytePos);
    bytePos += samples[i]?.data.length ?? 0;
  }
  const stcoBox = wrapBox('stco', stcoPayload);

  // stsd
  let stsdBox: Uint8Array;
  if (opts.stsdBytes) {
    stsdBox = opts.stsdBytes;
  } else if (handlerType === 'soun') {
    stsdBox = buildStsdAudio(opts.channelCount ?? 1, mediaTimescale);
  } else {
    stsdBox = buildStsdVideo(opts.width ?? 320, opts.height ?? 240);
  }

  const stblBox = wrapBox('stbl', stsdBox, sttsBox, stscBox, stszBox, stcoBox);

  const mediaInfo = handlerType === 'soun' ? buildSmhd() : buildVmhd();
  const dinf = wrapBox('dinf', buildDref());
  const minfBox = wrapBox('minf', mediaInfo, dinf, stblBox);
  const mdiaBox = wrapBox('mdia', buildMdhd(mediaTimescale), buildHdlr(handlerType), minfBox);
  const trakBox = wrapBox('trak', buildTkhd(trackId), mdiaBox);

  // Concatenate all sample data.
  const sampleData = concat(...samples.map((s) => s.data));

  return { trakBox, sampleData };
}

interface MultiTrackOptions {
  tracks: BuildTrackOptions[];
  movieTimescale?: number;
  nextTrackId?: number;
}

/**
 * Build a minimal classic (non-fragmented) multi-track MP4 byte stream.
 *
 * mdat layout: track[0] samples, then track[1] samples, etc.
 */
function buildMultiTrackMp4(opts: MultiTrackOptions): Uint8Array {
  const movieTimescale = opts.movieTimescale ?? 1000;

  const ftypBox = buildFtyp('isom');

  // We need to know where mdat payload starts before building track boxes,
  // but moov size depends on track boxes. Use two-pass.

  // Pass 1: build placeholder trak boxes with mdatStart=0 to measure moov size.
  const trakResults0 = opts.tracks.map((t) => buildClassicTrak(t, 0));
  const moovParts0 = [buildMvhd(movieTimescale, 0, opts.nextTrackId ?? opts.tracks.length + 1)];
  for (const r of trakResults0) moovParts0.push(r.trakBox);
  const moovPayload0 = concat(...moovParts0);
  const moovSize0 = 8 + moovPayload0.length;
  // mdat payload start = ftyp.length + moov.length + mdat_header(8)
  const mdatStart = ftypBox.length + moovSize0 + 8;

  // Pass 2: build real trak boxes with correct mdatStart offsets.
  // Each track's samples start right after the previous track's samples.
  const trakResults: Array<{ trakBox: Uint8Array; sampleData: Uint8Array }> = [];
  let trackByteOffset = mdatStart;
  for (const t of opts.tracks) {
    const result = buildClassicTrak(t, trackByteOffset);
    trakResults.push(result);
    trackByteOffset += result.sampleData.length;
  }

  const moovParts = [buildMvhd(movieTimescale, 0, opts.nextTrackId ?? opts.tracks.length + 1)];
  for (const r of trakResults) moovParts.push(r.trakBox);
  const moovPayload = concat(...moovParts);
  const moovBox = wrapBox('moov', moovPayload);

  // Build mdat: all track sample data contiguous.
  const allSampleData = concat(...trakResults.map((r) => r.sampleData));
  const mdatBox = wrapBox('mdat', allSampleData);

  return concat(ftypBox, moovBox, mdatBox);
}

/** Build a handler-only trak (no valid stsd) to test unsupported handler rejection. */
function buildTrakWithHandler(
  trackId: number,
  handlerType: string,
  mediaTimescale = 1000,
): Uint8Array {
  // Use a valid audio stsd so parseStsd doesn't fail, but override hdlr.
  const stsdBox = buildStsdAudio(1, mediaTimescale);
  const stcoBox = buildEmptyTable('stco');
  const stblBox = wrapBox(
    'stbl',
    stsdBox,
    buildEmptyTable('stts'),
    buildEmptyTable('stsc'),
    buildEmptyTable('stsz'),
    stcoBox,
  );
  const dinf = wrapBox('dinf', buildDref());
  const minfBox = wrapBox('minf', buildSmhd(), dinf, stblBox);
  const mdiaBox = wrapBox('mdia', buildMdhd(mediaTimescale), buildHdlr(handlerType), minfBox);
  return wrapBox('trak', buildTkhd(trackId), mdiaBox);
}

/** Build a complete MP4 with a single trak using a custom handler type. */
function buildMp4WithHandler(handlerType: string): Uint8Array {
  const ftypBox = buildFtyp('isom');
  const trakBox = buildTrakWithHandler(1, handlerType);
  const moovPayload = concat(buildMvhd(), trakBox);
  const moovBox = wrapBox('moov', moovPayload);
  const mdatBox = wrapBox('mdat', new Uint8Array(0));
  return concat(ftypBox, moovBox, mdatBox);
}

/** Build a minimal fMP4 with two trafs per moof (audio + video tracks). */
function buildMultiTrackFmp4(): Uint8Array {
  // Two tracks: audio trackId=1, video trackId=2.
  // Single moof with two traf, then one mdat with both tracks' samples.
  const audioSample = new Uint8Array([0xaa, 0xbb]);
  const videoSample = new Uint8Array([0xcc, 0xdd]);

  const ftypBox = buildFtyp('iso5');

  // Build audio trak (empty stbl).
  const audioStsd = buildStsdAudio(1, 44100);
  const audioStbl = wrapBox(
    'stbl',
    audioStsd,
    buildEmptyTable('stts'),
    buildEmptyTable('stsc'),
    buildEmptyTable('stsz'),
    buildEmptyTable('stco'),
  );
  const audioDinf = wrapBox('dinf', buildDref());
  const audioMinf = wrapBox('minf', buildSmhd(), audioDinf, audioStbl);
  const audioMdia = wrapBox('mdia', buildMdhd(44100), buildHdlr('soun'), audioMinf);
  const audioTrak = wrapBox('trak', buildTkhd(1), audioMdia);

  // Build video trak (empty stbl).
  const videoStsd = buildStsdVideo(320, 240);
  const videoStbl = wrapBox(
    'stbl',
    videoStsd,
    buildEmptyTable('stts'),
    buildEmptyTable('stsc'),
    buildEmptyTable('stsz'),
    buildEmptyTable('stco'),
  );
  const videoDinf = wrapBox('dinf', buildDref());
  const videoMinf = wrapBox('minf', buildVmhd(), videoDinf, videoStbl);
  const videoMdia = wrapBox('mdia', buildMdhd(30000), buildHdlr('vide'), videoMinf);
  const videoTrak = wrapBox('trak', buildTkhd(2), videoMdia);

  // trex for each track.
  function buildTrex(trackId: number): Uint8Array {
    const payload = new Uint8Array(24);
    u32be(payload, 4, trackId);
    u32be(payload, 8, 1);
    u32be(payload, 12, 1024); // default_sample_duration
    return wrapBox('trex', payload);
  }

  const mvexBox = wrapBox('mvex', buildTrex(1), buildTrex(2));

  const mvhdBox = buildMvhd(1000, 0, 3);
  const moovBox = wrapBox('moov', mvhdBox, audioTrak, videoTrak, mvexBox);

  // Build a single moof with two traf.
  // mfhd
  const mfhdPayload = new Uint8Array(8);
  u32be(mfhdPayload, 4, 1);
  const mfhdBox = wrapBox('mfhd', mfhdPayload);

  // We need to know moof size to compute data_offset.
  // Strategy: build traf1 and traf2 first, then compute moof size, then patch.

  function buildTfhd(trackId: number): Uint8Array {
    const payload = new Uint8Array(8); // version+flags(4)+track_ID(4)
    // default-base-is-moof flag = 0x020000
    payload[1] = 0x02;
    u32be(payload, 4, trackId);
    return wrapBox('tfhd', payload);
  }

  function buildTfdt(baseTime: number): Uint8Array {
    const payload = new Uint8Array(8);
    u32be(payload, 4, baseTime);
    return wrapBox('tfdt', payload);
  }

  function buildTrun(sampleSize: number, dataOffset: number): Uint8Array {
    // flags: data-offset-present(0x001) | sample-size-present(0x200) | sample-duration-present(0x100)
    const flags = 0x000301;
    const payload = new Uint8Array(8 + 4 + 8); // prefix(8) + data_offset(4) + 1 sample(8)
    payload[1] = (flags >> 16) & 0xff;
    payload[2] = (flags >> 8) & 0xff;
    payload[3] = flags & 0xff;
    u32be(payload, 4, 1); // sample_count=1
    // data_offset (signed i32)
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    view.setInt32(8, dataOffset, false);
    u32be(payload, 12, 1024); // sample_duration
    u32be(payload, 16, sampleSize); // sample_size
    return wrapBox('trun', payload);
  }

  // Build trial traf1 and traf2 with dataOffset=0 to measure moof size.
  const traf1Trial = wrapBox('traf', buildTfhd(1), buildTfdt(0), buildTrun(audioSample.length, 0));
  const traf2Trial = wrapBox('traf', buildTfhd(2), buildTfdt(0), buildTrun(videoSample.length, 0));
  const moofTrial = wrapBox('moof', mfhdBox, traf1Trial, traf2Trial);
  const moofSize = moofTrial.length;

  // data_offset for traf1: moof_size + 8 (mdat header)
  const audioDataOffset = moofSize + 8;
  // data_offset for traf2: moof_size + 8 + audioSample.length
  const videoDataOffset = moofSize + 8 + audioSample.length;

  const traf1 = wrapBox(
    'traf',
    buildTfhd(1),
    buildTfdt(0),
    buildTrun(audioSample.length, audioDataOffset),
  );
  const traf2 = wrapBox(
    'traf',
    buildTfhd(2),
    buildTfdt(0),
    buildTrun(videoSample.length, videoDataOffset),
  );
  const moofBox = wrapBox('moof', mfhdBox, traf1, traf2);

  const mdatBox = wrapBox('mdat', concat(audioSample, videoSample));

  return concat(ftypBox, moovBox, moofBox, mdatBox);
}

// ---------------------------------------------------------------------------
// Helpers to build invalid MP4s for rejection tests
// ---------------------------------------------------------------------------

/** Build an MP4 with N trak boxes, all with trackId=1 (duplicate). */
function buildMp4WithDuplicateTrackId(): Uint8Array {
  const ftypBox = buildFtyp('isom');
  const track = {
    trackId: 1,
    handlerType: 'soun' as const,
    mediaTimescale: 44100,
    samples: [{ data: new Uint8Array([0x01]), durationTicks: 1024 }],
  };
  const result1 = buildClassicTrak(track, 100);
  // Build second trak also with trackId=1.
  const result2 = buildClassicTrak(track, 101);
  const moovPayload = concat(buildMvhd(), result1.trakBox, result2.trakBox);
  const moovBox = wrapBox('moov', moovPayload);
  const mdatBox = wrapBox('mdat', concat(result1.sampleData, result2.sampleData));
  return concat(ftypBox, moovBox, mdatBox);
}

/** Build an MP4 with one trak that has trackId=0. */
function buildMp4WithTrackIdZero(): Uint8Array {
  const ftypBox = buildFtyp('isom');
  const track = {
    trackId: 0, // invalid!
    handlerType: 'soun' as const,
    mediaTimescale: 44100,
    samples: [{ data: new Uint8Array([0x01]), durationTicks: 1024 }],
  };
  const result = buildClassicTrak(track, 100);
  const moovPayload = concat(buildMvhd(), result.trakBox);
  const moovBox = wrapBox('moov', moovPayload);
  const mdatBox = wrapBox('mdat', result.sampleData);
  return concat(ftypBox, moovBox, mdatBox);
}

/** Build an MP4 moov with zero trak boxes. */
function buildMp4WithNoTracks(): Uint8Array {
  const ftypBox = buildFtyp('isom');
  const moovPayload = buildMvhd();
  const moovBox = wrapBox('moov', moovPayload);
  const mdatBox = wrapBox('mdat', new Uint8Array(0));
  return concat(ftypBox, moovBox, mdatBox);
}

/** Build an MP4 with `count` trak boxes. */
function buildMp4WithNTracks(count: number): Uint8Array {
  const ftypBox = buildFtyp('isom');
  const trakBoxes: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const track = {
      trackId: i + 1,
      handlerType: 'soun' as const,
      mediaTimescale: 44100,
      samples: [{ data: new Uint8Array([i & 0xff]), durationTicks: 1024 }],
    };
    const { trakBox } = buildClassicTrak(track, 9999);
    trakBoxes.push(trakBox);
  }
  const moovPayload = concat(buildMvhd(1000, 0, count + 1), ...trakBoxes);
  const moovBox = wrapBox('moov', moovPayload);
  const mdatBox = wrapBox('mdat', new Uint8Array(count));
  return concat(ftypBox, moovBox, mdatBox);
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Multi-track parser — C.1', () => {
  it('test 1: parses 2-track (audio+video) in file order', () => {
    const audioSample = { data: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]), durationTicks: 1024 };
    const videoSample = {
      data: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x00]),
      durationTicks: 3000,
    };
    const bytes = buildMultiTrackMp4({
      tracks: [
        { trackId: 1, handlerType: 'soun', mediaTimescale: 44100, samples: [audioSample] },
        { trackId: 2, handlerType: 'vide', mediaTimescale: 30000, samples: [videoSample] },
      ],
    });

    const file = parseMp4(bytes);
    expect(file.tracks).toHaveLength(2);
    // File order preserved: audio first, then video.
    expect(file.tracks[0]?.handlerType).toBe('soun');
    expect(file.tracks[1]?.handlerType).toBe('vide');
    expect(file.tracks[0]?.trackId).toBe(1);
    expect(file.tracks[1]?.trackId).toBe(2);
  });

  it('test 2: parses 3-track (audio+video+audio dub) with distinct trackIds', () => {
    const sample = { data: new Uint8Array([0x01]), durationTicks: 1024 };
    const bytes = buildMultiTrackMp4({
      tracks: [
        { trackId: 1, handlerType: 'soun', mediaTimescale: 44100, samples: [sample] },
        { trackId: 2, handlerType: 'vide', mediaTimescale: 30000, samples: [sample] },
        { trackId: 3, handlerType: 'soun', mediaTimescale: 44100, samples: [sample] },
      ],
    });

    const file = parseMp4(bytes);
    expect(file.tracks).toHaveLength(3);
    const ids = file.tracks.map((t) => t.trackId);
    expect(ids).toEqual([1, 2, 3]);
  });

  it('test 3: parses multi-audio-only (2 soun tracks)', () => {
    const sample = { data: new Uint8Array([0x01]), durationTicks: 1024 };
    const bytes = buildMultiTrackMp4({
      tracks: [
        { trackId: 1, handlerType: 'soun', mediaTimescale: 44100, samples: [sample] },
        { trackId: 2, handlerType: 'soun', mediaTimescale: 44100, samples: [sample] },
      ],
    });

    const file = parseMp4(bytes);
    expect(file.tracks).toHaveLength(2);
    expect(file.tracks.every((t) => t.handlerType === 'soun')).toBe(true);
  });

  it('test 4: parses multi-video-only (2 vide tracks)', () => {
    const sample = { data: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65]), durationTicks: 3000 };
    const bytes = buildMultiTrackMp4({
      tracks: [
        { trackId: 1, handlerType: 'vide', mediaTimescale: 30000, samples: [sample] },
        { trackId: 2, handlerType: 'vide', mediaTimescale: 30000, samples: [sample] },
      ],
    });

    const file = parseMp4(bytes);
    expect(file.tracks).toHaveLength(2);
    expect(file.tracks.every((t) => t.handlerType === 'vide')).toBe(true);
  });

  it('test 5: parses fragmented multi-track (moof with 2 traf)', () => {
    const bytes = buildMultiTrackFmp4();
    const file = parseMp4(bytes);
    expect(file.isFragmented).toBe(true);
    expect(file.tracks).toHaveLength(2);
    expect(file.tracks[0]?.handlerType).toBe('soun');
    expect(file.tracks[1]?.handlerType).toBe('vide');
    // Each moof should have 2 trackFragments.
    expect(file.fragments).toHaveLength(1);
    expect(file.fragments[0]?.trackFragments).toHaveLength(2);
  });

  it('test 11: rejects duplicate track_ID', () => {
    const bytes = buildMp4WithDuplicateTrackId();
    expect(() => parseMp4(bytes)).toThrow(Mp4DuplicateTrackIdError);
  });

  it('test 12: rejects track_ID = 0', () => {
    const bytes = buildMp4WithTrackIdZero();
    expect(() => parseMp4(bytes)).toThrow(Mp4TrackIdZeroError);
  });

  it('test 13: rejects empty moov (0 trak)', () => {
    const bytes = buildMp4WithNoTracks();
    expect(() => parseMp4(bytes)).toThrow(Mp4NoTracksError);
  });

  it('test 14: rejects track count > 64', () => {
    // 65 tracks should trigger Mp4TooManyTracksError.
    const bytes = buildMp4WithNTracks(65);
    expect(() => parseMp4(bytes)).toThrow(Mp4TooManyTracksError);
  });

  it('test 15: rejects unsupported handler type (subt)', () => {
    const bytes = buildMp4WithHandler('subt');
    expect(() => parseMp4(bytes)).toThrow(Mp4UnsupportedTrackTypeError);
  });

  it('test 19: per-track timescales are independent', () => {
    const audioSample = { data: new Uint8Array([0x01]), durationTicks: 1024 };
    const videoSample = {
      data: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65]),
      durationTicks: 3000,
    };
    const bytes = buildMultiTrackMp4({
      tracks: [
        { trackId: 1, handlerType: 'soun', mediaTimescale: 44100, samples: [audioSample] },
        { trackId: 2, handlerType: 'vide', mediaTimescale: 30000, samples: [videoSample] },
      ],
    });

    const file = parseMp4(bytes);
    expect(file.tracks[0]?.mediaHeader.timescale).toBe(44100);
    expect(file.tracks[1]?.mediaHeader.timescale).toBe(30000);
  });
});

describe('Track selectors — C.1', () => {
  /** Helper: build a 2-track (audio+video) parsed file. */
  function buildTwoTrackFile() {
    const audioSample = { data: new Uint8Array([0x01]), durationTicks: 1024 };
    const videoSample = {
      data: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65]),
      durationTicks: 3000,
    };
    const bytes = buildMultiTrackMp4({
      tracks: [
        { trackId: 1, handlerType: 'soun', mediaTimescale: 44100, samples: [audioSample] },
        { trackId: 2, handlerType: 'vide', mediaTimescale: 30000, samples: [videoSample] },
      ],
    });
    return parseMp4(bytes);
  }

  it('test 6: findAudioTrack returns first soun track', () => {
    const file = buildTwoTrackFile();
    const audio = findAudioTrack(file);
    expect(audio).not.toBeNull();
    expect(audio?.handlerType).toBe('soun');
    expect(audio?.trackId).toBe(1);
  });

  it('test 7: findVideoTrack returns first vide track', () => {
    const file = buildTwoTrackFile();
    const video = findVideoTrack(file);
    expect(video).not.toBeNull();
    expect(video?.handlerType).toBe('vide');
    expect(video?.trackId).toBe(2);
  });

  it('test 8: findTrackById returns track for known id, null for unknown', () => {
    const file = buildTwoTrackFile();
    expect(findTrackById(file, 1)?.trackId).toBe(1);
    expect(findTrackById(file, 2)?.trackId).toBe(2);
    expect(findTrackById(file, 99)).toBeNull();
  });

  it('test 9: findTracksByKind returns both audio tracks in a 2-dub file', () => {
    const sample = { data: new Uint8Array([0x01]), durationTicks: 1024 };
    const bytes = buildMultiTrackMp4({
      tracks: [
        { trackId: 1, handlerType: 'soun', mediaTimescale: 44100, samples: [sample] },
        { trackId: 2, handlerType: 'soun', mediaTimescale: 44100, samples: [sample] },
      ],
    });
    const file = parseMp4(bytes);
    const audioTracks = findTracksByKind(file, 'audio');
    expect(audioTracks).toHaveLength(2);
    expect(findTracksByKind(file, 'video')).toHaveLength(0);
  });

  it('findAudioTrack returns null when file has no audio track', () => {
    const sample = { data: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65]), durationTicks: 3000 };
    const bytes = buildMultiTrackMp4({
      tracks: [{ trackId: 1, handlerType: 'vide', mediaTimescale: 30000, samples: [sample] }],
    });
    const file = parseMp4(bytes);
    expect(findAudioTrack(file)).toBeNull();
  });

  it('findVideoTrack returns null when file has no video track', () => {
    const sample = { data: new Uint8Array([0x01]), durationTicks: 1024 };
    const bytes = buildMultiTrackMp4({
      tracks: [{ trackId: 1, handlerType: 'soun', mediaTimescale: 44100, samples: [sample] }],
    });
    const file = parseMp4(bytes);
    expect(findVideoTrack(file)).toBeNull();
  });
});

describe('Multi-track serializer — C.2', () => {
  it('test 10: round-trip 2-track: parse→serialize→re-parse preserves track structure', () => {
    const audioSample = { data: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]), durationTicks: 1024 };
    const videoSample = {
      data: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x00]),
      durationTicks: 3000,
    };
    const bytes = buildMultiTrackMp4({
      tracks: [
        { trackId: 1, handlerType: 'soun', mediaTimescale: 44100, samples: [audioSample] },
        { trackId: 2, handlerType: 'vide', mediaTimescale: 30000, samples: [videoSample] },
      ],
    });

    const original = parseMp4(bytes);
    const serialized = serializeMp4(original);
    const reparsed = parseMp4(serialized);

    // Track count preserved.
    expect(reparsed.tracks).toHaveLength(2);

    // Track order preserved.
    expect(reparsed.tracks[0]?.handlerType).toBe('soun');
    expect(reparsed.tracks[1]?.handlerType).toBe('vide');

    // Track IDs preserved.
    expect(reparsed.tracks[0]?.trackId).toBe(1);
    expect(reparsed.tracks[1]?.trackId).toBe(2);

    // Timescales preserved.
    expect(reparsed.tracks[0]?.mediaHeader.timescale).toBe(44100);
    expect(reparsed.tracks[1]?.mediaHeader.timescale).toBe(30000);

    // Sample counts preserved.
    expect(reparsed.tracks[0]?.sampleTable.sampleCount).toBe(1);
    expect(reparsed.tracks[1]?.sampleTable.sampleCount).toBe(1);
  });

  it('round-trip preserves sample bytes for multi-track file', () => {
    const audioData = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x88]);
    const bytes = buildMultiTrackMp4({
      tracks: [
        {
          trackId: 1,
          handlerType: 'soun',
          mediaTimescale: 44100,
          samples: [{ data: audioData, durationTicks: 1024 }],
        },
        {
          trackId: 2,
          handlerType: 'vide',
          mediaTimescale: 30000,
          samples: [{ data: videoData, durationTicks: 3000 }],
        },
      ],
    });

    const file = parseMp4(bytes);
    const serialized = serializeMp4(file);
    const reparsed = parseMp4(serialized);

    // Verify audio sample data.
    const audioTrack = reparsed.tracks[0]!;
    const audioOffset = audioTrack.sampleTable.sampleOffsets[0]!;
    const audioSize = audioTrack.sampleTable.sampleSizes[0]!;
    expect(Array.from(serialized.subarray(audioOffset, audioOffset + audioSize))).toEqual(
      Array.from(audioData),
    );

    // Verify video sample data.
    const videoTrack = reparsed.tracks[1]!;
    const videoOffset = videoTrack.sampleTable.sampleOffsets[0]!;
    const videoSize = videoTrack.sampleTable.sampleSizes[0]!;
    expect(Array.from(serialized.subarray(videoOffset, videoOffset + videoSize))).toEqual(
      Array.from(videoData),
    );
  });
});

describe('Multi-track iterators — C.3', () => {
  it('test 16: Mp4AmbiguousTrackError on multi-track file without selector', () => {
    const sample = { data: new Uint8Array([0x01]), durationTicks: 1024 };
    const bytes = buildMultiTrackMp4({
      tracks: [
        { trackId: 1, handlerType: 'soun', mediaTimescale: 44100, samples: [sample] },
        { trackId: 2, handlerType: 'soun', mediaTimescale: 44100, samples: [sample] },
      ],
    });
    const file = parseMp4(bytes);

    expect(() => [...iterateAudioSamplesAuto(file)]).toThrow(Mp4AmbiguousTrackError);
    expect(() => [...iterateSamples(file)]).toThrow(Mp4AmbiguousTrackError);
  });

  it('test 17: iterator with explicit audio track yields only audio samples', () => {
    const audioData = new Uint8Array([0xaa, 0xbb]);
    const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65]);
    const bytes = buildMultiTrackMp4({
      tracks: [
        {
          trackId: 1,
          handlerType: 'soun',
          mediaTimescale: 44100,
          samples: [{ data: audioData, durationTicks: 1024 }],
        },
        {
          trackId: 2,
          handlerType: 'vide',
          mediaTimescale: 30000,
          samples: [{ data: videoData, durationTicks: 3000 }],
        },
      ],
    });
    const file = parseMp4(bytes);
    const audioTrack = findAudioTrack(file)!;

    const audioSamples = [...iterateAudioSamplesAuto(file, audioTrack)];
    expect(audioSamples).toHaveLength(1);
    expect(Array.from(audioSamples[0]!.data)).toEqual(Array.from(audioData));
  });

  it('test 18: iterator with explicit video track yields video samples with correct isKeyframe', () => {
    const audioData = new Uint8Array([0xaa, 0xbb]);
    const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65]);
    const bytes = buildMultiTrackMp4({
      tracks: [
        {
          trackId: 1,
          handlerType: 'soun',
          mediaTimescale: 44100,
          samples: [{ data: audioData, durationTicks: 1024 }],
        },
        {
          trackId: 2,
          handlerType: 'vide',
          mediaTimescale: 30000,
          samples: [{ data: videoData, durationTicks: 3000 }],
        },
      ],
    });
    const file = parseMp4(bytes);
    const videoTrack = findVideoTrack(file)!;

    // No stss box → all video samples are keyframes.
    const videoSamples = [...iterateVideoSamples(videoTrack, file.fileBytes)];
    expect(videoSamples).toHaveLength(1);
    expect(videoSamples[0]?.isKeyframe).toBe(true);
    expect(videoSamples[0]?.kind).toBe('video');
    expect(Array.from(videoSamples[0]!.data)).toEqual(Array.from(videoData));
  });

  it('Mp4TrackNotFoundError when track from different file is passed', () => {
    const sample = { data: new Uint8Array([0x01]), durationTicks: 1024 };
    const bytes1 = buildMultiTrackMp4({
      tracks: [{ trackId: 1, handlerType: 'soun', mediaTimescale: 44100, samples: [sample] }],
    });
    const bytes2 = buildMultiTrackMp4({
      tracks: [{ trackId: 1, handlerType: 'soun', mediaTimescale: 44100, samples: [sample] }],
    });
    const file1 = parseMp4(bytes1);
    const file2 = parseMp4(bytes2);

    // Track from file1 should not be accepted by file2's iterator.
    const trackFromFile1 = file1.tracks[0]!;
    expect(() => [...iterateAudioSamplesAuto(file2, trackFromFile1)]).toThrow(
      Mp4TrackNotFoundError,
    );
  });

  it('fragmented multi-track: iterateFragmentedAudioSamples filters by trackId', () => {
    const bytes = buildMultiTrackFmp4();
    const file = parseMp4(bytes);
    expect(file.isFragmented).toBe(true);

    const audioTrack = findAudioTrack(file)!;
    const audioSamples = [...iterateFragmentedAudioSamples(file, audioTrack)];
    expect(audioSamples).toHaveLength(1);
    // Audio sample data was [0xaa, 0xbb].
    expect(Array.from(audioSamples[0]!.data)).toEqual([0xaa, 0xbb]);
  });

  it('fragmented multi-track: Mp4AmbiguousTrackError without explicit track', () => {
    const bytes = buildMultiTrackFmp4();
    const file = parseMp4(bytes);
    expect(() => [...iterateFragmentedAudioSamples(file)]).toThrow(Mp4AmbiguousTrackError);
  });

  it('iterateSamples with explicit track on multi-track file works', () => {
    const audioData = new Uint8Array([0xaa, 0xbb]);
    const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65]);
    const bytes = buildMultiTrackMp4({
      tracks: [
        {
          trackId: 1,
          handlerType: 'soun',
          mediaTimescale: 44100,
          samples: [{ data: audioData, durationTicks: 1024 }],
        },
        {
          trackId: 2,
          handlerType: 'vide',
          mediaTimescale: 30000,
          samples: [{ data: videoData, durationTicks: 3000 }],
        },
      ],
    });
    const file = parseMp4(bytes);
    const audioTrack = findAudioTrack(file)!;
    const videoTrack = findVideoTrack(file)!;

    const audioSamples = [...iterateSamples(file, audioTrack)];
    expect(audioSamples).toHaveLength(1);
    expect(audioSamples[0]?.kind).toBe('audio');

    const videoSamples = [...iterateSamples(file, videoTrack)];
    expect(videoSamples).toHaveLength(1);
    expect(videoSamples[0]?.kind).toBe('video');
  });
});

describe('Backend projection — C.4', () => {
  it('test 21: backend audio/mp4 → audio/mp4 on 2-track input drops video', async () => {
    const audioData = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x88]);
    const bytes = buildMultiTrackMp4({
      tracks: [
        {
          trackId: 1,
          handlerType: 'soun',
          mediaTimescale: 44100,
          samples: [{ data: audioData, durationTicks: 1024 }],
        },
        {
          trackId: 2,
          handlerType: 'vide',
          mediaTimescale: 30000,
          samples: [{ data: videoData, durationTicks: 3000 }],
        },
      ],
    });

    const backend = new Mp4Backend();
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/mp4' });
    const result = await backend.convert(
      blob,
      { mime: 'audio/mp4', ext: 'm4a', category: 'audio', description: 'M4A' },
      {},
    );

    // Output should be a valid M4A with only 1 track.
    const outputBytes = new Uint8Array(await result.blob.arrayBuffer());
    const output = parseMp4(outputBytes);
    expect(output.tracks).toHaveLength(1);
    expect(output.tracks[0]?.handlerType).toBe('soun');
  });

  it('test 22: backend throws Mp4NoAudioTrackError when no audio track', async () => {
    const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x88]);
    const bytes = buildMultiTrackMp4({
      tracks: [
        {
          trackId: 1,
          handlerType: 'vide',
          mediaTimescale: 30000,
          samples: [{ data: videoData, durationTicks: 3000 }],
        },
      ],
    });

    const backend = new Mp4Backend();
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/mp4' });
    await expect(
      backend.convert(
        blob,
        { mime: 'audio/mp4', ext: 'm4a', category: 'audio', description: 'M4A' },
        {},
      ),
    ).rejects.toThrow(Mp4NoAudioTrackError);
  });
});

// ---------------------------------------------------------------------------
// F1/F4 regression: stss round-trip
// ---------------------------------------------------------------------------

/**
 * Build a stss FullBox with the given 1-based keyframe sample numbers.
 */
function buildStssBox(keyframeSampleNumbers: number[]): Uint8Array {
  const sorted = [...keyframeSampleNumbers].sort((a, b) => a - b);
  const payloadSize = 8 + sorted.length * 4;
  const boxSize = 8 + payloadSize;
  const out = new Uint8Array(boxSize);
  const view = new DataView(out.buffer);
  view.setUint32(0, boxSize, false);
  fourCC(out, 4, 'stss');
  // version=0, flags=0 at bytes 8-11 (already zero)
  view.setUint32(12, sorted.length, false);
  for (let i = 0; i < sorted.length; i++) {
    view.setUint32(16 + i * 4, sorted[i]!, false);
  }
  return out;
}

/**
 * Build a complete trak box with stss: samples 1 and 3 are keyframes, 2 and 4 are not.
 * Returns {trakBox, sampleData}.
 */
function buildVideoTrakWithStss(mdatStart: number): {
  trakBox: Uint8Array;
  sampleData: Uint8Array;
} {
  const samples = [
    new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x01]), // sample 1: keyframe (IDR)
    new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x61, 0x02]), // sample 2: P-frame
    new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x03]), // sample 3: keyframe (IDR)
    new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x41, 0x04]), // sample 4: B-frame
  ];
  const sampleCount = samples.length;

  // stts: all 4 samples, delta=3000.
  const sttsPayload = new Uint8Array(8 + 8);
  u32be(sttsPayload, 4, 1);
  u32be(sttsPayload, 8, sampleCount);
  u32be(sttsPayload, 12, 3000);
  const sttsBox = wrapBox('stts', sttsPayload);

  // stsc: 1 chunk per sample.
  const stscPayload = new Uint8Array(8 + 12);
  u32be(stscPayload, 4, 1);
  u32be(stscPayload, 8, 1); // first_chunk=1
  u32be(stscPayload, 12, 1); // samples_per_chunk=1
  u32be(stscPayload, 16, 1); // sample_description_index=1
  const stscBox = wrapBox('stsc', stscPayload);

  // stsz: per-sample sizes.
  const stszPayload = new Uint8Array(12 + sampleCount * 4);
  u32be(stszPayload, 8, sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    u32be(stszPayload, 12 + i * 4, samples[i]!.length);
  }
  const stszBox = wrapBox('stsz', stszPayload);

  // stss: keyframes at sample numbers 1 and 3 (1-based).
  const stssBox = buildStssBox([1, 3]);

  // stco: one offset per sample.
  const stcoPayload = new Uint8Array(8 + sampleCount * 4);
  u32be(stcoPayload, 4, sampleCount);
  let bytePos = mdatStart;
  for (let i = 0; i < sampleCount; i++) {
    u32be(stcoPayload, 8 + i * 4, bytePos);
    bytePos += samples[i]!.length;
  }
  const stcoBox = wrapBox('stco', stcoPayload);

  const avcCPayload = buildAvcCPayload(0x42, 0xe0, 0x1e);
  const avcEntry = buildAvcSampleEntry('avc1', 320, 240, avcCPayload);
  const stsdPayload = new Uint8Array(8 + avcEntry.length);
  u32be(stsdPayload, 4, 1);
  stsdPayload.set(avcEntry, 8);
  const stsdBox = wrapBox('stsd', stsdPayload);

  const stblBox = wrapBox('stbl', stsdBox, sttsBox, stscBox, stszBox, stssBox, stcoBox);
  const dinf = wrapBox('dinf', buildDref());
  const minfBox = wrapBox('minf', buildVmhd(), dinf, stblBox);
  const mdiaBox = wrapBox('mdia', buildMdhd(30000), buildHdlr('vide'), minfBox);
  const trakBox = wrapBox('trak', buildTkhd(1), mdiaBox);

  const sampleData = concat(...samples);
  return { trakBox, sampleData };
}

describe('stss round-trip — F1/F4 regression', () => {
  it('video track with stss: syncSamples preserved after parse→serialize→parse', () => {
    // Build a single-video-track MP4 with stss marking samples 1 and 3 as keyframes.
    const ftypBox = buildFtyp('isom');
    // Pass 1: measure moov size with placeholder offset.
    const { trakBox: trak0 } = buildVideoTrakWithStss(0);
    const moov0 = wrapBox('moov', buildMvhd(30000, 0, 2), trak0);
    const mdatStart = ftypBox.length + moov0.length + 8;

    // Pass 2: build with real offset.
    const { trakBox, sampleData } = buildVideoTrakWithStss(mdatStart);
    const moovBox = wrapBox('moov', buildMvhd(30000, 0, 2), trakBox);
    const mdatBox = wrapBox('mdat', sampleData);
    const bytes = concat(ftypBox, moovBox, mdatBox);

    const original = parseMp4(bytes);
    expect(original.tracks[0]?.syncSamples).not.toBeNull();
    expect(original.tracks[0]?.syncSamples?.has(1)).toBe(true);
    expect(original.tracks[0]?.syncSamples?.has(3)).toBe(true);
    expect(original.tracks[0]?.syncSamples?.has(2)).toBe(false);
    expect(original.tracks[0]?.syncSamples?.has(4)).toBe(false);

    // Round-trip: serialize → re-parse.
    const serialized = serializeMp4(original);
    const reparsed = parseMp4(serialized);

    const ss = reparsed.tracks[0]?.syncSamples;
    expect(ss).not.toBeNull();
    expect(ss?.has(1)).toBe(true);
    expect(ss?.has(3)).toBe(true);
    expect(ss?.has(2)).toBe(false);
    expect(ss?.has(4)).toBe(false);
  });

  it('audio track with syncSamples=null: round-trip unchanged (no stss emitted)', async () => {
    // The existing single-track M4A fixture has no stss (all samples are keyframes).
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const original = parseMp4(bytes);
    expect(original.tracks[0]?.syncSamples).toBeNull();

    const serialized = serializeMp4(original);
    const reparsed = parseMp4(serialized);
    // syncSamples must remain null (no stss box emitted).
    expect(reparsed.tracks[0]?.syncSamples).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F3 regression: moof with duplicate traf trackId
// ---------------------------------------------------------------------------

/**
 * Build a fragmented MP4 where a single moof contains two traf boxes both
 * with the same trackId (spec-illegal). Used to test the F3 rejection.
 */
function buildFmp4WithDuplicateTraf(): Uint8Array {
  const ftypBox = buildFtyp('iso5');

  // Single audio track.
  const audioStsd = buildStsdAudio(1, 44100);
  const audioStbl = wrapBox(
    'stbl',
    audioStsd,
    buildEmptyTable('stts'),
    buildEmptyTable('stsc'),
    buildEmptyTable('stsz'),
    buildEmptyTable('stco'),
  );
  const audioDinf = wrapBox('dinf', buildDref());
  const audioMinf = wrapBox('minf', buildSmhd(), audioDinf, audioStbl);
  const audioMdia = wrapBox('mdia', buildMdhd(44100), buildHdlr('soun'), audioMinf);
  const audioTrak = wrapBox('trak', buildTkhd(1), audioMdia);

  function buildTrex(trackId: number): Uint8Array {
    const payload = new Uint8Array(24);
    u32be(payload, 4, trackId);
    u32be(payload, 8, 1);
    u32be(payload, 12, 1024);
    return wrapBox('trex', payload);
  }

  const mvexBox = wrapBox('mvex', buildTrex(1));
  const moovBox = wrapBox('moov', buildMvhd(1000, 0, 2), audioTrak, mvexBox);

  // Build moof with two traf, both trackId=1 (illegal duplicate).
  const mfhdPayload = new Uint8Array(8);
  u32be(mfhdPayload, 4, 1);
  const mfhdBox = wrapBox('mfhd', mfhdPayload);

  function buildTfhd(trackId: number): Uint8Array {
    const payload = new Uint8Array(8);
    payload[1] = 0x02; // default-base-is-moof
    u32be(payload, 4, trackId);
    return wrapBox('tfhd', payload);
  }
  function buildTfdt(baseTime: number): Uint8Array {
    const payload = new Uint8Array(8);
    u32be(payload, 4, baseTime);
    return wrapBox('tfdt', payload);
  }
  function buildTrun(sampleSize: number, dataOffset: number): Uint8Array {
    const flags = 0x000301;
    const payload = new Uint8Array(8 + 4 + 8);
    payload[1] = (flags >> 16) & 0xff;
    payload[2] = (flags >> 8) & 0xff;
    payload[3] = flags & 0xff;
    u32be(payload, 4, 1);
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    view.setInt32(8, dataOffset, false);
    u32be(payload, 12, 1024);
    u32be(payload, 16, sampleSize);
    return wrapBox('trun', payload);
  }

  // Both traf use trackId=1 — illegal duplicate.
  const traf1 = wrapBox('traf', buildTfhd(1), buildTfdt(0), buildTrun(2, 0));
  const traf2 = wrapBox('traf', buildTfhd(1), buildTfdt(1024), buildTrun(2, 2));
  const moofBox = wrapBox('moof', mfhdBox, traf1, traf2);

  const mdatBox = wrapBox('mdat', new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]));

  return concat(ftypBox, moovBox, moofBox, mdatBox);
}

describe('moof duplicate traf trackId — F3 regression', () => {
  it('rejects moof with two traf boxes sharing the same trackId', () => {
    const bytes = buildFmp4WithDuplicateTraf();
    expect(() => parseMp4(bytes)).toThrow(Mp4InvalidBoxError);
  });
});

describe('Regression — single-track fixtures', () => {
  it('test 20: single-track M4A fixture still parses correctly', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);
    expect(file.tracks).toHaveLength(1);
    expect(file.tracks[0]?.handlerType).toBe('soun');
  });

  it('single-track M4A can be serialized without error', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);
    const serialized = serializeMp4(file);
    expect(serialized.length).toBeGreaterThan(0);
  });

  it('iterateAudioSamplesAuto works on single-track file without explicit track', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);
    const samples = [...iterateAudioSamplesAuto(file)];
    expect(samples.length).toBeGreaterThan(0);
  });

  it('iterateSamples works on single-track file without explicit track', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);
    const samples = [...iterateSamples(file)];
    expect(samples.length).toBeGreaterThan(0);
  });
});
