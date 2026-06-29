import { describe, expect, it } from 'vitest';
import { type PreparedPageImage, writeMultiPagePdf } from './pdf-writer.ts';

const text = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);

const jpegPage: PreparedPageImage = {
  width: 100,
  height: 50,
  colorSpace: 'DeviceRGB',
  bitsPerComponent: 8,
  filter: 'DCTDecode',
  data: new Uint8Array([1, 2, 3, 4]),
};

const pngPage: PreparedPageImage = {
  width: 20,
  height: 20,
  colorSpace: 'DeviceGray',
  bitsPerComponent: 8,
  filter: 'FlateDecode',
  data: new Uint8Array([5, 6, 7]),
  decodeParms: '<< /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns 20 >>',
};

describe('writeMultiPagePdf', () => {
  it('emits a valid header, xref, and trailer', () => {
    const s = text(writeMultiPagePdf([jpegPage], 'tester'));
    expect(s.startsWith('%PDF-1.7')).toBe(true);
    expect(s).toContain('xref');
    expect(s).toContain('trailer');
    expect(s).toContain('/Root 1 0 R');
    expect(s).toContain('/Info 3 0 R');
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('writes one page per image with /Count and Kids', () => {
    const s = text(writeMultiPagePdf([jpegPage, pngPage], 'p'));
    expect(s).toContain('/Type /Pages /Kids [4 0 R 7 0 R] /Count 2');
    expect(s).toContain('/MediaBox [0 0 100 50]');
    expect(s).toContain('/MediaBox [0 0 20 20]');
  });

  it('uses DCTDecode for JPEG and FlateDecode + DecodeParms for PNG', () => {
    const s = text(writeMultiPagePdf([jpegPage, pngPage], 'p'));
    expect(s).toContain('/Filter /DCTDecode');
    expect(s).toContain('/Filter /FlateDecode /DecodeParms << /Predictor 15');
  });

  it('escapes special characters in the producer string', () => {
    const s = text(writeMultiPagePdf([jpegPage], 'a(b)\\c'));
    expect(s).toContain('/Producer (a\\(b\\)\\\\c)');
  });
});
