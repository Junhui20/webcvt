import { detectFormat } from './detect.ts';
import { resolveFormat } from './formats.ts';
import { defaultRegistry, type BackendRegistry } from './registry.ts';
import {
  NoBackendError,
  UnsupportedFormatError,
  type ConvertOptions,
  type ConvertResult,
} from './types.ts';

export interface ConvertContext {
  /** Registry to search for a backend. Defaults to the process-wide registry. */
  readonly registry?: BackendRegistry;
}

/**
 * Convert a file to a target format. This is the primary public entry point.
 *
 * @example
 *   const out = await convert(file, { format: 'webp' });
 *   const out = await convert(file, { format: 'mp4', codec: 'h264', quality: 0.8 });
 */
export async function convert(
  input: Blob,
  options: ConvertOptions,
  context: ConvertContext = {},
): Promise<ConvertResult> {
  const registry = context.registry ?? defaultRegistry;

  const outputFormat = resolveFormat(options.format);
  if (!outputFormat) {
    const raw = typeof options.format === 'string' ? options.format : options.format.ext;
    throw new UnsupportedFormatError(raw, 'output');
  }

  const inputFormat = await detectFormat(input);
  if (!inputFormat) {
    throw new UnsupportedFormatError('(unknown)', 'input');
  }

  const backend = await registry.findFor(inputFormat, outputFormat);
  if (!backend) {
    throw new NoBackendError(inputFormat.ext, outputFormat.ext);
  }

  return backend.convert(input, outputFormat, options);
}
