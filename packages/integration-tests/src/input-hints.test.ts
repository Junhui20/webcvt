/**
 * Input-format hints, end to end through `convert()`. Text/data formats have no
 * magic bytes and byte-sniffing them is a deliberate no, so routing them depends
 * entirely on the caller's hints: `inputFormat`, a `File` name, or `filename`.
 * When none is given, `convert()` must fail with the actionable hint.
 */

import { UnsupportedFormatError, convert } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';

import { makeRegistry } from './_helpers.ts';

const SOURCE = { name: 'webcvt', version: 2 };

describe('input-format hints', () => {
  it('typeless Blob + inputFormat routes a text format', async () => {
    const registry = makeRegistry();
    const blob = new Blob([JSON.stringify(SOURCE)]); // no type
    expect(blob.type).toBe('');

    const out = await convert(blob, { format: 'yaml', inputFormat: 'json' }, { registry });
    expect(out.backend).toBe('data-text');
    expect(out.format.mime).toBe('application/yaml');
    expect(await out.blob.text()).toContain('name');
  });

  it('typeless File uses its extension name to route with zero explicit format hints', async () => {
    const registry = makeRegistry();
    const file = new File([JSON.stringify(SOURCE)], 'data.json'); // no type, name carries ext

    const out = await convert(file, { format: 'yaml' }, { registry });
    expect(out.backend).toBe('data-text');
    expect(out.format.mime).toBe('application/yaml');
  });

  it('filename option resolves through an extension alias (.yml → yaml)', async () => {
    const registry = makeRegistry();
    const yaml = 'name: webcvt\nversion: 2\n';
    const blob = new Blob([yaml]); // no type

    const out = await convert(blob, { format: 'json', filename: 'config.yml' }, { registry });
    expect(out.backend).toBe('data-text');
    expect(JSON.parse(await out.blob.text())).toEqual(SOURCE);
  });

  it('throws UnsupportedFormatError with a hint when no input hint is given for a text format', async () => {
    const registry = makeRegistry();
    const blob = new Blob([JSON.stringify(SOURCE)]); // typeless, plain Blob (not a File)

    const err: unknown = await convert(blob, { format: 'yaml' }, { registry }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnsupportedFormatError);
    expect((err as UnsupportedFormatError).message).toMatch(
      /options\.inputFormat or options\.filename/,
    );
  });

  it('inputFormat takes precedence over a File name that would resolve differently', async () => {
    const registry = makeRegistry();
    // Name says .yaml, but the bytes are JSON and inputFormat pins json — explicit wins.
    const file = new File([JSON.stringify(SOURCE)], 'misnamed.yaml');

    const out = await convert(file, { format: 'yaml', inputFormat: 'json' }, { registry });
    expect(out.backend).toBe('data-text');
    expect(await out.blob.text()).toContain('name');
  });
});
