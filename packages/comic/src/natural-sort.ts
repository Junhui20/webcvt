/**
 * Natural (numeric-aware) string ordering for comic page filenames.
 *
 * Lexicographic order sorts `page10` before `page2` because `'1' < '2'`. Comic
 * readers expect numeric runs to be compared by VALUE, so `page2` precedes
 * `page10`. This module implements that comparison with a manual character scan
 * (no regular expressions at all — hence no possibility of catastrophic
 * backtracking on adversarial entry names).
 *
 * Rules:
 *   - A maximal run of ASCII digits is compared as a number: first by its length
 *     after stripping leading zeros (more significant digits ⇒ larger), then
 *     digit-by-digit, then — as a stable tie-break for equal values — the run
 *     with FEWER leading zeros sorts first.
 *   - Non-digit characters are compared case-insensitively first (so `A`/`a`
 *     interleave naturally), then case-sensitively as a stable tie-break.
 */

const ZERO = 0x30;
const NINE = 0x39;

function isDigit(code: number): boolean {
  return code >= ZERO && code <= NINE;
}

/** Lowercase an ASCII letter code; leave everything else unchanged. */
function toLowerCode(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
}

/**
 * Compare two strings in natural order. Returns a negative number when `a`
 * sorts before `b`, a positive number when after, and 0 when equal.
 */
export function naturalCompare(a: string, b: string): number {
  let i = 0;
  let j = 0;
  const la = a.length;
  const lb = b.length;

  while (i < la && j < lb) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(j);
    const aDigit = isDigit(ca);
    const bDigit = isDigit(cb);

    if (aDigit && bDigit) {
      // Locate the bounds of each digit run, and where its significant digits
      // begin (after any leading zeros).
      const aRunStart = i;
      const bRunStart = j;
      while (i < la && isDigit(a.charCodeAt(i))) i += 1;
      while (j < lb && isDigit(b.charCodeAt(j))) j += 1;

      let aSig = aRunStart;
      while (aSig < i - 1 && a.charCodeAt(aSig) === ZERO) aSig += 1;
      let bSig = bRunStart;
      while (bSig < j - 1 && b.charCodeAt(bSig) === ZERO) bSig += 1;

      const aSigLen = i - aSig;
      const bSigLen = j - bSig;
      if (aSigLen !== bSigLen) return aSigLen - bSigLen;

      for (let k = 0; k < aSigLen; k += 1) {
        const da = a.charCodeAt(aSig + k);
        const db = b.charCodeAt(bSig + k);
        if (da !== db) return da - db;
      }

      // Equal numeric value: fewer leading zeros (shorter raw run) first.
      const aRawLen = i - aRunStart;
      const bRawLen = j - bRunStart;
      if (aRawLen !== bRawLen) return aRawLen - bRawLen;
      continue;
    }

    if (ca !== cb) {
      const lca = toLowerCode(ca);
      const lcb = toLowerCode(cb);
      if (lca !== lcb) return lca - lcb;
      return ca - cb;
    }
    i += 1;
    j += 1;
  }

  // One string is a prefix of the other (or they are equal): shorter first.
  return la - i - (lb - j);
}

/**
 * Return a NEW array sorted by {@link naturalCompare} on the value derived from
 * each element by `key`. Stable: ties preserve the input order.
 */
export function naturalSortBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, k: key(item) }))
    .sort((x, y) => {
      const cmp = naturalCompare(x.k, y.k);
      return cmp !== 0 ? cmp : x.index - y.index;
    })
    .map((entry) => entry.item);
}
