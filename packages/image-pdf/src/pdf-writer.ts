/**
 * Clean-room PDF writer — assembles a single-page PDF (PDF 1.7) that draws one
 * image XObject filling the page. No third-party PDF library; objects, the
 * cross-reference table, and the trailer are emitted per ISO 32000-1.
 */

export interface PdfImage {
  readonly width: number;
  readonly height: number;
  readonly colorSpace: 'DeviceRGB' | 'DeviceGray';
  readonly filter: 'DCTDecode' | 'FlateDecode';
  /** The image XObject stream bytes (raw JPEG for DCTDecode, zlib for FlateDecode). */
  readonly data: Uint8Array;
  /** Optional 8-bit DeviceGray FlateDecode alpha stream, attached as a soft mask. */
  readonly smask?: Uint8Array;
}

/** Encode an ASCII/Latin-1 string to bytes (PDF structural syntax is ASCII). */
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * Assemble a one-page PDF wrapping `image`. The page's MediaBox equals the image
 * dimensions in points (1 px = 1 pt), and the image is scaled to fill it.
 */
export function assemblePdf(image: PdfImage): Uint8Array {
  const { width: w, height: h, colorSpace, filter, data, smask } = image;
  const hasSmask = smask !== undefined && smask.length > 0;
  const totalObjs = hasSmask ? 6 : 5;

  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets = new Array<number>(totalObjs + 1).fill(0);

  const push = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const str = (s: string): void => push(latin1(s));
  const begin = (n: number): void => {
    offsets[n] = length;
  };

  // Header (the binary comment marks the file as containing binary data).
  str('%PDF-1.7\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  begin(1);
  str('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  begin(2);
  str('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  begin(3);
  str(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );

  begin(4);
  const smaskRef = hasSmask ? ' /SMask 6 0 R' : '';
  str(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /${colorSpace} /BitsPerComponent 8 /Filter /${filter}${smaskRef} /Length ${data.length} >>\nstream\n`,
  );
  push(data);
  str('\nendstream\nendobj\n');

  begin(5);
  const content = latin1(`q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`);
  str(`5 0 obj\n<< /Length ${content.length} >>\nstream\n`);
  push(content);
  str('\nendstream\nendobj\n');

  if (hasSmask && smask) {
    begin(6);
    str(
      `6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${smask.length} >>\nstream\n`,
    );
    push(smask);
    str('\nendstream\nendobj\n');
  }

  // Cross-reference table.
  const xrefOffset = length;
  let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjs; i++) {
    xref += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  str(xref);

  // Trailer.
  str(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let off = 0;
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.length;
  }
  return out;
}
