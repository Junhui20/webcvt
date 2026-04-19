import type { FormatDescriptor } from './types.ts';

/**
 * Curated registry of known formats. Only Phase 1 formats are included here;
 * additional format packages register themselves via the FormatRegistry.
 */
const KNOWN_FORMATS: readonly FormatDescriptor[] = [
  // Image (Phase 1)
  { ext: 'png', mime: 'image/png', category: 'image', description: 'Portable Network Graphics' },
  { ext: 'jpeg', mime: 'image/jpeg', category: 'image', description: 'JPEG' },
  { ext: 'webp', mime: 'image/webp', category: 'image', description: 'Web Picture' },
  { ext: 'bmp', mime: 'image/bmp', category: 'image', description: 'Bitmap' },
  { ext: 'ico', mime: 'image/x-icon', category: 'image', description: 'Windows Icon' },
  { ext: 'gif', mime: 'image/gif', category: 'image', description: 'Graphics Interchange Format' },
  // Subtitle (Phase 1)
  { ext: 'srt', mime: 'application/x-subrip', category: 'subtitle', description: 'SubRip' },
  { ext: 'vtt', mime: 'text/vtt', category: 'subtitle', description: 'WebVTT' },
  {
    ext: 'ass',
    mime: 'text/x-ass',
    category: 'subtitle',
    description: 'Advanced SubStation Alpha',
  },
  { ext: 'ssa', mime: 'text/x-ssa', category: 'subtitle', description: 'SubStation Alpha' },
  { ext: 'sub', mime: 'text/x-microdvd', category: 'subtitle', description: 'MicroDVD / VobSub' },
  { ext: 'mpl', mime: 'text/x-mpl2', category: 'subtitle', description: 'MPL2' },
  // Audio/Video registered for format-detection even though backends arrive in later phases
  { ext: 'aac', mime: 'audio/aac', category: 'audio', description: 'Advanced Audio Coding (ADTS)' },
  { ext: 'mp3', mime: 'audio/mpeg', category: 'audio', description: 'MPEG Audio Layer III' },
  { ext: 'wav', mime: 'audio/wav', category: 'audio', description: 'Waveform Audio File' },
  { ext: 'ogg', mime: 'audio/ogg', category: 'audio', description: 'Ogg' },
  { ext: 'flac', mime: 'audio/flac', category: 'audio', description: 'Free Lossless Audio Codec' },
  { ext: 'mp4', mime: 'video/mp4', category: 'video', description: 'MPEG-4 Part 14' },
  { ext: 'm4a', mime: 'audio/mp4', category: 'audio', description: 'MP4 audio (AAC-in-M4A)' },
  { ext: 'webm', mime: 'video/webm', category: 'video', description: 'WebM' },
  { ext: 'mkv', mime: 'video/x-matroska', category: 'video', description: 'Matroska container' },
  // Archive (format detection only for now)
  { ext: 'zip', mime: 'application/zip', category: 'archive', description: 'Zip Archive' },
];

/**
 * Aliases: extensions that resolve to a canonical format. Used only for
 * extension lookup (MIME lookup is already one-to-one in KNOWN_FORMATS).
 */
const EXT_ALIASES: Readonly<Record<string, string>> = {
  jpg: 'jpeg',
};

const BY_EXT = new Map<string, FormatDescriptor>(
  KNOWN_FORMATS.map((f) => [f.ext.toLowerCase(), f] as const),
);
const BY_MIME = new Map<string, FormatDescriptor>(
  KNOWN_FORMATS.map((f) => [f.mime.toLowerCase(), f] as const),
);

export function findByExt(ext: string): FormatDescriptor | undefined {
  const normalized = ext.toLowerCase().replace(/^\./, '');
  const canonical = EXT_ALIASES[normalized] ?? normalized;
  return BY_EXT.get(canonical);
}

export function findByMime(mime: string): FormatDescriptor | undefined {
  return BY_MIME.get(mime.toLowerCase());
}

export function resolveFormat(input: string | FormatDescriptor): FormatDescriptor | undefined {
  if (typeof input !== 'string') return input;
  if (input.includes('/')) return findByMime(input);
  return findByExt(input);
}

export function knownFormats(): readonly FormatDescriptor[] {
  return KNOWN_FORMATS;
}
