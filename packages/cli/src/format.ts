import { extname } from 'node:path';
import { type FormatDescriptor, findByExt, findByMime } from '@catlabtech/webcvt-core';

/**
 * Resolve a format hint string (extension like "mp3" OR MIME like "audio/mpeg")
 * to a FormatDescriptor. Returns undefined if unrecognised.
 */
export function resolveHint(hint: string): FormatDescriptor | undefined {
  if (hint.includes('/')) {
    return findByMime(hint);
  }
  return findByExt(hint);
}

/**
 * Infer a FormatDescriptor from a file path's extension.
 * Returns undefined for paths with no extension or unrecognised extensions.
 */
export function inferFormatFromPath(filePath: string): FormatDescriptor | undefined {
  const ext = extname(filePath);
  if (!ext) return undefined;
  // extname returns ".mp3"; strip leading dot
  return findByExt(ext.slice(1));
}
