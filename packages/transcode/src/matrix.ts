/**
 * Static v1 capability matrix + codec/bitrate resolution for the audio
 * transcode paths.
 *
 * `canHandle` is two-stage: this frozen matrix is the cheap O(1) first gate
 * (rejects off-matrix pairs like `→ mp3`/`→ mp4` and every video pair before
 * any `isConfigSupported` round-trip), and the concrete both-sided codec probe
 * is the second gate (see backend.ts). See docs/design-notes/transcode.md §D.
 */

/** Codec token for a demux/mux side. `'pcm'` = raw PCM (wav), no WebCodecs. */
export type SideCodec = 'pcm' | 'opus' | 'aac' | 'flac' | 'mp3';

/** Output container family we can mux from scratch. */
export type OutputContainer = 'wav' | 'ogg' | 'webm' | 'aac' | 'flac';

export interface OutputTarget {
  readonly container: OutputContainer;
  /** Codec the WebCodecs encoder must produce (`'pcm'` = interleave, no encode). */
  readonly codec: SideCodec;
}

// ---------------------------------------------------------------------------
// Decodable audio inputs → the codec fed to the AudioDecoder (or 'pcm').
// ---------------------------------------------------------------------------

/**
 * MIME → input codec for the containers this stage can demux. `audio/ogg` is
 * assumed to carry Opus (Vorbis-in-Ogg decode needs a multi-packet setup
 * description and is deferred). mp4/m4a/webm/mkv audio-track extraction is
 * deferred to the video stage (shared demuxers).
 */
export const INPUT_CODECS: Readonly<Record<string, SideCodec>> = Object.freeze({
  'audio/wav': 'pcm',
  'audio/x-wav': 'pcm',
  'audio/wave': 'pcm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/x-mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/x-aac': 'aac',
  'audio/ogg': 'opus',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
});

// ---------------------------------------------------------------------------
// Muxable audio outputs → container + encoder codec.
// ---------------------------------------------------------------------------

/**
 * MIME → output target. `→ mp3` and `→ ogg(vorbis)` are intentionally absent
 * (no WebCodecs encoder); `→ mp4/m4a` is absent (no from-scratch mp4 muxer yet).
 */
export const OUTPUT_TARGETS: Readonly<Record<string, OutputTarget>> = Object.freeze({
  'audio/wav': { container: 'wav', codec: 'pcm' },
  'audio/x-wav': { container: 'wav', codec: 'pcm' },
  'audio/wave': { container: 'wav', codec: 'pcm' },
  'audio/ogg': { container: 'ogg', codec: 'opus' },
  'audio/opus': { container: 'ogg', codec: 'opus' },
  'audio/webm': { container: 'webm', codec: 'opus' },
  'audio/aac': { container: 'aac', codec: 'aac' },
  'audio/flac': { container: 'flac', codec: 'flac' },
});

/**
 * Frozen set of `"${inputMime}|${outputMime}"` keys — the full product of every
 * decodable input against every muxable output. This is the static gate.
 */
export const TRANSCODE_MATRIX: ReadonlySet<string> = Object.freeze(
  new Set<string>(
    Object.keys(INPUT_CODECS).flatMap((inMime) =>
      Object.keys(OUTPUT_TARGETS).map((outMime) => `${inMime}|${outMime}`),
    ),
  ),
);

/** Build the matrix key for a pair. */
export function matrixKey(inputMime: string, outputMime: string): string {
  return `${inputMime}|${outputMime}`;
}

/** Lookup the input codec for a MIME, or `undefined` if not decodable here. */
export function inputCodecFor(mime: string): SideCodec | undefined {
  return INPUT_CODECS[mime];
}

/** Lookup the output target for a MIME, or `undefined` if not muxable here. */
export function outputTargetFor(mime: string): OutputTarget | undefined {
  return OUTPUT_TARGETS[mime];
}

// ---------------------------------------------------------------------------
// Video + container-track matrix (video stage).
//
// These are DELIBERATELY separate from INPUT_CODECS / OUTPUT_TARGETS /
// TRANSCODE_MATRIX above (which stay the frozen audio-only matrix). A container
// input (mp4/webm/mkv) is not a single audio codec — it may carry a video and
// an audio track — so it is routed through its own lookups. `canHandle`/`convert`
// consult BOTH the audio matrix and these container lookups.
// ---------------------------------------------------------------------------

/** Demuxable container family (its sample/block iterators feed the pipeline). */
export type ContainerFamily = 'mp4' | 'webm' | 'mkv';

/** WebCodecs video codec token for a demux/mux side. */
export type VideoSideCodec = 'h264' | 'vp9' | 'vp8' | 'av1' | 'hevc';

/**
 * Container input MIME → family. Covers the video containers (video/mp4,
 * video/webm, video/x-matroska) and the audio-only projections that share a
 * demuxer (audio/mp4 = m4a, audio/webm). A container input can be transcoded
 * to a video target (its video track) OR have its audio track routed into the
 * existing audio matrix. Kept out of INPUT_CODECS so `inputCodecFor('video/mp4')`
 * stays `undefined` (a container is not one audio codec).
 */
export const CONTAINER_INPUTS: Readonly<Record<string, ContainerFamily>> = Object.freeze({
  'video/mp4': 'mp4',
  'audio/mp4': 'mp4', // m4a — audio-only track extraction
  'video/webm': 'webm',
  'audio/webm': 'webm', // webm audio-only extraction
  'video/x-matroska': 'mkv',
  'video/mkv': 'mkv',
});

/** Output container family for a video target (VP9 default, VP8 fallback). */
export interface VideoTarget {
  readonly container: 'webm' | 'mkv';
}

