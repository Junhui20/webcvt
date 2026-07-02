/**
 * Encode sinks: consume planar-float {@link DecodedAudio} and produce the
 * output container bytes.
 *
 * - **wav** — interleave to int16 → `serializeWav`. No WebCodecs.
 * - **opus-in-ogg / opus-in-webm** — `AudioEncoder{codec:'opus'}` → collect
 *   `EncodedAudioChunk`s → build an `OggFile` / `WebmFile` (OpusHead as the
 *   Ogg identification packet / WebM `CodecPrivate`) → serialize.
 * - **aac (ADTS)** — `AudioEncoder{codec:'mp4a.40.2', aac:{format:'adts'}}`;
 *   the encoder emits ADTS-framed chunks, so concatenation is the file.
 * - **flac** — `AudioEncoder{codec:'flac'}`; the FLAC stream header arrives as
 *   the first chunk's `decoderConfig.description`, frames as chunk data
 *   (probe-gated, best-effort — see notes).
 *
 * Encoders take ownership of each `AudioData` and always `close()` it; the
 * encoder is `close()`-d in `finally` and via an abort listener.
 */

import { WebCodecsAudioEncoder } from '@catlabtech/webcvt-codec-webcodecs';
import {
  type OggFile,
  buildOpusHead,
  buildOpusTags,
  serializeOgg,
} from '@catlabtech/webcvt-container-ogg';
import { type WavFile, serializeWav } from '@catlabtech/webcvt-container-wav';
import {
  type WebmAudioTrack,
  type WebmCluster,
  type WebmFile,
  serializeWebm,
} from '@catlabtech/webcvt-container-webm';
import { asCodecError, throwIfAborted } from './abort.ts';
import { TranscodeCodecError } from './errors.ts';
import { type DecodedAudio, buildAudioData, interleaveInt16 } from './pcm.ts';

export interface EncodeContext {
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}

export interface EncodeOptions {
  /** Encoder bitrate in bits/s (opus/aac). Omitted for lossless. */
  readonly bitrate?: number;
}

// ---------------------------------------------------------------------------
// WAV sink (pure PCM — no WebCodecs)
// ---------------------------------------------------------------------------

/** Interleave to 16-bit PCM and serialize a canonical RIFF/WAV file. */
export function encodeWav(decoded: DecodedAudio): Uint8Array {
  const audioData = interleaveInt16(decoded);
  const channels = Math.max(1, decoded.numberOfChannels);
  const bitsPerSample = 16 as const;
  const blockAlign = (channels * bitsPerSample) / 8;
  const file: WavFile = {
    format: {
      audioFormat: 1,
      channels,
      sampleRate: decoded.sampleRate,
      bitsPerSample,
      blockAlign,
      byteRate: decoded.sampleRate * blockAlign,
    },
    audioData,
  };
  return serializeWav(file);
}

// ---------------------------------------------------------------------------
// Shared AudioEncoder driver
// ---------------------------------------------------------------------------

interface EncodedOut {
  readonly data: Uint8Array;
  readonly timestampUs: number;
  readonly durationUs: number;
}

interface EncodeChunksResult {
  readonly chunks: EncodedOut[];
  /** First chunk's `decoderConfig.description`, when the encoder supplies one. */
  readonly description?: Uint8Array;
}

/**
 * Feed `decoded` to an `AudioEncoder` in ~20 ms windows and collect the emitted
 * chunks (bytes + timing) plus the setup description from the first chunk.
 */
