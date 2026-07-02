/**
 * Container demux for the video stage: pull encoded video/audio tracks out of
 * mp4 / webm / mkv so they can be fed to WebCodecs decoders.
 *
 * - `demuxContainerVideo` extracts the video track (required) plus its audio
 *   track (optional — `null` when the container has no audio or the audio codec
 *   is not decodable here, e.g. Vorbis-in-webm → video-only output).
 * - `demuxContainerAudio` extracts JUST the audio track (for routing a
 *   container's audio into the existing audio matrix, e.g. mp4/m4a AAC → wav).
 *
 * Descriptions come verbatim from the container per the design note §B:
 * mp4 avcC via `codecConfig.bytes`, mp4 AAC ASC via `decoderSpecificInfo`,
 * webm/mkv via `codecPrivate` (OpusHead / avcC / ASC). All sample/block access
 * is the containers' own zero-copy iterators.
 *
 * See docs/design-notes/transcode.md §B (demux capability audit) and §D (video).
 */

import {
  type AudioChunk as MkvAudioChunk,
  type MkvAudioTrack,
  type MkvFile,
  type VideoChunk as MkvVideoChunk,
  type MkvVideoTrack,
  iterateAudioChunks as iterateMkvAudioChunks,
  iterateVideoChunks as iterateMkvVideoChunks,
  parseMkv,
} from '@catlabtech/webcvt-container-mkv';
import {
  type Mp4File,
  type Mp4Track,
  deriveCodecString,
  findAudioTrack,
  findVideoTrack,
  iterateAudioSamplesAuto,
  iterateVideoSamples,
  parseMp4,
} from '@catlabtech/webcvt-container-mp4';
import {
  type AudioChunk as WebmAudioChunk,
  type WebmAudioTrack,
  type WebmFile,
  type VideoChunk as WebmVideoChunk,
  type WebmVideoTrack,
  iterateAudioChunks as iterateWebmAudioChunks,
  iterateVideoChunks as iterateWebmVideoChunks,
  parseWebm,
} from '@catlabtech/webcvt-container-webm';
import type { EncodedChunkSpec } from './demux.ts';
import { TranscodeDemuxError } from './errors.ts';
import type { ContainerFamily, VideoSideCodec } from './matrix.ts';

const US_PER_SEC = 1_000_000;
/** WebCodecs decodes/encodes Opus at 48 kHz internally regardless of container. */
const OPUS_RATE = 48_000;
/** Fallback per-chunk duration when a single-chunk stream gives no delta. */
const NOMINAL_AUDIO_FRAME_US = 20_000; // 20 ms

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One encoded video access unit to hand to the VideoDecoder. */
export interface EncodedVideoChunkSpec {
  readonly type: 'key' | 'delta';
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly data: Uint8Array;
}

/** Encoded audio track ready to feed an AudioDecoder (shape of DemuxResult's `encoded`). */
export interface EncodedAudioTrack {
  readonly config: AudioDecoderConfig;
  readonly chunks: EncodedChunkSpec[];
  readonly sampleRate: number;
  readonly numberOfChannels: number;
}

/** Encoded video track ready to feed a VideoDecoder. */
export interface EncodedVideoTrack {
  readonly config: VideoDecoderConfig;
  readonly chunks: EncodedVideoChunkSpec[];
  readonly width: number;
  readonly height: number;
  /** Estimated frame rate (fps) for the encoder config; 0 when underivable. */
  readonly frameRate: number;
  /** Coarse codec token for decoder probing. */
  readonly codec: VideoSideCodec;
}

