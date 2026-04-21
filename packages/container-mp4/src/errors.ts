/**
 * MP4-specific error classes extending WebcvtError.
 *
 * All error codes are UPPER_SNAKE_CASE strings for programmatic matching.
 * Never throw bare Error or WebcvtError from container-mp4 — always use
 * a typed subclass from this file.
 */

import { WebcvtError } from '@webcvt/core';

/** Thrown when the input exceeds the 200 MiB size cap. */
export class Mp4InputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'MP4_INPUT_TOO_LARGE',
      `MP4 input is ${size} bytes; maximum supported is ${max} bytes (200 MiB).`,
    );
    this.name = 'Mp4InputTooLargeError';
  }
}

/** Thrown when the ftyp box is missing or not the first box. */
export class Mp4MissingFtypError extends WebcvtError {
  constructor() {
    super('MP4_MISSING_FTYP', 'No ftyp box found as the first box. Not a valid MP4/M4A file.');
    this.name = 'Mp4MissingFtypError';
  }
}

/**
 * @deprecated REJECTED_BRANDS is now intentionally empty; this class is
 * unreachable. Brand-level rejection was removed in sub-pass D fixes:
 * fragmented-vs-classic detection uses mvex presence, not brand strings.
 * Retained for source compatibility only.
 */
export class Mp4UnsupportedBrandError extends WebcvtError {
  constructor(brand: string) {
    super(
      'MP4_UNSUPPORTED_BRAND',
      `ftyp brand "${brand}" is in the reject list (currently empty in this build).`,
    );
    this.name = 'Mp4UnsupportedBrandError';
  }
}

/** Thrown when no moov box is found at the top level. */
export class Mp4MissingMoovError extends WebcvtError {
  constructor() {
    super('MP4_MISSING_MOOV', 'No moov box found. The file is not a valid MP4.');
    this.name = 'Mp4MissingMoovError';
  }
}

/** Thrown when the file has more than one trak box (multi-track not supported). */
export class Mp4MultiTrackNotSupportedError extends WebcvtError {
  constructor(trackCount: number) {
    super(
      'MP4_MULTI_TRACK_NOT_SUPPORTED',
      `Found ${trackCount} trak boxes; only single-track audio M4A is supported in Phase 3. Multi-track support is Phase 3.5+.`,
    );
    this.name = 'Mp4MultiTrackNotSupportedError';
  }
}

/** Thrown when the hdlr handler_type is not 'soun' (video, subtitle, etc. are deferred). */
export class Mp4UnsupportedTrackTypeError extends WebcvtError {
  constructor(handlerType: string) {
    super(
      'MP4_UNSUPPORTED_TRACK_TYPE',
      `Track handler type "${handlerType}" is not supported. Only audio ('soun') tracks are supported in Phase 3. Video and other track types are Phase 3.5+.`,
    );
    this.name = 'Mp4UnsupportedTrackTypeError';
  }
}

/** Thrown when the stsd sample entry four-CC is not 'mp4a'. */
export class Mp4UnsupportedSampleEntryError extends WebcvtError {
  constructor(fourCC: string) {
    super(
      'MP4_UNSUPPORTED_SAMPLE_ENTRY',
      `Sample entry type "${fourCC}" is not supported. Only "mp4a" (AAC) is supported in Phase 3. Video sample entries (avc1, hev1, etc.) are Phase 3.5+.`,
    );
    this.name = 'Mp4UnsupportedSampleEntryError';
  }
}

/** Thrown when the dref entry is not self-contained (url with flags & 1). */
export class Mp4ExternalDataRefError extends WebcvtError {
  constructor() {
    super(
      'MP4_EXTERNAL_DATA_REF',
      'Data reference (dref) is not self-contained. Only files with all media data ' +
        'embedded (url  flags & 1) are supported.',
    );
    this.name = 'Mp4ExternalDataRefError';
  }
}

/** Thrown when a box size field is invalid (truncated, zero for non-mdat, or exceeds cap). */
export class Mp4InvalidBoxError extends WebcvtError {
  constructor(reason: string) {
    super('MP4_INVALID_BOX', `Invalid MP4 box: ${reason}`);
    this.name = 'Mp4InvalidBoxError';
  }
}

