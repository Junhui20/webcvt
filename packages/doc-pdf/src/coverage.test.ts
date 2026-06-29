/**
 * Edge-case tests that push branch coverage over the less-travelled paths:
 * malformed PNG chunk variants, the full set of PDF literal-string escapes,
 * odd-length hex strings, non-string Info values, and unterminated dict scans.
 */

import { describe, expect, it } from 'vitest';
import { latin1, makePng } from './_test-helpers/fixtures.ts';
import { DocPdfDecodeError } from './errors.ts';
import { parsePdfInfo } from './pdf-info.ts';
import { matchDictEnd } from './pdf-scan.ts';
import { pngToPdfImage } from './png-image.ts';

describe('png-image edge cases', () => {
  it('rejects a non-standard compression method', () => {
    const png = makePng(2, 2).slice();
    png[26] = 1; // IHDR compression byte
    expect(() => pngToPdfImage(png)).toThrow(DocPdfDecodeError);
  });

  it('rejects a non-standard filter method', () => {
    const png = makePng(2, 2).slice();
    png[27] = 1; // IHDR filter-method byte
    expect(() => pngToPdfImage(png)).toThrow(DocPdfDecodeError);
  });

  it('rejects a chunk whose declared length overruns the buffer', () => {
    const png = makePng(2, 2).slice();
    // The first post-IHDR chunk (IDAT) length lives at bytes 33..36.
    png[33] = 0x00;
    png[34] = 0x00;
    png[35] = 0xff;
    png[36] = 0xff;
    expect(() => pngToPdfImage(png)).toThrow(/Truncated PNG chunk/);
  });
});

describe('pdf string escapes and edge values', () => {
  it('decodes the full set of literal escapes', () => {
    const pdf = `%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page >> endobj
4 0 obj << /Title (T\\t\\r\\n\\b\\f\\zX) >> endobj
trailer << /Root 1 0 R /Info 4 0 R >>
%%EOF
`;
    const info = parsePdfInfo(latin1(pdf));
    // \t \r \n \b \f then \z → literal 'z', then 'X'
    expect(info.title).toBe('T\t\r\n\b\fzX');
  });

  it('decodes an odd-length hex string (trailing nibble padded)', () => {
    const pdf = `%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page >> endobj
4 0 obj << /Producer <4> >> endobj
trailer << /Root 1 0 R /Info 4 0 R >>
%%EOF
`;
    // <4> → high nibble 0x4, low nibble 0 → byte 0x40 = '@'
    expect(parsePdfInfo(latin1(pdf)).producer).toBe('@');
  });

  it('returns undefined when an Info value is an indirect reference, not a string', () => {
    const pdf = `%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page >> endobj
4 0 obj << /Title 5 0 R /Author (Real) >> endobj
trailer << /Root 1 0 R /Info 4 0 R >>
%%EOF
`;
    const info = parsePdfInfo(latin1(pdf));
    expect(info.title).toBeUndefined();
    expect(info.author).toBe('Real');
  });

  it('falls back when the resolved /Count is negative', () => {
    const pdf = `%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count -1 >> endobj
3 0 obj << /Type /Page >> endobj
%%EOF
`;
    // /Count -1 is rejected by the primary path; fallback B counts the leaf.
    expect(parsePdfInfo(latin1(pdf)).pageCount).toBe(1);
  });
});

describe('matchDictEnd unterminated values', () => {
  it('returns -1 for an unterminated literal string', () => {
    expect(matchDictEnd(latin1('<< /T (abc'), 0, 1024)).toBe(-1);
  });
  it('returns -1 for an unterminated hex string', () => {
    expect(matchDictEnd(latin1('<< /H <3e3e'), 0, 1024)).toBe(-1);
  });
});
