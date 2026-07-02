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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
