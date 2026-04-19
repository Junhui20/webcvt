/**
 * JSON parse/serialize for @webcvt/data-text.
 *
 * Wraps native JSON.parse / JSON.stringify with:
 * - UTF-8 decoding via fatal-mode TextDecoder (see utf8.ts).
 * - Input-size cap (MAX_INPUT_BYTES / MAX_INPUT_CHARS).
 * - Depth pre-scan BEFORE JSON.parse to prevent V8 stack-overflow (Trap §1).
 *   The pre-scan is a single O(n) pass that counts structural characters
 *   [/{/}/] outside strings. If max depth > MAX_JSON_DEPTH = 256, throws
 *   JsonDepthExceededError without ever invoking JSON.parse.
 * - BOM detection and strip (Trap §5).
 *
 * Security note (Trap §2): JSON.parse in modern V8 sets __proto__ as an own
 * data property, not via the setter, so prototype pollution does NOT occur
 * during parse. However, callers that subsequently merge the parsed tree into
 * another object via Object.assign MUST use Object.create(null) as the target
 * or explicitly delete __proto__/constructor/prototype keys.
 *
 * Integer precision (Trap §15): numbers above Number.MAX_SAFE_INTEGER (2^53-1)
 * silently lose precision. Callers that need BigInt handling for large IDs
 * must pre-process the source string before calling parseJson.
 */

import { MAX_JSON_DEPTH } from './constants.ts';
import { JsonDepthExceededError, JsonInvalidUtf8Error, JsonParseError } from './errors.ts';
import { decodeInput } from './utf8.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** RFC 8259 JSON value tree. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Parsed JSON document with BOM metadata. */
export interface JsonFile {
  /** Parsed root value. */
  value: JsonValue;
  /** Whether the input had a UTF-8 BOM (preserved on serialize if true). */
  hadBom: boolean;
}

// ---------------------------------------------------------------------------
// Depth pre-scan (Trap §1)
// ---------------------------------------------------------------------------

/**
 * Walk the source string once to find the maximum structural nesting depth.
 * Counts `[` and `{` as +1, `]` and `}` as -1, skips characters inside
 * strings (tracking `"` with `\"` escape awareness).
 *
 * Returns the maximum depth reached. Throws JsonDepthExceededError if it
 * exceeds MAX_JSON_DEPTH — this must run BEFORE JSON.parse.
 */
function prescanJsonDepth(text: string): void {
  let depth = 0;
  let maxDepth = 0;
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') {
        // Skip the next character (escape sequence)
        i += 1;
      } else if (c === '"') {
        inString = false;
      }
    } else {
      if (c === '"') {
        inString = true;
      } else if (c === '[' || c === '{') {
        depth += 1;
        if (depth > maxDepth) {
          maxDepth = depth;
          if (maxDepth > MAX_JSON_DEPTH) {
            throw new JsonDepthExceededError(maxDepth, MAX_JSON_DEPTH);
          }
        }
      } else if (c === ']' || c === '}') {
        depth -= 1;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a JSON document from bytes or a string.
 *
 * Steps:
 * 1. Decode + size-cap (via decodeInput).
 * 2. Pre-scan depth (throws JsonDepthExceededError before JSON.parse).
 * 3. Call JSON.parse (wraps SyntaxError in JsonParseError).
 * 4. Return { value, hadBom }.
 */
export function parseJson(input: Uint8Array | string): JsonFile {
  const { text, hadBom } = decodeInput(input, 'JSON', (cause) => new JsonInvalidUtf8Error(cause));

  // Trap §1: pre-scan BEFORE JSON.parse
  prescanJsonDepth(text);

  let value: JsonValue;
  try {
    value = JSON.parse(text) as JsonValue;
  } catch (err) {
    throw new JsonParseError(err);
  }

  return { value, hadBom };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a JsonFile back to a string.
 *
 * - Delegates to JSON.stringify; no post-processing of the result.
 * - If file.hadBom is true, prepends U+FEFF for round-trip preservation.
 * - indent defaults to 0 (compact).
 *
 * Note (Trap §14): JSON.stringify silently drops undefined values and
 * function-valued properties, and converts undefined in arrays to null.
 * The JsonValue type forbids these by construction; callers passing
 * untyped unknown MUST filter such values first.
 */
export function serializeJson(file: JsonFile, opts?: { indent?: number }): string {
  const indent = opts?.indent ?? 0;
  const serialized = JSON.stringify(file.value, null, indent === 0 ? undefined : indent);
  return file.hadBom ? `${'\uFEFF'}${serialized}` : serialized;
}
