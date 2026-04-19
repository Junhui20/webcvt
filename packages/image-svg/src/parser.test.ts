// @vitest-environment happy-dom
/**
 * Tests for parser.ts — detectSvg, parseSvg, serializeSvg.
 *
 * Strategy: DOMParser in happy-dom does not implement 'image/svg+xml' or
 * 'text/xml' MIME types correctly (returns an XHTML-namespaced document
 * instead of an SVG-namespaced one). We therefore mock DOMParser via
 * vi.stubGlobal() for tests that exercise the DOMParser path.
 *
 * Tests for security reject pass, size checks, detectSvg, and serializeSvg
 * do NOT require DOMParser and run without mocks.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SvgInputTooLargeError, SvgParseError, SvgUnsafeContentError } from './errors.ts';
import { detectSvg, parseSvg, serializeSvg } from './parser.ts';

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const FIXTURES_DIR = resolve(__dirname, '../../../tests/fixtures/image');

function readFixtureStr(name: string): string {
  return readFileSync(resolve(FIXTURES_DIR, name), 'utf-8');
}

function readFixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURES_DIR, name)));
}

// ---------------------------------------------------------------------------
// Mock DOMParser factory
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock DOMParser that returns a proper SVG document stub.
 * The stub mimics the minimal interface used by parseSvg().
 */
function makeMockDomParser(opts: {
  localName?: string;
  namespaceURI?: string;
  viewBox?: string | null;
  width?: string | null;
  height?: string | null;
  hasParsererror?: boolean;
  documentElementNull?: boolean;
}): unknown {
  const attrs: Record<string, string | null> = {
    viewBox: opts.viewBox ?? null,
    width: opts.width ?? null,
    height: opts.height ?? null,
  };

  const root =
    opts.documentElementNull === true
      ? null
      : {
          localName: opts.localName ?? 'svg',
          namespaceURI: opts.namespaceURI ?? 'http://www.w3.org/2000/svg',
          getAttribute: (name: string) => attrs[name] ?? null,
        };

  const doc = {
    documentElement: root,
    querySelector: (selector: string) => {
      if (selector === 'parsererror' && opts.hasParsererror === true) {
        return { textContent: 'mock parse error' };
      }
      return null;
    },
  };

  return {
    parseFromString: vi.fn().mockReturnValue(doc),
  };
}

// ---------------------------------------------------------------------------
// detectSvg — no DOMParser needed
// ---------------------------------------------------------------------------

describe('detectSvg', () => {
  it('detects svg by root element (minimal)', () => {
    const src = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>';
    expect(detectSvg(src)).toBe(true);
  });

  it('detects svg by root element with xml declaration prefix', () => {
    const src =
      '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(detectSvg(src)).toBe(true);
  });

  it('detects svg by root element with utf-8 BOM', () => {
    // BOM = U+FEFF as first character
    const src = '\uFEFF<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(detectSvg(src)).toBe(true);
  });

  it('detects svg from Uint8Array', () => {
    const bytes = readFixtureBytes('minimal.svg');
    expect(detectSvg(bytes)).toBe(true);
  });

  it('returns false for PNG bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectSvg(png)).toBe(false);
  });

  it('returns false for plain text', () => {
    expect(detectSvg('hello world')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(detectSvg('')).toBe(false);
  });

  it('detects svg with leading whitespace before root', () => {
    const src = '   \n  <svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(detectSvg(src)).toBe(true);
  });

  it('detects svg with xml declaration and leading comment', () => {
    const src =
      '<?xml version="1.0"?><!-- comment --><svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(detectSvg(src)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseSvg — with mocked DOMParser
// ---------------------------------------------------------------------------

describe('parseSvg — happy paths (mocked DOMParser)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses minimal SVG with width and height', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ width: '100', height: '100' })),
    );
    const src = readFixtureStr('minimal.svg');
    const file = parseSvg(src);
    expect(file.xmlns).toBe('http://www.w3.org/2000/svg');
    expect(file.width).toBe(100);
    expect(file.height).toBe(100);
  });

  it('parses SVG with viewBox (comma separators)', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ viewBox: '0,0,200,200' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,200,200"></svg>';
    const file = parseSvg(src);
    expect(file.viewBox).toEqual({ minX: 0, minY: 0, width: 200, height: 200 });
  });

  it('parses viewBox with whitespace separators', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ viewBox: '0 0 400 300' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"></svg>';
    const file = parseSvg(src);
    expect(file.viewBox).toEqual({ minX: 0, minY: 0, width: 400, height: 300 });
  });

  it('parses viewBox with mixed comma+whitespace separators', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ viewBox: '0, 0, 200, 200' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0, 0, 200, 200"></svg>';
    const file = parseSvg(src);
    expect(file.viewBox?.width).toBe(200);
  });

  it('parses with-viewbox fixture', () => {
    vi.stubGlobal(
      'DOMParser',
      vi
        .fn()
        .mockImplementation(() =>
          makeMockDomParser({ viewBox: '0 0 200 200', width: '200', height: '200' }),
        ),
    );
    const src = readFixtureStr('with-viewbox.svg');
    const file = parseSvg(src);
    expect(file.viewBox).toBeDefined();
    expect(file.viewBox?.width).toBe(200);
    expect(file.viewBox?.height).toBe(200);
  });

  it('parses width and height as bare numbers', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ width: '256', height: '128' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128"></svg>';
    const file = parseSvg(src);
    expect(file.width).toBe(256);
    expect(file.height).toBe(128);
  });

  it('parses width and height in px', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ width: '100px', height: '50px' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg" width="100px" height="50px"></svg>';
    const file = parseSvg(src);
    expect(file.width).toBe(100);
    expect(file.height).toBe(50);
  });

  it('parses decimal px dimensions', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ width: '100.5px', height: '50.5px' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg" width="100.5px" height="50.5px"></svg>';
    const file = parseSvg(src);
    expect(file.width).toBeCloseTo(100.5);
    expect(file.height).toBeCloseTo(50.5);
  });

  it('returns undefined width/height when attributes are absent', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ viewBox: '0 0 100 100' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
    const file = parseSvg(src);
    expect(file.width).toBeUndefined();
    expect(file.height).toBeUndefined();
  });

  it('returns undefined viewBox when viewBox attribute absent', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ width: '100', height: '100' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>';
    const file = parseSvg(src);
    expect(file.viewBox).toBeUndefined();
  });

  it('source is preserved byte-identically', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ width: '100', height: '100' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>';
    const file = parseSvg(src);
    expect(file.source).toBe(src);
  });

  it('parses SVG from Uint8Array', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ width: '100', height: '100' })),
    );
    const bytes = readFixtureBytes('minimal.svg');
    const file = parseSvg(bytes);
    expect(file.xmlns).toBe('http://www.w3.org/2000/svg');
  });
});

