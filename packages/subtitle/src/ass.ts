/**
 * Advanced SubStation Alpha (.ass) parser and serializer.
 *
 * Spec reference: http://www.tcax.org/docs/ass-specs.htm
 *
 * Handles:
 *   - [Script Info] section: key/value pairs stored in metadata
 *   - [V4+ Styles] section: full style table (Format + Style lines)
 *   - [Events] section: Dialogue lines parsed into Cues
 *   - Override tags stripped from Text field ({\pos(...)}, {\an8}, etc.)
 *   - Soft line-break (\N) converted to \n in text
 *   - Hard space (\h) converted to regular space
 *   - SSA V4 style section name variant handled via sectionName option
 *
 * Style preservation on serialize:
 *   - If track.metadata contains __assStyles__, it is re-emitted verbatim.
 *   - Otherwise a minimal default style is emitted.
 *   - Dialogue text is emitted as-is (plain text, no override tags re-added).
 */

import type { Cue, CueStyle, SubtitleTrack } from './cue.ts';
import { SubtitleParseError } from './srt.ts';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface AssStyle {
  name: string;
  fontName: string;
  fontSize: number;
  primaryColor: string;
  secondaryColor: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeOut: boolean;
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
  [key: string]: unknown;
}

interface ParsedEvent {
  layer: number;
  startMs: number;
  endMs: number;
  style: string;
  name: string;
  marginL: number;
  marginR: number;
  marginV: number;
  effect: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Parse ASS timestamp "H:MM:SS.cc" (centiseconds) to milliseconds. */
function parseAssTimestamp(raw: string): number {
  const m = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/.exec(raw.trim());
  if (!m) {
    throw new SubtitleParseError(`Invalid ASS timestamp: "${raw}"`);
  }
  const [, hh, mm, ss, cc] = m as unknown as [string, string, string, string, string];
  return (
    parseInt(hh, 10) * 3_600_000 +
    parseInt(mm, 10) * 60_000 +
    parseInt(ss, 10) * 1_000 +
    Math.round(parseInt(cc, 10) * 10)
  );
}

/** Format milliseconds to "H:MM:SS.cc". */
function formatAssTimestamp(ms: number): string {
  const totalCs = Math.round(ms / 10);
  const cc = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  return (
    String(hh) +
    ':' +
    String(mm).padStart(2, '0') +
    ':' +
    String(ss).padStart(2, '0') +
    '.' +
    String(cc).padStart(2, '0')
  );
}

// ---------------------------------------------------------------------------
// Override tag stripping
// ---------------------------------------------------------------------------

/** Strip ASS override tags: {\...} blocks, and convert soft/hard breaks. */
function stripAssTags(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '') // strip override blocks
    .replace(/\\N/g, '\n') // soft line break
    .replace(/\\n/g, '\n') // hard line break (same in our IR)
    .replace(/\\h/g, '\u00a0') // hard space → NBSP
    .trim();
}

/** Escape text for ASS: convert \n back to \N. */
function escapeAssText(text: string): string {
  return text.replace(/\n/g, '\\N').replace(/\u00a0/g, '\\h');
}

// ---------------------------------------------------------------------------
// Style parsing
// ---------------------------------------------------------------------------

/**
 * Parse the Format line tokens and a Style line into an AssStyle record.
 * Unknown fields are stored by their column name.
 */
function parseAssStyle(formatCols: string[], styleLine: string): AssStyle {
  const vals = styleLine.split(',');

  const style: AssStyle = {
    name: '',
    fontName: 'Arial',
    fontSize: 20,
    primaryColor: '&H00FFFFFF',
    secondaryColor: '&H000000FF',
    bold: false,
    italic: false,
    underline: false,
    strikeOut: false,
    alignment: 2,
    marginL: 10,
    marginR: 10,
    marginV: 10,
  };

  for (let i = 0; i < formatCols.length && i < vals.length; i++) {
    const col = (formatCols[i] ?? '').trim();
    const val = (vals[i] ?? '').trim();
    switch (col) {
      case 'Name':
        style.name = val;
        break;
      case 'Fontname':
        style.fontName = val;
        break;
      case 'Fontsize':
        style.fontSize = parseInt(val, 10) || 20;
        break;
      case 'PrimaryColour':
      case 'PrimaryColor':
        style.primaryColor = val;
        break;
      case 'SecondaryColour':
      case 'SecondaryColor':
        style.secondaryColor = val;
        break;
      case 'Bold':
        style.bold = val === '-1' || val === '1';
        break;
      case 'Italic':
        style.italic = val === '-1' || val === '1';
        break;
      case 'Underline':
        style.underline = val === '-1' || val === '1';
        break;
      case 'StrikeOut':
        style.strikeOut = val === '-1' || val === '1';
        break;
      case 'Alignment':
        style.alignment = parseInt(val, 10) || 2;
        break;
      case 'MarginL':
        style.marginL = parseInt(val, 10) || 0;
        break;
      case 'MarginR':
        style.marginR = parseInt(val, 10) || 0;
        break;
      case 'MarginV':
        style.marginV = parseInt(val, 10) || 0;
        break;
      default:
        style[col] = val;
        break;
    }
  }
  return style;
}

