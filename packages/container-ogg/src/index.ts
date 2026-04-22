/**
 * @catlabtech/webcvt-container-ogg — Ogg container muxer and demuxer.
 *
 * Supports:
 * - Vorbis and Opus audio codecs
 * - Single logical stream and chained streams
 * - File extensions: .ogg, .oga, .opus
 *
 * Implemented from:
 * - RFC 3533 (Ogg Encapsulation Format Version 0)
 * - RFC 7845 (Ogg Encapsulation for the Opus Audio Codec)
 * - RFC 5334 (Ogg media types)
 * - Vorbis I specification (https://xiph.org/vorbis/doc/Vorbis_I_spec.html)
 *
 * No code was copied from libogg, libvorbis, libopus, ffmpeg, or stb_vorbis.
 */

export { parseOgg, type OggFile, type OggLogicalStream, type OggCodec } from './parser.ts';
export { serializeOgg, type SerializeOggOptions } from './serializer.ts';
export { OggBackend, OGG_FORMAT, OPUS_FORMAT, OGA_FORMAT } from './backend.ts';
export { iterateStreams, firstStream, streamsByCodec, allPacketsInOrder } from './chain.ts';
export type { StreamVisitor } from './chain.ts';
export { computeCrc32 } from './crc32.ts';
export {
  decodeVorbisIdentification,
  decodeVorbisComment,
  isVorbisHeaderPacket,
  isVorbisSetupPacket,
  type VorbisIdentification,
  type VorbisComment,
} from './vorbis.ts';
export {
  decodeOpusHead,
  decodeOpusTags,
  isOpusHeadPacket,
  isOpusTagsPacket,
  type OpusHead,
  type OpusTags,
} from './opus.ts';
export { parsePage, serializePage, buildSegmentTable, hasOggSAt, type OggPage } from './page.ts';
export { PacketAssembler, type OggPacket } from './packet.ts';
export {
  OggInputTooLargeError,
  OggCaptureMissingError,
  OggInvalidVersionError,
  OggSequenceGapError,
  OggCorruptStreamError,
  OggMultiplexNotSupportedError,
  OggPacketTooLargeError,
  OggTooManyPacketsError,
  OggTooManyPagesError,
  OggUnsupportedCodecError,
  OggVorbisHeaderError,
  OggVorbisCommentError,
  OggOpusHeaderError,
  OggEncodeNotImplementedError,
  OggPageBodyTooLargeError,
} from './errors.ts';
