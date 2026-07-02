/**
 * Registry priority — when two backends both claim a conversion, the higher
 * `priority` wins regardless of registration order, and equal priorities keep
 * first-registered order (the historical, zero-config behaviour). Verified both
 * end-to-end through `convert()` and directly via `registry.findFor`.
 */

import { BackendRegistry, type FormatDescriptor, convert } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';

import { StubBackend, makeWavBlob } from './_helpers.ts';

const WAV: FormatDescriptor = { ext: 'wav', mime: 'audio/wav', category: 'audio' };

describe('registry priority', () => {
  it('higher priority wins regardless of registration order (via convert)', async () => {
    const wav = makeWavBlob();

    // low registered first, high second.
    const a = new BackendRegistry();
    a.register(new StubBackend('generic', 'audio/wav', 'audio/wav', 0));
    a.register(new StubBackend('specialized', 'audio/wav', 'audio/wav', 10));
    const outA = await convert(wav, { format: 'wav', inputFormat: 'wav' }, { registry: a });
    expect(outA.backend).toBe('specialized');

    // high registered first, low second — priority still decides.
    const b = new BackendRegistry();
    b.register(new StubBackend('specialized', 'audio/wav', 'audio/wav', 10));
    b.register(new StubBackend('generic', 'audio/wav', 'audio/wav', 0));
    const outB = await convert(wav, { format: 'wav', inputFormat: 'wav' }, { registry: b });
    expect(outB.backend).toBe('specialized');
  });

  it('a tie keeps registration order (stable-sort, historical behaviour)', async () => {
    const registry = new BackendRegistry();
    registry.register(new StubBackend('first', 'audio/wav', 'audio/wav', 0));
    registry.register(new StubBackend('second', 'audio/wav', 'audio/wav', 0));

    const chosen = await registry.findFor(WAV, WAV);
    expect(chosen?.name).toBe('first');
  });

  it('negative priority makes a backend a last-resort fallback', async () => {
    const registry = new BackendRegistry();
    // Registered first, but negative priority sinks it below the default-0 peer.
    registry.register(new StubBackend('fallback', 'audio/wav', 'audio/wav', -10));
    registry.register(new StubBackend('normal', 'audio/wav', 'audio/wav', 0));

    const chosen = await registry.findFor(WAV, WAV);
    expect(chosen?.name).toBe('normal');
  });

  it('unregistering the winner promotes the next candidate coherently', async () => {
    const registry = new BackendRegistry();
    registry.register(new StubBackend('winner', 'audio/wav', 'audio/wav', 10));
    registry.register(new StubBackend('runner-up', 'audio/wav', 'audio/wav', 0));

    expect((await registry.findFor(WAV, WAV))?.name).toBe('winner');
    expect(registry.unregister('winner')).toBe(true);
    expect((await registry.findFor(WAV, WAV))?.name).toBe('runner-up');
  });
});
