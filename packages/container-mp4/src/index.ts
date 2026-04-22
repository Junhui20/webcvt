/**
 * @catlabtech/webcvt-container-mp4 — MP4/M4A container muxer and demuxer.
 *
 * Public API surface (minimal per Lesson #6 — do not re-export internal helpers).
 */

// Parser / serializer entry points.
export { parseMp4, type Mp4File, type Mp4Track } from './parser.ts';
export { serializeMp4 } from './serializer.ts';

// Track selectors (multi-track, sub-pass C).
export {
  findAudioTrack,
  findVideoTrack,
  findTrackById,
  findTracksByKind,
} from './track-selectors.ts';

// Sample iteration.
export {
  iterateAudioSamples,
  iterateAudioSamplesWithContext,
  iterateFragmentedAudioSamples,
  iterateAudioSamplesAuto,
  iterateVideoSamples,
  iterateFragmentedVideoSamples,
  iterateSamples,
  deriveCodecString,
  type AudioSample,
  type Mp4Sample,
} from './sample-iterator.ts';

// Backend registration.
export { Mp4Backend, M4A_FORMAT } from './backend.ts';

// Typed error classes (exported so callers can catch by type).
export {
  Mp4InputTooLargeError,
  Mp4MissingFtypError,
  Mp4UnsupportedBrandError,
  Mp4MissingMoovError,
  /** @deprecated Parser no longer throws this. Kept for source compatibility. */
  Mp4MultiTrackNotSupportedError,
  // Multi-track errors (sub-pass C):
  Mp4NoTracksError,
  Mp4TooManyTracksError,
  Mp4TrackIdZeroError,
  Mp4DuplicateTrackIdError,
  Mp4AmbiguousTrackError,
  Mp4TrackNotFoundError,
  Mp4NoAudioTrackError,
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
  /** @deprecated Sub-pass D.4 replaced this guard with real round-trip serialization. Never thrown. */
  Mp4FragmentedSerializeNotSupportedError,
  Mp4FragmentNotYetIteratedError,
  Mp4FragmentedMoovSizeChangedError,
  Mp4FragmentedTailMissingError,
  // Video sample entry errors (sub-pass B):
  Mp4VisualSampleEntryTooSmallError,
  Mp4VisualDimensionOutOfRangeError,
  Mp4AvcCMissingError,
  Mp4AvcCBadVersionError,
  Mp4AvcCBadLengthSizeError,
  Mp4AvcCNalLengthError,
  Mp4HvcCMissingError,
  Mp4HvcCBadVersionError,
  Mp4HvcCBadLengthSizeError,
  Mp4VpcCMissingError,
  Mp4VpcCBadVersionError,
  Mp4Av1CMissingError,
  Mp4Av1CBadMarkerError,
  Mp4UnsupportedVideoCodecError,
  Mp4IterateWrongKindError,
} from './errors.ts';

// Core types re-exported for convenience.
export type { Mp4Ftyp } from './boxes/ftyp.ts';

export type {
  Mp4MovieHeader,
  Mp4TrackHeader,
  Mp4MediaHeader,
} from './boxes/mvhd-tkhd-mdhd.ts';

export type { Mp4AudioSampleEntry } from './boxes/hdlr-stsd-mp4a.ts';

export type {
  Mp4VideoSampleEntry,
  Mp4VideoCodecConfig,
  Mp4VideoFormat,
  Mp4SampleEntry,
} from './boxes/visual-sample-entry.ts';

export type { Mp4AvcConfig } from './boxes/avcC.ts';
export type { Mp4HvcConfig, Mp4HvcArray } from './boxes/hvcC.ts';
export type { Mp4VpcConfig } from './boxes/vpcC.ts';
export type { Mp4Av1Config } from './boxes/av1C.ts';

export { deriveVideoCodecString } from './boxes/codec-string.ts';

export type { Mp4SampleTable } from './boxes/stbl.ts';

export type { EditListEntry } from './boxes/elst.ts';

export type { MetadataAtom, MetadataAtoms, MetadataValue } from './boxes/udta-meta-ilst.ts';

// Fragmented MP4 types (sub-pass D):
export type { Mp4MovieFragment, Mp4TrackFragment, Mp4TrackRun } from './parser.ts';
export type { Mp4TrackExtends } from './parser.ts';
export type { Mp4FragmentSample } from './boxes/trun.ts';
export type { Mp4Mehd } from './boxes/mvex.ts';
