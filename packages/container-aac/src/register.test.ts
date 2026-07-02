/**
 * Tests for registerAacBackend — the uniform registration helper.
 */

import { BackendRegistry } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import { AacBackend, registerAacBackend } from './index.ts';

describe('registerAacBackend', () => {
  it('registers an AacBackend into a fresh registry and returns the instance', () => {
    const registry = new BackendRegistry();
    const backend = registerAacBackend(registry);
    expect(backend).toBeInstanceOf(AacBackend);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toBe(backend);
    expect(registry.list()[0]?.name).toBe('container-aac');
  });

  it('throws when the same backend name is registered twice', () => {
    const registry = new BackendRegistry();
    registerAacBackend(registry);
    expect(() => registerAacBackend(registry)).toThrow();
  });
});
