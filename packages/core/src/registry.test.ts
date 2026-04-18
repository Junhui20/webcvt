import { describe, expect, it } from 'vitest';
import { BackendRegistry } from './registry.ts';
import type { Backend, ConvertResult, FormatDescriptor } from './types.ts';

function makeBackend(
  name: string,
  accepts: (i: FormatDescriptor, o: FormatDescriptor) => boolean,
): Backend {
  return {
    name,
    async canHandle(i, o) {
      return accepts(i, o);
    },
    async convert(): Promise<ConvertResult> {
      throw new Error('not needed for registry tests');
    },
  };
}

const PNG: FormatDescriptor = { ext: 'png', mime: 'image/png', category: 'image' };
const JPG: FormatDescriptor = { ext: 'jpeg', mime: 'image/jpeg', category: 'image' };

describe('BackendRegistry', () => {
  it('starts empty', () => {
    const r = new BackendRegistry();
    expect(r.list()).toHaveLength(0);
  });

  it('registers and lists backends', () => {
    const r = new BackendRegistry();
    r.register(makeBackend('a', () => true));
    r.register(makeBackend('b', () => true));
    expect(r.list().map((b) => b.name)).toEqual(['a', 'b']);
  });

  it('rejects duplicate names', () => {
    const r = new BackendRegistry();
    r.register(makeBackend('a', () => true));
    expect(() => r.register(makeBackend('a', () => true))).toThrow(/already registered/);
  });

  it('unregisters by name', () => {
    const r = new BackendRegistry();
    r.register(makeBackend('a', () => true));
    expect(r.unregister('a')).toBe(true);
    expect(r.unregister('a')).toBe(false);
    expect(r.list()).toHaveLength(0);
  });

  it('findFor returns the first matching backend', async () => {
    const r = new BackendRegistry();
    r.register(makeBackend('first', () => false));
    r.register(makeBackend('second', () => true));
    r.register(makeBackend('third', () => true));
    const found = await r.findFor(PNG, JPG);
    expect(found?.name).toBe('second');
  });

  it('findFor returns undefined when no backend matches', async () => {
    const r = new BackendRegistry();
    r.register(makeBackend('noop', () => false));
    expect(await r.findFor(PNG, JPG)).toBeUndefined();
  });
});
