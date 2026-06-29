/**
 * Minimal, ReDoS-safe HTML → plain-text conversion for webcvt-email.
 *
 * Used by the `txt` backend when a message has only an HTML body. This is a
 * hand-written linear scanner (no backtracking regex on the variable-length
 * document): it drops <script>/<style> blocks, turns block-level tags into
 * newlines, removes all other tags, and decodes a small set of entities.
 */

const BLOCK_TAGS = new Set([
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
  'header',
  'footer',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode a single entity body (between `&` and `;`) or return null. */
function decodeEntityBody(body: string): string | null {
  if (body.length === 0 || body.length > 12) return null;
  if (body[0] === '#') {
    const isHex = body[1] === 'x' || body[1] === 'X';
    const digits = isHex ? body.slice(2) : body.slice(1);
    if (digits === '') return null;
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

/** Decode the handful of HTML entities we support; pass others through. */
function decodeEntities(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '&') {
      out += text[i];
      i += 1;
      continue;
    }
    const semi = text.indexOf(';', i + 1);
    // Cap the lookahead so a stray '&' cannot trigger a long scan.
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

/** Case-insensitive search for a closing tag like `</script>` from `from`. */
function findClosingTag(html: string, tag: string, from: number): number {
  const needle = `</${tag}`;
  const idx = html.toLowerCase().indexOf(needle, from);
  return idx;
}

/**
 * Convert an HTML string to plain text. Output collapses runs of blank lines and
 * trims surrounding whitespace.
 */
export function stripHtml(html: string): string {
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
    const slash = tagBody.startsWith('/');
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9]*/.exec(slash ? tagBody.slice(1) : tagBody);
    const tagName = (nameMatch?.[0] ?? '').toLowerCase();

    if (!slash && (tagName === 'script' || tagName === 'style')) {
      const closingIdx = findClosingTag(html, tagName, close + 1);
      if (closingIdx === -1) {
        i = n; // no closing tag → drop the rest
        break;
      }
      const endOfClose = html.indexOf('>', closingIdx);
      i = endOfClose === -1 ? n : endOfClose + 1;
      continue;
    }

    if (BLOCK_TAGS.has(tagName)) out += '\n';
    i = close + 1;
  }

  const decoded = decodeEntities(out);
  // Collapse 3+ newlines to 2; trim trailing spaces on each line; trim ends.
  return decoded
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
