/**
 * Smoke tests for the index.ts barrel — verifies public API surface.
 */
import { BackendRegistry } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  WASM_SUPPORTED_FORMATS,
  WASM_SUPPORTED_PAIRS,
  WasmBackend,
  WasmExecutionError,
  WasmLoadError,
  WasmUnsupportedError,
  isAllowlisted,
  registerWasmBackend,
} from './index.ts';

describe('barrel exports', () => {
  it('exports WasmBackend class', () => {
    expect(typeof WasmBackend).toBe('function');
  });

  it('exports WasmLoadError, WasmExecutionError, WasmUnsupportedError', () => {
    expect(typeof WasmLoadError).toBe('function');
    expect(typeof WasmExecutionError).toBe('function');
    expect(typeof WasmUnsupportedError).toBe('function');
  });

  it('exports isAllowlisted function', () => {
    expect(typeof isAllowlisted).toBe('function');
  });

  it('exports registerWasmBackend function', () => {
    expect(typeof registerWasmBackend).toBe('function');
  });

  it('exports WASM_SUPPORTED_PAIRS array with ≥180 entries', () => {
    expect(Array.isArray(WASM_SUPPORTED_PAIRS)).toBe(true);
    expect(WASM_SUPPORTED_PAIRS.length).toBeGreaterThanOrEqual(180);
  });

  it('exports WASM_SUPPORTED_FORMATS array with ≥10 entries', () => {
    expect(Array.isArray(WASM_SUPPORTED_FORMATS)).toBe(true);
    expect(WASM_SUPPORTED_FORMATS.length).toBeGreaterThanOrEqual(10);
  });
});

describe('registerWasmBackend', () => {
  it('registers without throwing when given a fresh registry', () => {
    const registry = new BackendRegistry();
    expect(() => registerWasmBackend(registry)).not.toThrow();
  });

  it('throws if called twice on same registry', () => {
    const registry = new BackendRegistry();
    registerWasmBackend(registry);
    expect(() => registerWasmBackend(registry)).toThrow();
  });

  it('enables subtitle pairs when enableSubtitleFallback is true', () => {
    const registry = new BackendRegistry();
    // Should not throw
    expect(() => registerWasmBackend(registry, { enableSubtitleFallback: true })).not.toThrow();
    // Subtitle pairs should now be allowlisted
    expect(isAllowlisted('text/x-subrip', 'text/vtt')).toBe(true);
  });
});
