/**
 * RFC 5322 §3.4 address-list parsing for webcvt-email.
 *
 * Parses an address-list header (From / To / Cc) into mailboxes. The scanner is
 * hand-written and linear: it splits on commas that are not inside a quoted
 * string, an angle-addr, or a (possibly nested) comment, then extracts the
 * display name and addr-spec from each token. Display names are RFC 2047
 * decoded. Group syntax is treated leniently (the group label is ignored).
 */

import { decodeEncodedWords } from './encoded-word.ts';
import type { EmailAddress } from './model.ts';

/** Split an address-list into top-level tokens, respecting quotes/comments/angles. */
function splitAddressTokens(raw: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  let inQuote = false;
  let commentDepth = 0;
  let angle = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inQuote) {
      buf += ch;
      if (ch === '\\' && i + 1 < raw.length) {
        buf += raw[i + 1];
        i += 1;
      } else if (ch === '"') {
        inQuote = false;
      }
      continue;
    }

    if (commentDepth > 0) {
      if (ch === '\\' && i + 1 < raw.length) {
        i += 1; // skip escaped char inside comment (comment content is dropped)
        continue;
      }
      if (ch === '(') commentDepth += 1;
      else if (ch === ')') commentDepth -= 1;
      continue; // comments are not part of the emitted token
    }

    if (ch === '"') {
      inQuote = true;
      buf += ch;
      continue;
    }
    if (ch === '(') {
      commentDepth += 1;
      continue;
    }
    if (ch === '<') angle = true;
    else if (ch === '>') angle = false;

    if ((ch === ',' || ch === ';') && !angle) {
      tokens.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }

  tokens.push(buf);
  return tokens;
}

/** Strip surrounding double-quotes (with `\x` unescaping) from a display name. */
function unquoteName(name: string): string {
  if (name.length < 2 || name[0] !== '"') return name;
  let out = '';
  for (let i = 1; i < name.length; i++) {
    const ch = name[i];
    if (ch === '\\' && i + 1 < name.length) {
      out += name[i + 1];
      i += 1;
      continue;
    }
    if (ch === '"') break;
    out += ch;
  }
  return out;
}

/** Parse a single address token into an EmailAddress, or null if empty. */
function parseSingleAddress(token: string): EmailAddress | null {
  const trimmed = token.trim();
  if (trimmed === '') return null;

  const lt = trimmed.lastIndexOf('<');
  const gt = lt === -1 ? -1 : trimmed.indexOf('>', lt);

  if (lt !== -1 && gt !== -1) {
    const address = trimmed.slice(lt + 1, gt).trim();
    if (address === '') return null;
    const name = decodeEncodedWords(unquoteName(trimmed.slice(0, lt).trim())).trim();
    return name === '' ? { address } : { name, address };
  }

  // No angle-addr: the whole token is an addr-spec (possibly a bare group label).
  if (trimmed.endsWith(':')) return null; // group label with no members on this token
  return { address: trimmed };
}

/**
 * Parse an address-list header value into a list of mailboxes.
 * Returns an empty array when no usable address is present.
 */
export function parseAddressList(raw: string): EmailAddress[] {
  const result: EmailAddress[] = [];
  for (const token of splitAddressTokens(raw)) {
    const address = parseSingleAddress(token);
    if (address) result.push(address);
  }
  return result;
}
