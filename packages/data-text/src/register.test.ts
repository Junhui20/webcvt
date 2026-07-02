/**
 * Tests for registerDataTextBackend — the uniform registration helper.
 */

import { BackendRegistry } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import { DataTextBackend, registerDataTextBackend } from './index.ts';

describe('registerDataTextBackend', () => {
  it('registers a DataTextBackend into a fresh registry and returns the instance', () => {
    const registry = new BackendRegistry();
    const backend = registerDataTextBackend(registry);
    expect(backend).toBeInstanceOf(DataTextBackend);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toBe(backend);
    expect(registry.list()[0]?.name).toBe('data-text');
  });

  it('throws when the same backend name is registered twice', () => {
    const registry = new BackendRegistry();
    registerDataTextBackend(registry);
    expect(() => registerDataTextBackend(registry)).toThrow();
  });
});
