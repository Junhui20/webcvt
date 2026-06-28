/**
 * Tests for pdf-writer.ts — structural validity of the assembled PDF.
 */

import { describe, expect, it } from 'vitest';
import { assemblePdf } from './pdf-writer.ts';

const text = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);

describe('assemblePdf', () => {
  it('emits a structurally valid PDF for a DCTDecode image (no smask)', () => {
    const pdf = assemblePdf({
      width: 16,
      height: 8,
      colorSpace: 'DeviceRGB',
      filter: 'DCTDecode',
      data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    const s = text(pdf);

    expect(s.startsWith('%PDF-1.7')).toBe(true);
    expect(s).toContain('/Type /Catalog');
    expect(s).toContain('/Type /Pages');
    expect(s).toContain('/MediaBox [0 0 16 8]');
    expect(s).toContain('/Subtype /Image /Width 16 /Height 8');
    expect(s).toContain('/ColorSpace /DeviceRGB');
    expect(s).toContain('/Filter /DCTDecode');
    expect(s).toContain('/Im0 Do');
    expect(s).toContain('/Root 1 0 R');
    expect(s).toContain('%%EOF');
    expect(s).not.toContain('/SMask');
    // 5 objects → /Size 6
    expect(s).toContain('/Size 6');
  });

  it('attaches a soft mask when smask bytes are provided', () => {
    const pdf = assemblePdf({
      width: 4,
      height: 4,
      colorSpace: 'DeviceRGB',
      filter: 'FlateDecode',
      data: new Uint8Array([0x78, 0x9c, 0x00]),
      smask: new Uint8Array([0x78, 0x9c, 0x01]),
    });
    const s = text(pdf);
    expect(s).toContain('/SMask 6 0 R');
    expect(s).toContain('/ColorSpace /DeviceGray');
    expect(s).toContain('/Size 7'); // 6 objects
  });

  it('writes a startxref offset that points at the xref keyword', () => {
    const pdf = assemblePdf({
      width: 2,
      height: 2,
      colorSpace: 'DeviceGray',
      filter: 'DCTDecode',
      data: new Uint8Array([1, 2, 3]),
    });
    const s = text(pdf);
    const m = s.match(/startxref\n(\d+)/);
    expect(m).not.toBeNull();
    const offset = Number(m?.[1]);
    expect(s.slice(offset, offset + 4)).toBe('xref');
  });

  it('declares an accurate /Length for the image stream', () => {
    const data = new Uint8Array([10, 20, 30, 40, 50]);
    const s = text(
      assemblePdf({ width: 1, height: 1, colorSpace: 'DeviceRGB', filter: 'DCTDecode', data }),
    );
    expect(s).toContain(`/Length ${data.length} >>\nstream`);
  });
});
