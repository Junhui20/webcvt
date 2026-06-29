/**
 * Low-level, bounded byte-scanning helpers for the read-only PDF-info reader.
 *
 * Everything here works directly on the raw `Uint8Array` and only ever decodes
 * small, bounded slices to text. No regular expressions run on untrusted input,
 * so there is no catastrophic-backtracking surface; every scan is a single
 * forward/backward pass with an explicit upper bound.
 */

const LATIN1 = new TextDecoder('latin1');

/** Decode bytes `[start, end)` as Latin-1 (each byte → one char). */
export function decodeLatin1(bytes: Uint8Array, start: number, end: number): string {
  return LATIN1.decode(bytes.subarray(start, end));
}

/** PDF whitespace: NUL, TAB, LF, FF, CR, SP. */
export function isWs(code: number): boolean {
  return (
    code === 0x00 ||
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0c ||
    code === 0x0d ||
    code === 0x20
  );
}

/** PDF delimiter characters: ( ) < > [ ] { } / % */
export function isDelim(code: number): boolean {
  return (
    code === 0x28 ||
    code === 0x29 ||
    code === 0x3c ||
    code === 0x3e ||
    code === 0x5b ||
    code === 0x5d ||
    code === 0x7b ||
    code === 0x7d ||
    code === 0x2f ||
    code === 0x25
  );
}

/** First index ≥ `from` where the ASCII `needle` occurs, or -1. */
export function indexOfSeq(haystack: Uint8Array, needle: string, from = 0): number {
  const nlen = needle.length;
  if (nlen === 0) return Math.max(0, from);
  const last = haystack.length - nlen;
  const c0 = needle.charCodeAt(0);
  for (let i = Math.max(0, from); i <= last; i++) {
    if (haystack[i] !== c0) continue;
    let k = 1;
    while (k < nlen && haystack[i + k] === needle.charCodeAt(k)) k++;
    if (k === nlen) return i;
  }
  return -1;
}

/** Last index < `before` where the ASCII `needle` occurs, or -1. */
export function lastIndexOfSeq(haystack: Uint8Array, needle: string, before?: number): number {
  const nlen = needle.length;
  if (nlen === 0) return Math.min(before ?? haystack.length, haystack.length);
  const hi = Math.min((before ?? haystack.length) - nlen, haystack.length - nlen);
  const c0 = needle.charCodeAt(0);
  for (let i = hi; i >= 0; i--) {
    if (haystack[i] !== c0) continue;
    let k = 1;
    while (k < nlen && haystack[i + k] === needle.charCodeAt(k)) k++;
    if (k === nlen) return i;
  }
  return -1;
}

/** Skip a PDF literal string `( … )` starting at `i` (just after the `(`). */
function skipLiteral(bytes: Uint8Array, i: number, end: number): number {
  let depth = 1;
  let j = i;
  while (j < end) {
    const c = bytes[j];
    if (c === undefined) break;
    if (c === 0x5c /* \ */) {
      j += 2;
      continue;
    }
    if (c === 0x28 /* ( */) depth++;
    else if (c === 0x29 /* ) */) {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return end;
}

/** Skip a PDF hex string `< … >` starting at `i` (just after the `<`). */
function skipHex(bytes: Uint8Array, i: number, end: number): number {
  let j = i;
  while (j < end) {
    if (bytes[j] === 0x3e /* > */) return j + 1;
    j++;
  }
  return end;
}

/**
 * Given `start` at the first `<` of a `<<` dictionary, return the index just
 * past the matching `>>`, or -1 if not found within `maxBytes`. String/hex-aware
 * so a `>>` inside a `( … )` or `< … >` value does not close the dict early.
 */
export function matchDictEnd(bytes: Uint8Array, start: number, maxBytes: number): number {
  const hardEnd = Math.min(bytes.length, start + maxBytes);
  let depth = 0;
  let i = start;
  while (i < hardEnd) {
    const c = bytes[i];
    if (c === undefined) break;
    if (c === 0x28 /* ( */) {
      i = skipLiteral(bytes, i + 1, hardEnd);
      continue;
    }
    if (c === 0x3c /* < */) {
      if (bytes[i + 1] === 0x3c) {
        depth++;
        i += 2;
        continue;
      }
      i = skipHex(bytes, i + 1, hardEnd);
      continue;
    }
    if (c === 0x3e /* > */) {
      if (bytes[i + 1] === 0x3e) {
        depth--;
        i += 2;
        if (depth === 0) return i;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Locate the indirect object `num gen obj` and return the Latin-1 text of its
 * `<< … >>` dictionary, or undefined. The last matching definition wins, so an
 * incrementally updated object resolves to its newest revision. A digit before
 * the number rules out false matches (e.g. "12 0 obj" vs "2 0 obj").
 */
export function findObjectDict(
  bytes: Uint8Array,
  num: number,
  gen: number,
  maxDictBytes: number,
): string | undefined {
  const marker = `${num} ${gen} obj`;
  let searchBefore = bytes.length;
  for (;;) {
    const i = lastIndexOfSeq(bytes, marker, searchBefore);
    if (i === -1) return undefined;
    const prev = i > 0 ? bytes[i - 1] : undefined;
    const boundaryOk = i === 0 || (prev !== undefined && (isWs(prev) || isDelim(prev)));
    if (boundaryOk) {
      const lt = indexOfSeq(bytes, '<<', i + marker.length);
      if (lt !== -1) {
        const end = matchDictEnd(bytes, lt, maxDictBytes);
        if (end !== -1) return decodeLatin1(bytes, lt, end);
      }
      return undefined;
    }
    searchBefore = i; // keep looking before this false match
  }
}
