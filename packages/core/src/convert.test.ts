import { describe, expect, it } from 'vitest';
import { convert } from './convert.ts';
import { BackendRegistry } from './registry.ts';
import {
  type Backend,
  type ConvertResult,
  type FormatDescriptor,
  NoBackendError,
  UnsupportedFormatError,
} from './types.ts';

function pngBlob(): Blob {
  const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Blob([header]);
}

function unknownBlob(): Blob {
  return new Blob([new Uint8Array([0, 0, 0, 0])]);
}

function passthroughBackend(name: string): Backend {
  return {
    name,
    async canHandle() {
      return true;
    },
    async convert(_input: Blob, output: FormatDescriptor): Promise<ConvertResult> {
      return {
        blob: new Blob(['converted'], { type: output.mime }),
        format: output,
        durationMs: 0,
        backend: name,
        hardwareAccelerated: false,
      };
    },
  };
}

/**
 * A backend that only accepts a specific input extension. Used to prove which
 * FormatDescriptor `convert()` resolved the input to — if resolution produced a
 * different ext, `canHandle` rejects and `convert()` throws NoBackendError.
 */
function inputFormatBackend(name: string, expectedInputExt: string): Backend {
  return {
    name,
    async canHandle(input: FormatDescriptor) {
      return input.ext === expectedInputExt;
    },
    async convert(_input: Blob, output: FormatDescriptor): Promise<ConvertResult> {
      return {
        blob: new Blob(['converted'], { type: output.mime }),
        format: output,
        durationMs: 0,
        backend: name,
        hardwareAccelerated: false,
      };
    },
  };
}

describe('convert', () => {
  it('throws UnsupportedFormatError for unknown output format', async () => {
    await expect(convert(pngBlob(), { format: 'zzz' })).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );
  });

  it('throws UnsupportedFormatError for unknown input magic bytes', async () => {
    await expect(convert(unknownBlob(), { format: 'webp' })).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );
  });

  it('throws NoBackendError when no backend matches', async () => {
    const registry = new BackendRegistry();
    await expect(convert(pngBlob(), { format: 'webp' }, { registry })).rejects.toBeInstanceOf(
      NoBackendError,
    );
  });

  it('delegates to a matching backend', async () => {
    const registry = new BackendRegistry();
    registry.register(passthroughBackend('test-backend'));
    const result = await convert(pngBlob(), { format: 'webp' }, { registry });
    expect(result.backend).toBe('test-backend');
    expect(result.format.ext).toBe('webp');
  });

  it('routes a text format via options.inputFormat (json → yaml)', async () => {
    // JSON has no magic bytes; an explicit inputFormat is the only route.
    const registry = new BackendRegistry();
    registry.register(inputFormatBackend('data-backend', 'json'));
    const result = await convert(
      new Blob(['{"a":1}']),
      { format: 'yaml', inputFormat: 'json' },
      { registry },
    );
    expect(result.backend).toBe('data-backend');
    expect(result.format.ext).toBe('yaml');
  });

  it('derives the input format from a File name with zero extra options', async () => {
    const registry = new BackendRegistry();
    registry.register(inputFormatBackend('data-backend', 'json'));
    const file = new File(['{"a":1}'], 'data.json', { type: 'application/json' });
    const result = await convert(file, { format: 'yaml' }, { registry });
    expect(result.backend).toBe('data-backend');
    expect(result.format.ext).toBe('yaml');
  });

  it('resolves a filename extension alias (.yml → yaml) as an input hint', async () => {
    // The input Blob has no magic bytes; the .yml filename fallback must resolve
    // through the yaml alias for the yaml-only backend to be selected.
    const registry = new BackendRegistry();
    registry.register(inputFormatBackend('yaml-backend', 'yaml'));
    const result = await convert(
      new Blob(['a: 1']),
      { format: 'json', filename: 'data.yml' },
      { registry },
    );
    expect(result.backend).toBe('yaml-backend');
    expect(result.format.ext).toBe('json');
  });

  it('lets options.inputFormat override contradictory magic bytes (explicit > sniffed)', async () => {
    // The blob's magic bytes are PNG. If detection ran, canHandle would see
    // 'png' and reject → NoBackendError. Success proves the explicit inputFormat
    // took precedence over the sniffed bytes.
    const registry = new BackendRegistry();
    registry.register(inputFormatBackend('json-only', 'json'));
    const result = await convert(pngBlob(), { format: 'yaml', inputFormat: 'json' }, { registry });
    expect(result.backend).toBe('json-only');
    expect(result.format.ext).toBe('yaml');
  });

  it('throws UnsupportedFormatError for an unresolvable inputFormat', async () => {
    await expect(
      convert(new Blob(['x']), { format: 'webp', inputFormat: 'zzz' }),
    ).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it('throws UnsupportedFormatError with a text-format hint when input is unresolvable', async () => {
    // No magic bytes, no filename/inputFormat: the error message must point the
    // caller at the two explicit routes.
    await expect(convert(unknownBlob(), { format: 'webp' })).rejects.toThrow(
      /Pass options\.inputFormat or options\.filename/,
    );
  });
});

describe('convert input blob MIME alignment', () => {
  /** Backend that records the `Blob.type` it received. */
  function typeRecordingBackend(name: string): { backend: Backend; receivedType: () => string } {
    let received = '';
    return {
      receivedType: () => received,
      backend: {
        name,
        async canHandle() {
          return true;
        },
        async convert(input: Blob, output: FormatDescriptor): Promise<ConvertResult> {
          received = input.type;
          return {
            blob: new Blob(['converted'], { type: output.mime }),
            format: output,
            durationMs: 0,
            backend: name,
            hardwareAccelerated: false,
          };
        },
      },
    };
  }

  it('re-types a typeless input blob to the resolved input format MIME', async () => {
    // Backends dispatch on Blob.type; a typeless blob routed via inputFormat
    // must reach the backend carrying the resolved MIME.
    const registry = new BackendRegistry();
    const { backend, receivedType } = typeRecordingBackend('recorder');
    registry.register(backend);
    await convert(new Blob(['a: 1']), { format: 'json', inputFormat: 'yaml' }, { registry });
    expect(receivedType()).toBe('application/yaml');
  });

  it('passes the blob through untouched when its MIME already matches', async () => {
    const registry = new BackendRegistry();
    const { backend, receivedType } = typeRecordingBackend('recorder');
    registry.register(backend);
    const blob = new Blob(['{"a":1}'], { type: 'application/json' });
    await convert(blob, { format: 'yaml', inputFormat: 'json' }, { registry });
    expect(receivedType()).toBe('application/json');
  });
});
