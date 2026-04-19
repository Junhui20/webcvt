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

/** Thrown when the ftyp brand is in the fragmented/unsupported list. */
export class Mp4UnsupportedBrandError extends WebcvtError {
  constructor(brand: string) {
    super(
      'MP4_UNSUPPORTED_BRAND',
      `ftyp brand "${brand}" implies fragmented or unsupported MP4 (Phase 3.5+). Only M4A , mp42, isom, M4V , qt   are supported in Phase 3.`,
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
