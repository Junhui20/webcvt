import { detectFormatWithHint } from '@webcvt/core';
import type { FormatDescriptor } from '@webcvt/core';

/**
 * Detect the format of a File using magic-byte detection with filename hint fallback.
 * Reads only the first 8 KiB so large files are not buffered.
 */
export async function detectFileFormat(file: File): Promise<FormatDescriptor | undefined> {
  const head = file.slice(0, 8192);
  return detectFormatWithHint(head, file.name);
}
