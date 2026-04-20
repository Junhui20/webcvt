/**
 * Lookup tables for codec selection in @webcvt/backend-wasm.
 *
 * All codec decisions flow through these tables — no user-controlled strings
 * ever reach ffmpeg argv directly (Trap #8, #4).
 *
 * Tables are pure data: no side effects, no imports beyond types.
 */

// ---------------------------------------------------------------------------
// Codec alias map (Trap #8)
// ---------------------------------------------------------------------------

/**
 * Maps user-facing codec shorthand to the ffmpeg encoder name.
 * Keys are lowercase normalised inputs from ConvertOptions.codec.
 *
 * H.264:  h264  → libx264
 * HEVC:   hevc  → libx265
 * AV1:    av1   → libaom-av1
 * VP9:    vp9   → libvpx-vp9
 * VP8:    vp8   → libvpx
 * MPEG-2: mpeg2 → mpeg2video
 * MPEG-4: mpeg4 → mpeg4  (already ffmpeg name)
 * MP3:    mp3   → libmp3lame
 * AAC:    aac   → aac    (ffmpeg built-in)
 * Opus:   opus  → libopus
 * Vorbis: vorbis→ libvorbis
 * FLAC:   flac  → flac   (ffmpeg built-in)
 * PCM:    pcm   → pcm_s16le
 */
export const CODEC_ALIAS_MAP: Readonly<Record<string, string>> = {
  h264: 'libx264',
  'h.264': 'libx264',
  avc: 'libx264',
  hevc: 'libx265',
  'h.265': 'libx265',
  h265: 'libx265',
  av1: 'libaom-av1',
  vp9: 'libvpx-vp9',
  vp8: 'libvpx',
  mpeg2: 'mpeg2video',
  'mpeg-2': 'mpeg2video',
  mpeg4: 'mpeg4',
  'mpeg-4': 'mpeg4',
  mp3: 'libmp3lame',
  aac: 'aac',
  opus: 'libopus',
  vorbis: 'libvorbis',
  flac: 'flac',
  pcm: 'pcm_s16le',
  // Pass-through known ffmpeg names unchanged
  libx264: 'libx264',
  libx265: 'libx265',
  'libaom-av1': 'libaom-av1',
  'libvpx-vp9': 'libvpx-vp9',
  libvpx: 'libvpx',
  mpeg2video: 'mpeg2video',
  libmp3lame: 'libmp3lame',
  libopus: 'libopus',
  libvorbis: 'libvorbis',
  pcm_s16le: 'pcm_s16le',
} as const;

/**
 * Resolves a user codec string to the ffmpeg encoder name.
 *
 * @param userCodec - Value of ConvertOptions.codec (normalised to lowercase).
 * @returns The ffmpeg encoder name, or undefined if not in the alias map.
 */
export function resolveCodecAlias(userCodec: string): string | undefined {
  return CODEC_ALIAS_MAP[userCodec.toLowerCase()];
}

// ---------------------------------------------------------------------------
// Default video codec per output container MIME
// ---------------------------------------------------------------------------

/**
 * Default video encoder for each output MIME type.
 * Used when no explicit codec override is provided.
 */
export const CONTAINER_DEFAULT_VIDEO_CODEC: Readonly<Record<string, string>> = {
  'video/mp4': 'libx264',
  'video/webm': 'libvpx-vp9',
  'video/x-matroska': 'libx264',
  'video/quicktime': 'libx264',
  'video/x-msvideo': 'libx264',
  'video/x-flv': 'libx264',
  'video/3gpp': 'libx264',
} as const;

// ---------------------------------------------------------------------------
// Default audio codec per output MIME
// ---------------------------------------------------------------------------

/**
 * Default audio encoder for each output MIME type.
 * Video containers use their paired audio codec; audio containers encode directly.
 */
export const CONTAINER_DEFAULT_AUDIO_CODEC: Readonly<Record<string, string>> = {
  // Video containers → paired audio
  'video/mp4': 'aac',
  'video/webm': 'libopus',
  'video/x-matroska': 'aac',
  'video/quicktime': 'aac',
  'video/x-msvideo': 'libmp3lame',
  'video/x-flv': 'aac',
  'video/3gpp': 'aac',
  // Audio containers → direct audio encoder
  'audio/mp4': 'aac',
  'audio/mpeg': 'libmp3lame',
  'audio/flac': 'flac',
  'audio/ogg': 'libvorbis',
  'audio/opus': 'libopus',
  'audio/wav': 'pcm_s16le',
  'audio/aac': 'aac',
} as const;

// ---------------------------------------------------------------------------
// Quality flag dispatch (Trap #9)
// ---------------------------------------------------------------------------

/** Codec families that use CRF (-crf) for quality control. */
export const CRF_CODECS = new Set([
  'libx264',
  'libx265',
  'libvpx-vp9',
  'libaom-av1',
  'mpeg2video',
  'mpeg4',
]);

/** Codec families that use -q:a for quality control (VBR). */
export const QA_CODECS = new Set(['libmp3lame', 'libvorbis']);

/** Codec families that use -b:a (bitrate) for quality control. */
export const BA_CODECS = new Set(['aac', 'libopus', 'flac', 'pcm_s16le']);

/**
 * CRF ranges per codec family.
 * quality=0 → best (lowest CRF), quality=1 → worst (highest CRF).
 *
 * Inversion: CRF is inverse of quality (lower number = better quality).
 */
const CRF_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  libx264: [0, 51],
  libx265: [0, 51],
  'libvpx-vp9': [0, 63],
  'libaom-av1': [0, 63],
  mpeg2video: [1, 31],
  mpeg4: [1, 31],
} as const;

/**
 * Quality-to-bitrate table for -b:a codecs.
 * quality=0 → low, quality=0.5 → medium, quality=1 → high.
 */
const BA_BITRATES: Readonly<Record<string, readonly [number, number, number]>> = {
  // [low, medium, high] kbps
  aac: [64, 192, 320],
  libopus: [32, 128, 256],
  flac: [0, 0, 0], // lossless; bitrate irrelevant but we still need a value
  pcm_s16le: [0, 0, 0], // lossless; no bitrate control
} as const;

/**
 * Computes quality-appropriate ffmpeg flags for the given codec.
 *
 * @param codec - The resolved ffmpeg encoder name.
 * @param quality - Quality hint 0–1 from ConvertOptions (undefined → 0.7 default).
 * @returns Array of flag strings to append to argv.
 */
export function mapQualityFlags(codec: string, quality: number | undefined): readonly string[] {
  const q = quality ?? 0.7;

  if (CRF_CODECS.has(codec)) {
    const range = CRF_RANGES[codec];
    if (range === undefined) return [];
    const [minCrf, maxCrf] = range;
    // quality 1 → best → lowest CRF; quality 0 → worst → highest CRF
    const crf = Math.round(minCrf + (1 - q) * (maxCrf - minCrf));
    return ['-crf', String(crf)];
  }

  if (QA_CODECS.has(codec)) {
    // libmp3lame: q:a 0 = best, 9 = worst
    const qa = Math.round((1 - q) * 9);
    return ['-q:a', String(qa)];
  }

  if (BA_CODECS.has(codec)) {
    const rates = BA_BITRATES[codec];
    if (rates === undefined || rates[0] === 0) return []; // lossless
    const [low, mid, high] = rates;
    let kbps: number;
    if (q < 0.33) {
      kbps = low;
    } else if (q < 0.67) {
      kbps = mid;
    } else {
      kbps = high;
    }
    return ['-b:a', `${kbps}k`];
  }

  return [];
}