/** Thrown when the total box count exceeds MAX_BOXES_PER_FILE. */
export class Mp4TooManyBoxesError extends WebcvtError {
  constructor(max: number) {
    super(
      'MP4_TOO_MANY_BOXES',
      `File contains more than ${max} boxes. The input may be corrupt or adversarially crafted.`,
    );
    this.name = 'Mp4TooManyBoxesError';
  }
}

/** Thrown when box descent depth exceeds MAX_DEPTH. */
export class Mp4DepthExceededError extends WebcvtError {
  constructor(max: number) {
    super(
      'MP4_DEPTH_EXCEEDED',
      `Box nesting depth exceeds maximum of ${max}. The input may be corrupt or adversarially crafted.`,
    );
    this.name = 'Mp4DepthExceededError';
  }
}

/** Thrown when an entry_count field exceeds MAX_TABLE_ENTRIES. */
export class Mp4TableTooLargeError extends WebcvtError {
  constructor(boxType: string, count: number, max: number) {
    super(
      'MP4_TABLE_TOO_LARGE',
      `${boxType} entry_count ${count} exceeds maximum ${max}. Input may be crafted.`,
    );
    this.name = 'Mp4TableTooLargeError';
  }
}

/** Thrown when an esds descriptor size exceeds MAX_DESCRIPTOR_BYTES. */
export class Mp4DescriptorTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'MP4_DESCRIPTOR_TOO_LARGE',
      `esds descriptor claims size ${size} bytes; maximum is ${max} bytes (16 MiB).`,
    );
    this.name = 'Mp4DescriptorTooLargeError';
  }
}

/** Thrown when the mp4a sound description version is not 0 (QuickTime v1/v2 is deferred). */
export class Mp4UnsupportedSoundVersionError extends WebcvtError {
  constructor(version: number) {
    super(
      'MP4_UNSUPPORTED_SOUND_VERSION',
      `mp4a sound description version ${version} is not supported. Only ISO MP4 version 0 is supported in Phase 3. QuickTime v1/v2 is Phase 3.5+.`,
    );
    this.name = 'Mp4UnsupportedSoundVersionError';
  }
}

/** Thrown when a sample offset + size would read outside the file buffer. */
export class Mp4CorruptSampleError extends WebcvtError {
  constructor(sampleIndex: number, offset: number, size: number, fileSize: number) {
    super(
      'MP4_CORRUPT_SAMPLE',
      `Sample ${sampleIndex} at offset ${offset} + size ${size} = ${offset + size} exceeds file length ${fileSize}.`,
    );
    this.name = 'Mp4CorruptSampleError';
  }
}

/**
 * Reserved for top-level structural failures (no ftyp, no moov).
 * Per-trak parse failures throw typed Mp4MissingBoxError / Mp4InvalidBoxError,
 * which are more specific than Mp4CorruptStreamError.
 *
 * @deprecated Reserved for future use; see parser.ts comment.
 */
export class Mp4CorruptStreamError extends WebcvtError {
  constructor(reason: string) {
    super('MP4_CORRUPT_STREAM', `MP4 stream is corrupt: ${reason}`);
    this.name = 'Mp4CorruptStreamError';
  }
}

/** Thrown when a required child box is missing from a container. */
export class Mp4MissingBoxError extends WebcvtError {
  constructor(boxType: string, parent: string) {
    super('MP4_MISSING_BOX', `Required box "${boxType}" not found inside "${parent}".`);
    this.name = 'Mp4MissingBoxError';
  }
}

/** Thrown when a non-identity encode conversion is requested (Phase 3 scope). */
export class Mp4EncodeNotImplementedError extends WebcvtError {
  constructor() {
    super(
      'MP4_ENCODE_NOT_IMPLEMENTED',
      'Encoding to MP4/M4A from non-MP4 input is not implemented in container-mp4 Phase 3. ' +
        'Install @webcvt/backend-wasm to enable transcode via ffmpeg.wasm.',
    );
    this.name = 'Mp4EncodeNotImplementedError';
  }
}

// ---------------------------------------------------------------------------
// elst (Edit List) errors
// ---------------------------------------------------------------------------

