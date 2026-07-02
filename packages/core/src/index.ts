export {
  type Category,
  type FormatDescriptor,
  type ProgressEvent,
  type HardwareAcceleration,
  type ConvertOptions,
  type ConvertResult,
  type Backend,
  WebcvtError,
  UnsupportedFormatError,
  NoBackendError,
} from './types.ts';

export { InputTooLargeError, EncodeNotImplementedError } from './errors.ts';
export {
  RoundTripBackend,
  type RoundTripBackendConfig,
  type RoundTripProgressStep,
  type RoundTripSizeGuard,
  type CanHandleMode,
} from './round-trip-backend.ts';

export { findByExt, findByMime, resolveFormat, knownFormats } from './formats.ts';
export { detectFormat, detectFormatWithHint } from './detect.ts';
export { type Capabilities, detectCapabilities } from './capability.ts';
export { BackendRegistry, defaultRegistry } from './registry.ts';
export { convert, type ConvertContext } from './convert.ts';
export {
  convertBatch,
  type BatchItem,
  type BatchItemResult,
  type ConvertBatchOptions,
} from './convert-batch.ts';