// ---------------------------------------------------------------------------
// parseSvg — dimension unit rejection (no DOMParser needed for these)
// ---------------------------------------------------------------------------

describe('parseSvg — dimension unit rejection', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'DOMParser',
      vi
        .fn()
        .mockImplementation((attr: string) => makeMockDomParser({ width: attr, height: attr })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects width with % unit (returns undefined)', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ width: '50%', height: '50%' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg" width="50%" height="50%"></svg>';
    const file = parseSvg(src);
    expect(file.width).toBeUndefined();
    expect(file.height).toBeUndefined();
  });

  it('rejects width with em unit', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ width: '10em', height: '10em' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg" width="10em" height="10em"></svg>';
    const file = parseSvg(src);
    expect(file.width).toBeUndefined();
  });

  it('rejects width with rem unit', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ width: '10rem', height: '10rem' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg" width="10rem" height="10rem"></svg>';
    const file = parseSvg(src);
    expect(file.width).toBeUndefined();
  });

  it('rejects width with vw unit', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ width: '100vw', height: '100vh' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg" width="100vw" height="100vh"></svg>';
    const file = parseSvg(src);
    expect(file.width).toBeUndefined();
    expect(file.height).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseSvg — error paths
// ---------------------------------------------------------------------------

describe('parseSvg — error paths', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws SvgInputTooLargeError for input exceeding 10 MiB', () => {
    const huge = 'x'.repeat(11 * 1024 * 1024);
    expect(() => {
      parseSvg(huge);
    }).toThrow(SvgInputTooLargeError);
  });

  it('throws SvgInputTooLargeError for Uint8Array exceeding 10 MiB', () => {
    const huge = new Uint8Array(11 * 1024 * 1024);
    expect(() => {
      parseSvg(huge);
    }).toThrow(SvgInputTooLargeError);
  });

  it('throws SvgUnsafeContentError for xxe-attack fixture (before DOMParser)', () => {
    // No DOMParser mock needed — validator rejects before DOMParser is called.
    const src = readFixtureStr('xxe-attack.svg');
    expect(() => {
      parseSvg(src);
    }).toThrow(SvgUnsafeContentError);
  });

  it('throws SvgParseError when DOMParser reports parsererror', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ hasParsererror: true })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(() => {
      parseSvg(src);
    }).toThrow(SvgParseError);
  });

  it('throws SvgParseError when root element is not <svg>', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ localName: 'html' })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(() => {
      parseSvg(src);
    }).toThrow(SvgParseError);
  });

  it('throws SvgParseError when namespace is wrong', () => {
    vi.stubGlobal(
      'DOMParser',
      vi
        .fn()
        .mockImplementation(() =>
          makeMockDomParser({ namespaceURI: 'http://wrong.namespace.com/' }),
        ),
    );
    const src = '<svg xmlns="http://wrong.namespace.com/"></svg>';
    expect(() => {
      parseSvg(src);
    }).toThrow(SvgParseError);
  });

  it('throws SvgParseError when documentElement is null after both parse attempts', () => {
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ documentElementNull: true })),
    );
    const src = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(() => {
      parseSvg(src);
    }).toThrow(SvgParseError);
  });

  it('throws SvgParseError for empty string (no <svg root signal)', () => {
    expect(() => {
      parseSvg('');
    }).toThrow(SvgParseError);
  });
});

// ---------------------------------------------------------------------------
// serializeSvg — round-trip (no DOMParser needed)
// ---------------------------------------------------------------------------

describe('serializeSvg', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips: parseSvg → serializeSvg returns byte-identical source', () => {
    const src = readFixtureStr('minimal.svg');
    vi.stubGlobal(
      'DOMParser',
      vi.fn().mockImplementation(() => makeMockDomParser({ width: '100', height: '100' })),
    );
    const file = parseSvg(src);
    expect(serializeSvg(file)).toBe(src);
  });

  it('round-trips with-viewbox fixture', () => {
    const src = readFixtureStr('with-viewbox.svg');
    vi.stubGlobal(
      'DOMParser',
      vi
        .fn()
        .mockImplementation(() =>
          makeMockDomParser({ viewBox: '0 0 200 200', width: '200', height: '200' }),
        ),
    );
    const file = parseSvg(src);
    expect(serializeSvg(file)).toBe(src);
  });
});