/**
 * Thrown when elst entry_count * entry_size + 8 does not equal the payload length.
 * Indicates a truncated or malformed elst box.
 */
export class Mp4ElstBadEntryCountError extends WebcvtError {
  constructor(entryCount: number, entrySize: number, actual: number, expected: number) {
    super(
      'MP4_ELST_BAD_ENTRY_COUNT',
      `elst entry_count=${entryCount} × entry_size=${entrySize} + 8 = ${expected} bytes, ` +
        `but payload is ${actual} bytes. Box is truncated or corrupt.`,
    );
    this.name = 'Mp4ElstBadEntryCountError';
  }
}

/**
 * Thrown when elst entry_count exceeds MAX_ELST_ENTRIES.
 * Guards against adversarially large entry counts.
 */
export class Mp4ElstTooManyEntriesError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'MP4_ELST_TOO_MANY_ENTRIES',
      `elst entry_count ${count} exceeds maximum ${max}. Input may be adversarially crafted.`,
    );
    this.name = 'Mp4ElstTooManyEntriesError';
  }
}

/**
 * Thrown when media_rate_integer != 1 or media_rate_fraction != 0.
 * Dwell edits (rate=0) and slow-mo / fast-forward / reverse rates are
 * out of scope for Phase 3.
 */
export class Mp4ElstUnsupportedRateError extends WebcvtError {
  constructor(rateInt: number, rateFrac: number) {
    super(
      'MP4_ELST_UNSUPPORTED_RATE',
      `elst entry has unsupported media_rate ${rateInt}.${rateFrac} (fixed-point 16.16). Only rate 1.0 (integer=1, fraction=0) is supported in Phase 3. Dwell edits (rate=0) and fractional rates are Phase 3.5+.`,
    );
    this.name = 'Mp4ElstUnsupportedRateError';
  }
}

/**
 * Thrown when media_time is a negative value other than -1 (the empty-edit sentinel).
 * Negative media_time < -1 indicates a corrupt or non-spec-compliant elst entry.
 */
export class Mp4ElstSignBitError extends WebcvtError {
  constructor(mediaTime: number) {
    super(
      'MP4_ELST_SIGN_BIT_ERROR',
      `elst entry media_time=${mediaTime} is negative but not -1 (the empty-edit sentinel). The box appears corrupt.`,
    );
    this.name = 'Mp4ElstSignBitError';
  }
}

/**
 * Thrown when a v1 (64-bit) elst field value exceeds Number.MAX_SAFE_INTEGER.
 * Files requiring segment_duration or media_time > 2^53 are not supported.
 */
export class Mp4ElstValueOutOfRangeError extends WebcvtError {
  constructor(field: string, hiWord: number) {
    super(
      'MP4_ELST_VALUE_OUT_OF_RANGE',
      `elst v1 field "${field}" has hi-word 0x${hiWord.toString(16).toUpperCase()} which exceeds Number.MAX_SAFE_INTEGER. Files requiring 64-bit elst values beyond 2^53 are not supported.`,
    );
    this.name = 'Mp4ElstValueOutOfRangeError';
  }
}

/**
 * Thrown by the sample iterator when the track's edit list contains more than
 * one non-empty edit segment. Multi-segment playback is Phase 3.5+.
 */
export class Mp4ElstMultiSegmentNotSupportedError extends WebcvtError {
  constructor() {
    super(
      'MP4_ELST_MULTI_SEGMENT_NOT_SUPPORTED',
      'The track edit list contains more than one non-empty edit segment. ' +
        'Multi-segment edit lists are not supported in Phase 3. ' +
        'The parser preserved all entries for round-trip; iterator support is Phase 3.5+.',
    );
    this.name = 'Mp4ElstMultiSegmentNotSupportedError';
  }
}

// ---------------------------------------------------------------------------
// udta/meta/ilst (Movie Metadata) errors
// ---------------------------------------------------------------------------

/**
 * Thrown when hdlr.handler_type inside meta is not 'mdir'.
 * The caller should preserve the entire udta as opaque bytes.
 */
