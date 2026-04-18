/**
 * SubRip (.srt) parser and serializer.
 *
 * Format spec reference: https://en.wikipedia.org/wiki/SubRip
 *
 * Structure:
 *   <sequence_number>\n
 *   <HH:MM:SS,mmm> --> <HH:MM:SS,mmm>\n
 *   <text lines>\n
 *   \n
 *
 * Handled:
 *   - UTF-8 BOM at start of file
 *   - CRLF and LF line endings
 *   - Inline HTML tags: <i>, <b>, <u>, <font>, and their closing forms
 *   - Speaker labels: "PERSON: text" — preserved as-is in text
 *   - Empty files (returns empty track)
 *   - Sequence numbers are re-generated on serialize (1-based, monotonic)
 */

import type { Cue, SubtitleTrack } from './cue.ts';
import { WebcvtError } from '@webcvt/core';

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/**
 * Parse SRT timestamp "HH:MM:SS,mmm" to milliseconds.
 * Throws SubtitleParseError on malformed input.
 */
function parseSrtTimestamp(raw: string): number {
  const m = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/.exec(raw.trim());
  if (!m) {
    throw new SubtitleParseError(`Invalid SRT timestamp: "${raw}"`);
  }
  const [, hh, mm, ss, ms] = m as unknown as [string, string, string, string, string];
  return (
    parseInt(hh, 10) * 3_600_000 +
    parseInt(mm, 10) * 60_000 +
    parseInt(ss, 10) * 1_000 +
    parseInt(ms, 10)
  );
}

/** Format milliseconds as "HH:MM:SS,mmm". */
function formatSrtTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const millis = ms % 1000;
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  return (
    String(hh).padStart(2, '0') +
    ':' +
    String(mm).padStart(2, '0') +
    ':' +
    String(ss).padStart(2, '0') +
    ',' +
    String(millis).padStart(3, '0')
  );
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class SubtitleParseError extends WebcvtError {
  constructor(message: string) {
    super('SUBTITLE_PARSE_ERROR', message);
    this.name = 'SubtitleParseError';
  }
}

// ---------------------------------------------------------------------------
// Inline tag stripping
// ---------------------------------------------------------------------------

/**
 * Strip basic HTML markup used in SRT (<i>, <b>, <u>, <font color=...>).
 * Returns plain text suitable for the `text` field of a Cue.
 */
function stripSrtTags(text: string): string {
  return text.replace(/<\/?(?:i|b|u|font(?:\s[^>]*)?)>/gi, '');
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a SubRip (.srt) text into a SubtitleTrack.
 *
 * @param text - Raw SRT file contents (may contain BOM, CRLF).
 * @returns Parsed SubtitleTrack with cues in chronological order.
 * @throws SubtitleParseError on malformed timestamp lines.
 */
export function parseSrt(text: string): SubtitleTrack {
  // Strip BOM.
  const normalized = text.startsWith('\uFEFF') ? text.slice(1) : text;
  // Normalise line endings.
  const lines = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const cues: Cue[] = [];
  let i = 0;

  while (i < lines.length) {
    // Skip blank lines between blocks.
    while (i < lines.length && lines[i]!.trim() === '') i++;
    if (i >= lines.length) break;

    // Sequence number line.
    const seqLine = lines[i]!.trim();
    if (!/^\d+$/.test(seqLine)) {
      // Tolerate files that start without a number (some tools omit it).
      // Skip until we find a timing line.
      i++;
      continue;
    }
    const id = seqLine;
    i++;

    if (i >= lines.length) break;

    // Timing line.
    const timingLine = lines[i]!.trim();
    const arrowIdx = timingLine.indexOf(' --> ');
    if (arrowIdx === -1) {
      throw new SubtitleParseError(
        `Expected timing line after sequence ${id}, got: "${timingLine}"`,
      );
    }
    const startMs = parseSrtTimestamp(timingLine.slice(0, arrowIdx));
    // The portion after '-->' may include cue settings (non-standard but seen in the wild);
    // take only the first token for the end time.
    const afterArrow = timingLine.slice(arrowIdx + 5).split(/\s+/)[0] ?? '';
    const endMs = parseSrtTimestamp(afterArrow);
    i++;

    // Text lines (until blank line or EOF).
    const textLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '') {
      textLines.push(lines[i]!);
      i++;
    }

    const rawText = textLines.join('\n');
    const text = stripSrtTags(rawText);

    cues.push({ id, startMs, endMs, text });
  }

  return { cues };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a SubtitleTrack to SRT format.
 *
 * Cues are numbered sequentially starting at 1 regardless of their `id` values.
 * Text is emitted as-is (plain text, no HTML wrapping applied).
 *
 * @param track - The SubtitleTrack to serialize.
 * @returns SRT-formatted string (LF line endings, no BOM).
 */
export function serializeSrt(track: SubtitleTrack): string {
  if (track.cues.length === 0) return '';

  const blocks = track.cues.map((cue, idx) => {
    const seq = idx + 1;
    const timing = `${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}`;
    return `${seq}\n${timing}\n${cue.text}`;
  });

  return blocks.join('\n\n') + '\n';
}
