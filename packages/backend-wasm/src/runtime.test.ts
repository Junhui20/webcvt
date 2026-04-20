import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canUseMultiThread, detectRuntime, detectRuntimeKind } from './runtime.ts';

// ---------------------------------------------------------------------------
// detectRuntimeKind
// ---------------------------------------------------------------------------

describe('detectRuntimeKind', () => {
  it('returns "node" in the vitest environment', () => {
    // vitest runs in Node, so process.versions.node is always defined
    expect(detectRuntimeKind()).toBe('node');
  });

  it('returns "browser" when process is absent and window is present', () => {
    const origProcess = globalThis.process;
    // @ts-expect-error - removing process for test
    globalThis.process = undefined;
    const origWindow = globalThis.window;
    // @ts-expect-error - setting window for test
    globalThis.window = {};
    (globalThis as Record<string, unknown>).document = {};

    try {
      expect(detectRuntimeKind()).toBe('browser');
    } finally {
      globalThis.process = origProcess;
      // @ts-expect-error - restoring window
      globalThis.window = origWindow;
      (globalThis as Record<string, unknown>).document = undefined;
    }
  });

  it('returns "unknown" when no env signals are present', () => {
    const origProcess = globalThis.process;
    // @ts-expect-error - removing process for test
    globalThis.process = undefined;
    const origWindow = globalThis.window;
    // @ts-expect-error - removing window for test
    globalThis.window = undefined;

    try {
      expect(detectRuntimeKind()).toBe('unknown');
    } finally {
      globalThis.process = origProcess;
      // @ts-expect-error - restoring window
      globalThis.window = origWindow;
    }
  });
});

// ---------------------------------------------------------------------------
// canUseMultiThread
// ---------------------------------------------------------------------------

describe('canUseMultiThread', () => {
  it('returns true in Node environment with SharedArrayBuffer available', () => {
    // Node has SAB available and we treat it as multi-thread capable
    expect(canUseMultiThread()).toBe(true);
  });

  it('returns false in browser context without crossOriginIsolated', () => {
    const origProcess = globalThis.process;
    // @ts-expect-error - removing process for test
    globalThis.process = undefined;
    const origWindow = globalThis.window;
    // @ts-expect-error - setting window for test
    globalThis.window = {};
    (globalThis as Record<string, unknown>).document = {};
    (globalThis as Record<string, unknown>).crossOriginIsolated = false;

    try {
      expect(canUseMultiThread()).toBe(false);
    } finally {
      globalThis.process = origProcess;
      // @ts-expect-error - restoring window
      globalThis.window = origWindow;
      (globalThis as Record<string, unknown>).document = undefined;
      (globalThis as Record<string, unknown>).crossOriginIsolated = undefined;
    }
  });

  it('returns true in browser context with crossOriginIsolated=true', () => {
    const origProcess = globalThis.process;
    // @ts-expect-error - removing process for test
    globalThis.process = undefined;
    const origWindow = globalThis.window;
    // @ts-expect-error - setting window for test
    globalThis.window = {};
    (globalThis as Record<string, unknown>).document = {};
    (globalThis as Record<string, unknown>).crossOriginIsolated = true;

    try {
      expect(canUseMultiThread()).toBe(true);
    } finally {
      globalThis.process = origProcess;
      // @ts-expect-error - restoring window
      globalThis.window = origWindow;
      (globalThis as Record<string, unknown>).document = undefined;
      (globalThis as Record<string, unknown>).crossOriginIsolated = undefined;
    }
  });
});

// ---------------------------------------------------------------------------
// detectRuntime
// ---------------------------------------------------------------------------

describe('detectRuntime', () => {
  it('returns a RuntimeInfo with kind and multiThread', () => {
    const info = detectRuntime();
    expect(info).toHaveProperty('kind');
    expect(info).toHaveProperty('multiThread');
    expect(typeof info.multiThread).toBe('boolean');
  });

  it('is consistent with individual detectors', () => {
    const info = detectRuntime();
    expect(info.kind).toBe(detectRuntimeKind());
    expect(info.multiThread).toBe(canUseMultiThread());
  });
});
