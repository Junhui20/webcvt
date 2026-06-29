/**
 * Clean-room multi-page PDF writer (PDF 1.7 / ISO 32000-1).
 *
 * Each page draws one image XObject scaled to fill a MediaBox equal to the
 * image's pixel dimensions (1 px = 1 pt). Objects, the cross-reference table,
 * and the trailer are emitted from scratch — no third-party PDF library.
 *
 * image-pdf's `assemblePdf` writes a *single*-page document (its own header,
 * xref, and trailer), so it cannot be looped for a multi-page file. This module
 * replicates the same DCTDecode / FlateDecode technique for an arbitrary number
 * of pages, assigning object numbers dynamically.
 */

/**
 * A single image already reduced to the fields a PDF image XObject needs:
 * JPEG sources keep their bytes and use DCTDecode; PNG sources keep their IDAT
 * zlib stream and use FlateDecode with a PNG `/DecodeParms` predictor.
 */
export interface PreparedPageImage {
  readonly width: number;
  readonly height: number;
  readonly colorSpace: 'DeviceRGB' | 'DeviceGray';
  readonly bitsPerComponent: number;
  readonly filter: 'DCTDecode' | 'FlateDecode';
  /** The image XObject stream bytes (raw JPEG, or PNG's concatenated IDAT). */
  readonly data: Uint8Array;
  /** Inline `/DecodeParms` dictionary text for FlateDecode/PNG predictor. */
  readonly decodeParms?: string;
}

/** Encode an ASCII/Latin-1 string to bytes (PDF structural syntax is ASCII). */
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i) & 0xff;
  }
  return out;
}

/** Escape a JS string for use inside a PDF literal string `( … )`. */
function pdfLiteral(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch === '\\' || ch === '(' || ch === ')') out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else out += ch;
  }
  return out;
}

/**
 * Assemble a PDF with one page per entry in `images`.
 *
 * Object layout: 1 = Catalog, 2 = Pages, 3 = Info; then each page contributes
 * three consecutive objects — Page (4 + 3i), Image (5 + 3i), Content (6 + 3i).
 */
export function writeMultiPagePdf(
  images: readonly PreparedPageImage[],
  producer: string,
): Uint8Array {
  const n = images.length;
  const totalObjs = 3 + 3 * n;

  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets = new Array<number>(totalObjs + 1).fill(0);

  const push = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const str = (s: string): void => push(latin1(s));
  const begin = (objNum: number): void => {
    offsets[objNum] = length;
  };

  // Header — the binary comment marks the file as containing binary data.
  str('%PDF-1.7\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  begin(1);
  str('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kids: string[] = [];
  for (let i = 0; i < n; i++) kids.push(`${4 + 3 * i} 0 R`);
  begin(2);
  str(`2 0 obj\n<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>\nendobj\n`);

  begin(3);
  str(`3 0 obj\n<< /Producer (${pdfLiteral(producer)}) >>\nendobj\n`);

  let i = 0;
  for (const img of images) {
    const pageNum = 4 + 3 * i;
    const imageNum = 5 + 3 * i;
    const contentNum = 6 + 3 * i;

    begin(pageNum);
    str(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${img.width} ${img.height}]` +
        ` /Resources << /XObject << /Im0 ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`,
    );

    begin(imageNum);
    const dp = img.decodeParms ? ` /DecodeParms ${img.decodeParms}` : '';
    str(
      `${imageNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height}` +
        ` /ColorSpace /${img.colorSpace} /BitsPerComponent ${img.bitsPerComponent}` +
        ` /Filter /${img.filter}${dp} /Length ${img.data.length} >>\nstream\n`,
    );
    push(img.data);
    str('\nendstream\nendobj\n');

    begin(contentNum);
    const content = latin1(`q\n${img.width} 0 0 ${img.height} 0 0 cm\n/Im0 Do\nQ\n`);
    str(`${contentNum} 0 obj\n<< /Length ${content.length} >>\nstream\n`);
    push(content);
    str('\nendstream\nendobj\n');

    i++;
  }

  // Cross-reference table.
  const xrefOffset = length;
  let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let k = 1; k <= totalObjs; k++) {
    xref += `${String(offsets[k] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  str(xref);

  // Trailer.
  str(
    `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R /Info 3 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  const out = new Uint8Array(length);
  let off = 0;
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.length;
  }
  return out;
}
