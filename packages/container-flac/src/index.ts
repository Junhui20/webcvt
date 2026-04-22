/**
 * @catlabtech/webcvt-container-flac
 *
 * FLAC (Free Lossless Audio Codec) container parser and serializer for webcvt.
 *
 * Implementation references:
 * This package is implemented from the FLAC Format specification at
 * xiph.org/flac/format.html and the IETF CELLAR FLAC draft. Vorbis comment
 * parsing follows xiph.org/vorbis/doc/v-comment.html. No code was copied
 * from other implementations. Test fixtures derived from FFmpeg samples
 * (LGPL-2.1) live under `tests/fixtures/audio/` and are not redistributed
 * in npm.
 *
 * Phase 1: decode (FLAC → PCM via WebCodecs, FLAC → FLAC round-trip).
 * Phase 2: encode via @catlabtech/webcvt-backend-wasm (libFLAC). Install that package
 * to enable FLAC encoding; the core BackendRegistry will auto-discover it.
 */

// Types
export type { FlacStreamInfo } from './streaminfo.ts';
export type { FlacFrame, ChannelAssignment } from './frame.ts';
export type {
  FlacMetadataBlock,
  FlacSeekPoint,
  FlacVorbisComment,
  FlacPicture,
  MetaBlockHeader,
} from './metadata.ts';
export type { FlacFile } from './parser.ts';

// Errors
export {
  FlacInputTooLargeError,
  FlacInvalidMagicError,
  FlacInvalidMetadataError,
  FlacCrc8MismatchError,
  FlacCrc16MismatchError,
  FlacInvalidVarintError,
  FlacInvalidFrameError,
  FlacEncodeNotImplementedError,
} from './errors.ts';

// Core parsing / serialization
export { parseFlac } from './parser.ts';
export { serializeFlac } from './serializer.ts';

// Low-level primitives
export { decodeStreamInfo, encodeStreamInfo, STREAMINFO_SIZE } from './streaminfo.ts';
export { decodeVarint, encodeVarint, parseFrameHeader, FRAME_SYNC_CODE } from './frame.ts';
export { crc8, crc16, crc8Update, crc16Update } from './crc.ts';
export {
  parseBlockHeader,
  encodeBlockHeader,
  decodeSeekTable,
  decodeVorbisComment,
  decodePicture,
  BLOCK_TYPE_STREAMINFO,
  BLOCK_TYPE_PADDING,
  BLOCK_TYPE_APPLICATION,
  BLOCK_TYPE_SEEKTABLE,
  BLOCK_TYPE_VORBIS_COMMENT,
  BLOCK_TYPE_CUESHEET,
  BLOCK_TYPE_PICTURE,
  BLOCK_TYPE_INVALID,
} from './metadata.ts';

// Backend
export { FlacBackend, FLAC_FORMAT } from './backend.ts';