export class Mp4MetaBadHandlerError extends WebcvtError {
  constructor(handlerType: string) {
    super(
      'MP4_META_BAD_HANDLER',
      `meta hdlr handler_type is "${handlerType}"; expected "mdir" for iTunes-style metadata. udta will be preserved as opaque bytes.`,
    );
    this.name = 'Mp4MetaBadHandlerError';
  }
}

/**
 * Thrown when the high byte of a `data` sub-box type_indicator is non-zero.
 * The spec requires the high byte to be 0x00.
 */
export class Mp4MetaBadDataTypeError extends WebcvtError {
  constructor(typeIndicatorFull: number) {
    super(
      'MP4_META_BAD_DATA_TYPE',
      `ilst 'data' box type_indicator 0x${typeIndicatorFull.toString(16).toUpperCase().padStart(8, '0')} has a non-zero high byte; this is not a valid well-known type indicator.`,
    );
    this.name = 'Mp4MetaBadDataTypeError';
  }
}

/**
 * Thrown when the number of ilst child atoms exceeds MAX_METADATA_ATOMS.
 */
export class Mp4MetaTooManyAtomsError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'MP4_META_TOO_MANY_ATOMS',
      `ilst contains more than ${max} atoms (found at least ${count}). Input may be adversarially crafted.`,
    );
    this.name = 'Mp4MetaTooManyAtomsError';
  }
}

// ---------------------------------------------------------------------------
// Fragmented MP4 errors (sub-pass D)
// ---------------------------------------------------------------------------

/** Thrown when a moof box is missing its required mfhd child. */
export class Mp4MoofMissingMfhdError extends WebcvtError {
  constructor(moofOffset: number) {
    super(
      'MP4_MOOF_MISSING_MFHD',
      `moof at offset ${moofOffset} has no mfhd child box. The fragment is corrupt.`,
    );
    this.name = 'Mp4MoofMissingMfhdError';
  }
}

/** Thrown when mfhd.sequence_number is not monotonically increasing. */
export class Mp4MoofSequenceOutOfOrderError extends WebcvtError {
  constructor(expected: number, got: number, moofOffset: number) {
    super(
      'MP4_MOOF_SEQUENCE_OUT_OF_ORDER',
      `moof at offset ${moofOffset}: sequence_number ${got} is not greater than previous ${expected}. Fragments must have monotonically increasing sequence numbers.`,
    );
    this.name = 'Mp4MoofSequenceOutOfOrderError';
  }
}

/** Thrown when tfhd has invalid flag bits (reserved bits set). */
export class Mp4TfhdInvalidFlagsError extends WebcvtError {
  constructor(flags: number, moofOffset: number) {
    super(
      'MP4_TFHD_INVALID_FLAGS',
      `tfhd in moof at offset ${moofOffset} has invalid flags 0x${flags.toString(16).padStart(6, '0')}.`,
    );
    this.name = 'Mp4TfhdInvalidFlagsError';
  }
}

/** Thrown when tfhd.track_ID has no corresponding trex in mvex. */
export class Mp4TfhdUnknownTrackError extends WebcvtError {
  constructor(trackId: number, moofOffset: number) {
    super(
      'MP4_TFHD_UNKNOWN_TRACK',
      `tfhd in moof at offset ${moofOffset} references track_ID ${trackId} which has no trex in mvex.`,
    );
    this.name = 'Mp4TfhdUnknownTrackError';
  }
}

/** Thrown when a tfhd u64 field value exceeds Number.MAX_SAFE_INTEGER. */
export class Mp4TfhdValueOutOfRangeError extends WebcvtError {
  constructor(field: string, hiWord: number, moofOffset: number) {
    super(
      'MP4_TFHD_VALUE_OUT_OF_RANGE',
      `tfhd in moof at offset ${moofOffset}: field "${field}" hi-word 0x${hiWord.toString(16).toUpperCase()} exceeds Number.MAX_SAFE_INTEGER.`,
    );
    this.name = 'Mp4TfhdValueOutOfRangeError';
  }
}

/**
 * Thrown when tfhd has neither base-data-offset-present (0x000001) nor
 * default-base-is-moof (0x020000) — the legacy moov-relative base is not supported.
 */