/** Convert an AssStyle to a CueStyle. */
function assStyleToCueStyle(s: AssStyle): CueStyle {
  const alignment = s.alignment as CueStyle['alignment'];
  return {
    fontName: s.fontName,
    fontSize: s.fontSize,
    primaryColor: s.primaryColor,
    secondaryColor: s.secondaryColor,
    bold: s.bold,
    italic: s.italic,
    underline: s.underline,
    strikeOut: s.strikeOut,
    alignment: [1, 2, 3, 4, 5, 6, 7, 8, 9].includes(s.alignment)
      ? (alignment as CueStyle['alignment'])
      : 2,
    marginL: s.marginL,
    marginR: s.marginR,
    marginV: s.marginV,
  };
}

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

const DEFAULT_EVENT_FORMAT = [
  'Layer',
  'Start',
  'End',
  'Style',
  'Name',
  'MarginL',
  'MarginR',
  'MarginV',
  'Effect',
  'Text',
];

/**
 * Parse a Dialogue line into a ParsedEvent.
 * The Text field may contain commas, so only split the first N-1 columns.
 */
function parseDialogueLine(formatCols: string[], line: string): ParsedEvent {
  const nCols = formatCols.length;
  const parts = splitDialogueLine(line, nCols);

  const event: ParsedEvent = {
    layer: 0,
    startMs: 0,
    endMs: 0,
    style: 'Default',
    name: '',
    marginL: 0,
    marginR: 0,
    marginV: 0,
    effect: '',
    text: '',
  };

  for (let i = 0; i < formatCols.length && i < parts.length; i++) {
    const col = (formatCols[i] ?? '').trim();
    const val = (parts[i] ?? '').trim();
    switch (col) {
      case 'Layer':
        event.layer = parseInt(val, 10) || 0;
        break;
      case 'Start':
        event.startMs = parseAssTimestamp(val);
        break;
      case 'End':
        event.endMs = parseAssTimestamp(val);
        break;
      case 'Style':
        event.style = val;
        break;
      case 'Name':
        event.name = val;
        break;
      case 'MarginL':
        event.marginL = parseInt(val, 10) || 0;
        break;
      case 'MarginR':
        event.marginR = parseInt(val, 10) || 0;
        break;
      case 'MarginV':
        event.marginV = parseInt(val, 10) || 0;
        break;
      case 'Effect':
        event.effect = val;
        break;
      case 'Text':
        event.text = val;
        break;
    }
  }
  return event;
}

/** Split a dialogue line into exactly `nCols` parts. The last part may contain commas. */
function splitDialogueLine(line: string, nCols: number): string[] {
  const result: string[] = [];
  let remaining = line;
  for (let i = 0; i < nCols - 1; i++) {
    const idx = remaining.indexOf(',');
    if (idx === -1) {
      result.push(remaining);
      remaining = '';
      break;
    }
    result.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx + 1);
  }
  result.push(remaining);
  return result;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface AssParseOptions {
  /** Override the styles section name to look for (default "[V4+ Styles]"). */
  stylesSectionName?: string;
}

/**
 * Parse an ASS/SSA file into a SubtitleTrack.
 *
 * @param text - Raw ASS file contents.
 * @param options - Optional section name overrides for SSA compatibility.
 */
