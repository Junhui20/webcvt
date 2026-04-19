/**
 * Tests for path-traversal validation.
 *
 * Covers design-note Trap #2 requirements:
 *   - Reject '..' segments
 *   - Reject absolute paths (leading '/', '\\', Windows drive letter)
 *   - Reject NUL bytes
 *   - Normalize '\\' to '/'
 */

import { describe, expect, it } from 'vitest';
import { ArchiveInvalidEntryNameError } from './errors.ts';
import { validateEntryName } from './path-validator.ts';

describe('validateEntryName', () => {
  describe('valid names', () => {
    it('accepts a simple filename', () => {
      expect(validateEntryName('hello.txt')).toBe('hello.txt');
    });

    it('accepts a nested path', () => {
      expect(validateEntryName('dir/subdir/file.txt')).toBe('dir/subdir/file.txt');
    });

    it('accepts a directory entry', () => {
      expect(validateEntryName('mydir/')).toBe('mydir/');
    });

    it('normalizes backslashes to forward slashes', () => {
      expect(validateEntryName('dir\\subdir\\file.txt')).toBe('dir/subdir/file.txt');
    });

    it('accepts a name with a dot that is NOT a ".." segment', () => {
      expect(validateEntryName('file.min.js')).toBe('file.min.js');
    });

    it('accepts a name starting with a dot', () => {
      expect(validateEntryName('.gitignore')).toBe('.gitignore');
    });
  });

  describe('path traversal rejection', () => {
    it('rejects ".." as the entire name', () => {
      expect(() => validateEntryName('..')).toThrow(ArchiveInvalidEntryNameError);
    });

    it('rejects name with ".." segment at start', () => {
      expect(() => validateEntryName('../etc/passwd')).toThrow(ArchiveInvalidEntryNameError);
    });

    it('rejects name with ".." segment in middle', () => {
      expect(() => validateEntryName('dir/../etc/passwd')).toThrow(ArchiveInvalidEntryNameError);
    });

    it('rejects name with ".." segment at end', () => {
      expect(() => validateEntryName('dir/..')).toThrow(ArchiveInvalidEntryNameError);
    });

    it('rejects Windows backslash path traversal', () => {
      expect(() => validateEntryName('dir\\..\\etc\\passwd')).toThrow(ArchiveInvalidEntryNameError);
    });
  });

  describe('absolute path rejection', () => {
    it('rejects leading forward slash', () => {
      expect(() => validateEntryName('/etc/passwd')).toThrow(ArchiveInvalidEntryNameError);
    });

    it('rejects Windows drive letter C:', () => {
      expect(() => validateEntryName('C:/Windows/System32')).toThrow(ArchiveInvalidEntryNameError);
    });

    it('rejects lowercase drive letter', () => {
      expect(() => validateEntryName('c:/Windows')).toThrow(ArchiveInvalidEntryNameError);
    });
  });

  describe('NUL byte rejection', () => {
    it('rejects name with NUL byte', () => {
      expect(() => validateEntryName('file\0name')).toThrow(ArchiveInvalidEntryNameError);
    });

    it('rejects name that is only a NUL byte', () => {
      expect(() => validateEntryName('\0')).toThrow(ArchiveInvalidEntryNameError);
    });
  });

  describe('error type', () => {
    it('throws ArchiveInvalidEntryNameError with the problematic name', () => {
      let err: unknown;
      try {
        validateEntryName('../evil');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ArchiveInvalidEntryNameError);
      const archiveErr = err as ArchiveInvalidEntryNameError;
      expect(archiveErr.code).toBe('ARCHIVE_INVALID_ENTRY_NAME');
      expect(archiveErr.message).toContain('../evil');
    });
  });
});