export class Mp4TfhdLegacyBaseUnsupportedError extends WebcvtError {
  constructor(moofOffset: number) {
    super(
      'MP4_TFHD_LEGACY_BASE_UNSUPPORTED',
      `tfhd in moof at offset ${moofOffset}: neither base-data-offset-present (0x000001) nor default-base-is-moof (0x020000) is set. Legacy moov-relative base offsets are not supported.`,
    );
    this.name = 'Mp4TfhdLegacyBaseUnsupportedError';
  }
}

/** Thrown when tfdt version is not 0 or 1. */
export class Mp4TfdtVersionError extends WebcvtError {
  constructor(version: number, moofOffset: number) {
    super(
      'MP4_TFDT_VERSION_ERROR',
      `tfdt in moof at offset ${moofOffset} has unsupported version ${version}; only 0 and 1 are valid.`,
    );
    this.name = 'Mp4TfdtVersionError';
  }
}

/** Thrown when tfdt v1 value exceeds Number.MAX_SAFE_INTEGER. */
export class Mp4TfdtValueOutOfRangeError extends WebcvtError {
  constructor(hiWord: number, moofOffset: number) {
    super(
      'MP4_TFDT_VALUE_OUT_OF_RANGE',
      `tfdt v1 in moof at offset ${moofOffset}: hi-word 0x${hiWord.toString(16).toUpperCase()} exceeds Number.MAX_SAFE_INTEGER.`,
    );
    this.name = 'Mp4TfdtValueOutOfRangeError';
  }
}

/** Thrown when a trun box has invalid flags. */
export class Mp4TrunInvalidFlagsError extends WebcvtError {
  constructor(flags: number, moofOffset: number) {
    super(
      'MP4_TRUN_INVALID_FLAGS',
      `trun in moof at offset ${moofOffset} has invalid flags 0x${flags.toString(16).padStart(6, '0')}.`,
    );
    this.name = 'Mp4TrunInvalidFlagsError';
  }
}

/** Thrown when trun.sample_count exceeds MAX_SAMPLES_PER_TRUN. */
export class Mp4TrunSampleCountTooLargeError extends WebcvtError {
  constructor(count: number, max: number, moofOffset: number) {
    super(
      'MP4_TRUN_SAMPLE_COUNT_TOO_LARGE',
      `trun in moof at offset ${moofOffset}: sample_count ${count} exceeds cap ${max}.`,
    );
    this.name = 'Mp4TrunSampleCountTooLargeError';
  }
}

/** Thrown when the trun payload size does not match the declared fields and sample_count. */
export class Mp4TrunSizeMismatchError extends WebcvtError {
  constructor(expected: number, actual: number, moofOffset: number) {
    super(
      'MP4_TRUN_SIZE_MISMATCH',
      `trun in moof at offset ${moofOffset}: expected payload ${expected} bytes, got ${actual} bytes.`,
    );
    this.name = 'Mp4TrunSizeMismatchError';
  }
}

/** Thrown when the total fragment count exceeds MAX_FRAGMENTS. */
export class Mp4FragmentCountTooLargeError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'MP4_FRAGMENT_COUNT_TOO_LARGE',
      `Fragment count ${count} exceeds the maximum of ${max}. The file may be adversarially crafted.`,
    );
    this.name = 'Mp4FragmentCountTooLargeError';
  }
}

/** Thrown when a moof contains more traf boxes than MAX_TRAFS_PER_MOOF. */
export class Mp4TrafCountTooLargeError extends WebcvtError {
  constructor(count: number, max: number, moofOffset: number) {
    super(
      'MP4_TRAF_COUNT_TOO_LARGE',
      `moof at offset ${moofOffset} contains ${count} traf boxes; maximum is ${max}.`,
    );
    this.name = 'Mp4TrafCountTooLargeError';
  }
}

/** Thrown when the defaulting cascade cannot resolve sample_duration or sample_size. */
export class Mp4DefaultsCascadeError extends WebcvtError {
  constructor(field: 'duration' | 'size', sampleIndex: number, moofOffset: number) {
    super(
      'MP4_DEFAULTS_CASCADE',
      `Cannot resolve sample ${field} for sample ${sampleIndex} in moof at offset ${moofOffset}: neither per-sample, tfhd, nor trex provides a default value.`,
    );
    this.name = 'Mp4DefaultsCascadeError';
  }
}

