import { describe, expect, it } from 'vitest';
import { MAX_INPUT_BYTES, MAX_MIME_DEPTH, MAX_MIME_PARTS } from './constants.ts';
import {
  EmailInputTooLargeError,
  EmailMimeTooDeepError,
  EmailMissingBoundaryError,
  EmailTooManyPartsError,
  EmailUnsupportedTransferEncodingError,
} from './errors.ts';
import { parseEmail, parseEml } from './parser.ts';
import { encodeBase64 } from './transfer-encoding.ts';

const CRLF = '\r\n';
const b64 = (s: string): string => encodeBase64(new TextEncoder().encode(s));

function msg(lines: string[]): string {
  return lines.join(CRLF);
}

// ---------------------------------------------------------------------------
// Simple message
// ---------------------------------------------------------------------------

describe('parseEml — simple message', () => {
  const SIMPLE = msg([
    'From: Alice <alice@example.com>',
    'To: Bob <bob@example.com>',
    'Subject: Hello there',
    'Date: Mon, 29 Jun 2026 10:00:00 +0000',
    'Message-ID: <abc@example.com>',
    '',
    'Hello Bob,',
    'This is a test.',
  ]);

  it('extracts well-known fields and the text body', () => {
    const m = parseEml(SIMPLE);
    expect(m.from).toEqual({ name: 'Alice', address: 'alice@example.com' });
    expect(m.to).toEqual([{ name: 'Bob', address: 'bob@example.com' }]);
    expect(m.subject).toBe('Hello there');
    expect(m.date).toContain('2026');
    expect(m.textBody).toContain('Hello Bob,');
    expect(m.textBody).toContain('This is a test.');
    expect(m.htmlBody).toBeUndefined();
    expect(m.attachments).toEqual([]);
  });

  it('exposes ordered, decoded headers (with original-case names)', () => {
    const m = parseEml(SIMPLE);
    expect(m.headers[0]).toEqual({ name: 'From', value: 'Alice <alice@example.com>' });
    expect(m.headers.map((h) => h.name)).toContain('Message-ID');
  });

  it('parseEmail is an alias of parseEml', () => {
    expect(parseEmail).toBe(parseEml);
  });

  it('accepts a Uint8Array input', () => {
    const m = parseEml(new TextEncoder().encode(SIMPLE));
    expect(m.subject).toBe('Hello there');
  });

  it('tolerates bare-LF line endings', () => {
    const m = parseEml(SIMPLE.replace(/\r\n/g, '\n'));
    expect(m.subject).toBe('Hello there');
    expect(m.textBody).toContain('Hello Bob,');
  });
});

// ---------------------------------------------------------------------------
// Folded headers, multiple recipients, encoded-word subject
// ---------------------------------------------------------------------------

