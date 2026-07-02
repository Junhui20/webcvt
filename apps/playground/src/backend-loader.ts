import { defaultRegistry, findByExt } from '@catlabtech/webcvt-core';
import type { BackendRegistry, FormatDescriptor } from '@catlabtech/webcvt-core';

export interface TargetOption {
  readonly format: FormatDescriptor;
  readonly loader: () => Promise<void>;
  /**
   * Optional runtime capability gate. When present and it returns `false`, the
   * target is hidden by {@link getTargetsFor} — used for the WebCodecs transcode
   * targets so browsers without `VideoEncoder`/`AudioEncoder` never advertise a
   * conversion that would fail to find a backend.
   */
  readonly available?: () => boolean;
}

/** Resolve a format descriptor, throwing if the ext is unknown. */
function fmt(ext: string): FormatDescriptor {
  const f = findByExt(ext);
  if (!f) throw new Error(`Unknown format: ${ext}`);
  return f;
}

/**
 * Invoke a package's `registerXxx()` helper against the default registry,
 * tolerating duplicate registration (can happen when the same loader runs twice
 * across a user session — e.g. png→webp then png→jpeg both load image-canvas).
 * The registry throws when a backend name is already present; that specific case
 * is a no-op here, and anything else is re-thrown.
 */
function tryRegister(register: (registry?: BackendRegistry) => unknown): void {
  try {
    register(defaultRegistry);
  } catch (err) {
    if (err instanceof Error && err.message.includes('already registered')) return;
    throw err;
  }
}

const imageCanvasLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-image-canvas');
  tryRegister(mod.registerCanvasBackend);
};
const imageLegacyLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-image-legacy');
  tryRegister(mod.registerImageLegacyBackend);
};
const subtitleLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-subtitle');
  tryRegister(mod.registerSubtitleBackend);
};
const dataTextLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-data-text');
  tryRegister(mod.registerDataTextBackend);
};
const archiveZipLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-archive-zip');
  tryRegister(mod.registerArchiveBackend);
};
const jxlLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-image-jsquash-jxl');
  tryRegister(mod.registerJxlBackend);
};
const avifLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-image-jsquash-avif');
  tryRegister(mod.registerAvifBackend);
};
const pdfLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-image-pdf');
  tryRegister(mod.registerPdfBackend);
};
const heicLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-image-heic');
  tryRegister(mod.registerHeicBackend);
};

// ---------------------------------------------------------------------------
// WebCodecs transcode (audio + video) — capability-gated
// ---------------------------------------------------------------------------

/** True when the runtime can decode audio via WebCodecs (needed for → wav). */
const hasAudioDecode = (): boolean => typeof globalThis.AudioDecoder !== 'undefined';
/** True when the runtime can decode AND encode audio (needed for → opus/aac/flac). */
const hasAudioEncode = (): boolean =>
  typeof globalThis.AudioEncoder !== 'undefined' && typeof globalThis.AudioDecoder !== 'undefined';
/** True when the runtime can decode AND encode video (needed for → webm/mkv). */
const hasVideoTranscode = (): boolean =>
  typeof globalThis.VideoEncoder !== 'undefined' && typeof globalThis.VideoDecoder !== 'undefined';

/**
 * Register the single WebCodecs transcode backend. It no-ops on runtimes with no
 * WebCodecs at all; `canHandle` still probes each concrete codec pair, so an
 * unsupported pair falls through cleanly.
 */
const transcodeLoader = async (): Promise<void> => {
  if (!hasAudioDecode() && !hasVideoTranscode()) return; // no WebCodecs — no-op.
  const mod = await import('@catlabtech/webcvt-transcode');
  tryRegister(mod.registerTranscodeBackend);
};

/** WebCodecs transcode target that only needs an audio DECODER (→ wav / PCM). */
const audioDecodeTarget = (ext: string): TargetOption => ({
  format: fmt(ext),
  loader: transcodeLoader,
  available: hasAudioDecode,
});
/** WebCodecs transcode target that needs an audio ENCODER (→ opus/ogg/aac/flac). */
const audioEncodeTarget = (ext: string): TargetOption => ({
  format: fmt(ext),
  loader: transcodeLoader,
  available: hasAudioEncode,
});
/** WebCodecs transcode target that needs a video decoder + encoder (→ webm/mkv). */
const videoTarget = (ext: string): TargetOption => ({
  format: fmt(ext),
  loader: transcodeLoader,
  available: hasVideoTranscode,
});

