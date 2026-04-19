/**
 * UTF-8 decode helpers for @webcvt/data-text.
 *
 * Key decisions:
 * - TextDecoder is hoisted to module scope (Lesson 2 from prior packages).
 * - fatal: true so malformed UTF-8 throws a TypeError instead of silently
 *   replacing bytes with U+FFFD (Trap §13).
 * - ignoreBOM: false is the default but stated explicitly for clarity.
 *   With ignoreBOM: false, a BOM (U+FEFF) IS included in the decoded string
 *   so we can detect and record it. (The option name is counter-intuitive —
 *   see Trap §5 in the design note.)
 */

import { MAX_INPUT_BYTES, MAX_INPUT_CHARS } from './constants.ts';
import { InputTooLargeError, InputTooManyCharsError } from './errors.ts';

// ---------------------------------------------------------------------------
// Module-scoped TextDecoder (hoisted, reused across calls)
// ---------------------------------------------------------------------------

/**
 * Fatal UTF-8 TextDecoder with BOM preservation enabled.
 *
 * IMPORTANT: The `ignoreBOM` option name is inverted from what you might expect:
 *   - `ignoreBOM: false` (default) → TextDecoder STRIPS the BOM from the output
 *   - `ignoreBOM: true`            → TextDecoder PRESERVES the BOM in the output
 *
 * We use `ignoreBOM: true` so the BOM passes through to the string layer where
 * we can detect it, record `hadBom`, and strip it ourselves. This is the correct
 * approach for round-trip preservation. (Trap §5 in the design note.)
 */
const DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// ---------------------------------------------------------------------------
// Unicode BOM constant
// ---------------------------------------------------------------------------

/** UTF-8 BOM as a Unicode code point / JS string character. */
const BOM_CHAR = '\uFEFF';

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Result of decodeInput — decoded string with BOM metadata.
 */
export interface DecodeResult {
  /** Decoded UTF-8 string, BOM stripped if present. */
  text: string;
  /** Whether the input started with a UTF-8 BOM. */
  hadBom: boolean;
}

/**
 * Decode a Uint8Array or pass through a string, enforcing:
 * 1. MAX_INPUT_BYTES cap (on Uint8Array).
 * 2. Fatal UTF-8 decoding (TypeError wrapped in formatInvalidUtf8Error).
 * 3. MAX_INPUT_CHARS cap (on decoded string).
 * 4. BOM detection and stripping (Trap §5).
 *
 * @param input    Raw bytes or already-decoded string.
 * @param format   Format name for error messages (e.g. 'JSON').
 * @param makeUtf8Error  Factory for the format-specific InvalidUtf8Error.
 */
export function decodeInput(
  input: Uint8Array | string,
  format: string,
  makeUtf8Error: (cause: unknown) => Error,
): DecodeResult {
  let raw: string;

  if (input instanceof Uint8Array) {
    if (input.length > MAX_INPUT_BYTES) {
      throw new InputTooLargeError(input.length, MAX_INPUT_BYTES, format);
    }
    try {
      raw = DECODER.decode(input);
    } catch (err) {
      throw makeUtf8Error(err);
    }
  } else {
    raw = input;
  }

  if (raw.length > MAX_INPUT_CHARS) {
    throw new InputTooManyCharsError(raw.length, MAX_INPUT_CHARS, format);
  }

  const hadBom = raw.charCodeAt(0) === 0xfeff;
  const text = hadBom ? raw.slice(1) : raw;

  return { text, hadBom };
}
