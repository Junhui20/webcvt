import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  ImageLegacyBackend,
  PBM_FORMAT,
  PFM_FORMAT,
  PGM_FORMAT,
  PPM_FORMAT,
  QOI_FORMAT,
} from './backend.ts';
import { ImageInputTooLargeError, ImageUnsupportedFormatError } from './errors.ts';

const FAKE_FORMAT: FormatDescriptor = {
  ext: 'bmp',
  mime: 'image/bmp',
  category: 'image',
};

describe('ImageLegacyBackend', () => {
  const backend = new ImageLegacyBackend();

  it('has correct name', () => {
    expect(backend.name).toBe('image-legacy');
  });

  it('canHandle returns true for PBM identity', async () => {
    expect(await backend.canHandle(PBM_FORMAT, PBM_FORMAT)).toBe(true);
  });

  it('canHandle returns true for PGM identity', async () => {
    expect(await backend.canHandle(PGM_FORMAT, PGM_FORMAT)).toBe(true);
  });

  it('canHandle returns true for PPM identity', async () => {
    expect(await backend.canHandle(PPM_FORMAT, PPM_FORMAT)).toBe(true);
  });

  it('canHandle returns true for PFM identity', async () => {
    expect(await backend.canHandle(PFM_FORMAT, PFM_FORMAT)).toBe(true);
  });

  it('canHandle returns true for QOI identity', async () => {
    expect(await backend.canHandle(QOI_FORMAT, QOI_FORMAT)).toBe(true);
  });

  it('canHandle returns false for cross-format (PBM → PGM)', async () => {
    expect(await backend.canHandle(PBM_FORMAT, PGM_FORMAT)).toBe(false);
  });

  it('canHandle returns false for unsupported format', async () => {
    expect(await backend.canHandle(FAKE_FORMAT, FAKE_FORMAT)).toBe(false);
  });

  it('format descriptors have correct MIMEs', () => {
    expect(PBM_FORMAT.mime).toBe('image/x-portable-bitmap');
    expect(PGM_FORMAT.mime).toBe('image/x-portable-graymap');
    expect(PPM_FORMAT.mime).toBe('image/x-portable-pixmap');
    expect(PFM_FORMAT.mime).toBe('image/x-portable-floatmap');
    expect(QOI_FORMAT.mime).toBe('image/qoi');
  });

  it('format descriptors have correct categories', () => {
    expect(PBM_FORMAT.category).toBe('image');
    expect(QOI_FORMAT.category).toBe('image');
  });

  it('convert throws ImageInputTooLargeError when blob is too large', async () => {
    // Create a Blob that reports a size > MAX_INPUT_BYTES
    const fakeLargeBlob = new Blob([new Uint8Array(1)], { type: PBM_FORMAT.mime });
    Object.defineProperty(fakeLargeBlob, 'size', { get: () => 201 * 1024 * 1024 });
    await expect(
      backend.convert(fakeLargeBlob, PBM_FORMAT, { format: PBM_FORMAT }),
    ).rejects.toThrow(ImageInputTooLargeError);
  });

  it('convert throws ImageUnsupportedFormatError for unsupported MIME', async () => {
    const badBlob = new Blob([new Uint8Array(1)], { type: 'image/bmp' });
    await expect(backend.convert(badBlob, FAKE_FORMAT, { format: FAKE_FORMAT })).rejects.toThrow(
      ImageUnsupportedFormatError,
    );
  });

  it('convert performs identity parse→serialize round-trip for PBM', async () => {
    // Build a simple 1×1 P4 PBM file
    const encoder = new TextEncoder();
    const header = encoder.encode('P4\n1 1\n');
    const body = new Uint8Array([0x80]); // 1 pixel = 1 (MSB)
    const data = new Uint8Array(header.length + body.length);
    data.set(header, 0);
    data.set(body, header.length);
    const input = new Blob([data], { type: PBM_FORMAT.mime });
    const result = await backend.convert(input, PBM_FORMAT, {
      format: PBM_FORMAT,
    });
    expect(result.backend).toBe('image-legacy');
    expect(result.hardwareAccelerated).toBe(false);
    expect(result.format.mime).toBe(PBM_FORMAT.mime);
  });

  it('convert calls onProgress callbacks', async () => {
    const encoder = new TextEncoder();
    const header = encoder.encode('P4\n1 1\n');
    const body = new Uint8Array([0x80]);
    const data = new Uint8Array(header.length + body.length);
    data.set(header, 0);
    data.set(body, header.length);
    const input = new Blob([data], { type: PBM_FORMAT.mime });
    const progressEvents: number[] = [];
    await backend.convert(input, PBM_FORMAT, {
      format: PBM_FORMAT,
      onProgress: (e) => progressEvents.push(e.percent),
    });
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[progressEvents.length - 1]).toBe(100);
  });
});
