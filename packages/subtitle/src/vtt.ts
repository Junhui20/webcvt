/**
 * WebVTT (.vtt) parser and serializer.
 *
 * Spec reference: https://www.w3.org/TR/webvtt1/
 *
 * Handled:
 *   - WEBVTT header (with optional description after a space/tab)
 *   - NOTE blocks (skipped on parse, not preserved on serialize)
 *   - STYLE blocks (skipped — stored in metadata)
 *   - REGION blocks (skipped — stored in metadata)
 *   - Cue identifiers (optional text line before timing)
 *   - Cue settings: position, line, size, align, vertical
 *   - Timestamps: "HH:MM:SS.mmm" and short form "MM:SS.mmm"
 *   - BOM, CRLF/LF
 */

import type { Cue, SubtitleTrack } from './cue.ts';
import { SubtitleParseError } from './srt.ts';

// ---------------------------------------------------------------------------
// Cue settings
// ---------------------------------------------------------------------------

/** VTT-specific cue positioning settings carried in the `id` field as JSON. */
export interface VttCueSettings {
  vertical?: 'rl' | 'lr';
  line?: string;
  position?: string;
  size?: string;
  align?: 'start' | 'center' | 'end' | 'left' | 'right';
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/**
 * Parse VTT timestamp "HH:MM:SS.mmm" or "MM:SS.mmm" to milliseconds.
 */
function parseVttTimestamp(raw: string): number {
  const m = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(raw.trim());
  if (!m) {
    throw new SubtitleParseError(`Invalid VTT timestamp: "${raw}"`);
  }
  const [, hh, mm, ss, ms] = m as unknown as [string, string | undefined, string, string, string];
  return (
    (hh !== undefined ? parseInt(hh, 10) : 0) * 3_600_000 +
    parseInt(mm, 10) * 60_000 +
    parseInt(ss, 10) * 1_000 +
    parseInt(ms, 10)
  );
}

/** Format milliseconds as "HH:MM:SS.mmm". */
function formatVttTimestamp(ms: number): string {
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
    '.' +
    String(millis).padStart(3, '0')
  );
}

// ---------------------------------------------------------------------------
// Cue settings parsing/serialization
// ---------------------------------------------------------------------------

function parseCueSettings(raw: string): VttCueSettings {
  const settings: VttCueSettings = {};
  for (const token of raw.trim().split(/\s+/)) {
    const eqIdx = token.indexOf(':');
    if (eqIdx === -1) continue;
    const key = token.slice(0, eqIdx);
    const val = token.slice(eqIdx + 1);
    switch (key) {
      case 'vertical':
        if (val === 'rl' || val === 'lr') settings.vertical = val;
        break;
      case 'line':
        settings.line = val;
        break;
      case 'position':
        settings.position = val;
        break;
      case 'size':
        settings.size = val;
        break;
      case 'align':
        if (['start', 'center', 'end', 'left', 'right'].includes(val)) {
          settings.align = val as VttCueSettings['align'];
        }
        break;
    }
  }
  return settings;
}

