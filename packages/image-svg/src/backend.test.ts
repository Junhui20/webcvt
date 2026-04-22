// @vitest-environment happy-dom
/**
 * Tests for backend.ts — SvgBackend.
 *
 * Tests canHandle routing logic and convert() for the identity (SVG→SVG) path.
 * Rasterization paths (SVG→PNG/JPEG/WebP) are tested at the rasterizer level.
 *
 * convert() calls parseSvg() internally which uses DOMParser. Since happy-dom
 * does not support 'image/svg+xml' MIME correctly, we mock DOMParser for
 * the convert() tests.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JPEG_FORMAT, PNG_FORMAT, SVG_FORMAT, SvgBackend, WEBP_FORMAT } from './backend.ts';
import { SvgEncodeNotImplementedError } from './errors.ts';

// ---------------------------------------------------------------------------
// Mock DOMParser for convert() tests
// ---------------------------------------------------------------------------

function stubDomParser(width = '10', height = '10'): void {
  const attrs: Record<string, string | null> = { width, height, viewBox: null };
  const root = {
    localName: 'svg',
    namespaceURI: 'http://www.w3.org/2000/svg',
    getAttribute: (name: string) => attrs[name] ?? null,
  };
  const doc = {
    documentElement: root,
    querySelector: () => null,
  };
  vi.stubGlobal(
    'DOMParser',
    vi.fn().mockImplementation(() => ({ parseFromString: vi.fn().mockReturnValue(doc) })),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormat(mime: string, ext: string): FormatDescriptor {
  return { ext, mime, category: 'image', description: 'test' };
}

const SVG = makeFormat('image/svg+xml', 'svg');
const PNG = makeFormat('image/png', 'png');
const JPEG = makeFormat('image/jpeg', 'jpeg');
const WEBP = makeFormat('image/webp', 'webp');
const MP4 = makeFormat('video/mp4', 'mp4');
const ZIP = makeFormat('application/zip', 'zip');

// ---------------------------------------------------------------------------
// canHandle
// ---------------------------------------------------------------------------

describe('SvgBackend.canHandle', () => {
  const backend = new SvgBackend();

  it('returns true for SVG → SVG (identity)', async () => {
    expect(await backend.canHandle(SVG, SVG)).toBe(true);
  });

  it('returns true for SVG → PNG', async () => {
    expect(await backend.canHandle(SVG, PNG)).toBe(true);
  });

  it('returns true for SVG → JPEG', async () => {
    expect(await backend.canHandle(SVG, JPEG)).toBe(true);
  });

  it('returns true for SVG → WebP', async () => {
    expect(await backend.canHandle(SVG, WEBP)).toBe(true);
  });

  it('returns false for PNG → SVG (non-SVG input)', async () => {
    expect(await backend.canHandle(PNG, SVG)).toBe(false);
  });

  it('returns false for SVG → MP4 (unsupported output)', async () => {
    expect(await backend.canHandle(SVG, MP4)).toBe(false);
  });

  it('returns false for MP4 → PNG (non-SVG input)', async () => {
    expect(await backend.canHandle(MP4, PNG)).toBe(false);
  });

  it('returns false for ZIP → ZIP (archive, not SVG)', async () => {
    expect(await backend.canHandle(ZIP, ZIP)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Format descriptors
// ---------------------------------------------------------------------------

describe('Format descriptors', () => {
  it('SVG_FORMAT has correct mime and ext', () => {
    expect(SVG_FORMAT.mime).toBe('image/svg+xml');
    expect(SVG_FORMAT.ext).toBe('svg');
    expect(SVG_FORMAT.category).toBe('image');
  });

  it('PNG_FORMAT has correct mime', () => {
    expect(PNG_FORMAT.mime).toBe('image/png');
  });

  it('JPEG_FORMAT has correct mime', () => {
    expect(JPEG_FORMAT.mime).toBe('image/jpeg');
  });

  it('WEBP_FORMAT has correct mime', () => {
    expect(WEBP_FORMAT.mime).toBe('image/webp');
  });
});

// ---------------------------------------------------------------------------
// convert — identity path (SVG → SVG)
// ---------------------------------------------------------------------------

describe('SvgBackend.convert — SVG identity path', () => {
  const backend = new SvgBackend();

  const MINIMAL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('converts SVG → SVG (identity round-trip)', async () => {
    stubDomParser();
    const inputBlob = new Blob([MINIMAL_SVG], { type: 'image/svg+xml' });
    const result = await backend.convert(inputBlob, SVG_FORMAT, { format: SVG_FORMAT });
    const text = await result.blob.text();
    expect(text).toBe(MINIMAL_SVG);
    expect(result.format.mime).toBe('image/svg+xml');
    expect(result.backend).toBe('image-svg');
    expect(result.hardwareAccelerated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('throws SvgEncodeNotImplementedError for unsupported output mime', async () => {
    stubDomParser();
    const inputBlob = new Blob([MINIMAL_SVG], { type: 'image/svg+xml' });
    await expect(backend.convert(inputBlob, MP4, { format: MP4 })).rejects.toThrow(
      SvgEncodeNotImplementedError,
    );
  });

  it('calls onProgress callbacks', async () => {
    stubDomParser();
    const inputBlob = new Blob([MINIMAL_SVG], { type: 'image/svg+xml' });
    const phases: string[] = [];
    await backend.convert(inputBlob, SVG_FORMAT, {
      format: SVG_FORMAT,
      onProgress: (p) => {
        if (p.phase) phases.push(p.phase);
      },
    });
    expect(phases).toContain('demux');
    expect(phases).toContain('mux');
    expect(phases).toContain('done');
  });
});
