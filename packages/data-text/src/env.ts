/**
 * ENV (dotenv-style) parse/serialize for @catlabtech/webcvt-data-text.
 *
 * Implements the conservative dotenv subset:
 * - KEY=value per line, optional 'export ' prefix stripped
 * - Keys match /^[A-Za-z_][A-Za-z0-9_]*$/
 * - Three value forms:
 *     - Single-quoted: literal, no escapes
 *     - Double-quoted: \n / \t / \\ / \" recognized; others rejected (Trap §11)
 *     - Unquoted: trailing whitespace trimmed; # strips from that point (Trap §12)
 * - Blank lines and # comment lines skipped
 * - Trap §10: raw multi-line values rejected (no literal newlines in values)
 * - Last-wins on duplicate keys with a warning
 *
 * Note: KEY=foo#bar yields value 'foo' (not 'foo#bar') because # in an
 * unquoted value is always a comment delimiter (motdotla/dotenv behaviour).
 */

import { MAX_ENV_KEYS } from './constants.ts';
import { EnvBadEscapeError, EnvInvalidUtf8Error, EnvSyntaxError } from './errors.ts';
import { decodeInput } from './utf8.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Parsed ENV document. */
export interface EnvFile {
  /** Insertion-ordered key names; preserved on serialize. */
  keys: string[];
  /** Key → string value. Last-wins on duplicate; warning emitted. */
  data: Record<string, string>;
  /** Non-fatal parse warnings. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Value decoder
// ---------------------------------------------------------------------------

/**
 * Decode the value portion of a KEY=<rest> line.
 *
 * @param rest        Everything after the `=` sign.
 * @param lineNumber  For error messages.
 */
function decodeValue(rest: string, lineNumber: number): string {
  if (rest.length === 0) {
    return '';
  }

  const first = rest[0] as string;

  // Single-quoted: literal, no escapes
  if (first === "'") {
    const closeIdx = rest.indexOf("'", 1);
    if (closeIdx === -1) {
      throw new EnvSyntaxError(lineNumber);
    }
    // After closing quote: only optional whitespace and optional # comment allowed
    const trailing = rest.slice(closeIdx + 1).trimStart();
    if (trailing.length > 0 && trailing[0] !== '#') {
      throw new EnvSyntaxError(lineNumber);
    }
    return rest.slice(1, closeIdx);
  }

  // Double-quoted: escape sequences
  if (first === '"') {
    let value = '';
    let i = 1;
    while (i < rest.length) {
      const c = rest[i] as string;
      if (c === '"') {
        // Closing quote found
        const trailing = rest.slice(i + 1).trimStart();
        if (trailing.length > 0 && trailing[0] !== '#') {
          throw new EnvSyntaxError(lineNumber);
        }
        return value;
      }
      if (c === '\\') {
        i += 1;
        if (i >= rest.length) {
          throw new EnvSyntaxError(lineNumber);
        }
        const esc = rest[i] as string;
        switch (esc) {
          case 'n':
            value += '\n';
            break;
          case 't':
            value += '\t';
            break;
          case '\\':
            value += '\\';
            break;
          case '"':
            value += '"';
            break;
          default:
            // Trap §11: reject unrecognized escape sequences
            throw new EnvBadEscapeError(lineNumber, esc);
        }
      } else {
        value += c;
      }
      i += 1;
    }
    // Unterminated double-quoted value
    throw new EnvSyntaxError(lineNumber);
  }

  // Unquoted: scan for # comment delimiter, then rtrim
  // Trap §12: # is always a comment delimiter in unquoted values, even without leading space
  const hashIdx = rest.indexOf('#');
  const raw = hashIdx === -1 ? rest : rest.slice(0, hashIdx);
  return raw.trimEnd();
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/**
 * Parse an ENV document from bytes or a string.
 */
export function parseEnv(input: Uint8Array | string): EnvFile {
  const { text } = decodeInput(input, 'ENV', (cause) => new EnvInvalidUtf8Error(cause));

  const keys: string[] = [];
  // Use Object.create(null) so that adversarial keys like '__proto__' or
  // 'constructor' assigned via `data[key] = value` do NOT pollute
  // Object.prototype (Sec-H-1 from review).
  const data: Record<string, string> = Object.create(null) as Record<string, string>;
  const warnings: string[] = [];

  // Trap §10: split on line boundaries; multi-line values are rejected
  const lines = text.split(/\r\n?|\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineNumber = lineIndex + 1;
    const line = lines[lineIndex] as string;

    // Strip leading whitespace only (preserve key/value structure)
    const stripped = line.replace(/^\s+/, '');

    if (stripped.length === 0) {
      continue;
    }

    if (stripped[0] === '#') {
      continue;
    }

    // Strip optional 'export ' prefix
    let remainder = stripped;
    if (remainder.startsWith('export ')) {
      remainder = remainder.slice('export '.length).replace(/^\s+/, '');
    }

    const match = KEY_RE.exec(remainder);
    if (match === null) {
      throw new EnvSyntaxError(lineNumber);
    }

    const key = match[1] as string;
    const rest = match[2] as string;

    const value = decodeValue(rest, lineNumber);

    if (key in data) {
      warnings.push(`duplicate key '${key}' at line ${lineNumber}; last-wins`);
    } else {
      if (keys.length >= MAX_ENV_KEYS) {
        throw new EnvSyntaxError(lineNumber);
      }
      keys.push(key);
    }

    data[key] = value;
  }

  return { keys, data, warnings };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Regex matching values that are safe to emit unquoted.
 * Allows alphanumeric, underscore, dot, slash, colon, at-sign, comma, plus, hyphen.
 */
const SAFE_UNQUOTED_RE = /^[A-Za-z0-9_./:@,+\-]*$/;

/**
 * Serialize an EnvFile back to a string.
 *
 * - Empty values: KEY=
 * - Safe-shell values: KEY=value (no quoting)
 * - All other values: KEY="value" with \\ " \n \t escaped
 * - Line terminator: LF (\n)
 */
export function serializeEnv(file: EnvFile): string {
  const { keys, data } = file;
  const parts: string[] = [];

  for (const key of keys) {
    const value = data[key] ?? '';

    if (value === '') {
      parts.push(`${key}=\n`);
    } else if (SAFE_UNQUOTED_RE.test(value)) {
      parts.push(`${key}=${value}\n`);
    } else {
      const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
      parts.push(`${key}="${escaped}"\n`);
    }
  }

  return parts.join('');
}
