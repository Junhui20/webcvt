/**
 * Tests for registerCanvasBackend — the uniform registration helper.
 */

import { BackendRegistry } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import { CanvasBackend, registerCanvasBackend } from './index.ts';

describe('registerCanvasBackend', () => {
  it('registers a CanvasBackend into a fresh registry and returns the instance', () => {
    const registry = new BackendRegistry();
    const backend = registerCanvasBackend(registry);
    expect(backend).toBeInstanceOf(CanvasBackend);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toBe(backend);
    expect(registry.list()[0]?.name).toBe('canvas');
  });

  it('throws when the same backend name is registered twice', () => {
    const registry = new BackendRegistry();
    registerCanvasBackend(registry);
    expect(() => registerCanvasBackend(registry)).toThrow();
  });
});