/**
 * Allowlist mapping input file extension to available conversion targets.
 * Each target carries the lazy-loader for its backend package.
 */
export const BACKEND_ALLOWLIST: Readonly<Record<string, readonly TargetOption[]>> = {
  // Image — canvas backend
  png: [
    { format: fmt('webp'), loader: imageCanvasLoader },
    { format: fmt('jpeg'), loader: imageCanvasLoader },
    { format: fmt('bmp'), loader: imageCanvasLoader },
    { format: fmt('ico'), loader: imageCanvasLoader },
    { format: fmt('jxl'), loader: jxlLoader },
    { format: fmt('avif'), loader: avifLoader },
    { format: fmt('pdf'), loader: pdfLoader },
  ],
  jpg: [
    { format: fmt('png'), loader: imageCanvasLoader },
    { format: fmt('webp'), loader: imageCanvasLoader },
    { format: fmt('bmp'), loader: imageCanvasLoader },
    { format: fmt('ico'), loader: imageCanvasLoader },
    { format: fmt('jxl'), loader: jxlLoader },
    { format: fmt('avif'), loader: avifLoader },
    { format: fmt('pdf'), loader: pdfLoader },
  ],
  jpeg: [
    { format: fmt('png'), loader: imageCanvasLoader },
    { format: fmt('webp'), loader: imageCanvasLoader },
    { format: fmt('bmp'), loader: imageCanvasLoader },
    { format: fmt('ico'), loader: imageCanvasLoader },
    { format: fmt('jxl'), loader: jxlLoader },
    { format: fmt('avif'), loader: avifLoader },
    { format: fmt('pdf'), loader: pdfLoader },
  ],
  webp: [
    { format: fmt('png'), loader: imageCanvasLoader },
    { format: fmt('jpeg'), loader: imageCanvasLoader },
    { format: fmt('bmp'), loader: imageCanvasLoader },
    { format: fmt('jxl'), loader: jxlLoader },
    { format: fmt('avif'), loader: avifLoader },
    { format: fmt('pdf'), loader: pdfLoader },
  ],
  // JPEG XL (modern codec — @jsquash/jxl wasm)
  jxl: [
    { format: fmt('png'), loader: jxlLoader },
    { format: fmt('jpeg'), loader: jxlLoader },
    { format: fmt('webp'), loader: jxlLoader },
  ],
  // AVIF (modern codec — @jsquash/avif wasm)
  avif: [
    { format: fmt('png'), loader: avifLoader },
    { format: fmt('jpeg'), loader: avifLoader },
    { format: fmt('webp'), loader: avifLoader },
  ],
  // HEIC / HEIF (iPhone photos — libheif wasm, decode-only)
  heic: [
    { format: fmt('jpeg'), loader: heicLoader },
    { format: fmt('png'), loader: heicLoader },
    { format: fmt('webp'), loader: heicLoader },
  ],
  heif: [
    { format: fmt('jpeg'), loader: heicLoader },
    { format: fmt('png'), loader: heicLoader },
    { format: fmt('webp'), loader: heicLoader },
  ],
  gif: [
    { format: fmt('png'), loader: imageCanvasLoader },
    { format: fmt('webp'), loader: imageCanvasLoader },
    { format: fmt('pdf'), loader: pdfLoader },
  ],
  bmp: [
    { format: fmt('png'), loader: imageCanvasLoader },
    { format: fmt('webp'), loader: imageCanvasLoader },
    { format: fmt('jpeg'), loader: imageCanvasLoader },
    { format: fmt('pdf'), loader: pdfLoader },
  ],
  // Image — legacy backend (TIFF, TGA, QOI, Netpbm)
  tiff: [
    { format: fmt('png'), loader: imageLegacyLoader },
    { format: fmt('bmp'), loader: imageLegacyLoader },
  ],
  tga: [
    { format: fmt('png'), loader: imageLegacyLoader },
    { format: fmt('bmp'), loader: imageLegacyLoader },
  ],
  qoi: [
    { format: fmt('png'), loader: imageLegacyLoader },
    { format: fmt('bmp'), loader: imageLegacyLoader },
  ],
  // Subtitle — subtitle backend
  srt: [
    { format: fmt('vtt'), loader: subtitleLoader },
    { format: fmt('ass'), loader: subtitleLoader },
  ],
  vtt: [
    { format: fmt('srt'), loader: subtitleLoader },
    { format: fmt('ass'), loader: subtitleLoader },
  ],
  ass: [
    { format: fmt('srt'), loader: subtitleLoader },
    { format: fmt('vtt'), loader: subtitleLoader },
  ],
  // Data-text — data-text backend
  csv: [
    { format: fmt('tsv'), loader: dataTextLoader },
    { format: fmt('json'), loader: dataTextLoader },
  ],
  tsv: [
    { format: fmt('csv'), loader: dataTextLoader },
    { format: fmt('json'), loader: dataTextLoader },
  ],
  json: [
    { format: fmt('csv'), loader: dataTextLoader },
    { format: fmt('yaml'), loader: dataTextLoader },
  ],
  // Archive — archive-zip backend
  zip: [{ format: fmt('tar'), loader: archiveZipLoader }],

  // -------------------------------------------------------------------------
  // Audio — WebCodecs transcode backend (capability-gated). Only shown on
  // runtimes with the matching WebCodecs classes; otherwise hidden so the UI
  // never advertises a conversion with no backend.
  // -------------------------------------------------------------------------
  mp3: [
    audioDecodeTarget('wav'),
    audioEncodeTarget('opus'),
    audioEncodeTarget('ogg'),
    audioEncodeTarget('aac'),
    audioEncodeTarget('flac'),
  ],
  wav: [
    audioEncodeTarget('opus'),
    audioEncodeTarget('ogg'),
    audioEncodeTarget('aac'),
    audioEncodeTarget('flac'),
  ],
  ogg: [
    audioDecodeTarget('wav'),
    audioEncodeTarget('opus'),
    audioEncodeTarget('aac'),
    audioEncodeTarget('flac'),
  ],
  opus: [
    audioDecodeTarget('wav'),
    audioEncodeTarget('ogg'),
    audioEncodeTarget('aac'),
    audioEncodeTarget('flac'),
  ],
  flac: [
    audioDecodeTarget('wav'),
    audioEncodeTarget('opus'),
    audioEncodeTarget('ogg'),
    audioEncodeTarget('aac'),
  ],
  aac: [
    audioDecodeTarget('wav'),
    audioEncodeTarget('opus'),
    audioEncodeTarget('ogg'),
    audioEncodeTarget('flac'),
  ],
  m4a: [
    audioDecodeTarget('wav'),
    audioEncodeTarget('opus'),
    audioEncodeTarget('ogg'),
    audioEncodeTarget('aac'),
    audioEncodeTarget('flac'),
  ],

  // -------------------------------------------------------------------------
  // Video — WebCodecs transcode backend (VP9|VP8 + Opus). Video targets need
  // VideoEncoder/Decoder; the audio-extraction targets need AudioDecoder.
  // -------------------------------------------------------------------------
  mp4: [
    videoTarget('webm'),
    videoTarget('mkv'),
    audioDecodeTarget('wav'),
    audioEncodeTarget('opus'),
  ],
  webm: [
    videoTarget('webm'),
    videoTarget('mkv'),
    audioDecodeTarget('wav'),
    audioEncodeTarget('opus'),
  ],
  mkv: [
    videoTarget('webm'),
    videoTarget('mkv'),
    audioDecodeTarget('wav'),
    audioEncodeTarget('opus'),
  ],
};

/**
 * Return target options for a given input extension.
 * Returns an empty array for unsupported formats. Targets with an `available`
 * capability gate that currently returns `false` (e.g. WebCodecs transcode on a
 * runtime lacking `VideoEncoder`/`AudioEncoder`) are filtered out.
 */
export function getTargetsFor(inputExt: string): readonly TargetOption[] {
  const targets = BACKEND_ALLOWLIST[inputExt.toLowerCase()] ?? [];
  return targets.filter((t) => t.available === undefined || t.available());
}

/**
 * Dynamically import the backend package for a target option.
 * After awaiting, the backend is registered in the default registry.
 */
export async function loadBackend(target: TargetOption): Promise<void> {
  await target.loader();
}
