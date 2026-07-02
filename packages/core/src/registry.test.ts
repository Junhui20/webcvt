import { describe, expect, it } from 'vitest';
import { BackendRegistry } from './registry.ts';
import type { Backend, ConvertResult, FormatDescriptor } from './types.ts';

function makeBackend(
  name: string,
  accepts: (i: FormatDescriptor, o: FormatDescriptor) => boolean,
  priority?: number,
): Backend {
  return {
    name,
    ...(priority === undefined ? {} : { priority }),
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

  it('findFor picks the highest priority backend regardless of registration order', async () => {
    const r = new BackendRegistry();
    // Register the low-priority generic backend FIRST — priority must override
    // registration order so the specialized codec still wins.
    r.register(makeBackend('generic', () => true, -10));
    r.register(makeBackend('specialized', () => true, 10));
    r.register(makeBackend('default', () => true));
    const found = await r.findFor(PNG, JPG);
    expect(found?.name).toBe('specialized');
  });

  it('findFor breaks ties by registration order (stable sort)', async () => {
    const r = new BackendRegistry();
    // All equal priority: the first registered must win, matching the historical
    // first-match-wins behavior for callers that never set a priority.
    r.register(makeBackend('first', () => true, 5));
    r.register(makeBackend('second', () => true, 5));
    const found = await r.findFor(PNG, JPG);
    expect(found?.name).toBe('first');
  });

  it('findFor is unchanged for default-priority backends (first match wins)', async () => {
    const r = new BackendRegistry();
    r.register(makeBackend('first', () => false));
    r.register(makeBackend('second', () => true));
    r.register(makeBackend('third', () => true));
    const found = await r.findFor(PNG, JPG);
    expect(found?.name).toBe('second');
  });

  it('findFor still ranks by priority after an unregister', async () => {
    const r = new BackendRegistry();
    r.register(makeBackend('generic', () => true, -10));
    r.register(makeBackend('specialized', () => true, 10));
    r.register(makeBackend('mid', () => true, 5));
    expect(r.unregister('specialized')).toBe(true);
    // With the top codec gone, the next-highest priority backend wins — not the
    // first-registered generic one.
    const found = await r.findFor(PNG, JPG);
    expect(found?.name).toBe('mid');
    // list() keeps registration order (minus the removed entry).
    expect(r.list().map((b) => b.name)).toEqual(['generic', 'mid']);
  });
});
