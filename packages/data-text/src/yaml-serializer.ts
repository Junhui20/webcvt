/**
 * YAML 1.2 canonical emitter for @catlabtech/webcvt-data-text.
 *
 * Hand-rolled canonical emitter over a YamlFile POJO.
 * No anchors/aliases emitted — always produces expanded tree.
 * Round-trip semantic but not syntactic.
 *
 * Canonical form:
 * - Block style (no flow output)
 * - 2-space indent
 * - Alphabetical map key sort
 * - LF line endings
 * - No BOM
 * - No leading '---'
 * - Plain scalars when unambiguous, double-quoted otherwise
 *
 * Spec: YAML 1.2.2 https://yaml.org/spec/1.2.2/
 * Core Schema: https://yaml.org/spec/1.2.2/#103-core-schema
 * Clean-room: no code ported from js-yaml, yaml (eemeli), yamljs.
 */

import type { YamlFile, YamlValue } from './yaml-parser.ts';

// ---------------------------------------------------------------------------
// Core Schema plain-scalar safety check
// These are the same patterns as in the parser, used to detect if a string
// would be misclassified if emitted plain.
// ---------------------------------------------------------------------------

const NULL_RE_SER = /^(null|Null|NULL|~|)$/;
const BOOL_RE_SER = /^(true|True|TRUE|false|False|FALSE)$/;
const INT_RE_SER = /^[-+]?(?:0|[1-9][0-9]*)$/;
const FLOAT_RE_SER =
  /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)(?:[eE][-+]?[0-9]+)?$|^[-+]?[0-9]+[eE][-+]?[0-9]+$|^[-+]?\.(?:inf|Inf|INF)$|^\.(?:nan|NaN|NAN)$/;

/**
 * YAML 1.1 implicit types that should be quoted even though Core Schema
 * keeps them as strings. Quote them for maximum interoperability and to
 * prevent silent misinterpretation by YAML 1.1 parsers (Trap 5).
 */
const YAML11_AMBIGUOUS_RE =
  /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~)$/;

/**
 * Determine if a string value must be quoted when emitted.
 * Returns true if the string MUST be double-quoted to survive round-trip.
 *
 * A string needs quoting if:
 * - It is empty (would be null)
 * - It matches a Core Schema null/bool/int/float pattern
 * - It starts with a YAML structural character that would confuse the parser
 * - It contains control characters
 * - It starts or ends with whitespace
 * - It contains ':' followed by space (would be a mapping indicator)
 * - It is '---' or '...' (document markers)
 * - It starts with '#' (comment indicator after whitespace)
 */
