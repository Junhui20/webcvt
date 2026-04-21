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
  iterateFragmentedAudioSamples,
  iterateAudioSamplesAuto,
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
  // Fragmented MP4 errors (sub-pass D):
  Mp4MoofMissingMfhdError,
  Mp4MoofSequenceOutOfOrderError,
  Mp4TfhdInvalidFlagsError,
  Mp4TfhdUnknownTrackError,
  Mp4TfhdValueOutOfRangeError,
  Mp4TfhdLegacyBaseUnsupportedError,
  Mp4TfdtVersionError,
  Mp4TfdtValueOutOfRangeError,
  Mp4TrunInvalidFlagsError,
  Mp4TrunSampleCountTooLargeError,
  Mp4TrunSizeMismatchError,
  Mp4FragmentCountTooLargeError,
  Mp4TrafCountTooLargeError,
  Mp4DefaultsCascadeError,
  Mp4SidxBadVersionError,
  Mp4SidxNestedDepthExceededError,
  Mp4SidxReferenceCountTooLargeError,
  Mp4MfraOutOfBoundsError,
  Mp4FragmentMixedSampleTablesError,
  Mp4FragmentedSerializeNotSupportedError,
  Mp4FragmentNotYetIteratedError,
  Mp4FragmentedMoovSizeChangedError,
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

// Fragmented MP4 types (sub-pass D):
export type { Mp4MovieFragment, Mp4TrackFragment, Mp4TrackRun } from './parser.ts';
export type { Mp4TrackExtends } from './parser.ts';
export type { Mp4FragmentSample } from './boxes/trun.ts';
