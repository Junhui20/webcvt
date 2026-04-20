/**
 * @webcvt/ebml — Shared EBML primitives for webcvt container packages.
 *
 * Public API surface: VINT codec, element walker, typed readers/writers, error classes.
 */

// VINT codec
export {
  type EbmlVint,
  type EbmlVintBig,
  readVintId,
  readVintSize,
  writeVintId,
  writeVintSize,
} from './vint.ts';

// Element walker and helpers
export {
  type EbmlElement,
  readElementHeader,
  walkElements,
  readChildren,
  findChild,
  findChildren,
  parseFlatChildren,
} from './element.ts';

// Typed value readers and writers
export {
  readUint,
  readUintNumber,
  readInt,
  readFloat,
  readString,
  readUtf8,
  readBinary,
  writeUint,
  writeFloat64,
  writeFloat32,
  writeString,
  writeUtf8,
  concatBytes,
} from './types.ts';

// Error classes
export {
  EbmlVintError,
  EbmlElementTooLargeError,
  EbmlTooManyElementsError,
  EbmlDepthExceededError,
  EbmlTruncatedError,
  EbmlUnknownSizeError,
} from './errors.ts';