function needsQuoting(v: string): boolean {
  if (v.length === 0) return true; // empty → null
  if (NULL_RE_SER.test(v)) return true;
  if (BOOL_RE_SER.test(v)) return true;
  if (INT_RE_SER.test(v)) return true;
  if (FLOAT_RE_SER.test(v)) return true;
  if (YAML11_AMBIGUOUS_RE.test(v)) return true; // Quote YAML 1.1 ambiguous values (Trap 5)
  if (v === '---' || v === '...') return true;

  const first = v[0] ?? '';
  // YAML indicator characters at start
  if ('-&*!|>\'"%@`{}[]#'.includes(first)) return true;
  // '? ' or ': ' or '- ' at start
  if (first === '?' || first === ':') return true;

  // Whitespace at start or end
  if (first === ' ' || first === '\t') return true;
  const last = v[v.length - 1] ?? '';
  if (last === ' ' || last === '\t') return true;

  // Control characters anywhere
  for (let i = 0; i < v.length; i++) {
    const cp = v.codePointAt(i) ?? 0;
    if (cp < 0x20 || cp === 0x7f) return true;
    if (cp > 0xffff) i++; // surrogate pair advance
  }

  // ':' followed by space anywhere in the string (mapping indicator)
  for (let i = 0; i < v.length - 1; i++) {
    if (v[i] === ':' && (v[i + 1] === ' ' || v[i + 1] === '\t' || v[i + 1] === '\n')) return true;
  }

  // '#' preceded by space anywhere (comment indicator)
  for (let i = 1; i < v.length; i++) {
    if (v[i] === '#' && (v[i - 1] === ' ' || v[i - 1] === '\t')) return true;
  }

  // Newlines (block scalar territory — for cleanliness we still double-quote)
  if (v.includes('\n') || v.includes('\r')) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Double-quoted string emitter
// ---------------------------------------------------------------------------

/**
 * Emit a double-quoted YAML string scalar.
 * Escapes: control chars, \, ", and nothing else.
 */
function emitDoubleQuoted(v: string): string {
  let out = '"';
  for (let i = 0; i < v.length; ) {
    const cp = v.codePointAt(i) ?? 0;
    const ch = v[i] ?? '';
    if (cp === 0x00) {
      out += '\\0';
      i++;
      continue;
    }
    if (cp === 0x07) {
      out += '\\a';
      i++;
      continue;
    }
    if (cp === 0x08) {
      out += '\\b';
      i++;
      continue;
    }
    if (cp === 0x09) {
      out += '\\t';
      i++;
      continue;
    }
    if (cp === 0x0a) {
      out += '\\n';
      i++;
      continue;
    }
    if (cp === 0x0b) {
      out += '\\v';
      i++;
      continue;
    }
    if (cp === 0x0c) {
      out += '\\f';
      i++;
      continue;
    }
    if (cp === 0x0d) {
      out += '\\r';
      i++;
      continue;
    }
    if (cp === 0x1b) {
      out += '\\e';
      i++;
      continue;
    }
    if (cp === 0x22) {
      out += '\\"';
      i++;
      continue;
    }
    if (cp === 0x5c) {
      out += '\\\\';
      i++;
      continue;
    }
    if (cp < 0x20 || cp === 0x7f) {
      out += `\\x${cp.toString(16).padStart(2, '0')}`;
      i++;
      continue;
    }
    if (cp >= 0x80 && cp <= 0x9f) {
      out += `\\x${cp.toString(16).padStart(2, '0')}`;
      i++;
      continue;
    }
    out += cp > 0xffff ? String.fromCodePoint(cp) : ch;
    i += cp > 0xffff ? 2 : 1;
  }
  out += '"';
  return out;
}

// ---------------------------------------------------------------------------
// Scalar emitter
// ---------------------------------------------------------------------------

function emitScalar(v: string): string {
  if (needsQuoting(v)) return emitDoubleQuoted(v);
  return v;
}

// ---------------------------------------------------------------------------
// Number emitters
// ---------------------------------------------------------------------------

function emitNumber(v: number): string {
  if (Number.isNaN(v)) return '.nan';
  if (!Number.isFinite(v)) return v < 0 ? '-.inf' : '.inf';
  // Standard JS number to string — sufficient for Core Schema round-trip
  return String(v);
}

// ---------------------------------------------------------------------------
// Recursive emitter
// ---------------------------------------------------------------------------

/**
 * Emit a YAML value at the given indent level.
 * @param v        The value to emit
 * @param indent   Current indentation string (spaces)
 */
function emitValue(v: YamlValue, indent: string): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return emitNumber(v);
  if (typeof v === 'string') return emitScalar(v);

  if (Array.isArray(v)) {
    const arr = v as YamlValue[];
    if (arr.length === 0) return '[]\n';
    const childIndent = `${indent}  `;
    let out = '\n';
    for (const item of arr) {
      const itemStr = emitValue(item, childIndent);
      if (
        typeof item === 'object' &&
        item !== null &&
        !Array.isArray(item) &&
        Object.keys(item).length > 0
      ) {
        // Map item inside sequence: emit as block map indented under '- '
        const mapIndent = `${childIndent}  `;
        const mapStr = emitMapEntries(item as { [key: string]: YamlValue }, mapIndent);
        out += `${childIndent}- ${mapStr.trimStart()}`;
      } else if (Array.isArray(item)) {
        out += `${childIndent}- ${itemStr.trimStart()}`;
      } else {
        out += `${childIndent}- ${itemStr}\n`;
      }
    }
    return out;
  }

  // Object (map)
  const obj = v as { [key: string]: YamlValue };
  const keys = Object.keys(obj).sort();
  if (keys.length === 0) return '{}\n';
  return `\n${emitMapEntries(obj, `${indent}  `)}`;
}

/**
 * Emit map entries (sorted keys) at the given indent.
 */
function emitMapEntries(obj: { [key: string]: YamlValue }, indent: string): string {
  const keys = Object.keys(obj).sort();
  let out = '';
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined) continue;
    const keyStr = emitScalar(key);
    const valStr = emitValue(v as YamlValue, indent);

    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      // Map or sequence value → newline before
      out += `${indent}${keyStr}:${valStr}`;
    } else if (Array.isArray(v)) {
      out += `${indent}${keyStr}:${valStr}`;
    } else {
      out += `${indent}${keyStr}: ${valStr}\n`;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public serialize API
// ---------------------------------------------------------------------------

/**
 * Serialize a YamlFile to canonical YAML string.
 *
 * - No %YAML directive emitted (always 1.2 implicit)
 * - No leading '---'
 * - No BOM
 * - LF line endings
 * - 2-space indent
 * - Alphabetical map key sort
 * - Plain scalars when safe, double-quoted otherwise
 * - Anchors/aliases expanded (serializer always produces expanded tree)
 */
export function serializeYaml(file: YamlFile): string {
  const v = file.value;
  if (v === null) return 'null\n';
  if (typeof v === 'boolean') return `${v ? 'true' : 'false'}\n`;
  if (typeof v === 'bigint') return `${v.toString()}\n`;
  if (typeof v === 'number') return `${emitNumber(v)}\n`;
  if (typeof v === 'string') return `${emitScalar(v)}\n`;

  if (Array.isArray(v)) {
    const arr = v as YamlValue[];
    if (arr.length === 0) return '[]\n';
    let out = '';
    for (const item of arr) {
      const itemStr = emitValue(item, '');
      if (
        typeof item === 'object' &&
        item !== null &&
        !Array.isArray(item) &&
        Object.keys(item).length > 0
      ) {
        const mapIndent = '  ';
        const mapStr = emitMapEntries(item as { [key: string]: YamlValue }, mapIndent);
        out += `-\n${mapStr}`;
      } else if (Array.isArray(item)) {
        out += `- ${itemStr.trimStart()}`;
      } else {
        out += `- ${itemStr}\n`;
      }
    }
    return out;
  }

  // Object
  const obj = v as { [key: string]: YamlValue };
  const keys = Object.keys(obj).sort();
  if (keys.length === 0) return '{}\n';
  return emitMapEntries(obj, '');
}
