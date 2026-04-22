/**
 * SubtitleBackend — webcvt Backend implementation for subtitle format conversion.
 *
 * Handles detection by content signature and conversion via the shared Cue IR.
 *
 * Supported input/output pairs:
 *   SRT ↔ VTT ↔ ASS ↔ SSA ↔ SUB ↔ MPL (any combination)
 */

import type { Backend, ConvertOptions, ConvertResult, FormatDescriptor } from '@catlabtech/webcvt-core';
import { UnsupportedFormatError, WebcvtError } from '@catlabtech/webcvt-core';
import { parseAss, serializeAss } from './ass.ts';
import type { SubtitleTrack } from './cue.ts';
import { parseMpl, serializeMpl } from './mpl.ts';
import { parseSrt, serializeSrt } from './srt.ts';
import { parseSsa, serializeSsa } from './ssa.ts';
import { parseSub, serializeSub } from './sub.ts';
import { parseVtt, serializeVtt } from './vtt.ts';

// ---------------------------------------------------------------------------
// Supported MIME types
// ---------------------------------------------------------------------------

const SUBTITLE_MIMES = new Set([
  'application/x-subrip', // .srt
  'text/vtt', // .vtt
  'text/x-ass', // .ass
  'text/x-ssa', // .ssa
  'text/x-microdvd', // .sub (text MicroDVD only)
  'text/x-mpl2', // .mpl
]);

// ---------------------------------------------------------------------------
// Format detection by content
// ---------------------------------------------------------------------------

type KnownMime =
  | 'application/x-subrip'
  | 'text/vtt'
  | 'text/x-ass'
  | 'text/x-ssa'
  | 'text/x-microdvd'
  | 'text/x-mpl2';

/**
 * Detect the subtitle format from file content.
 *
 * Detection heuristics (in priority order):
 *   1. "WEBVTT" on first line → VTT
 *   2. "[Script Info]" present + "ScriptType: v4.00+" → ASS
 *   3. "[Script Info]" present + "ScriptType: v4.00" (no +) → SSA
 *   4. First non-empty line matches "{number}{number}" → MicroDVD
 *   5. First non-empty line matches "[number][number]" → MPL2
 *   6. Fallback: if sequence number + timestamp pattern found → SRT
 */
export function detectSubtitleFormat(text: string): KnownMime | undefined {
  const stripped = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const normalized = stripped.replace(/\r\n/g, '\n');

  if (/^WEBVTT/.test(normalized.trimStart())) return 'text/vtt';

  if (/^\[Script Info\]/m.test(normalized)) {
    if (/^ScriptType:\s*v4\.00\+/im.test(normalized)) return 'text/x-ass';
    if (/^ScriptType:\s*v4\.00(?!\+)/im.test(normalized)) return 'text/x-ssa';
    // Default ASS if [Script Info] present but no ScriptType.
    return 'text/x-ass';
  }

  const firstNonEmpty = normalized.split('\n').find((l) => l.trim() !== '') ?? '';

  if (/^\{\d+\}\{\d+\}/.test(firstNonEmpty)) return 'text/x-microdvd';
  if (/^\[\d+\]\[\d+\]/.test(firstNonEmpty)) return 'text/x-mpl2';

  // SRT detection: look for a timing line pattern.
  if (/^\d{1,2}:\d{2}:\d{2}[,\.]\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[,\.]\d{3}/m.test(normalized)) {
    return 'application/x-subrip';
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Parser dispatch
// ---------------------------------------------------------------------------

function parseByMime(text: string, mime: string): SubtitleTrack {
  switch (mime) {
    case 'application/x-subrip':
      return parseSrt(text);
    case 'text/vtt':
      return parseVtt(text);
    case 'text/x-ass':
      return parseAss(text);
    case 'text/x-ssa':
      return parseSsa(text);
    case 'text/x-microdvd':
      return parseSub(text);
    case 'text/x-mpl2':
      return parseMpl(text);
    default:
      throw new UnsupportedFormatError(mime, 'input');
  }
}

// ---------------------------------------------------------------------------
// Serializer dispatch
// ---------------------------------------------------------------------------

function serializeByMime(track: SubtitleTrack, mime: string): string {
  switch (mime) {
    case 'application/x-subrip':
      return serializeSrt(track);
    case 'text/vtt':
      return serializeVtt(track);
    case 'text/x-ass':
      return serializeAss(track);
    case 'text/x-ssa':
      return serializeSsa(track);
    case 'text/x-microdvd':
      return serializeSub(track);
    case 'text/x-mpl2':
      return serializeMpl(track);
    default:
      throw new UnsupportedFormatError(mime, 'output');
  }
}

// ---------------------------------------------------------------------------
// SubtitleBackend
// ---------------------------------------------------------------------------

/**
 * Subtitle conversion backend implementing the webcvt Backend interface.
 *
 * Converts between any pair of: SRT, VTT, ASS, SSA, MicroDVD, MPL2.
 * All conversion goes through the shared SubtitleTrack IR.
 *
 * Text encoding of output Blobs is always UTF-8.
 */
export class SubtitleBackend implements Backend {
  readonly name = 'subtitle';

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    return SUBTITLE_MIMES.has(input.mime) && SUBTITLE_MIMES.has(output.mime);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (!SUBTITLE_MIMES.has(output.mime)) {
      throw new UnsupportedFormatError(output.mime, 'output');
    }

    // Decode input blob to text.
    const text = await input.text();

    // Determine input format: prefer explicit blob.type, fall back to detection.
    let inputMime = input.type;
    if (!SUBTITLE_MIMES.has(inputMime)) {
      const detected = detectSubtitleFormat(text);
      if (!detected) {
        throw new WebcvtError(
          'SUBTITLE_DETECT_FAILED',
          'Could not detect subtitle format from content. ' +
            'Provide a Blob with an explicit MIME type (e.g. "application/x-subrip").',
        );
      }
      inputMime = detected;
    }

    options.onProgress?.({ percent: 10, phase: 'parse' });

    const track = parseByMime(text, inputMime);

    options.onProgress?.({ percent: 60, phase: 'serialize' });

    const outputText = serializeByMime(track, output.mime);

    options.onProgress?.({ percent: 100, phase: 'done' });

    const blob = new Blob([outputText], { type: output.mime });

    return {
      blob,
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }
}
