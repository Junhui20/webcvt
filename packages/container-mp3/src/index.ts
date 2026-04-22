/**
 * @catlabtech/webcvt-container-mp3
 *
 * MPEG-1/2 Layer III (MP3) container parser and serializer for webcvt.
 *
 * Implementation references:
 * This package is implemented from ISO/IEC 11172-3 (MPEG-1 Audio) and the
 * ID3v2.4 structure and frames documents published by id3.org. The Xing
 * VBR header and LAME extension are covered by unofficial but
 * well-documented community references. No code was copied from other
 * implementations. Test fixtures derived from FFmpeg samples (LGPL-2.1)
 * live under `tests/fixtures/audio/` and are not redistributed in npm.
 */

// Types
export type { Mp3FrameHeader, Mp3Frame } from './frame-header.ts';
export type { Id3v2Tag, Id3v2Frame } from './id3v2.ts';
export type { Id3v1Tag } from './id3v1.ts';
export type { XingHeader, LameExtension } from './xing.ts';
export type { Mp3File } from './parser.ts';

// Errors
export {
  Mp3FreeFormatError,
  Mp3Mpeg25EncodeNotSupportedError,
  Mp3InvalidFrameError,
  Mp3UnsynchronisationError,
  Mp3EncodeNotImplementedError,
} from './errors.ts';

// Core parsing / serialization
export { parseMp3 } from './parser.ts';
export { serializeMp3 } from './serializer.ts';

// Low-level primitives (useful for consumers)
export { parseMp3FrameHeader, sideInfoSize } from './frame-header.ts';
export { parseId3v2, serializeId3v2 } from './id3v2.ts';
export { parseId3v1, serializeId3v1 } from './id3v1.ts';
export { parseXingHeader } from './xing.ts';

// Backend
export { Mp3Backend, MP3_FORMAT } from './backend.ts';
