import { describe, expect, it } from 'vitest';
import { latin1 } from './_test-helpers/fixtures.ts';
import { DocPdfInputTooLargeError, DocPdfParseError } from './errors.ts';
import { parsePdfInfo } from './pdf-info.ts';

const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>
endobj
4 0 obj
<< /Title (Hello World) /Author (Jane Doe) /Subject (A subject) /Creator (Unit) /Producer (webcvt) >>
endobj
trailer
<< /Root 1 0 R /Info 4 0 R >>
startxref
0
%%EOF
`;

describe('parsePdfInfo — primary path', () => {
  it('reads version, page count, and all Info strings', () => {
    const info = parsePdfInfo(latin1(MINIMAL_PDF));
    expect(info.version).toBe('1.4');
    expect(info.pageCount).toBe(1);
    expect(info.title).toBe('Hello World');
    expect(info.author).toBe('Jane Doe');
    expect(info.subject).toBe('A subject');
    expect(info.creator).toBe('Unit');
    expect(info.producer).toBe('webcvt');
  });

  it('decodes UTF-16BE (BOM) hex strings and octal escapes', () => {
    const pdf = `%PDF-1.5
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page >> endobj
4 0 obj << /Title <FEFF00480049> /Author (A\\050B\\051 caf\\351) >> endobj
trailer << /Root 1 0 R /Info 4 0 R >>
%%EOF
`;
    const info = parsePdfInfo(latin1(pdf));
    expect(info.title).toBe('HI');
    expect(info.author).toBe('A(B) café');
  });

  it('handles literal-string line continuation and leaves missing fields undefined', () => {
    const pdf = `%PDF-1.6
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page >> endobj
4 0 obj << /Title (line1\\
line2) >> endobj
trailer << /Root 1 0 R /Info 4 0 R >>
%%EOF
`;
    const info = parsePdfInfo(latin1(pdf));
    expect(info.title).toBe('line1line2');
    expect(info.author).toBeUndefined();
    expect(info.producer).toBeUndefined();
  });
});

describe('parsePdfInfo — fallbacks', () => {
  it('falls back to the maximum /Count when the catalog is unresolvable', () => {
    const pdf = `%PDF-1.5
2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>
endobj
trailer << /Root 9 0 R >>
%%EOF
`;
    const info = parsePdfInfo(latin1(pdf));
    expect(info.version).toBe('1.5');
    expect(info.pageCount).toBe(3);
    expect(info.title).toBeUndefined();
  });

  it('falls back to counting /Type /Page leaves when there is no trailer', () => {
    const pdf = `%PDF-1.3
1 0 obj << /Type /Page >> endobj
2 0 obj << /Type /Page >> endobj
%%EOF
`;
    const info = parsePdfInfo(latin1(pdf));
    expect(info.version).toBe('1.3');
    expect(info.pageCount).toBe(2);
  });

  it('falls back when /Root has no R token', () => {
    const pdf = `%PDF-1.7
2 0 obj << /Type /Pages /Count 5 >> endobj
trailer << /Root 1 0 >>
%%EOF
`;
    expect(parsePdfInfo(latin1(pdf)).pageCount).toBe(5);
  });
});

describe('parsePdfInfo — error handling', () => {
  it('throws when there is no %PDF header', () => {
    expect(() => parsePdfInfo(latin1('not a pdf at all'))).toThrow(DocPdfParseError);
  });

  it('throws on a malformed version header', () => {
    expect(() => parsePdfInfo(latin1('%PDF-xyz\n%%EOF'))).toThrow(DocPdfParseError);
  });

  it('throws when the page count cannot be determined', () => {
    expect(() => parsePdfInfo(latin1('%PDF-1.7\njunk with no structure\n%%EOF'))).toThrow(
      DocPdfParseError,
    );
  });

  it('enforces the input-bytes cap', () => {
    expect(() => parsePdfInfo(latin1('%PDF-1.7 padded'), { maxInputBytes: 4 })).toThrow(
      DocPdfInputTooLargeError,
    );
  });
});