function serializeCueSettings(s: VttCueSettings): string {
  const parts: string[] = [];
  if (s.vertical) parts.push(`vertical:${s.vertical}`);
  if (s.line !== undefined) parts.push(`line:${s.line}`);
  if (s.position !== undefined) parts.push(`position:${s.position}`);
  if (s.size !== undefined) parts.push(`size:${s.size}`);
  if (s.align !== undefined) parts.push(`align:${s.align}`);
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

// ---------------------------------------------------------------------------
// Tag stripping
// ---------------------------------------------------------------------------

/** Strip VTT cue markup (voice spans, timestamp tags, class spans, etc.). */
function stripVttTags(text: string): string {
  return text
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '') // timestamp tags
    .replace(/<\/?[a-z][^>]*>/gi, '') // element tags
    .trim();
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a WebVTT file into a SubtitleTrack.
 *
 * @param text - Raw VTT file contents (may contain BOM, CRLF).
 * @returns Parsed SubtitleTrack.
 * @throws SubtitleParseError on missing WEBVTT header or malformed timestamps.
 */
export function parseVtt(text: string): SubtitleTrack {
  const normalized = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const lines = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  if (lines.length === 0 || !lines[0]!.startsWith('WEBVTT')) {
    throw new SubtitleParseError('VTT file must start with "WEBVTT"');
  }

  const metadata: Record<string, string> = {};
  const cues: Cue[] = [];
  let i = 1;

  // Skip optional header block (lines until first blank line after WEBVTT).
  while (i < lines.length && lines[i]!.trim() !== '') {
    const line = lines[i]!;
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      metadata[key] = val;
    }
    i++;
  }

  while (i < lines.length) {
    // Skip blank lines.
    while (i < lines.length && lines[i]!.trim() === '') i++;
    if (i >= lines.length) break;

    const firstLine = lines[i]!.trim();

    // NOTE block.
    if (firstLine.startsWith('NOTE')) {
      i++;
      while (i < lines.length && lines[i]!.trim() !== '') i++;
      continue;
    }

    // STYLE block.
    if (firstLine.startsWith('STYLE')) {
      i++;
      const styleLines: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '') {
        styleLines.push(lines[i]!);
        i++;
      }
      metadata['__style__'] = (metadata['__style__'] ?? '') + styleLines.join('\n');
      continue;
    }

    // REGION block.
    if (firstLine.startsWith('REGION')) {
      i++;
      while (i < lines.length && lines[i]!.trim() !== '') i++;
      continue;
    }

    // Determine whether firstLine is a cue identifier or a timing line.
    const isTimingLine = firstLine.includes(' --> ');
    let cueId: string | undefined;
    let timingLine: string;

    if (isTimingLine) {
      timingLine = firstLine;
    } else {
      // The next line should be the timing line.
      cueId = firstLine;
      i++;
      if (i >= lines.length) break;
      timingLine = lines[i]!.trim();
      if (!timingLine.includes(' --> ')) {
        // Not a valid cue — skip.
        i++;
        continue;
      }
    }
    i++;

    // Parse timing + optional cue settings.
    const arrowIdx = timingLine.indexOf(' --> ');
    const startToken = timingLine.slice(0, arrowIdx).trim();
    const rest = timingLine.slice(arrowIdx + 5);
    // Rest may be "HH:MM:SS.mmm setting1:val1 setting2:val2"
    const spaceAfterEnd = rest.search(/\s/);
    const endToken = spaceAfterEnd !== -1 ? rest.slice(0, spaceAfterEnd) : rest;
    const settingsRaw = spaceAfterEnd !== -1 ? rest.slice(spaceAfterEnd + 1) : '';

    const startMs = parseVttTimestamp(startToken);
    const endMs = parseVttTimestamp(endToken.trim());
    const settings = parseCueSettings(settingsRaw);

    // Store settings in metadata on the cue's id field as JSON if present.
    const hasSettings = Object.keys(settings).length > 0;
    const storedId = hasSettings
      ? JSON.stringify({ id: cueId, settings })
      : cueId;

    // Text lines.
    const textLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '') {
      textLines.push(lines[i]!);
      i++;
    }

    const text = stripVttTags(textLines.join('\n'));
    cues.push({ id: storedId, startMs, endMs, text });
  }

  return { cues, metadata: Object.keys(metadata).length > 0 ? metadata : undefined };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a SubtitleTrack to WebVTT format.
 *
 * Cue settings are recovered from the `id` field if they were stored as JSON
 * during parsing. Otherwise the plain `id` string is used as the cue identifier.
 *
 * @param track - The SubtitleTrack to serialize.
 * @returns VTT-formatted string (LF line endings, no BOM).
 */
export function serializeVtt(track: SubtitleTrack): string {
  const header = 'WEBVTT\n';
  if (track.cues.length === 0) return header + '\n';

  const blocks = track.cues.map((cue) => {
    let cueId: string | undefined;
    let settings: VttCueSettings = {};

    if (cue.id !== undefined) {
      try {
        const parsed = JSON.parse(cue.id) as { id?: string; settings?: VttCueSettings };
        if (typeof parsed === 'object' && parsed !== null && 'settings' in parsed) {
          cueId = parsed.id;
          settings = parsed.settings ?? {};
        } else {
          cueId = cue.id;
        }
      } catch {
        cueId = cue.id;
      }
    }

    const timing = `${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}${serializeCueSettings(settings)}`;
    const lines: string[] = [];
    if (cueId !== undefined) lines.push(cueId);
    lines.push(timing);
    lines.push(cue.text);
    return lines.join('\n');
  });

  return header + '\n' + blocks.join('\n\n') + '\n';
}
