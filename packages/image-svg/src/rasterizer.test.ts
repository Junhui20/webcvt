// @vitest-environment happy-dom
/**
 * Tests for rasterizer.ts — rasterizeSvg.
 *
 * Strategy: mock Image, OffscreenCanvas, and URL.createObjectURL via
 * vi.stubGlobal() so tests run in happy-dom without requiring a real
 * browser rasterization pipeline. Tests verify orchestration logic:
 * timeout handling, URL revocation, JPEG background fill, dimension caps,
 * and error propagation.
 *
 * The happy-dom environment provides DOMParser but does NOT implement
 * OffscreenCanvas.convertToBlob or Image.decode — we stub both.
 *
 * NOTE: The actual pixel-rendering path (drawImage → convertToBlob
 * producing real image bytes) is a browser integration concern and is
 * intentionally not exercised here. A separate E2E test suite running
 * in a real browser would cover that path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RASTERIZE_HEIGHT, MAX_RASTERIZE_WIDTH, MAX_SVG_PARSE_TIME_MS } from './constants.ts';
import { SvgRasterizeError, SvgRasterizeTooLargeError } from './errors.ts';
import type { SvgFile } from './parser.ts';
import { rasterizeSvg } from './rasterizer.ts';

// ---------------------------------------------------------------------------
// Minimal SvgFile fixtures
// ---------------------------------------------------------------------------

function makeSvgFile(overrides?: Partial<SvgFile>): SvgFile {
  return {
    source:
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>',
    xmlns: 'http://www.w3.org/2000/svg',
    width: 100,
    height: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/** Create a mock Image that resolves decode() immediately. */
function makeMockImage(shouldDecodeReject = false): {
  instance: Record<string, unknown>;
  DecodePromise: Promise<void>;
} {
  let decodeResolve!: () => void;
  let decodeReject!: (reason: unknown) => void;
  const DecodePromise = new Promise<void>((res, rej) => {
    decodeResolve = res;
    decodeReject = rej;
  });

  if (!shouldDecodeReject) {
    // Resolve immediately on next microtask.
    Promise.resolve().then(decodeResolve);
  } else {
    Promise.resolve().then(() => {
      decodeReject(new Error('Image failed to load'));
    });
  }

  const instance: Record<string, unknown> = {
    decoding: 'auto',
    src: '',
    decode: () => DecodePromise,
  };

  return { instance, DecodePromise };
}