describe('parseEml — headers', () => {
  it('unfolds folded header values', () => {
    const m = parseEml(msg(['Subject: This is a very', ' long subject line', '', 'body']));
    expect(m.subject).toBe('This is a very long subject line');
  });

  it('parses multiple recipients across To and Cc', () => {
    const m = parseEml(
      msg(['To: a@x.com,', ' "B, B" <b@x.com>', 'Cc: c@x.com, d@x.com', '', 'hi']),
    );
    expect(m.to).toEqual([{ address: 'a@x.com' }, { name: 'B, B', address: 'b@x.com' }]);
    expect(m.cc).toEqual([{ address: 'c@x.com' }, { address: 'd@x.com' }]);
  });

  it('decodes an RFC 2047 encoded-word subject', () => {
    const subject = `=?UTF-8?B?${b64('Réunion 📅')}?=`;
    const m = parseEml(msg([`Subject: ${subject}`, '', 'body']));
    expect(m.subject).toBe('Réunion 📅');
  });

  it('preserves duplicate same-name headers in the list', () => {
    const m = parseEml(msg(['Received: one', 'Received: two', '', 'body']));
    const received = m.headers.filter((h) => h.name === 'Received');
    expect(received).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// MIME bodies
// ---------------------------------------------------------------------------

describe('parseEml — MIME bodies', () => {
  it('parses multipart/alternative into text + html bodies', () => {
    const m = parseEml(
      msg([
        'Content-Type: multipart/alternative; boundary="BOUND"',
        '',
        'preamble is ignored',
        '--BOUND',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Plain text body',
        '--BOUND',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>HTML body</p>',
        '--BOUND--',
        'epilogue ignored',
      ]),
    );
    expect(m.textBody).toBe('Plain text body');
    expect(m.htmlBody).toBe('<p>HTML body</p>');
  });

  it('decodes a base64 body', () => {
    const m = parseEml(
      msg([
        'Content-Type: text/plain; charset="utf-8"',
        'Content-Transfer-Encoding: base64',
        '',
        b64('Base64 body content ✓'),
        '',
      ]),
    );
    expect(m.textBody).toBe('Base64 body content ✓');
  });

  it('decodes a quoted-printable body with a soft line break', () => {
    const m = parseEml(
      msg([
        'Content-Type: text/plain; charset="utf-8"',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'Caf=C3=A9 =',
        'break',
      ]),
    );
    expect(m.textBody).toBe('Café break');
  });

  it('collects an attachment with filename, content type and bytes', () => {
    const m = parseEml(
      msg([
        'Content-Type: multipart/mixed; boundary="MIX"',
        '',
        '--MIX',
        'Content-Type: text/plain',
        '',
        'See attachment.',
        '--MIX',
        'Content-Type: text/csv; name="data.csv"',
        'Content-Disposition: attachment; filename="data.csv"',
        'Content-Transfer-Encoding: base64',
        '',
        b64('col1,col2\n1,2\n'),
        '--MIX--',
        '',
      ]),
    );
    expect(m.textBody).toBe('See attachment.');
    expect(m.attachments).toHaveLength(1);
    const att = m.attachments[0];
    expect(att?.filename).toBe('data.csv');
    expect(att?.contentType).toBe('text/csv');
    expect(att?.size).toBeGreaterThan(0);
    expect(new TextDecoder().decode(att?.bytes)).toBe('col1,col2\n1,2\n');
  });

  it('parses a nested multipart (mixed > alternative + attachment)', () => {
    const m = parseEml(
      msg([
        'Content-Type: multipart/mixed; boundary="OUT"',
        '',
        '--OUT',
        'Content-Type: multipart/alternative; boundary="IN"',
        '',
        '--IN',
        'Content-Type: text/plain',
        '',
        'nested plain',
        '--IN',
        'Content-Type: text/html',
        '',
        '<b>nested html</b>',
        '--IN--',
        '--OUT',
        'Content-Type: application/octet-stream; name="f.bin"',
        'Content-Transfer-Encoding: base64',
        '',
        encodeBase64(new Uint8Array([1, 2, 3, 4])),
        '--OUT--',
        '',
      ]),
    );
    expect(m.textBody).toBe('nested plain');
    expect(m.htmlBody).toBe('<b>nested html</b>');
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]?.contentType).toBe('application/octet-stream');
    expect(Array.from(m.attachments[0]?.bytes ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('captures an inline part with a Content-ID as an attachment', () => {
    const m = parseEml(
      msg([
        'Content-Type: multipart/related; boundary="REL"',
        '',
        '--REL',
        'Content-Type: text/plain',
        '',
        'body',
        '--REL',
        'Content-Type: image/png',
        'Content-ID: <logo@cid>',
        'Content-Transfer-Encoding: base64',
        '',
        encodeBase64(new Uint8Array([137, 80, 78, 71])),
        '--REL--',
        '',
      ]),
    );
    expect(m.attachments[0]?.contentId).toBe('logo@cid');
  });
});

// ---------------------------------------------------------------------------
// Security caps + error paths
// ---------------------------------------------------------------------------

describe('parseEml — security caps', () => {
  it('rejects oversized input', () => {
    const tooBig = new Uint8Array(MAX_INPUT_BYTES + 1);
    expect(() => parseEml(tooBig)).toThrow(EmailInputTooLargeError);
  });

  it('rejects a multipart with no boundary parameter', () => {
    expect(() => parseEml(msg(['Content-Type: multipart/mixed', '', 'x']))).toThrow(
      EmailMissingBoundaryError,
    );
  });

  it('rejects an unsupported Content-Transfer-Encoding', () => {
    expect(() =>
      parseEml(msg(['Content-Type: text/plain', 'Content-Transfer-Encoding: x-uuencode', '', 'x'])),
    ).toThrow(EmailUnsupportedTransferEncodingError);
  });

  it('rejects MIME nesting deeper than the cap', () => {
    let inner = msg(['Content-Type: text/plain', '', 'deep']);
    for (let level = MAX_MIME_DEPTH + 1; level >= 1; level--) {
      const b = `b${level}`;
      inner = msg([
        `Content-Type: multipart/mixed; boundary="${b}"`,
        '',
        `--${b}`,
        inner,
        `--${b}--`,
        '',
      ]);
    }
    expect(() => parseEml(inner)).toThrow(EmailMimeTooDeepError);
  });

  it('allows nesting up to the cap', () => {
    let inner = msg(['Content-Type: text/plain', '', 'ok']);
    for (let level = 3; level >= 1; level--) {
      const b = `b${level}`;
      inner = msg([
        `Content-Type: multipart/mixed; boundary="${b}"`,
        '',
        `--${b}`,
        inner,
        `--${b}--`,
        '',
      ]);
    }
    expect(parseEml(inner).textBody).toBe('ok');
  });

  it('rejects a message with too many parts', () => {
    const parts: string[] = ['Content-Type: multipart/mixed; boundary="P"', ''];
    for (let i = 0; i <= MAX_MIME_PARTS; i++) {
      parts.push('--P', 'Content-Type: text/plain', '', `part ${i}`);
    }
    parts.push('--P--', '');
    expect(() => parseEml(msg(parts))).toThrow(EmailTooManyPartsError);
  });
});
