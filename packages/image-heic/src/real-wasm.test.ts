/**
 * Real-wasm smoke test — NO vi.mock. Proves the actual libheif-js wasm bundle
 * loads and runs in Node, even though we have no real .heic sample to decode.
 *
 * - preloadHeic() must resolve (wasm instantiates).
 * - decodeHeic(<invalid bytes>) must reject with HeicDecodeError (libheif either
 *   returns zero images or throws inside wasm; both map to HeicDecodeError).
 *
 * This is the closest we can get to end-to-end coverage without a sample file:
 * full-image decode of a genuine HEIC is verified manually / in-browser.
 */

import { describe, expect, it } from 'vitest';
import { decodeHeic } from './decode.ts';
import { HeicDecodeError } from './errors.ts';
import { disposeHeic, getCachedModule, preloadHeic } from './loader.ts';

describe('real libheif-js wasm bundle', () => {
  it('preloadHeic() instantiates the real wasm module', async () => {
    disposeHeic();
    await preloadHeic();
    const mod = getCachedModule();
    expect(mod).not.toBeNull();
    expect(typeof mod?.HeifDecoder).toBe('function');
  }, 30_000);

  it('decodeHeic() rejects invalid bytes with HeicDecodeError', async () => {
    const notAHeic = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
    const err = await decodeHeic(notAHeic).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HeicDecodeError);
  }, 30_000);
});