export interface ContainerVideoDemux {
  readonly video: EncodedVideoTrack;
  /** Null → no audio track, or the audio codec is not decodable here. */
  readonly audio: EncodedAudioTrack | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Demux the video track (+ optional audio) of a container. */
export function demuxContainerVideo(
  family: ContainerFamily,
  bytes: Uint8Array,
): ContainerVideoDemux {
  return wrap(() => {
    switch (family) {
      case 'mp4': {
        const file = parseMp4(bytes);
        return { video: mp4Video(file), audio: mp4Audio(file) };
      }
      case 'webm': {
        const file = parseWebm(bytes);
        return { video: webmVideo(file), audio: webmAudio(file) };
      }
      case 'mkv': {
        const file = parseMkv(bytes);
        return { video: mkvVideo(file), audio: mkvAudio(file) };
      }
    }
  });
}

/** Demux JUST the audio track of a container (for the audio matrix). */
export function demuxContainerAudioTrack(
  family: ContainerFamily,
  bytes: Uint8Array,
): EncodedAudioTrack {
  return wrap(() => {
    let audio: EncodedAudioTrack | null;
    switch (family) {
      case 'mp4':
        audio = mp4Audio(parseMp4(bytes));
        break;
      case 'webm':
        audio = webmAudio(parseWebm(bytes));
        break;
      case 'mkv':
        audio = mkvAudio(parseMkv(bytes));
        break;
    }
    if (!audio) {
      throw new TranscodeDemuxError(
        `${family} container has no audio track decodable here (only AAC/Opus audio is supported)`,
      );
    }
    return audio;
  });
}

// ---------------------------------------------------------------------------
// mp4
// ---------------------------------------------------------------------------

function mp4Video(file: Mp4File): EncodedVideoTrack {
  const track = findVideoTrack(file);
  if (!track || track.sampleEntry.kind !== 'video') {
    throw new TranscodeDemuxError('mp4 has no video track');
  }
  const entry = track.sampleEntry.entry;
  const config: VideoDecoderConfig = {
    codec: entry.codecString,
    description: entry.codecConfig.bytes,
    codedWidth: entry.width,
    codedHeight: entry.height,
  };

  const chunks: EncodedVideoChunkSpec[] = [];
  for (const s of iterateVideoSamples(track, file.fileBytes)) {
    chunks.push({
      type: s.isKeyframe ? 'key' : 'delta',
      timestampUs: Math.round(s.presentationTimeUs),
      durationUs: Math.round(s.durationUs),
      data: s.data,
    });
  }
  if (chunks.length === 0) throw new TranscodeDemuxError('mp4 video track has no samples');

  return {
    config,
    chunks,
    width: entry.width,
    height: entry.height,
    frameRate: estimateFrameRate(chunks),
    codec: mp4VideoCodec(entry.format),
  };
}

function mp4Audio(file: Mp4File): EncodedAudioTrack | null {
  const track: Mp4Track | null = findAudioTrack(file);
  if (!track || track.sampleEntry.kind !== 'audio') return null;
  const entry = track.sampleEntry.entry;
  const codec = deriveCodecString(entry.objectTypeIndication, entry.decoderSpecificInfo);
  const numberOfChannels = Math.max(1, entry.channelCount);
  const sampleRate = entry.sampleRate;

  const chunks: EncodedChunkSpec[] = [];
  for (const s of iterateAudioSamplesAuto(file, track)) {
    chunks.push({
      type: 'key',
      timestampUs: Math.round(s.timestampUs),
      durationUs: Math.round(s.durationUs),
      data: s.data,
    });
  }
  if (chunks.length === 0) return null;

  return {
    config: { codec, description: entry.decoderSpecificInfo, sampleRate, numberOfChannels },
    chunks,
    sampleRate,
    numberOfChannels,
  };
}

function mp4VideoCodec(format: string): VideoSideCodec {
  if (format.startsWith('avc')) return 'h264';
  if (format.startsWith('hev') || format.startsWith('hvc')) return 'hevc';
  if (format === 'vp09') return 'vp9';
  if (format === 'av01') return 'av1';
  return 'h264';
}

// ---------------------------------------------------------------------------
// webm
// ---------------------------------------------------------------------------

function webmVideo(file: WebmFile): EncodedVideoTrack {
  const track = file.tracks.find((t): t is WebmVideoTrack => t.trackType === 1);
  if (!track) throw new TranscodeDemuxError('webm has no video track');
  const { codec, config } = webmVideoConfig(track);

  const chunks = collectVideoChunks(iterateWebmVideoChunks(file, track.trackNumber));
  if (chunks.length === 0) throw new TranscodeDemuxError('webm video track has no blocks');

  return {
    config,
    chunks,
    width: track.pixelWidth,
    height: track.pixelHeight,
    frameRate: estimateFrameRate(chunks),
    codec,
  };
}

function webmVideoConfig(track: WebmVideoTrack): {
  codec: VideoSideCodec;
  config: VideoDecoderConfig;
} {
  const base = { codedWidth: track.pixelWidth, codedHeight: track.pixelHeight };
  switch (track.codecId) {
    case 'V_VP8':
      return { codec: 'vp8', config: { codec: 'vp8', ...base } };
    case 'V_VP9':
      return { codec: 'vp9', config: { codec: 'vp09.00.10.08', ...base } };
    case 'V_AV01':
      return {
        codec: 'av1',
        config: {
          codec: 'av01.0.04M.08',
          ...(track.codecPrivate ? { description: track.codecPrivate } : {}),
          ...base,
        },
      };
  }
}

function webmAudio(file: WebmFile): EncodedAudioTrack | null {
  const track = file.tracks.find((t): t is WebmAudioTrack => t.trackType === 2);
  if (!track) return null;
  if (track.codecId !== 'A_OPUS') return null; // Vorbis-in-webm decode deferred.
  const numberOfChannels = Math.max(1, track.channels);
  const chunks = deriveAudioDurations(
    collectAudioChunks(iterateWebmAudioChunks(file, track.trackNumber)),
  );
  if (chunks.length === 0) return null;

  return {
    config: {
      codec: 'opus',
      description: track.codecPrivate,
      sampleRate: OPUS_RATE,
      numberOfChannels,
    },
    chunks,
    sampleRate: OPUS_RATE,
    numberOfChannels,
  };
}

// ---------------------------------------------------------------------------
// mkv
// ---------------------------------------------------------------------------

function mkvVideo(file: MkvFile): EncodedVideoTrack {
  const track = file.tracks.find((t): t is MkvVideoTrack => t.trackType === 1);
  if (!track) throw new TranscodeDemuxError('mkv has no video track');
  const config: VideoDecoderConfig = {
    codec: track.webcodecsCodecString,
    ...(mkvNeedsDescription(track.codecId) && track.codecPrivate
      ? { description: track.codecPrivate }
      : {}),
    codedWidth: track.pixelWidth,
    codedHeight: track.pixelHeight,
  };

  const chunks = collectVideoChunks(iterateMkvVideoChunks(file, track.trackNumber));
  if (chunks.length === 0) throw new TranscodeDemuxError('mkv video track has no blocks');

  return {
    config,
    chunks,
    width: track.pixelWidth,
    height: track.pixelHeight,
    frameRate: estimateFrameRate(chunks),
    codec: mkvVideoCodec(track.codecId),
  };
}

function mkvAudio(file: MkvFile): EncodedAudioTrack | null {
  const track = file.tracks.find((t): t is MkvAudioTrack => t.trackType === 2);
  if (!track) return null;

  let config: AudioDecoderConfig;
  let sampleRate: number;
  const numberOfChannels = Math.max(1, track.channels);
  if (track.codecId === 'A_OPUS') {
    sampleRate = OPUS_RATE;
    config = { codec: 'opus', description: track.codecPrivate, sampleRate, numberOfChannels };
  } else if (track.codecId === 'A_AAC') {
    sampleRate = track.samplingFrequency;
    config = {
      codec: track.webcodecsCodecString,
      description: track.codecPrivate,
      sampleRate,
      numberOfChannels,
    };
  } else {
    return null; // Vorbis / MP3 / FLAC-in-mkv decode deferred.
  }

  const chunks = deriveAudioDurations(
    collectAudioChunks(iterateMkvAudioChunks(file, track.trackNumber)),
  );
  if (chunks.length === 0) return null;

  return { config, chunks, sampleRate, numberOfChannels };
}

function mkvNeedsDescription(codecId: MkvVideoTrack['codecId']): boolean {
  return codecId === 'V_MPEG4/ISO/AVC' || codecId === 'V_MPEGH/ISO/HEVC' || codecId === 'V_AV01';
}

function mkvVideoCodec(codecId: MkvVideoTrack['codecId']): VideoSideCodec {
  switch (codecId) {
    case 'V_MPEG4/ISO/AVC':
      return 'h264';
    case 'V_MPEGH/ISO/HEVC':
      return 'hevc';
    case 'V_VP8':
      return 'vp8';
    case 'V_VP9':
      return 'vp9';
    case 'V_AV01':
      return 'av1';
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function collectVideoChunks(
  gen: Generator<WebmVideoChunk | MkvVideoChunk>,
): EncodedVideoChunkSpec[] {
  const raw = [...gen];
  const specs: EncodedVideoChunkSpec[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (!c) continue;
    const next = raw[i + 1];
    const durationUs = next
      ? Math.max(1, next.timestampUs - c.timestampUs)
      : (specs.at(-1)?.durationUs ?? NOMINAL_AUDIO_FRAME_US);
    specs.push({ type: c.type, timestampUs: c.timestampUs, durationUs, data: c.data });
  }
  return specs;
}

function collectAudioChunks(gen: Generator<WebmAudioChunk | MkvAudioChunk>): EncodedChunkSpec[] {
  return [...gen].map((c) => ({
    type: 'key' as const,
    timestampUs: c.timestampUs,
    durationUs: 0, // filled by deriveAudioDurations
    data: c.data,
  }));
}

/** Fill each audio chunk's duration from the delta to the next chunk. */
function deriveAudioDurations(chunks: EncodedChunkSpec[]): EncodedChunkSpec[] {
  return chunks.map((c, i) => {
    const next = chunks[i + 1];
    const durationUs = next
      ? Math.max(1, next.timestampUs - c.timestampUs)
      : chunks[i - 1]
        ? Math.max(1, c.timestampUs - (chunks[i - 1]?.timestampUs ?? 0))
        : NOMINAL_AUDIO_FRAME_US;
    return { ...c, durationUs };
  });
}

function estimateFrameRate(chunks: readonly EncodedVideoChunkSpec[]): number {
  if (chunks.length < 2) return 0;
  const first = chunks[0];
  const last = chunks[chunks.length - 1];
  if (!first || !last) return 0;
  const spanUs = last.timestampUs + last.durationUs - first.timestampUs;
  if (spanUs <= 0) return 0;
  return Math.round((chunks.length / spanUs) * US_PER_SEC);
}

function wrap<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (err instanceof TranscodeDemuxError) throw err;
    throw new TranscodeDemuxError(err instanceof Error ? err.message : String(err), { cause: err });
  }
}
