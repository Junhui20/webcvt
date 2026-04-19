/**
 * INI parse/serialize for @webcvt/data-text.
 *
 * Implements the de-facto Windows INI subset:
 * - [section] headers (literal names, no nesting — Trap §8)
 * - key=value and key: value pairs
 * - ; and # line comments
 * - __default__ section for keys before the first header
 * - Last-key-wins on duplicates, with a warning pushed to IniFile.warnings (Trap §9)
 * - Whitespace trimmed around keys, delimiters, and values
 *
 * No quoting or escape processing — values are raw remainder of the line.
 * No comment preservation on serialize.
 */

import { MAX_INI_KEYS, MAX_INI_SECTIONS } from './constants.ts';
import { IniEmptyKeyError, IniInvalidUtf8Error, IniSyntaxError } from './errors.ts';
import { decodeInput } from './utf8.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** INI as a flat section → key → value map. */
export interface IniFile {
  /**
   * Insertion-ordered section names.
   * '__default__' appears first if any bare keys preceded the first header.
   */
  sections: string[];
  /**
   * Map of section name → insertion-ordered key/value entries.
   * Last-wins on duplicate key; duplicates emit a warning.
   */
  data: Record<string, Record<string, string>>;
  /** Non-fatal parse warnings (duplicate-key notices). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Name used for keys that appear before the first section header. */
const DEFAULT_SECTION = '__default__';

/**
 * Parse an INI document from bytes or a string.
 */
export function parseIni(input: Uint8Array | string): IniFile {
  const { text } = decodeInput(input, 'INI', (cause) => new IniInvalidUtf8Error(cause));

  const sections: string[] = [];
  // Use Object.create(null) so that adversarial section names like '[__proto__]'
  // or 'constructor' do NOT pollute Object.prototype when assigned via
  // `data[sectionName] = ...` (Sec-H-1 from review). Inner per-section
  // records are created the same way below.
  const data: Record<string, Record<string, string>> = Object.create(null) as Record<
    string,
    Record<string, string>
  >;
  data[DEFAULT_SECTION] = Object.create(null) as Record<string, string>;
  const warnings: string[] = [];
  let currentSection = DEFAULT_SECTION;
  let totalKeys = 0;

  const lines = text.split(/\r\n?|\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineNumber = lineIndex + 1;
    const line = lines[lineIndex] as string;
    const trimmed = line.trim();

    // Blank lines
    if (trimmed.length === 0) {
      continue;
    }

    // Comment lines
    const firstChar = trimmed[0];
    if (firstChar === ';' || firstChar === '#') {
      continue;
    }

    // Section header: [name]
    // Trap §8: treat entire bracket content as a literal section name (no nesting).
    const sectionMatch = /^\[(.+)\]$/.exec(trimmed);
    if (sectionMatch !== null) {
      const sectionName = (sectionMatch[1] as string).trim();
      currentSection = sectionName;

      if (!(sectionName in data)) {
        if (sections.length >= MAX_INI_SECTIONS) {
          // Silently treat as key under a new section would breach cap;
          // throw to be safe with the cap.
          throw new IniSyntaxError(
            lineNumber,
            `section count would exceed MAX_INI_SECTIONS (${MAX_INI_SECTIONS})`,
          );
        }
        sections.push(sectionName);
        data[sectionName] = Object.create(null) as Record<string, string>;
      }

      continue;
    }

    // Key=value or key: value
    const eqIdx = trimmed.indexOf('=');
    const colonIdx = trimmed.indexOf(':');

    let sepIdx: number;
    if (eqIdx === -1 && colonIdx === -1) {
      throw new IniSyntaxError(lineNumber, trimmed);
    }
    if (eqIdx === -1) {
      sepIdx = colonIdx;
    } else if (colonIdx === -1) {
      sepIdx = eqIdx;
    } else {
      sepIdx = Math.min(eqIdx, colonIdx);
    }

    const key = trimmed.slice(0, sepIdx).trim();
    const value = trimmed.slice(sepIdx + 1).trim();

    if (key.length === 0) {
      throw new IniEmptyKeyError(lineNumber);
    }

    // Section was created when it was first seen above; this is a defensive
    // no-op kept for clarity. Use Object.create(null) for prototype safety.
    if (data[currentSection] === undefined) {
      data[currentSection] = Object.create(null) as Record<string, string>;
    }

    // Trap §9: duplicate key warning, last-wins
    if ((data[currentSection] as Record<string, string>)[key] !== undefined) {
      warnings.push(`duplicate key '${currentSection}.${key}' at line ${lineNumber}; last-wins`);
    } else {
      // New key: check total cap
      if (totalKeys >= MAX_INI_KEYS) {
        throw new IniSyntaxError(
          lineNumber,
          `key count would exceed MAX_INI_KEYS (${MAX_INI_KEYS})`,
        );
      }
      totalKeys += 1;
    }

    (data[currentSection] as Record<string, string>)[key] = value;
  }

  // If __default__ section is empty, omit it from sections list
  const defaultData = data[DEFAULT_SECTION] as Record<string, string>;
  const hasDefaultKeys = Object.keys(defaultData).length > 0;

  const finalSections = hasDefaultKeys ? [DEFAULT_SECTION, ...sections] : sections;

  return { sections: finalSections, data, warnings };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize an IniFile back to a string.
 *
 * - Sections in `sections` order.
 * - For __default__ section: keys are emitted at the top without a [header].
 * - Other sections: emit [name] then key=value pairs.
 * - One blank line between sections.
 * - No comments, no quoting, no escaping.
 */
export function serializeIni(file: IniFile): string {
  const { sections, data } = file;
  const parts: string[] = [];
  let first = true;

  for (const section of sections) {
    const sectionData = data[section];
    if (sectionData === undefined) continue;

    if (!first) {
      parts.push('\n');
    }
    first = false;

    if (section !== DEFAULT_SECTION) {
      parts.push(`[${section}]\n`);
    }

    for (const [key, value] of Object.entries(sectionData)) {
      parts.push(`${key}=${value}\n`);
    }
  }

  return parts.join('');
}
