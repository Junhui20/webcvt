/**
 * Minimal, ReDoS-safe (X)HTML → plain-text conversion for the EPUB `txt` target.
 *
 * A hand-written linear scanner (no backtracking regex on the variable-length
 * document): it drops `<script>` / `<style>` blocks, turns block-level tags into
 * newlines, removes all other tags, decodes the five predefined XML/HTML
 * entities plus decimal/hex numeric character references, and collapses runs of
 * blank lines. Single-pass O(n); a stray `&` or `<` cannot trigger a long scan.
 *
 * Clean-room implementation.
 */

const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'br',
  'p',
  'div',
  'li',
  'tr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'table',
  'blockquote',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'nav',
  'figure',
  'hr',
  'pre',
]);

/** The five predefined entities (XML 1.0 §4.6); the only named set we decode. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Decode a single entity body (the text between `&` and `;`) or return null. */
function decodeEntityBody(body: string): string | null {
  if (body.length === 0 || body.length > 12) return null;
  if (body[0] === '#') {
    const isHex = body[1] === 'x' || body[1] === 'X';
    const digits = isHex ? body.slice(2) : body.slice(1);
    if (digits.length === 0) return null;
    const code = Number.parseInt(digits, isHex ? 16 : 10);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null;
    try {
      return String.fromCodePoint(code);
    } catch {
      return null;
    }
  }
  return Object.hasOwn(NAMED_ENTITIES, body) ? (NAMED_ENTITIES[body] ?? null) : null;
}

/** Decode the supported entities; pass everything else through unchanged. */
function decodeEntities(text: string): string {
  if (text.indexOf('&') === -1) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '&') {
      out += text[i];
      i += 1;
      continue;
    }
    const semi = text.indexOf(';', i + 1);
    // Bound the lookahead so a lone '&' cannot scan far.
    if (semi === -1 || semi - i > 12) {
      out += '&';
      i += 1;
      continue;
    }
    const decoded = decodeEntityBody(text.slice(i + 1, semi));
    if (decoded === null) {
      out += '&';
      i += 1;
      continue;
    }
    out += decoded;
    i = semi + 1;
  }
  return out;
}

/** Case-insensitive search for a closing tag like `</script` from `from`. */
function findClosingTag(html: string, tag: string, from: number): number {
  return html.toLowerCase().indexOf(`</${tag}`, from);
}

/**
 * Convert an (X)HTML string to plain text. Output decodes entities, inserts a
 * newline for block-level elements, collapses 3+ newlines to 2, strips trailing
 * spaces, and trims the ends.
 */
export function htmlToText(html: string): string {
  let out = '';
  let i = 0;
  const n = html.length;

  while (i < n) {
    const ch = html[i];
    if (ch !== '<') {
      out += ch;
      i += 1;
      continue;
    }

    const close = html.indexOf('>', i + 1);
    if (close === -1) {
      // Unterminated tag: treat the remainder as text.
      out += html.slice(i);
      break;
    }

    const tagBody = html.slice(i + 1, close).trim();
    const isClosing = tagBody.startsWith('/');
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9]*/.exec(isClosing ? tagBody.slice(1) : tagBody);
    const tagName = (nameMatch?.[0] ?? '').toLowerCase();

    if (!isClosing && (tagName === 'script' || tagName === 'style')) {
      const closingIdx = findClosingTag(html, tagName, close + 1);
      if (closingIdx === -1) {
        break; // no closing tag → drop the rest
      }
      const endOfClose = html.indexOf('>', closingIdx);
      i = endOfClose === -1 ? n : endOfClose + 1;
      continue;
    }

    if (BLOCK_TAGS.has(tagName)) out += '\n';
    i = close + 1;
  }

  return decodeEntities(out)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
