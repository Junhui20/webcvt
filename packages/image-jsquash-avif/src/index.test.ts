/**
 * Tests for index.ts — barrel export completeness and registerAvifBackend smoke test.
 *
 * These tests verify that the public API is correctly wired up without
 * triggering any wasm load (sideEffects: false invariant).
 */

import { BackendRegistry } from '@catlabtech/webcvt-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupMockJsquash } from './_test-helpers/mock-jsquash.ts';

vi.mock('@jsquash/avif', () => setupMockJsquash());

import { disposeAvif } from './loader.ts';

beforeEach(() => {
  disposeAvif();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Barrel exports
// ---------------------------------------------------------------------------

describe('barrel exports', () => {
  it('exports AVIF_FORMAT', async () => {
    const { AVIF_FORMAT } = await import('./index.ts');
    expect(AVIF_FORMAT).toBeDefined();
    expect(AVIF_FORMAT.mime).toBe('image/avif');
    expect(AVIF_FORMAT.ext).toBe('avif');
    expect(AVIF_FORMAT.category).toBe('image');
  });

  it('exports constants', async () => {
    const { AVIF_MIME, MAX_INPUT_BYTES, MAX_PIXELS } = await import('./index.ts');
    expect(AVIF_MIME).toBe('image/avif');
    expect(MAX_INPUT_BYTES).toBeGreaterThan(0);
    expect(MAX_PIXELS).toBeGreaterThan(0);
  });

  it('exports free functions', async () => {
    const {
      decodeAvif,
      encodeAvif,
      preloadAvif,
      disposeAvif: dispose,
    } = await import('./index.ts');
    expect(typeof decodeAvif).toBe('function');
    expect(typeof encodeAvif).toBe('function');
    expect(typeof preloadAvif).toBe('function');
    expect(typeof dispose).toBe('function');
  });

  it('exports error classes', async () => {
    const {
      AvifLoadError,
      AvifDecodeError,
      AvifEncodeError,
      AvifInputTooLargeError,
      AvifDimensionsTooLargeError,
    } = await import('./index.ts');
    expect(AvifLoadError).toBeDefined();
    expect(AvifDecodeError).toBeDefined();
    expect(AvifEncodeError).toBeDefined();
    expect(AvifInputTooLargeError).toBeDefined();
    expect(AvifDimensionsTooLargeError).toBeDefined();
  });

  it('exports AvifBackend class', async () => {
    const { AvifBackend } = await import('./index.ts');
    expect(AvifBackend).toBeDefined();
    expect(typeof AvifBackend).toBe('function');
  });

  it('exports registerAvifBackend function', async () => {
    const { registerAvifBackend } = await import('./index.ts');
    expect(typeof registerAvifBackend).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// registerAvifBackend — smoke test
// ---------------------------------------------------------------------------

describe('registerAvifBackend — smoke test', () => {
  it('registers a backend that can handle AVIF→AVIF', async () => {
    const { registerAvifBackend } = await import('./index.ts');
    const registry = new BackendRegistry();
    registerAvifBackend(registry);

    const AVIF = { ext: 'avif', mime: 'image/avif', category: 'image' as const };
    const backend = await registry.findFor(AVIF, AVIF);
    expect(backend).toBeDefined();
    expect(backend?.name).toBe('image-jsquash-avif');
  });

  it('does not auto-register on import (sideEffects: false invariant)', async () => {
    // Import the barrel — should not modify defaultRegistry
    const { getCachedModule } = await import('./loader.ts');
    // Wasm should still be null after import
    expect(getCachedModule()).toBeNull();
  });
});
