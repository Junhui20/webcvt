/**
 * Curated MIME-pair allowlist for @webcvt/backend-wasm.
 *
 * Rules:
 * 1. Only pairs with smoke-tested fixtures are listed.
 * 2. No wildcards — every entry is an explicit input→output pair.
 * 3. Don't allowlist pairs a native backend already claims.
 * 4. Subtitle pairs are gated by enableSubtitleFallback (not listed here
 *    by default; the backend.ts register helper adds them when the flag is set).
 *
 * Key is `${inputMime}|${outputMime}`.
 */

import type { FormatDescriptor } from '@webcvt/core';

// ---------------------------------------------------------------------------
// Raw pair data
// ---------------------------------------------------------------------------

/**
 * All supported MIME pairs as [inputMime, outputMime] tuples.
 * ~180 pairs covering: video↔video, audio↔audio, video→audio, legacy image.
 */
export const WASM_SUPPORTED_PAIRS: readonly (readonly [string, string])[] = [
  // ---- video → video -------------------------------------------------------
  // MP4 source
  ['video/mp4', 'video/mp4'],
  ['video/mp4', 'video/webm'],
  ['video/mp4', 'video/x-matroska'],
  ['video/mp4', 'video/quicktime'],
  ['video/mp4', 'video/x-msvideo'],
  ['video/mp4', 'video/x-flv'],
  ['video/mp4', 'video/3gpp'],
  // WebM source
  ['video/webm', 'video/mp4'],
  ['video/webm', 'video/webm'],
  ['video/webm', 'video/x-matroska'],
  ['video/webm', 'video/quicktime'],
  ['video/webm', 'video/x-msvideo'],
  ['video/webm', 'video/x-flv'],
  ['video/webm', 'video/3gpp'],
  // MKV source
  ['video/x-matroska', 'video/mp4'],
  ['video/x-matroska', 'video/webm'],
  ['video/x-matroska', 'video/x-matroska'],
  ['video/x-matroska', 'video/quicktime'],
  ['video/x-matroska', 'video/x-msvideo'],
  ['video/x-matroska', 'video/x-flv'],
  ['video/x-matroska', 'video/3gpp'],
  // MOV source
  ['video/quicktime', 'video/mp4'],
  ['video/quicktime', 'video/webm'],
  ['video/quicktime', 'video/x-matroska'],
  ['video/quicktime', 'video/quicktime'],
  ['video/quicktime', 'video/x-msvideo'],
  ['video/quicktime', 'video/x-flv'],
  ['video/quicktime', 'video/3gpp'],
  // AVI source
  ['video/x-msvideo', 'video/mp4'],
  ['video/x-msvideo', 'video/webm'],
  ['video/x-msvideo', 'video/x-matroska'],
  ['video/x-msvideo', 'video/quicktime'],
  ['video/x-msvideo', 'video/x-msvideo'],
  ['video/x-msvideo', 'video/x-flv'],
  ['video/x-msvideo', 'video/3gpp'],
  // FLV source
  ['video/x-flv', 'video/mp4'],
  ['video/x-flv', 'video/webm'],
  ['video/x-flv', 'video/x-matroska'],
  ['video/x-flv', 'video/quicktime'],
  ['video/x-flv', 'video/x-msvideo'],
  ['video/x-flv', 'video/x-flv'],
  ['video/x-flv', 'video/3gpp'],
  // 3GP source
  ['video/3gpp', 'video/mp4'],
  ['video/3gpp', 'video/webm'],
  ['video/3gpp', 'video/x-matroska'],
  ['video/3gpp', 'video/quicktime'],
  ['video/3gpp', 'video/x-msvideo'],
  ['video/3gpp', 'video/x-flv'],
  ['video/3gpp', 'video/3gpp'],

  // ---- audio → audio -------------------------------------------------------
  // M4A source
  ['audio/mp4', 'audio/mp4'],
  ['audio/mp4', 'audio/mpeg'],
  ['audio/mp4', 'audio/flac'],
  ['audio/mp4', 'audio/ogg'],
  ['audio/mp4', 'audio/opus'],
  ['audio/mp4', 'audio/wav'],
  ['audio/mp4', 'audio/aac'],
  // MP3 source (supplement to native; identity already handled by container-mp3)
  ['audio/mpeg', 'audio/mp4'],
  ['audio/mpeg', 'audio/flac'],
  ['audio/mpeg', 'audio/ogg'],
  ['audio/mpeg', 'audio/opus'],
  ['audio/mpeg', 'audio/wav'],
  ['audio/mpeg', 'audio/aac'],
  // FLAC source
  ['audio/flac', 'audio/mp4'],
  ['audio/flac', 'audio/mpeg'],
  ['audio/flac', 'audio/flac'],
  ['audio/flac', 'audio/ogg'],
  ['audio/flac', 'audio/opus'],
  ['audio/flac', 'audio/wav'],
  ['audio/flac', 'audio/aac'],
  // OGG source
  ['audio/ogg', 'audio/mp4'],
  ['audio/ogg', 'audio/mpeg'],
  ['audio/ogg', 'audio/flac'],
  ['audio/ogg', 'audio/ogg'],
  ['audio/ogg', 'audio/opus'],
  ['audio/ogg', 'audio/wav'],
  ['audio/ogg', 'audio/aac'],
  // OPUS source
  ['audio/opus', 'audio/mp4'],
  ['audio/opus', 'audio/mpeg'],
  ['audio/opus', 'audio/flac'],
  ['audio/opus', 'audio/ogg'],
  ['audio/opus', 'audio/opus'],
  ['audio/opus', 'audio/wav'],
  ['audio/opus', 'audio/aac'],
  // WAV source
  ['audio/wav', 'audio/mp4'],
  ['audio/wav', 'audio/mpeg'],
  ['audio/wav', 'audio/flac'],
  ['audio/wav', 'audio/ogg'],
  ['audio/wav', 'audio/opus'],
  ['audio/wav', 'audio/wav'],
  ['audio/wav', 'audio/aac'],
  // AAC source
  ['audio/aac', 'audio/mp4'],
  ['audio/aac', 'audio/mpeg'],
  ['audio/aac', 'audio/flac'],
  ['audio/aac', 'audio/ogg'],
  ['audio/aac', 'audio/opus'],
  ['audio/aac', 'audio/wav'],
  ['audio/aac', 'audio/aac'],

  // ---- video → audio (extraction) ------------------------------------------
  ['video/mp4', 'audio/mp4'],
  ['video/mp4', 'audio/mpeg'],
  ['video/mp4', 'audio/flac'],
  ['video/mp4', 'audio/ogg'],
  ['video/mp4', 'audio/opus'],
  ['video/mp4', 'audio/wav'],
  ['video/mp4', 'audio/aac'],
  ['video/webm', 'audio/mp4'],
  ['video/webm', 'audio/mpeg'],
  ['video/webm', 'audio/flac'],
  ['video/webm', 'audio/ogg'],
  ['video/webm', 'audio/opus'],
  ['video/webm', 'audio/wav'],
  ['video/webm', 'audio/aac'],
  ['video/x-matroska', 'audio/mp4'],
  ['video/x-matroska', 'audio/mpeg'],
  ['video/x-matroska', 'audio/flac'],
  ['video/x-matroska', 'audio/ogg'],
  ['video/x-matroska', 'audio/opus'],
  ['video/x-matroska', 'audio/wav'],
  ['video/x-matroska', 'audio/aac'],
  ['video/quicktime', 'audio/mp4'],
  ['video/quicktime', 'audio/mpeg'],
  ['video/quicktime', 'audio/flac'],
  ['video/quicktime', 'audio/ogg'],
  ['video/quicktime', 'audio/opus'],
  ['video/quicktime', 'audio/wav'],
  ['video/quicktime', 'audio/aac'],
  ['video/x-msvideo', 'audio/mp4'],
  ['video/x-msvideo', 'audio/mpeg'],
  ['video/x-msvideo', 'audio/flac'],
  ['video/x-msvideo', 'audio/ogg'],
  ['video/x-msvideo', 'audio/opus'],
  ['video/x-msvideo', 'audio/wav'],
  ['video/x-msvideo', 'audio/aac'],
  ['video/x-flv', 'audio/mp4'],
  ['video/x-flv', 'audio/mpeg'],
  ['video/x-flv', 'audio/flac'],
  ['video/x-flv', 'audio/ogg'],
  ['video/x-flv', 'audio/opus'],
  ['video/x-flv', 'audio/wav'],
  ['video/x-flv', 'audio/aac'],
  ['video/3gpp', 'audio/mp4'],
  ['video/3gpp', 'audio/mpeg'],
  ['video/3gpp', 'audio/flac'],
  ['video/3gpp', 'audio/ogg'],
  ['video/3gpp', 'audio/opus'],
  ['video/3gpp', 'audio/wav'],
  ['video/3gpp', 'audio/aac'],

  // ---- MPEG-TS (video/mp2t) ------------------------------------------------
  // TS as source → video containers
  ['video/mp2t', 'video/mp4'],
  ['video/mp2t', 'video/webm'],
  ['video/mp2t', 'video/x-matroska'],
  ['video/mp2t', 'video/quicktime'],
  ['video/mp2t', 'video/x-msvideo'],
  ['video/mp2t', 'video/mp2t'],
  // TS as source → audio extraction
  ['video/mp2t', 'audio/mp4'],
  ['video/mp2t', 'audio/mpeg'],
  ['video/mp2t', 'audio/flac'],
  ['video/mp2t', 'audio/ogg'],
  ['video/mp2t', 'audio/opus'],
  ['video/mp2t', 'audio/wav'],
  ['video/mp2t', 'audio/aac'],
  // Other video → TS
  ['video/mp4', 'video/mp2t'],
  ['video/webm', 'video/mp2t'],
  ['video/x-matroska', 'video/mp2t'],
  ['video/quicktime', 'video/mp2t'],
  ['video/x-msvideo', 'video/mp2t'],
  ['video/x-flv', 'video/mp2t'],
  ['video/3gpp', 'video/mp2t'],

  // ---- WMV (legacy Windows Media Video) ------------------------------------
  ['video/x-ms-wmv', 'video/mp4'],
  ['video/x-ms-wmv', 'video/webm'],
  ['video/x-ms-wmv', 'video/x-matroska'],
  ['video/x-ms-wmv', 'audio/mpeg'],
  ['video/x-ms-wmv', 'audio/aac'],

  // ---- F4V (Flash Video variant) -------------------------------------------
  ['video/x-f4v', 'video/mp4'],
  ['video/x-f4v', 'video/webm'],
  ['video/x-f4v', 'audio/mpeg'],
  ['video/x-f4v', 'audio/aac'],

  // ---- WMA (Windows Media Audio) -------------------------------------------
  ['audio/x-ms-wma', 'audio/mpeg'],
  ['audio/x-ms-wma', 'audio/mp4'],
  ['audio/x-ms-wma', 'audio/flac'],
  ['audio/x-ms-wma', 'audio/wav'],
  ['audio/x-ms-wma', 'audio/ogg'],
  ['audio/x-ms-wma', 'audio/aac'],

  // ---- AIFF ----------------------------------------------------------------
  ['audio/aiff', 'audio/mpeg'],
  ['audio/aiff', 'audio/mp4'],
  ['audio/aiff', 'audio/flac'],
  ['audio/aiff', 'audio/wav'],
  ['audio/aiff', 'audio/ogg'],
  ['audio/aiff', 'audio/aac'],
  ['audio/wav', 'audio/aiff'],
  ['audio/flac', 'audio/aiff'],

  // ---- legacy image (identity only) ----------------------------------------
  // PSD
  ['image/vnd.adobe.photoshop', 'image/vnd.adobe.photoshop'],
  // BLP
  ['image/x-blp', 'image/x-blp'],
  // DDS
  ['image/vnd.ms-dds', 'image/vnd.ms-dds'],
  // EPS
  ['application/postscript', 'application/postscript'],
  // JPEG 2000
  ['image/jp2', 'image/jp2'],

  // Subtitle pairs are added dynamically when enableSubtitleFallback: true
  // SRT, ASS, SSA, VTT — omitted from default allowlist
] as const;