/** Thrown when a sidx box has an unsupported version (D.3 placeholder). */
export class Mp4SidxBadVersionError extends WebcvtError {
  constructor(version: number) {
    super(
      'MP4_SIDX_BAD_VERSION',
      `sidx version ${version} is not supported; only 0 and 1 are valid.`,
    );
    this.name = 'Mp4SidxBadVersionError';
  }
}

/** Thrown when sidx nesting depth exceeds MAX_SIDX_DEPTH (D.3 placeholder). */
export class Mp4SidxNestedDepthExceededError extends WebcvtError {
  constructor(max: number) {
    super('MP4_SIDX_NESTED_DEPTH_EXCEEDED', `sidx nesting depth exceeds maximum of ${max}.`);
    this.name = 'Mp4SidxNestedDepthExceededError';
  }
}

/** Thrown when sidx reference_count exceeds MAX_SIDX_REFERENCES (D.3 placeholder). */
export class Mp4SidxReferenceCountTooLargeError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'MP4_SIDX_REFERENCE_COUNT_TOO_LARGE',
      `sidx reference_count ${count} exceeds maximum ${max}.`,
    );
    this.name = 'Mp4SidxReferenceCountTooLargeError';
  }
}

/** Thrown when the mfra box is at an invalid position (D.3 placeholder). */
export class Mp4MfraOutOfBoundsError extends WebcvtError {
  constructor(reason: string) {
    super('MP4_MFRA_OUT_OF_BOUNDS', `mfra parse error: ${reason}`);
    this.name = 'Mp4MfraOutOfBoundsError';
  }
}

/** Thrown when a fragmented file has non-empty sample tables (stbl) in moov. */
export class Mp4FragmentMixedSampleTablesError extends WebcvtError {
  constructor(trackId: number) {
    super(
      'MP4_FRAGMENT_MIXED_SAMPLE_TABLES',
      `Track ${trackId} in a fragmented file (mvex present) has non-empty sample tables (stsz/stsc/stts). A fragmented file must have zero-sample stbl entries.`,
    );
    this.name = 'Mp4FragmentMixedSampleTablesError';
  }
}

/** Thrown when the serializer is called on a fragmented file (D.4 guard). */
export class Mp4FragmentedSerializeNotSupportedError extends WebcvtError {
  constructor() {
    super(
      'MP4_FRAGMENTED_SERIALIZE_NOT_SUPPORTED',
      'Serializing fragmented MP4 files is not supported in sub-pass D. Round-trip serialization of fragmented files is planned for sub-pass D.4.',
    );
    this.name = 'Mp4FragmentedSerializeNotSupportedError';
  }
}

/** Thrown when the fragmented file sample iterator is called on a non-fragmented file or vice-versa. */
export class Mp4FragmentNotYetIteratedError extends WebcvtError {
  constructor() {
    super(
      'MP4_FRAGMENT_NOT_YET_ITERATED',
      'iterateAudioSamples / iterateAudioSamplesWithContext cannot be used on fragmented MP4 files. Use iterateFragmentedAudioSamples or iterateAudioSamplesAuto instead.',
    );
    this.name = 'Mp4FragmentNotYetIteratedError';
  }
}

/** Thrown when moov size changes after rebuild (D.4 guard placeholder). */
export class Mp4FragmentedMoovSizeChangedError extends WebcvtError {
  constructor(original: number, rebuilt: number) {
    super(
      'MP4_FRAGMENTED_MOOV_SIZE_CHANGED',
      `Rebuilt moov is ${rebuilt} bytes but original was ${original} bytes. Mutating metadata on a fragmented file would corrupt all moof data offsets.`,
    );
    this.name = 'Mp4FragmentedMoovSizeChangedError';
  }
}

// ---------------------------------------------------------------------------
// Cover art — placed after fragmented errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a cover art payload exceeds MAX_COVER_ART_BYTES (16 MiB).
 */