async function encodeAudioChunks(
  decoded: DecodedAudio,
  config: AudioEncoderConfig,
  ctx: EncodeContext,
): Promise<EncodeChunksResult> {
  throwIfAborted(ctx.signal);

  const out: EncodedOut[] = [];
  let description: Uint8Array | undefined;

  const encoder = new WebCodecsAudioEncoder({ config }, (chunk, metadata) => {
    const bytes = new Uint8Array(chunk.byteLength);
    chunk.copyTo(bytes);
    out.push({
      data: bytes,
      timestampUs: chunk.timestamp,
      durationUs: chunk.duration ?? 0,
    });
    const desc = metadata?.decoderConfig?.description;
    if (description === undefined && desc !== undefined) {
      description = new Uint8Array(
        desc instanceof ArrayBuffer ? desc : (desc as ArrayBufferView).buffer,
        desc instanceof ArrayBuffer ? 0 : (desc as ArrayBufferView).byteOffset,
        desc instanceof ArrayBuffer ? desc.byteLength : (desc as ArrayBufferView).byteLength,
      ).slice();
    }
  });

  const onAbort = (): void => encoder.close();
  ctx.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const framesPerChunk = Math.max(1, Math.round(decoded.sampleRate / 50)); // 20 ms
    const total = decoded.numberOfFrames || 1;
    for (let start = 0; start < decoded.numberOfFrames; start += framesPerChunk) {
      throwIfAborted(ctx.signal);
      const count = Math.min(framesPerChunk, decoded.numberOfFrames - start);
      const timestampUs = Math.round((start / decoded.sampleRate) * 1_000_000);
      encoder.encode(buildAudioData(decoded, start, count, timestampUs));
      ctx.onProgress?.(Math.min(1, (start + count) / total));
    }
    await encoder.flush();
    throwIfAborted(ctx.signal);
  } catch (err) {
    throw asCodecError(err, 'encode');
  } finally {
    ctx.signal?.removeEventListener('abort', onAbort);
    encoder.close();
  }

  return { chunks: out, description };
}

// ---------------------------------------------------------------------------
// Opus encode + mux
// ---------------------------------------------------------------------------

const OPUS_RATE = 48_000;
const OPUS_PRE_SKIP = 3840; // libopus default pre-skip @48 kHz.
const OGG_SERIAL = 1;
const WEBM_TIMECODE_SCALE = 1_000_000; // 1 ms ticks.
const WEBM_CLUSTER_MAX_TICKS = 30_000; // keep per-block int16 delta well within range.

async function encodeOpus(
  decoded: DecodedAudio,
  opts: EncodeOptions,
  ctx: EncodeContext,
): Promise<EncodedOut[]> {
  const config: AudioEncoderConfig = {
    codec: 'opus',
    sampleRate: decoded.sampleRate,
    numberOfChannels: Math.max(1, decoded.numberOfChannels),
    ...(opts.bitrate ? { bitrate: opts.bitrate } : {}),
  };
  const { chunks } = await encodeAudioChunks(decoded, config, ctx);
  return chunks;
}

/** any decodable audio → opus-in-ogg. */
export async function encodeOpusOgg(
  decoded: DecodedAudio,
  opts: EncodeOptions,
  ctx: EncodeContext,
): Promise<Uint8Array> {
  const channels = Math.max(1, decoded.numberOfChannels);
  const chunks = await encodeOpus(decoded, opts, ctx);
  const identification = buildOpusHead({
    channelCount: channels,
    preSkip: OPUS_PRE_SKIP,
    inputSampleRate: decoded.sampleRate,
  });
  const comments = buildOpusTags('webcvt-transcode', [
    { key: 'ENCODER', value: 'webcvt-transcode' },
  ]);

  const packets = chunks.map((c) => ({
    data: c.data,
    // Opus granule = decoded 48 kHz samples (incl. pre-skip) at packet end.
    granulePosition: BigInt(
      Math.round(((c.timestampUs + c.durationUs) / 1_000_000) * OPUS_RATE) + OPUS_PRE_SKIP,
    ),
    serialNumber: OGG_SERIAL,
  }));

  const file: OggFile = {
    streams: [
      {
        serialNumber: OGG_SERIAL,
        codec: 'opus',
        identification,
        comments,
        setup: undefined,
        packets,
        preSkip: OPUS_PRE_SKIP,
        sampleRate: OPUS_RATE,
        channels,
      },
    ],
  };
  return serializeOgg(file);
}