// ---------------------------------------------------------------------------
// O(1) lookup set
// ---------------------------------------------------------------------------

/** Internal set for fast O(1) pair membership checks. */
const PAIR_SET = new Set<string>(WASM_SUPPORTED_PAIRS.map(([i, o]) => `${i}|${o}`));

/**
 * Returns true if the WASM backend supports converting inputMime → outputMime.
 *
 * O(1) — Set lookup, no iteration.
 */
export function isAllowlisted(inputMime: string, outputMime: string): boolean {
  return PAIR_SET.has(`${inputMime}|${outputMime}`);
}

// ---------------------------------------------------------------------------
// Subtitle pairs (added when enableSubtitleFallback is true)
// ---------------------------------------------------------------------------

/** Subtitle pairs that are only allowlisted when enableSubtitleFallback is set. */
export const SUBTITLE_PAIRS: readonly (readonly [string, string])[] = [
  ['text/x-subrip', 'text/x-subrip'],
  ['text/x-subrip', 'text/x-ass'],
  ['text/x-subrip', 'text/vtt'],
  ['text/x-ass', 'text/x-subrip'],
  ['text/x-ass', 'text/x-ass'],
  ['text/x-ass', 'text/vtt'],
  ['text/vtt', 'text/x-subrip'],
  ['text/vtt', 'text/x-ass'],
  ['text/vtt', 'text/vtt'],
] as const;