export class Mp4MetaCoverArtTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'MP4_META_COVER_ART_TOO_LARGE',
      `covr data payload is ${size} bytes; maximum is ${max} bytes (16 MiB). Input may be adversarially crafted.`,
    );
    this.name = 'Mp4MetaCoverArtTooLargeError';
  }
}

/**
 * Thrown when a '----' freeform atom is missing mean, name, or data children
 * or they appear in the wrong order.
 */
export class Mp4MetaFreeformIncompleteError extends WebcvtError {
  constructor(reason: string) {
    super(
      'MP4_META_FREEFORM_INCOMPLETE',
      `'----' freeform atom is incomplete or malformed: ${reason}`,
    );
    this.name = 'Mp4MetaFreeformIncompleteError';
  }
}

/**
 * Thrown when a 'trkn' or 'disk' atom has a binary payload that is not exactly 8 bytes.
 */
export class Mp4MetaBadTrackNumberError extends WebcvtError {
  constructor(key: string, length: number) {
    super(
      'MP4_META_BAD_TRACK_NUMBER',
      `'${key}' binary payload must be exactly 8 bytes ([u16 0][u16 cur][u16 total][u16 0]); got ${length} bytes.`,
    );
    this.name = 'Mp4MetaBadTrackNumberError';
  }
}

/**
 * Thrown when a non-cover-art metadata payload exceeds MAX_METADATA_PAYLOAD_BYTES (4 MiB).
 */
export class Mp4MetaPayloadTooLargeError extends WebcvtError {
  constructor(key: string, size: number, max: number) {
    super(
      'MP4_META_PAYLOAD_TOO_LARGE',
      `Metadata atom '${key}' payload is ${size} bytes; maximum is ${max} bytes (4 MiB). Input may be adversarially crafted.`,
    );
    this.name = 'Mp4MetaPayloadTooLargeError';
  }
}

// ---------------------------------------------------------------------------
// Video sample entry errors (sub-pass B)
// ---------------------------------------------------------------------------

/** Thrown when a VisualSampleEntry payload is shorter than 78 bytes. */
export class Mp4VisualSampleEntryTooSmallError extends WebcvtError {
  constructor(size: number) {
    super(
      'MP4_VISUAL_SAMPLE_ENTRY_TOO_SMALL',
      `VisualSampleEntry payload is ${size} bytes; minimum is 78 bytes (ISO/IEC 14496-12 §12.1).`,
    );
    this.name = 'Mp4VisualSampleEntryTooSmallError';
  }
}

/** Thrown when width or height exceeds MAX_VIDEO_DIMENSION. */
export class Mp4VisualDimensionOutOfRangeError extends WebcvtError {
  constructor(field: 'width' | 'height', value: number, max: number) {
    super(
      'MP4_VISUAL_DIMENSION_OUT_OF_RANGE',
      `VisualSampleEntry ${field}=${value} exceeds maximum ${max}.`,
    );
    this.name = 'Mp4VisualDimensionOutOfRangeError';
  }
}

/** Thrown when the avcC child box is missing from a visual sample entry. */
export class Mp4AvcCMissingError extends WebcvtError {
  constructor() {
    super('MP4_AVCC_MISSING', 'avc1/avc3 sample entry is missing the required avcC child box.');
    this.name = 'Mp4AvcCMissingError';
  }
}

/** Thrown when avcC configurationVersion != 1. */
export class Mp4AvcCBadVersionError extends WebcvtError {
  constructor(version: number) {
    super(
      'MP4_AVCC_BAD_VERSION',
      `avcC configurationVersion=${version}; only version 1 is valid (ISO/IEC 14496-15 §5.2.4.1).`,
    );
    this.name = 'Mp4AvcCBadVersionError';
  }
}

/** Thrown when avcC lengthSizeMinusOne == 2 (reserved by spec). */
export class Mp4AvcCBadLengthSizeError extends WebcvtError {
  constructor(value: number) {
    super(
      'MP4_AVCC_BAD_LENGTH_SIZE',
      `avcC lengthSizeMinusOne=${value} is reserved. Valid values are 0 (1-byte), 1 (2-byte), 3 (4-byte).`,
    );
    this.name = 'Mp4AvcCBadLengthSizeError';
  }
}

