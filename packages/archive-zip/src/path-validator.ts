/**
 * Path-traversal validator for archive entry names.
 *
 * Implements the rejection rules from design note §Trap #2 and §"Security caps":
 *   - Normalize `\\` → `/` (Windows-authored ZIPs may use backslash)
 *   - Reject names with `..` path segments
 *   - Reject absolute paths: leading `/`, `\\`, or Windows drive letter `C:`
 *   - Reject names containing NUL bytes (0x00)
 *
 * Applied to both ZIP and TAR entry names at parse time.
 * Throws ArchiveInvalidEntryNameError on any rejection.
 */

import { ArchiveInvalidEntryNameError } from './errors.ts';

// Matches a Windows drive-letter prefix like C: or c:
const DRIVE_LETTER_RE = /^[A-Za-z]:/;

/**
 * Validate an archive entry name.
 *
 * @param name Raw entry name (UTF-8 decoded string).
 * @returns Normalized name (backslashes converted to forward slashes).
 * @throws ArchiveInvalidEntryNameError if the name fails validation.
 */
export function validateEntryName(name: string): string {
  // Reject NUL bytes
  if (name.includes('\0')) {
    throw new ArchiveInvalidEntryNameError(name, 'name contains NUL byte');
  }

  // Normalize backslashes to forward slashes (Windows-authored ZIP compatibility)
  const normalized = name.replace(/\\/g, '/');

  // Reject absolute paths: leading '/'
  if (normalized.startsWith('/')) {
    throw new ArchiveInvalidEntryNameError(normalized, 'absolute path (leading /)');
  }

  // Reject Windows drive letters: C:
  if (DRIVE_LETTER_RE.test(normalized)) {
    throw new ArchiveInvalidEntryNameError(normalized, 'Windows drive-letter path');
  }

  // Reject '..' path segments (any occurrence in the path)
  const parts = normalized.split('/');
  for (const part of parts) {
    if (part === '..') {
      throw new ArchiveInvalidEntryNameError(normalized, 'path traversal via ".." segment');
    }
  }

  return normalized;
}
