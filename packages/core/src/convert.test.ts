import { describe, expect, it } from 'vitest';
import { convert } from './convert.ts';
import { BackendRegistry } from './registry.ts';
import {
  NoBackendError,
  UnsupportedFormatError,
  type Backend,
  type ConvertResult,
  type FormatDescriptor,
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
    await expect(
      convert(pngBlob(), { format: 'webp' }, { registry }),
    ).rejects.toBeInstanceOf(NoBackendError);
  });

  it('delegates to a matching backend', async () => {
    const registry = new BackendRegistry();
    registry.register(passthroughBackend('test-backend'));
    const result = await convert(pngBlob(), { format: 'webp' }, { registry });
    expect(result.backend).toBe('test-backend');
    expect(result.format.ext).toBe('webp');
  });
});