/** any decodable audio → opus-in-webm. */
export async function encodeOpusWebm(
  decoded: DecodedAudio,
  opts: EncodeOptions,
  ctx: EncodeContext,
): Promise<Uint8Array> {
  const channels = Math.max(1, decoded.numberOfChannels);
  const chunks = await encodeOpus(decoded, opts, ctx);
  const codecPrivate = buildOpusHead({
    channelCount: channels,
    preSkip: OPUS_PRE_SKIP,
    inputSampleRate: decoded.sampleRate,
  });

  // Split clusters so every SimpleBlock's timecode delta (ticks) fits int16.
  const clusters: WebmCluster[] = [];
  let current: WebmCluster | null = null;
  for (const c of chunks) {
    const tick = BigInt(Math.round(c.timestampUs / 1000)); // µs → ms ticks
    if (current === null || tick - current.timecode > BigInt(WEBM_CLUSTER_MAX_TICKS)) {
      current = { fileOffset: 0, timecode: tick, blocks: [] };
      clusters.push(current);
    }
    current.blocks.push({
      trackNumber: 1,
      timestampNs: tick * BigInt(WEBM_TIMECODE_SCALE),
      keyframe: true,
      invisible: false,
      discardable: false,
      frames: [c.data],
    });
  }

  const track: WebmAudioTrack = {
    trackNumber: 1,
    trackUid: 1n,
    trackType: 2,
    codecId: 'A_OPUS',
    codecPrivate,
    samplingFrequency: OPUS_RATE,
    channels,
  };

  const file: WebmFile = {
    ebmlHeader: {
      ebmlVersion: 1,
      ebmlReadVersion: 1,
      ebmlMaxIdLength: 4,
      ebmlMaxSizeLength: 8,
      docType: 'webm',
      docTypeVersion: 4,
      docTypeReadVersion: 2,
    },
    segmentPayloadOffset: 0, // placeholder — ignored on write.
    info: {
      timecodeScale: WEBM_TIMECODE_SCALE,
      muxingApp: 'webcvt-transcode',
      writingApp: 'webcvt-transcode',
    },
    tracks: [track],
    clusters,
    fileBytes: new Uint8Array(0), // placeholder — ignored on write.
  };
  return serializeWebm(file);
}

// ---------------------------------------------------------------------------
// AAC (encoder-native ADTS)
// ---------------------------------------------------------------------------

/** any decodable audio → aac (ADTS). Encoder emits ADTS frames; concat = file. */
export async function encodeAac(
  decoded: DecodedAudio,
  opts: EncodeOptions,
  ctx: EncodeContext,
): Promise<Uint8Array> {
  const config = {
    codec: 'mp4a.40.2',
    sampleRate: decoded.sampleRate,
    numberOfChannels: Math.max(1, decoded.numberOfChannels),
    ...(opts.bitrate ? { bitrate: opts.bitrate } : {}),
    // Ask the encoder for self-framed ADTS output so concatenation is a valid
    // .aac file (no container muxer needed).
    aac: { format: 'adts' as const },
  } as AudioEncoderConfig;

  const { chunks } = await encodeAudioChunks(decoded, config, ctx);
  return concatBytes(chunks.map((c) => c.data));
}

// ---------------------------------------------------------------------------
// FLAC (probe-gated, best-effort)
// ---------------------------------------------------------------------------

/**
 * any decodable audio → flac. The WebCodecs FLAC encoder delivers the stream
 * header (`fLaC` + STREAMINFO) via the first chunk's `decoderConfig.description`
 * and the FLAC frames as chunk data, so the file is `description ++ frames`.
 *
 * This path is gated by the encoder probe in `canHandle`; if FLAC encode is
 * unsupported (most non-Chromium runtimes) routing falls through to ffmpeg-wasm
 * and this is never reached. The exact chunk→frame mapping is unverified in
 * Node (no real encoder) — see docs/design-notes/transcode.md §Needs verification.
 */
export async function encodeFlac(
  decoded: DecodedAudio,
  _opts: EncodeOptions,
  ctx: EncodeContext,
): Promise<Uint8Array> {
  const config: AudioEncoderConfig = {
    codec: 'flac',
    sampleRate: decoded.sampleRate,
    numberOfChannels: Math.max(1, decoded.numberOfChannels),
  };
  const { chunks, description } = await encodeAudioChunks(decoded, config, ctx);
  if (description === undefined) {
    throw new TranscodeCodecError(
      'flac encoder did not supply a stream header (decoderConfig.description); cannot mux FLAC',
    );
  }
  return concatBytes([description, ...chunks.map((c) => c.data)]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