export function parseAss(text: string, options: AssParseOptions = {}): SubtitleTrack {
  const normalized = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const lines = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const stylesSectionName = options.stylesSectionName ?? '[V4+ Styles]';

  const metadata: Record<string, string> = {};
  const styleMap = new Map<string, AssStyle>();
  const cues: Cue[] = [];

  // Raw style block lines — preserved for round-trip serialization.
  const rawStyleLines: string[] = [];

  let section = '';
  let eventFormatCols: string[] = DEFAULT_EVENT_FORMAT;
  let styleFormatCols: string[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Section header.
    if (line.startsWith('[')) {
      section = line.trim();
      continue;
    }

    // Comment line.
    if (line.startsWith(';') || line.startsWith('!:')) continue;

    // Empty line.
    if (line.trim() === '') continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    switch (section) {
      case '[Script Info]':
        metadata[key] = value;
        break;

      default:
        if (section === stylesSectionName || section === '[V4 Styles]') {
          if (key === 'Format') {
            styleFormatCols = value.split(',').map((s) => s.trim());
            rawStyleLines.push(line);
          } else if (key === 'Style') {
            rawStyleLines.push(line);
            if (styleFormatCols.length > 0) {
              const s = parseAssStyle(styleFormatCols, value);
              styleMap.set(s.name, s);
            }
          }
        } else if (section === '[Events]') {
          if (key === 'Format') {
            eventFormatCols = value.split(',').map((s) => s.trim());
          } else if (key === 'Dialogue') {
            const ev = parseDialogueLine(eventFormatCols, value);
            const assStyle = styleMap.get(ev.style);
            const cueStyle: CueStyle | undefined = assStyle
              ? assStyleToCueStyle(assStyle)
              : undefined;

            cues.push({
              id: ev.style !== 'Default' ? ev.style : undefined,
              startMs: ev.startMs,
              endMs: ev.endMs,
              text: stripAssTags(ev.text),
              style: cueStyle,
            });
          }
        }
        break;
    }
  }

  // Preserve raw style block for round-trip.
  if (rawStyleLines.length > 0) {
    metadata['__assStyles__'] = rawStyleLines.join('\n');
    metadata['__assStylesSectionName__'] = stylesSectionName;
  }

  return {
    cues,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

const DEFAULT_STYLE_FORMAT =
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding';

const DEFAULT_STYLE_LINE =
  'Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1';

const DEFAULT_EVENT_FORMAT_LINE =
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';

/**
 * Serialize a SubtitleTrack to ASS format.
 *
 * If `track.metadata.__assStyles__` is present (written by the parser), it is
 * re-emitted verbatim to preserve the original style table. Otherwise a minimal
 * default "Default" style is emitted.
 *
 * @param track - The SubtitleTrack to serialize.
 * @param sectionOptions - Override section heading for SSA compatibility.
 */
export function serializeAss(
  track: SubtitleTrack,
  sectionOptions: { stylesSectionName?: string } = {},
): string {
  const meta = track.metadata ?? {};
  const stylesSectionName = sectionOptions.stylesSectionName ?? '[V4+ Styles]';

  const scriptInfoLines: string[] = [
    '[Script Info]',
    '; Generated by @webcvt/subtitle',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.601',
    'PlayResX: 640',
    'PlayResY: 480',
  ];

  // Append known Script Info metadata.
  for (const [k, v] of Object.entries(meta)) {
    if (k.startsWith('__') || k === 'ScriptType') continue;
    scriptInfoLines.push(`${k}: ${v}`);
  }

  // Styles section.
  const stylesLines: string[] = [stylesSectionName];
  if (meta['__assStyles__']) {
    stylesLines.push(...meta['__assStyles__'].split('\n'));
  } else {
    stylesLines.push(DEFAULT_STYLE_FORMAT);
    stylesLines.push(DEFAULT_STYLE_LINE);
  }

  // Events section.
  const eventLines: string[] = ['[Events]', DEFAULT_EVENT_FORMAT_LINE];
  for (const cue of track.cues) {
    const styleName = cue.id ?? 'Default';
    const start = formatAssTimestamp(cue.startMs);
    const end = formatAssTimestamp(cue.endMs);
    const assText = escapeAssText(cue.text);
    eventLines.push(
      `Dialogue: 0,${start},${end},${styleName},,0,0,0,,${assText}`,
    );
  }

  return [
    ...scriptInfoLines,
    '',
    ...stylesLines,
    '',
    ...eventLines,
    '',
  ].join('\n');
}
