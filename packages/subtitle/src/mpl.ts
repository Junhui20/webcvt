/**
 * MPL2 (.mpl) parser and serializer.
 *
 * Spec reference: http://napisy24.pl/mpl2-info
 *
 * Format:
 *   [start_ds][end_ds]text|second_line
 *
 * Where start_ds and end_ds are timestamps in deciseconds (tenths of a second).
 * Line separator within a cue is "|" (pipe character), same as MicroDVD.
 *
 * Italic markup: leading "/" in text or "|/" in continuation lines indicates italic.
 * This parser strips that markup; it is not preserved in the IR.
 */

import type { Cue, SubtitleTrack } from './cue.ts';
import { SubtitleParseError } from './srt.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert deciseconds to milliseconds. */
function dsToMs(ds: number): number {
  return ds * 100;
}

/** Convert milliseconds to deciseconds, rounding to nearest. */
function msToDs(ms: number): number {
  return Math.round(ms / 100);
}

/** Strip MPL2 italic markers (leading "/" characters in line segments). */
function stripMplItalic(text: string): string {
  return text
    .split('|')
    .map((seg) => (seg.startsWith('/') ? seg.slice(1) : seg))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse an MPL2 (.mpl) subtitle file into a SubtitleTrack.
 *
 * @param text - Raw MPL2 file contents (may contain BOM, CRLF).
 * @throws SubtitleParseError on lines that look like MPL2 but have bad timestamps.
 */
export function parseMpl(text: string): SubtitleTrack {
  const normalized = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const lines = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const cues: Cue[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;

    // Comment lines starting with '#' are skipped.
    if (line.startsWith('#')) continue;

    const m = /^\[(\d+)\]\[(\d+)\](.*)$/.exec(line);
    if (!m) continue;

    const [, startDsStr, endDsStr, rest] = m as unknown as [string, string, string, string];
    const startDs = Number.parseInt(startDsStr, 10);
    const endDs = Number.parseInt(endDsStr, 10);

    if (Number.isNaN(startDs) || Number.isNaN(endDs)) {
      throw new SubtitleParseError(`Invalid MPL2 timestamps in: "${line}"`);
    }

    const text = stripMplItalic(rest);
    cues.push({
      startMs: dsToMs(startDs),
      endMs: dsToMs(endDs),
      text,
    });
  }

  return { cues };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a SubtitleTrack to MPL2 format.
 *
 * @param track - The SubtitleTrack to serialize.
 */
export function serializeMpl(track: SubtitleTrack): string {
  if (track.cues.length === 0) return '';

  const lines = track.cues.map((cue) => {
    const startDs = msToDs(cue.startMs);
    const endDs = msToDs(cue.endMs);
    const text = cue.text.replace(/\n/g, '|');
    return `[${startDs}][${endDs}]${text}`;
  });

  return `${lines.join('\n')}\n`;
}