/** Thrown when an avcC SPS/PPS NAL unit length overruns the payload. */
export class Mp4AvcCNalLengthError extends WebcvtError {
  constructor(cursor: number, claimed: number, available: number) {
    super(
      'MP4_AVCC_NAL_LENGTH',
      `avcC NAL unit at cursor=${cursor} claims length=${claimed} but only ${available} bytes available.`,
    );
    this.name = 'Mp4AvcCNalLengthError';
  }
}

/** Thrown when the hvcC child box is missing from a visual sample entry. */
export class Mp4HvcCMissingError extends WebcvtError {
  constructor() {
    super('MP4_HVCC_MISSING', 'hev1/hvc1 sample entry is missing the required hvcC child box.');
    this.name = 'Mp4HvcCMissingError';
  }
}

/** Thrown when hvcC configurationVersion != 1. */
export class Mp4HvcCBadVersionError extends WebcvtError {
  constructor(version: number) {
    super(
      'MP4_HVCC_BAD_VERSION',
      `hvcC configurationVersion=${version}; only version 1 is valid (ISO/IEC 14496-15 §8.3.3.1).`,
    );
    this.name = 'Mp4HvcCBadVersionError';
  }
}

/** Thrown when hvcC lengthSizeMinusOne == 2 (reserved by spec). */
export class Mp4HvcCBadLengthSizeError extends WebcvtError {
  constructor(value: number) {
    super(
      'MP4_HVCC_BAD_LENGTH_SIZE',
      `hvcC lengthSizeMinusOne=${value} is reserved. Valid values are 0, 1, 3.`,
    );
    this.name = 'Mp4HvcCBadLengthSizeError';
  }
}

/** Thrown when the vpcC child box is missing from a visual sample entry. */
export class Mp4VpcCMissingError extends WebcvtError {
  constructor() {
    super('MP4_VPCC_MISSING', 'vp09 sample entry is missing the required vpcC child box.');
    this.name = 'Mp4VpcCMissingError';
  }
}

/** Thrown when vpcC version != 1. */
export class Mp4VpcCBadVersionError extends WebcvtError {
  constructor(version: number) {
    super(
      'MP4_VPCC_BAD_VERSION',
      `vpcC version=${version}; only version 1 is valid (VP-Codec-ISOBMFF §2.2).`,
    );
    this.name = 'Mp4VpcCBadVersionError';
  }
}

/** Thrown when the av1C child box is missing from a visual sample entry. */
export class Mp4Av1CMissingError extends WebcvtError {
  constructor() {
    super('MP4_AV1C_MISSING', 'av01 sample entry is missing the required av1C child box.');
    this.name = 'Mp4Av1CMissingError';
  }
}

/** Thrown when av1C byte 0 marker bit != 1 or version != 1. */
export class Mp4Av1CBadMarkerError extends WebcvtError {
  constructor(byte0: number) {
    super(
      'MP4_AV1C_BAD_MARKER',
      `av1C byte[0]=0x${byte0.toString(16).padStart(2, '0')}: marker bit must be 1 and version bits must be 1 (AV1-ISOBMFF §2.3.3).`,
    );
    this.name = 'Mp4Av1CBadMarkerError';
  }
}

/** Thrown when a video sample entry uses an unsupported codec 4cc. */
export class Mp4UnsupportedVideoCodecError extends WebcvtError {
  constructor(fourCC: string) {
    super(
      'MP4_UNSUPPORTED_VIDEO_CODEC',
      `Video sample entry type "${fourCC}" is not supported. Supported: avc1, avc3, hev1, hvc1, vp09, av01.`,
    );
    this.name = 'Mp4UnsupportedVideoCodecError';
  }
}

/**
 * Thrown when iterateAudioSamples / iterateAudioSamplesWithContext is called on
 * a video track, or iterateVideoSamples is called on an audio track.
 */
export class Mp4IterateWrongKindError extends WebcvtError {
  constructor(expected: 'audio' | 'video', got: 'audio' | 'video') {
    super(
      'MP4_ITERATE_WRONG_KIND',
      `Iterator expected a ${expected} track but the track kind is ${got}.`,
    );
    this.name = 'Mp4IterateWrongKindError';
  }
}
