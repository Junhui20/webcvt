import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { UnsupportedFormatError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import { buildSampleFont } from './_test-helpers/build-sfnt.ts';
import { FontBackend, OTF_FORMAT, TTF_FORMAT, WOFF_FORMAT } from './backend.ts';
import { MAX_INPUT_BYTES } from './constants.ts';
import { FontInputTooLargeError } from './errors.ts';
import { parseSfnt } from './sfnt.ts';
import { parseWoff, serializeWoff } from './woff.ts';

const PNG_FORMAT: FormatDescriptor = {
  ext: 'png',
  mime: 'image/png',
  category: 'image',
  description: 'PNG',
};

function blobOf(bytes: Uint8Array, type = ''): Blob {
  return new Blob([bytes.buffer as ArrayBuffer], { type });
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('FontBackend.canHandle', () => {
  const be = new FontBackend();

  it('accepts sfnt → woff and woff → sfnt in both directions', async () => {
    expect(await be.canHandle(TTF_FORMAT, WOFF_FORMAT)).toBe(true);
    expect(await be.canHandle(OTF_FORMAT, WOFF_FORMAT)).toBe(true);
    expect(await be.canHandle(WOFF_FORMAT, TTF_FORMAT)).toBe(true);
    expect(await be.canHandle(WOFF_FORMAT, OTF_FORMAT)).toBe(true);
  });

  it('rejects ttf→otf, woff→woff, and non-font pairs', async () => {
    expect(await be.canHandle(TTF_FORMAT, OTF_FORMAT)).toBe(false);
    expect(await be.canHandle(WOFF_FORMAT, WOFF_FORMAT)).toBe(false);
    expect(await be.canHandle(PNG_FORMAT, WOFF_FORMAT)).toBe(false);
    expect(await be.canHandle(TTF_FORMAT, PNG_FORMAT)).toBe(false);
  });
});

describe('FontBackend.convert', () => {
  const be = new FontBackend();

  it('converts a TrueType sfnt to a WOFF', async () => {
    const result = await be.convert(blobOf(buildSampleFont()), WOFF_FORMAT, {});
    expect(result.format).toEqual(WOFF_FORMAT);
    expect(result.backend).toBe('font');
    const back = await parseWoff(await blobBytes(result.blob));
    expect(back.tables.map((t) => t.tag).sort()).toEqual(['head', 'maxp', 'name']);
  });

  it('converts a WOFF back to a .ttf sfnt', async () => {
    const woff = await serializeWoff(parseSfnt(buildSampleFont({ flavor: 0x00010000 })));
    const result = await be.convert(blobOf(woff), TTF_FORMAT, {});
    expect(result.format).toEqual(TTF_FORMAT);
    expect(parseSfnt(await blobBytes(result.blob)).flavor).toBe(0x00010000);
  });

  it('emits .otf when the WOFF flavor is OTTO, regardless of the requested sfnt ext', async () => {
    const woff = await serializeWoff(parseSfnt(buildSampleFont({ flavor: 0x4f54544f })));
    const result = await be.convert(blobOf(woff), TTF_FORMAT, {}); // requests ttf…
    expect(result.format).toEqual(OTF_FORMAT); // …but OTTO flavor wins
  });

  it('reports progress ending at 100', async () => {
    const seen: number[] = [];
    await be.convert(blobOf(buildSampleFont()), WOFF_FORMAT, {
      onProgress: (p) => seen.push(p.percent),
    });
    expect(seen.at(-1)).toBe(100);
  });

  it('throws FontInputTooLargeError before reading an oversized input', async () => {
    let read = false;
    const huge = {
      size: MAX_INPUT_BYTES + 1,
      type: '',
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    } as unknown as Blob;
    await expect(be.convert(huge, WOFF_FORMAT, {})).rejects.toThrow(FontInputTooLargeError);
    expect(read).toBe(false);
  });

  it('throws UnsupportedFormatError for a non-font output target', async () => {
    await expect(be.convert(blobOf(buildSampleFont()), PNG_FORMAT, {})).rejects.toThrow(
      UnsupportedFormatError,
    );
  });
});