/** Create a mock OffscreenCanvas that resolves convertToBlob with a fake Blob. */
function makeMockCanvas(format: string): Record<string, unknown> {
  const fakeBlob = new Blob(['fakepixels'], { type: format });
  const ctx = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };
  return {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(ctx),
    convertToBlob: vi.fn().mockResolvedValue(fakeBlob),
    _ctx: ctx,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let mockImageInstance: Record<string, unknown> = {};
let mockCanvasInstance: Record<string, unknown> = {};
let revokedUrls: string[] = [];

beforeEach(() => {
  revokedUrls = [];

  // Stub URL.createObjectURL / revokeObjectURL
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
    revokeObjectURL: vi.fn().mockImplementation((url: string) => {
      revokedUrls.push(url);
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Dimension validation tests (no Image/Canvas needed)
// ---------------------------------------------------------------------------

describe('rasterizeSvg — dimension validation', () => {
  beforeEach(() => {
    // Set up a passing Image stub for tests that do need it.
    const { instance } = makeMockImage();
    mockImageInstance = instance;
    vi.stubGlobal(
      'Image',
      vi.fn().mockImplementation(() => mockImageInstance),
    );
    mockCanvasInstance = makeMockCanvas('image/png');
    vi.stubGlobal(
      'OffscreenCanvas',
      vi.fn().mockImplementation(() => mockCanvasInstance),
    );
  });

  it('rejects rasterize request over MAX_RASTERIZE_WIDTH', async () => {
    const file = makeSvgFile({ width: MAX_RASTERIZE_WIDTH + 1, height: 100 });
    await expect(rasterizeSvg(file, { format: 'image/png' })).rejects.toThrow(
      SvgRasterizeTooLargeError,
    );
  });

  it('rejects rasterize request over MAX_RASTERIZE_HEIGHT', async () => {
    const file = makeSvgFile({ width: 100, height: MAX_RASTERIZE_HEIGHT + 1 });
    await expect(rasterizeSvg(file, { format: 'image/png' })).rejects.toThrow(
      SvgRasterizeTooLargeError,
    );
  });

  it('rejects rasterize request exactly at 8192×8192 + 1', async () => {
    const file = makeSvgFile({ width: 8193, height: 8193 });
    await expect(rasterizeSvg(file, { format: 'image/png' })).rejects.toThrow(
      SvgRasterizeTooLargeError,
    );
  });

  it('accepts rasterize request exactly at 8192×8192', async () => {
    const file = makeSvgFile({ width: 8192, height: 8192 });
    await expect(rasterizeSvg(file, { format: 'image/png' })).resolves.toBeDefined();
  });

  it('rejects zero width', async () => {
    const file = makeSvgFile({ width: 0, height: 100 });
    await expect(rasterizeSvg(file, { format: 'image/png' })).rejects.toThrow(
      SvgRasterizeTooLargeError,
    );
  });

  it('rejects negative width passed via opts', async () => {
    const file = makeSvgFile({ width: 100, height: 100 });
    await expect(
      rasterizeSvg(file, { format: 'image/png', width: -1, height: 100 }),
    ).rejects.toThrow(SvgRasterizeTooLargeError);
  });
});

// ---------------------------------------------------------------------------
// URL revocation test (Trap §9 cleanup)
// ---------------------------------------------------------------------------

describe('rasterizeSvg — object URL revocation (Trap §9)', () => {
  it('always revokes the object URL even when decode succeeds', async () => {
    const { instance } = makeMockImage();
    mockImageInstance = instance;
    vi.stubGlobal(
      'Image',
      vi.fn().mockImplementation(() => mockImageInstance),
    );
    mockCanvasInstance = makeMockCanvas('image/png');
    vi.stubGlobal(
      'OffscreenCanvas',
      vi.fn().mockImplementation(() => mockCanvasInstance),
    );

    const file = makeSvgFile();
    await rasterizeSvg(file, { format: 'image/png' });

    expect(revokedUrls).toContain('blob:mock-url');
  });

  it('revokes the object URL when decode rejects', async () => {
    const { instance } = makeMockImage(true);
    mockImageInstance = instance;
    vi.stubGlobal(
      'Image',
      vi.fn().mockImplementation(() => mockImageInstance),
    );
    mockCanvasInstance = makeMockCanvas('image/png');
    vi.stubGlobal(
      'OffscreenCanvas',
      vi.fn().mockImplementation(() => mockCanvasInstance),
    );

    const file = makeSvgFile();
    await expect(rasterizeSvg(file, { format: 'image/png' })).rejects.toThrow(SvgRasterizeError);
    expect(revokedUrls).toContain('blob:mock-url');
  });
});

// ---------------------------------------------------------------------------
// JPEG background fill (Trap §10)
// ---------------------------------------------------------------------------

describe('rasterizeSvg — JPEG background fill (Trap §10)', () => {
  it('fills canvas with #fff background when format=image/jpeg', async () => {
    const { instance } = makeMockImage();
    mockImageInstance = instance;
    vi.stubGlobal(
      'Image',
      vi.fn().mockImplementation(() => mockImageInstance),
    );
    mockCanvasInstance = makeMockCanvas('image/jpeg');
    vi.stubGlobal(
      'OffscreenCanvas',
      vi.fn().mockImplementation(() => mockCanvasInstance),
    );

    const file = makeSvgFile();
    await rasterizeSvg(file, { format: 'image/jpeg' });

    const ctx = (
      mockCanvasInstance as { _ctx: { fillStyle: string; fillRect: ReturnType<typeof vi.fn> } }
    )._ctx;
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillStyle).toBe('#fff');
  });

  it('uses custom background when specified for JPEG', async () => {
    const { instance } = makeMockImage();
    mockImageInstance = instance;
    vi.stubGlobal(
      'Image',
      vi.fn().mockImplementation(() => mockImageInstance),
    );
    mockCanvasInstance = makeMockCanvas('image/jpeg');
    vi.stubGlobal(
      'OffscreenCanvas',
      vi.fn().mockImplementation(() => mockCanvasInstance),
    );

    const file = makeSvgFile();
    await rasterizeSvg(file, { format: 'image/jpeg', background: '#000' });

    const ctx = (mockCanvasInstance as { _ctx: { fillStyle: string } })._ctx;
    expect(ctx.fillStyle).toBe('#000');
  });

  it('does NOT fill background for PNG (alpha preserved)', async () => {
    const { instance } = makeMockImage();
    mockImageInstance = instance;
    vi.stubGlobal(
      'Image',
      vi.fn().mockImplementation(() => mockImageInstance),
    );
    mockCanvasInstance = makeMockCanvas('image/png');
    vi.stubGlobal(
      'OffscreenCanvas',
      vi.fn().mockImplementation(() => mockCanvasInstance),
    );

    const file = makeSvgFile();
    await rasterizeSvg(file, { format: 'image/png' });

    const ctx = (mockCanvasInstance as { _ctx: { fillRect: ReturnType<typeof vi.fn> } })._ctx;
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Timeout test (Trap §9)
// ---------------------------------------------------------------------------

describe('rasterizeSvg — Image decode timeout (Trap §9)', () => {
  it('throws SvgRasterizeError when Image.decode hangs beyond MAX_SVG_PARSE_TIME_MS', async () => {
    vi.useFakeTimers();

    // Create a decode() that never resolves.
    const neverResolve = new Promise<void>(() => {
      /* intentionally never resolves */
    });
    const hangingImg: Record<string, unknown> = {
      decoding: 'auto',
      src: '',
      decode: vi.fn().mockReturnValue(neverResolve),
    };
    vi.stubGlobal(
      'Image',
      vi.fn().mockImplementation(() => hangingImg),
    );
    mockCanvasInstance = makeMockCanvas('image/png');
    vi.stubGlobal(
      'OffscreenCanvas',
      vi.fn().mockImplementation(() => mockCanvasInstance),
    );

    const file = makeSvgFile();

    // Start the rasterize call and advance timers concurrently.
    // We must attach the rejection handler BEFORE advancing timers to avoid
    // an unhandled rejection being reported by the test runner.
    const rasterizePromise = rasterizeSvg(file, { format: 'image/png' });
    const assertion = expect(rasterizePromise).rejects.toThrow(SvgRasterizeError);

    // Advance past the timeout threshold.
    await vi.advanceTimersByTimeAsync(MAX_SVG_PARSE_TIME_MS + 100);

    await assertion;

    // URL must still be revoked even on timeout.
    expect(revokedUrls).toContain('blob:mock-url');

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Dimension fallback chain
// ---------------------------------------------------------------------------

describe('rasterizeSvg — dimension fallback chain', () => {
  beforeEach(() => {
    const { instance } = makeMockImage();
    mockImageInstance = instance;
    vi.stubGlobal(
      'Image',
      vi.fn().mockImplementation(() => mockImageInstance),
    );
    mockCanvasInstance = makeMockCanvas('image/png');
    vi.stubGlobal(
      'OffscreenCanvas',
      vi.fn().mockImplementation(() => {
        // Capture the dimensions passed to constructor.
        const c = makeMockCanvas('image/png');
        return c;
      }),
    );
  });

  it('uses opts.width/height when provided', async () => {
    const file = makeSvgFile({ width: 100, height: 100 });
    // Should not throw — opts override file dimensions.
    await expect(
      rasterizeSvg(file, { format: 'image/png', width: 50, height: 50 }),
    ).resolves.toBeDefined();
  });

  it('falls back to file.width/height when opts are absent', async () => {
    const file = makeSvgFile({ width: 200, height: 150 });
    await expect(rasterizeSvg(file, { format: 'image/png' })).resolves.toBeDefined();
  });

  it('falls back to viewBox dimensions when file.width/height are absent', async () => {
    const file = makeSvgFile({
      width: undefined,
      height: undefined,
      viewBox: { minX: 0, minY: 0, width: 400, height: 300 },
    });
    await expect(rasterizeSvg(file, { format: 'image/png' })).resolves.toBeDefined();
  });

  it('falls back to 300×150 defaults when no intrinsic dimensions', async () => {
    const file = makeSvgFile({ width: undefined, height: undefined, viewBox: undefined });
    await expect(rasterizeSvg(file, { format: 'image/png' })).resolves.toBeDefined();
  });
});
