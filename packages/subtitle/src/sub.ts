/**
 * MicroDVD (.sub) parser and serializer.
 *
 * Spec reference: https://en.wikipedia.org/wiki/MicroDVD
 *
 * Format:
 *   {frame_start}{frame_end}text|second_line
 *
 * - Frame numbers are converted to milliseconds using the provided FPS.
 * - Default FPS: 23.976 (NTSC film, the most common MicroDVD assumption).
 * - Text lines within a cue are separated by "|" (pipe).
 * - Some tools encode the FPS in frame 0: "{0}{0}23.976" — this is detected
 *   and used automatically.
 * - Style tags like {Y:i}, {Y:b}, {P:} are stripped from text.
 *
 * Out of scope: VobSub binary .sub files.
 * VobSub uses a 4-byte magic "DVDV" / IDX companion.
 * If binary magic is detected in the first 4 bytes, a clear error is thrown.
 */

import type { Cue, SubtitleTrack } from './cue.ts';
import { SubtitleParseError } from './srt.ts';
import { WebcvtError } from '@webcvt/core';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_FPS = 23.976;

// Binary VobSub magic: first 4 bytes of a .idx file start with '#' — but the
// actual .sub video stream starts with 0x00 0x00 0x01 0xba (MPEG PS header).
// We detect the MPEG PS pack header as "binary" VobSub.
const VOBSUB_MAGIC_0 = 0x00;
const VOBSUB_MAGIC_1 = 0x00;
const VOBSUB_MAGIC_2 = 0x01;
const VOBSUB_MAGIC_3 = 0xba;

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class VobSubError extends WebcvtError {
  constructor() {
    super(
      'VOBSUB_NOT_SUPPORTED',
      'VobSub binary .sub files are not supported. ' +
        'VobSub is an image-based subtitle format stored as an MPEG-PS bitstream. ' +
        'Only text-based MicroDVD .sub files are handled by @webcvt/subtitle. ' +
        'If you need VobSub support, use a dedicated video processing pipeline.',
    );
    this.name = 'VobSubError';
  }
}

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the provided text could be a binary VobSub stream.
 * We check the first four characters (as char codes) against the MPEG-PS magic.
 */
function detectVobSub(text: string): boolean {
  if (text.length < 4) return false;
  return (
    text.charCodeAt(0) === VOBSUB_MAGIC_0 &&
    text.charCodeAt(1) === VOBSUB_MAGIC_1 &&
    text.charCodeAt(2) === VOBSUB_MAGIC_2 &&
    text.charCodeAt(3) === VOBSUB_MAGIC_3
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function framesToMs(frame: number, fps: number): number {
  return Math.round((frame / fps) * 1000);
}

function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

/** Strip MicroDVD style tags: {Y:...}, {P:...}, {F:...}, {S:...}, etc. */
function stripSubTags(text: string): string {
  return text.replace(/\{[A-Z]:[^}]*\}/gi, '').replace(/\{[oO]\}/g, '');
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a MicroDVD (.sub) text file into a SubtitleTrack.
 *
 * @param text - Raw .sub file contents.
 * @param fps  - Frames per second. Overridden by embedded FPS header if present.
 * @throws VobSubError if binary VobSub magic is detected.
 * @throws SubtitleParseError on malformed cue lines.
 */
export function parseSub(text: string, fps: number = DEFAULT_FPS): SubtitleTrack {
  if (detectVobSub(text)) {
    throw new VobSubError();
  }

  const normalized = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const lines = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let effectiveFps = fps;
  const cues: Cue[] = [];
  const metadata: Record<string, string> = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;

    const m = /^\{(\d+)\}\{(\d+)\}(.*)$/.exec(line);
    if (!m) {
      // Non-matching lines (e.g. comments or garbage) are skipped silently.
      continue;
    }

    const [, startFrameStr, endFrameStr, rest] = m as unknown as [
      string,
      string,
      string,
      string,
    ];
    const startFrame = parseInt(startFrameStr, 10);
    const endFrame = parseInt(endFrameStr, 10);

    // FPS header: {0}{0}23.976
    if (startFrame === 0 && endFrame === 0) {
      const parsedFps = parseFloat(rest);
      if (!Number.isNaN(parsedFps) && parsedFps > 0) {
        effectiveFps = parsedFps;
        metadata['fps'] = String(parsedFps);
      }
      continue;
    }

    if (startFrame >= endFrame) {
      // Degenerate cue — skip rather than throw to be tolerant.
      continue;
    }

    const text = stripSubTags(rest).replace(/\|/g, '\n');
    cues.push({
      startMs: framesToMs(startFrame, effectiveFps),
      endMs: framesToMs(endFrame, effectiveFps),
      text,
    });
  }

  metadata['fps'] = metadata['fps'] ?? String(effectiveFps);

  return { cues, metadata };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a SubtitleTrack to MicroDVD .sub format.
 *
 * @param track - The SubtitleTrack to serialize.
 * @param fps   - FPS to use for frame calculation. Falls back to metadata.fps,
 *                then DEFAULT_FPS.
 */
export function serializeSub(track: SubtitleTrack, fps?: number): string {
  const effectiveFps =
    fps ??
    (track.metadata?.['fps'] !== undefined ? parseFloat(track.metadata['fps']) : DEFAULT_FPS);

  const lines: string[] = [];
  lines.push(`{0}{0}${effectiveFps}`);

  for (const cue of track.cues) {
    const startFrame = msToFrames(cue.startMs, effectiveFps);
    const endFrame = msToFrames(cue.endMs, effectiveFps);
    const text = cue.text.replace(/\n/g, '|');
    lines.push(`{${startFrame}}{${endFrame}}${text}`);
  }

  return lines.join('\n') + '\n';
}
