/**
 * Content-Transfer-Encoding codecs and charset decoding for webcvt-email.
 *
 * Implements base64 (RFC 4648) and quoted-printable (RFC 2045 §6.7) decoding,
 * the RFC 2047 "Q" word decoding, a base64 encoder (used by the JSON backend),
 * and a small charset-aware byte→string decoder. All scanners are hand-written
 * and linear — no backtracking regex runs on untrusted input.
 */

import { latin1Decode } from './bytes.ts';
import { EmailUnsupportedTransferEncodingError } from './errors.ts';

// ---------------------------------------------------------------------------
// Base64
// ---------------------------------------------------------------------------

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const B64_DECODE = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) {
    table[B64_CHARS.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Decode a base64 string to bytes. Whitespace and other non-alphabet
 * characters are skipped (lenient, per RFC 2045 §6.8); `=` padding ends input.
 */
export function decodeBase64(input: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 0x3d) break; // '=' padding → stop
    const value = B64_DECODE[code] ?? -1;
    if (value < 0) continue; // skip whitespace / invalid
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Look up a base64 alphabet character for a 6-bit value (always in range). */
function b64char(value: number): string {
  return B64_CHARS.charAt(value & 63);
}

/** Encode bytes to a (padded) base64 string. */
export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += b64char(n >> 18) + b64char(n >> 12) + b64char(n >> 6) + b64char(n);
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += `${b64char(n >> 18)}${b64char(n >> 12)}==`;
  } else if (remaining === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += `${b64char(n >> 18)}${b64char(n >> 12)}${b64char(n >> 6)}=`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quoted-printable
// ---------------------------------------------------------------------------

/** Parse one hex digit, or -1 if `code` is not a hex character. */
function hexDigit(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30; // 0-9
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10; // A-F
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10; // a-f
  return -1;
}

/** Parse two hex digits at s[i], s[i+1] → byte value, or -1 if invalid. */
function hexByte(s: string, i: number): number {
  const hi = hexDigit(s.charCodeAt(i));
  const lo = hexDigit(s.charCodeAt(i + 1));
  if (hi < 0 || lo < 0) return -1;
  return (hi << 4) | lo;
}

/**
 * Decode a quoted-printable string to bytes (RFC 2045 §6.7).
 * Handles `=XX` hex escapes and `=`-soft line breaks (CRLF, LF, or bare CR).
 * A malformed `=` sequence is emitted literally (lenient).
 */
export function decodeQuotedPrintable(input: string): Uint8Array {
  const out: number[] = [];
  const n = input.length;
  for (let i = 0; i < n; i++) {
    const ch = input.charCodeAt(i);
    if (ch !== 0x3d) {
      out.push(ch & 0xff);
      continue;
    }
    // ch === '='
    const next = input.charCodeAt(i + 1);
    if (next === 0x0a) {
      i += 1; // soft break: =LF
      continue;
    }
    if (next === 0x0d) {
      // soft break: =CRLF or bare =CR
      i += input.charCodeAt(i + 2) === 0x0a ? 2 : 1;
      continue;
    }
    const byte = hexByte(input, i + 1);
    if (byte >= 0) {
      out.push(byte);
      i += 2;
      continue;
    }
    out.push(0x3d); // stray '='
  }
  return Uint8Array.from(out);
}

/**
 * Decode an RFC 2047 "Q" encoded-word payload to bytes.
 * Like quoted-printable but `_` denotes 0x20 and there are no soft line breaks.
 */
export function decodeQEncodedWord(input: string): Uint8Array {
  const out: number[] = [];
  const n = input.length;
  for (let i = 0; i < n; i++) {
    const ch = input.charCodeAt(i);
    if (ch === 0x5f) {
      out.push(0x20); // '_' → space
      continue;
    }
    if (ch === 0x3d) {
      const byte = hexByte(input, i + 1);
      if (byte >= 0) {
        out.push(byte);
        i += 2;
        continue;
      }
      out.push(0x3d);
      continue;
    }
    out.push(ch & 0xff);
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// Charset decoding
// ---------------------------------------------------------------------------

const UTF8_DECODER = new TextDecoder('utf-8');

/** Normalise a charset label: lowercase, trimmed, strip RFC 2231 *language. */
function normaliseCharset(charset: string): string {
  const star = charset.indexOf('*');
  const base = star === -1 ? charset : charset.slice(0, star);
  return base.trim().toLowerCase();
}

/**
 * Decode bytes to a string using a (best-effort) charset.
 * UTF-8 and the Latin-1 family are handled directly; anything else is attempted
 * via TextDecoder and falls back to a lossless Latin-1 mapping.
 */
export function decodeBytesWithCharset(bytes: Uint8Array, charset: string): string {
  const cs = normaliseCharset(charset);
  if (cs === '' || cs === 'utf-8' || cs === 'utf8') {
    return UTF8_DECODER.decode(bytes);
  }
  if (
    cs === 'us-ascii' ||
    cs === 'ascii' ||
    cs === 'iso-8859-1' ||
    cs === 'latin1' ||
    cs === 'windows-1252' ||
    cs === 'cp1252'
  ) {
    return latin1Decode(bytes);
  }
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch {
    return latin1Decode(bytes);
  }
}

// ---------------------------------------------------------------------------
// Transfer-encoding dispatch
// ---------------------------------------------------------------------------

/**
 * Decode an entity body according to its Content-Transfer-Encoding.
 *
 * 7bit / 8bit / binary (and an absent CTE) are identity transforms returning the
 * raw bytes. base64 and quoted-printable decode the ASCII-armoured payload.
 * Any other token throws EmailUnsupportedTransferEncodingError.
 */
export function decodeTransferEncoding(body: Uint8Array, cte: string): Uint8Array {
  switch (cte) {
    case '':
    case '7bit':
    case '8bit':
    case 'binary':
      return body;
    case 'base64':
      return decodeBase64(latin1Decode(body));
    case 'quoted-printable':
      return decodeQuotedPrintable(latin1Decode(body));
    default:
      throw new EmailUnsupportedTransferEncodingError(cte);
  }
}
