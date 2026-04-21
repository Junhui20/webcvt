/**
 * @webcvt/container-mp4 — MP4/M4A container muxer and demuxer.
 *
 * Public API surface (minimal per Lesson #6 — do not re-export internal helpers).
 */

// Parser / serializer entry points.
export { parseMp4, type Mp4File, type Mp4Track } from './parser.ts';
export { serializeMp4 } from './serializer.ts';

// Sample iteration.
export {
  iterateAudioSamples,
  iterateAudioSamplesWithContext,
  deriveCodecString,
  type AudioSample,
} from './sample-iterator.ts';

// Backend registration.
export { Mp4Backend, M4A_FORMAT } from './backend.ts';

// Typed error classes (exported so callers can catch by type).
export {
  Mp4InputTooLargeError,
  Mp4MissingFtypError,
  Mp4UnsupportedBrandError,
  Mp4MissingMoovError,
  Mp4MultiTrackNotSupportedError,
  Mp4UnsupportedTrackTypeError,
  Mp4UnsupportedSampleEntryError,
  Mp4ExternalDataRefError,
  Mp4InvalidBoxError,
  Mp4TooManyBoxesError,
  Mp4DepthExceededError,
  Mp4TableTooLargeError,
  Mp4DescriptorTooLargeError,
  Mp4UnsupportedSoundVersionError,
  Mp4CorruptSampleError,
  Mp4CorruptStreamError,
  Mp4MissingBoxError,
  Mp4EncodeNotImplementedError,
  Mp4ElstBadEntryCountError,
  Mp4ElstTooManyEntriesError,
  Mp4ElstUnsupportedRateError,
  Mp4ElstSignBitError,
  Mp4ElstValueOutOfRangeError,
  Mp4ElstMultiSegmentNotSupportedError,
  Mp4MetaBadHandlerError,
  Mp4MetaBadDataTypeError,
  Mp4MetaTooManyAtomsError,
  Mp4MetaCoverArtTooLargeError,
  Mp4MetaFreeformIncompleteError,
  Mp4MetaBadTrackNumberError,
  Mp4MetaPayloadTooLargeError,
} from './errors.ts';

// Core types re-exported for convenience.
export type { Mp4Ftyp } from './boxes/ftyp.ts';

export type {
  Mp4MovieHeader,
  Mp4TrackHeader,
  Mp4MediaHeader,
} from './boxes/mvhd-tkhd-mdhd.ts';

export type { Mp4AudioSampleEntry } from './boxes/hdlr-stsd-mp4a.ts';

export type { Mp4SampleTable } from './boxes/stbl.ts';

export type { EditListEntry } from './boxes/elst.ts';

export type { MetadataAtom, MetadataAtoms, MetadataValue } from './boxes/udta-meta-ilst.ts';
