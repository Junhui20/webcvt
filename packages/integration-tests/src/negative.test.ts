/**
 * Negative paths — `convert()` must (a) raise NoBackendError when no registered
 * backend claims a resolvable format pair, and (b) let a backend's own typed
 * error propagate out unchanged when a conversion is routable but the concrete
 * value cannot be represented in the target format.
 */

import { NoBackendError, convert } from '@catlabtech/webcvt-core';
import { CrossFormatShapeError, CrossFormatValueError } from '@catlabtech/webcvt-data-text';
import { describe, expect, it } from 'vitest';

import { makeRegistry } from './_helpers.ts';

describe('negative paths', () => {
  it('raises NoBackendError for a resolvable-but-unhandled pair', async () => {
    const registry = makeRegistry();
    // png → gif both resolve as formats, but no registered backend handles images.
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);

    const err: unknown = await convert(
      blob,
      { format: 'gif', inputFormat: 'png' },
      { registry },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoBackendError);
    expect((err as NoBackendError).message).toContain('png');
    expect((err as NoBackendError).message).toContain('gif');
  });

  it('surfaces CrossFormatShapeError through convert() (json array → toml)', async () => {
    const registry = makeRegistry();
    // TOML documents must have an object root; a top-level array is a shape error.
    const blob = new Blob([JSON.stringify([1, 2, 3])], { type: 'application/json' });

    const err: unknown = await convert(
      blob,
      { format: 'toml', inputFormat: 'json' },
      { registry },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CrossFormatShapeError);
  });

  it('surfaces CrossFormatValueError through convert() (json null → toml)', async () => {
    const registry = makeRegistry();
    // TOML has no null type, so a null value is an unrepresentable-value error.
    const blob = new Blob([JSON.stringify({ a: null })], { type: 'application/json' });

    const err: unknown = await convert(
      blob,
      { format: 'toml', inputFormat: 'json' },
      { registry },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CrossFormatValueError);
  });

  it('surfaces CrossFormatShapeError for a nested value in a CSV cell (json → csv)', async () => {
    const registry = makeRegistry();
    // A 2-D table cannot hold a nested object in a cell.
    const blob = new Blob([JSON.stringify([{ a: { nested: 1 } }])], { type: 'application/json' });

    const err: unknown = await convert(
      blob,
      { format: 'csv', inputFormat: 'json' },
      { registry },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CrossFormatShapeError);
  });
});
