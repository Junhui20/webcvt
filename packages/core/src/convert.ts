import { detectFormatWithHint } from './detect.ts';
import { resolveFormat } from './formats.ts';
import { type BackendRegistry, defaultRegistry } from './registry.ts';
import {
  type ConvertOptions,
  type ConvertResult,
  type FormatDescriptor,
  NoBackendError,
  UnsupportedFormatError,
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

  // Resolve the input format. Order (first hit wins):
  //   1. options.inputFormat — explicit route. The ONLY way to convert text
  //      formats (JSON/CSV/YAML/…): they have no magic bytes, and byte-level
  //      auto-detection is a deliberate no (see detect.ts:334) because their
  //      byte patterns overlap and guessing would silently corrupt data.
  //   2. detectFormatWithHint — magic bytes, then a filename-extension fallback
  //      (options.filename, else a File input's .name).
  //   3. Fail with a hint pointing at the two explicit routes above.
  let inputFormat: FormatDescriptor | undefined;
  if (options.inputFormat !== undefined) {
    inputFormat = resolveFormat(options.inputFormat);
    if (!inputFormat) {
      const raw =
        typeof options.inputFormat === 'string' ? options.inputFormat : options.inputFormat.ext;
      throw new UnsupportedFormatError(raw, 'input');
    }
  } else {
    // Guard the `File` global — core must keep working in Node without DOM types.
    const filenameHint =
      options.filename ??
      (typeof File !== 'undefined' && input instanceof File ? input.name : undefined);
    inputFormat = await detectFormatWithHint(input, filenameHint);
  }
  if (!inputFormat) {
    throw new UnsupportedFormatError(
      '(unknown)',
      'input',
      'Pass options.inputFormat or options.filename for text formats that have no magic bytes.',
    );
  }

  const backend = await registry.findFor(inputFormat, outputFormat);
  if (!backend) {
    throw new NoBackendError(inputFormat.ext, outputFormat.ext);
  }

  // Backends dispatch on `Blob.type` (Backend.convert does not receive the
  // input descriptor), but browser Files for text formats (.yaml, .json, …)
  // frequently arrive with an empty or mismatched `type`. Hand the backend a
  // blob typed as the format routing just resolved — `Blob.slice` re-types
  // without copying the underlying bytes.
  const aligned =
    input.type === inputFormat.mime ? input : input.slice(0, input.size, inputFormat.mime);

  return backend.convert(aligned, outputFormat, options);
}