/**
 * Video output MIME → container. `→ mp4` is intentionally absent (no from-scratch
 * mp4 muxer yet — deferred to a later stage). The encoder codec (VP9 preferred,
 * VP8 fallback) is resolved at convert time by probing, not fixed here.
 */
export const VIDEO_TARGETS: Readonly<Record<string, VideoTarget>> = Object.freeze({
  'video/webm': { container: 'webm' },
  'video/x-matroska': { container: 'mkv' },
  'video/mkv': { container: 'mkv' },
});

/**
 * Assumed audio-track codec per container family, used only by `canHandle`
 * probing (the true codec is known after demux). mp4 audio is ~always AAC and
 * webm/mkv audio is ~always Opus. A mismatch (e.g. Vorbis-in-webm) is rejected
 * at demux — the same optimistic-probe contract the ogg(opus) input already uses.
 */
export const CONTAINER_AUDIO_CODEC: Readonly<Record<ContainerFamily, Exclude<SideCodec, 'pcm'>>> =
  Object.freeze({ mp4: 'aac', webm: 'opus', mkv: 'opus' });

/** Assumed video-track codec per family, for `canHandle` decoder probing. */
export const CONTAINER_VIDEO_CODEC: Readonly<Record<ContainerFamily, VideoSideCodec>> =
  Object.freeze({ mp4: 'h264', webm: 'vp9', mkv: 'h264' });

/** Lookup the container family for an input MIME, or `undefined`. */
export function containerFamilyFor(mime: string): ContainerFamily | undefined {
  return CONTAINER_INPUTS[mime];
}

/** Lookup the video output target for a MIME, or `undefined`. */
export function videoTargetFor(mime: string): VideoTarget | undefined {
  return VIDEO_TARGETS[mime];
}

// ---------------------------------------------------------------------------
// Options → encoder config mapping
// ---------------------------------------------------------------------------

/** Default quality when `ConvertOptions.quality` is omitted (mid-ladder). */
export const DEFAULT_QUALITY = 0.7;

/**
 * Buffer-all input cap. Every serializer takes a complete in-memory model, so a
 * hard cap protects against OOM. 256 MiB per the design note's conservative
 * default; revisit when a streaming muxer exists (decoded PCM expands well
 * beyond the compressed input size).
 */
export const MAX_INPUT_BYTES = 256 * 1024 * 1024;

/**
 * Map `quality` (0–1) to a codec bitrate in bits/s. The ladder is piecewise so
 * the default `quality = 0.7` lands exactly on the mid-ladder figure from the
 * design note (Opus 128 kbps, AAC 128 kbps stereo), with q=0 and q=1 at the
 * ladder ends. Mono is scaled to ~0.6×. Lossless FLAC returns `undefined`
 * (bitrate is not applicable).
 */
export function resolveBitrate(
  codec: SideCodec,
  quality: number,
  channels: number,
): number | undefined {
  const q = clamp01(quality);
  let stereo: number;
  switch (codec) {
    case 'opus':
      // 64 → 128 → 256 kbps across q 0 → 0.7 → 1.
      stereo = ladder(q, 64_000, 128_000, 256_000);
      break;
    case 'aac':
      // 96 → 128 → 256 kbps across q 0 → 0.7 → 1.
      stereo = ladder(q, 96_000, 128_000, 256_000);
      break;
    default:
      return undefined; // pcm / flac: no bitrate.
  }
  const scale = channels <= 1 ? 0.6 : 1;
  return Math.round(stereo * scale);
}

/**
 * Map video geometry + `quality` to a VP9/VP8 bitrate in bits/s. Resolution
 * drives the base (design note ladder: 720p ≈ 3 Mbps for VP9), scaled ±40% by
 * quality around the default `0.7`, with VP8 at ≈1.3× VP9. Clamped to a sane
 * floor so tiny test clips still get a positive bitrate.
 */
export function resolveVideoBitrate(
  width: number,
  height: number,
  quality: number,
  codec: 'vp9' | 'vp8',
): number {
  const q = clamp01(quality);
  const pixels = Math.max(1, width) * Math.max(1, height);
  const ratio = pixels / (1280 * 720);
  const base = VP9_720P_BPS * ratio;
  const scale =
    q <= DEFAULT_QUALITY
      ? 0.6 + (0.4 * q) / DEFAULT_QUALITY // q 0 → 0.6, q 0.7 → 1.0
      : 1.0 + (0.4 * (q - DEFAULT_QUALITY)) / (1 - DEFAULT_QUALITY); // q 1 → 1.4
  const codecFactor = codec === 'vp8' ? 1.3 : 1;
  return Math.max(VIDEO_MIN_BPS, Math.round(base * scale * codecFactor));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** VP9 base bitrate at 720p, quality 0.7. */
const VP9_720P_BPS = 3_000_000;
/** Floor so tiny clips still get a positive, encodable bitrate. */
const VIDEO_MIN_BPS = 100_000;

function clamp01(v: number): number {
  if (Number.isNaN(v)) return DEFAULT_QUALITY;
  return Math.max(0, Math.min(1, v));
}

/**
 * Piecewise-linear ladder through (0, lo), (0.7, mid), (1, hi). The knee at 0.7
 * makes the default quality resolve to `mid` exactly.
 */
function ladder(q: number, lo: number, mid: number, hi: number): number {
  const KNEE = DEFAULT_QUALITY;
  if (q <= KNEE) return lo + ((mid - lo) * q) / KNEE;
  return mid + ((hi - mid) * (q - KNEE)) / (1 - KNEE);
}
