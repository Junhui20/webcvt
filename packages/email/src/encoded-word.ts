/**
 * RFC 2047 encoded-word decoding for webcvt-email.
 *
 * An encoded-word has the form `=?charset?encoding?encoded-text?=` where
 * `encoding` is `B` (base64) or `Q` (a quoted-printable variant). Adjacent
 * encoded-words separated only by linear whitespace have that whitespace
 * removed (RFC 2047 §6.2). The scanner is hand-written and linear so there is
 * no ReDoS exposure on hostile header values.
 */

import { decodeBase64, decodeBytesWithCharset, decodeQEncodedWord } from './transfer-encoding.ts';

interface EncodedWord {
  /** Decoded text of this encoded-word. */
  text: string;
  /** Index immediately after the closing `?=`. */
  end: number;
}

/** Largest charset label we will consider valid (defensive bound). */
const MAX_CHARSET_LEN = 100;

/**
 * Try to parse a single encoded-word beginning at `start` (where s[start] is the
 * `=` of the `=?` introducer). Returns null if the token is not a well-formed
 * encoded-word, in which case the caller treats `=?` as literal text.
 */
function parseEncodedWord(s: string, start: number): EncodedWord | null {
  // s[start] === '=', s[start + 1] === '?'
  const charsetStart = start + 2;
  const charsetEnd = s.indexOf('?', charsetStart);
  if (charsetEnd === -1) return null;

  const encStart = charsetEnd + 1;
  const encEnd = s.indexOf('?', encStart);
  if (encEnd === -1) return null;

  const textStart = encEnd + 1;
  const textEnd = s.indexOf('?=', textStart);
  if (textEnd === -1) return null;

  const charset = s.slice(charsetStart, charsetEnd);
  if (charset.length === 0 || charset.length > MAX_CHARSET_LEN) return null;

  const encoding = s.slice(encStart, encEnd).toUpperCase();
  const encodedText = s.slice(textStart, textEnd);
  // Encoded-text may not contain whitespace (RFC 2047 §2).
  if (/\s/.test(encodedText)) return null;

  let bytes: Uint8Array;
  if (encoding === 'B') {
    bytes = decodeBase64(encodedText);
  } else if (encoding === 'Q') {
    bytes = decodeQEncodedWord(encodedText);
  } else {
    return null;
  }

  return { text: decodeBytesWithCharset(bytes, charset), end: textEnd + 2 };
}

/** True if `code` is a linear-whitespace code unit (space, tab, CR, or LF). */
function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0d || code === 0x0a;
}

/**
 * Decode all RFC 2047 encoded-words in a header value. Non-encoded runs are
 * passed through unchanged; whitespace separating two adjacent encoded-words is
 * dropped.
 */
export function decodeEncodedWords(input: string): string {
  let out = '';
  let pendingWhitespace = '';
  let lastWasEncodedWord = false;
  let i = 0;
  const n = input.length;

  while (i < n) {
    if (input.charCodeAt(i) === 0x3d && input.charCodeAt(i + 1) === 0x3f) {
      const word = parseEncodedWord(input, i);
      if (word) {
        // Between two adjacent encoded-words, drop the separating whitespace.
        if (!lastWasEncodedWord) out += pendingWhitespace;
        pendingWhitespace = '';
        out += word.text;
        lastWasEncodedWord = true;
        i = word.end;
        continue;
      }
    }

    const code = input.charCodeAt(i);
    if (isWhitespace(code)) {
      pendingWhitespace += input[i];
      i += 1;
      continue;
    }

    // Ordinary (non-whitespace, non-encoded-word) character.
    out += pendingWhitespace;
    pendingWhitespace = '';
    out += input[i];
    lastWasEncodedWord = false;
    i += 1;
  }

  return out + pendingWhitespace;
}