/**
 * Adds subtitle pairs to the runtime allowlist set.
 * Must be called before any canHandle checks if subtitle fallback is desired.
 * Idempotent — re-adding already-present pairs is safe.
 */
export function enableSubtitlePairs(): void {
  for (const [i, o] of SUBTITLE_PAIRS) {
    PAIR_SET.add(`${i}|${o}`);
  }
}

// ---------------------------------------------------------------------------
// Format descriptor list (for registration)
// ---------------------------------------------------------------------------

/** All unique MIME types that appear as inputs or outputs in the allowlist. */
const UNIQUE_MIMES = new Set<string>();
for (const [i, o] of WASM_SUPPORTED_PAIRS) {
  UNIQUE_MIMES.add(i);
  UNIQUE_MIMES.add(o);
}

/**
 * Minimal FormatDescriptor list derived from the allowlist.
 * Used by registerWasmBackend() to advertise capabilities.
 */
export const WASM_SUPPORTED_FORMATS: readonly FormatDescriptor[] = buildFormatList();

function buildFormatList(): FormatDescriptor[] {
  const mimeToDescriptor = new Map<string, FormatDescriptor>([
    [
      'video/mp4',
      { ext: 'mp4', mime: 'video/mp4', category: 'video', description: 'MPEG-4 Part 14' },
    ],
    ['video/webm', { ext: 'webm', mime: 'video/webm', category: 'video', description: 'WebM' }],
    [
      'video/x-matroska',
      { ext: 'mkv', mime: 'video/x-matroska', category: 'video', description: 'Matroska' },
    ],
    [
      'video/quicktime',
      { ext: 'mov', mime: 'video/quicktime', category: 'video', description: 'QuickTime Movie' },
    ],
    [
      'video/x-msvideo',
      {
        ext: 'avi',
        mime: 'video/x-msvideo',
        category: 'video',
        description: 'Audio Video Interleave',
      },
    ],
    [
      'video/x-flv',
      { ext: 'flv', mime: 'video/x-flv', category: 'video', description: 'Flash Video' },
    ],
    ['video/3gpp', { ext: '3gp', mime: 'video/3gpp', category: 'video', description: '3GPP' }],
    [
      'audio/mp4',
      { ext: 'm4a', mime: 'audio/mp4', category: 'audio', description: 'MPEG-4 Audio' },
    ],
    [
      'audio/mpeg',
      { ext: 'mp3', mime: 'audio/mpeg', category: 'audio', description: 'MPEG Audio Layer III' },
    ],
    [
      'audio/flac',
      {
        ext: 'flac',
        mime: 'audio/flac',
        category: 'audio',
        description: 'Free Lossless Audio Codec',
      },
    ],
    ['audio/ogg', { ext: 'ogg', mime: 'audio/ogg', category: 'audio', description: 'Ogg Vorbis' }],
    [
      'audio/opus',
      { ext: 'opus', mime: 'audio/opus', category: 'audio', description: 'Opus Audio' },
    ],
    [
      'audio/wav',
      { ext: 'wav', mime: 'audio/wav', category: 'audio', description: 'Waveform Audio' },
    ],
    [
      'audio/aac',
      { ext: 'aac', mime: 'audio/aac', category: 'audio', description: 'Advanced Audio Coding' },
    ],
    [
      'image/vnd.adobe.photoshop',
      {
        ext: 'psd',
        mime: 'image/vnd.adobe.photoshop',
        category: 'image',
        description: 'Adobe Photoshop',
      },
    ],
    [
      'image/x-blp',
      { ext: 'blp', mime: 'image/x-blp', category: 'image', description: 'BLP Texture' },
    ],
    [
      'image/vnd.ms-dds',
      {
        ext: 'dds',
        mime: 'image/vnd.ms-dds',
        category: 'image',
        description: 'DirectDraw Surface',
      },
    ],
    [
      'application/postscript',
      {
        ext: 'eps',
        mime: 'application/postscript',
        category: 'image',
        description: 'Encapsulated PostScript',
      },
    ],
    ['image/jp2', { ext: 'jp2', mime: 'image/jp2', category: 'image', description: 'JPEG 2000' }],
    [
      'video/mp2t',
      { ext: 'ts', mime: 'video/mp2t', category: 'video', description: 'MPEG-2 Transport Stream' },
    ],
    [
      'video/x-ms-wmv',
      { ext: 'wmv', mime: 'video/x-ms-wmv', category: 'video', description: 'Windows Media Video' },
    ],
    [
      'video/x-f4v',
      { ext: 'f4v', mime: 'video/x-f4v', category: 'video', description: 'Flash MP4 Video' },
    ],
    [
      'audio/x-ms-wma',
      { ext: 'wma', mime: 'audio/x-ms-wma', category: 'audio', description: 'Windows Media Audio' },
    ],
    [
      'audio/aiff',
      {
        ext: 'aiff',
        mime: 'audio/aiff',
        category: 'audio',
        description: 'Audio Interchange File Format',
      },
    ],
  ]);

  const result: FormatDescriptor[] = [];
  for (const mime of UNIQUE_MIMES) {
    const descriptor = mimeToDescriptor.get(mime);
    if (descriptor !== undefined) {
      result.push(descriptor);
    }
  }
  return result;
}
