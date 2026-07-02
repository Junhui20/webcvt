/**
 * Blob MIME alignment — backends dispatch on `Blob.type`, but browser Files for
 * text formats routinely arrive typeless or mistyped. `convert()` must hand the
 * backend a Blob re-typed to the resolved input MIME. Proven with a recording
 * wrapper that captures the `Blob.type` its delegate actually receives.
 */

import { convert } from '@catlabtech/webcvt-core';
import { BackendRegistry } from '@catlabtech/webcvt-core';
import { DataTextBackend } from '@catlabtech/webcvt-data-text';
import { describe, expect, it } from 'vitest';

import { RecordingBackend } from './_helpers.ts';

function wrappedRegistry(): { registry: BackendRegistry; recorder: RecordingBackend } {
  const recorder = new RecordingBackend(new DataTextBackend());
  const registry = new BackendRegistry();
  registry.register(recorder);
  return { registry, recorder };
}

describe('blob MIME alignment', () => {
  it('re-types a typeless Blob to the resolved input MIME before the backend runs', async () => {
    const { registry, recorder } = wrappedRegistry();
    const blob = new Blob([JSON.stringify({ name: 'webcvt' })]); // typeless
    expect(blob.type).toBe('');

    const out = await convert(blob, { format: 'yaml', inputFormat: 'json' }, { registry });

    // The delegate observed the resolved JSON MIME, not the empty original type.
    expect(recorder.seenInputTypes).toEqual(['application/json']);
    // ...and the real conversion still succeeded on the re-typed bytes.
    expect(out.format.mime).toBe('application/yaml');
    expect(await out.blob.text()).toContain('name');
  });

  it('aligns MIME even when the format was resolved from a File name (not inputFormat)', async () => {
    const { registry, recorder } = wrappedRegistry();
    const file = new File([JSON.stringify({ name: 'webcvt' })], 'data.json'); // typeless File
    expect(file.type).toBe('');

    await convert(file, { format: 'yaml' }, { registry });
    expect(recorder.seenInputTypes).toEqual(['application/json']);
  });

  it('leaves an already-correctly-typed Blob untouched but still delivers the right MIME', async () => {
    const { registry, recorder } = wrappedRegistry();
    const blob = new Blob([JSON.stringify({ name: 'webcvt' })], { type: 'application/json' });

    await convert(blob, { format: 'yaml', inputFormat: 'json' }, { registry });
    expect(recorder.seenInputTypes).toEqual(['application/json']);
  });
});
