/**
 * @catlabtech/webcvt-container-ts — MPEG-2 Transport Stream demuxer and muxer.
 *
 * Public API surface (minimal — do not re-export internal helpers).
 */

// Parser / serializer entry points.
export { parseTs, type TsFile } from './parser.ts';
export { serializeTs } from './serializer.ts';

// Chunk iterators.
export {
  iterateVideoChunks,
  iterateAudioChunks,
  type EncodedVideoChunkInit,
  type EncodedAudioChunkInit,
} from './chunk-iterator.ts';

// Core types.
export type { TsPacketHeader, TsAdaptationField, TsPacket } from './packet.ts';
export type { TsPsiSection } from './psi.ts';
export type { PatTable, PatEntry } from './pat.ts';
export type { TsProgram, TsProgramStream } from './pmt.ts';
export type { TsPesPacket, TsPesHeader } from './pes.ts';
export type { NalUnit, AvcParamSets } from './nal-conversion.ts';

// NAL conversion utilities.
export {
  splitAnnexBNalUnits,
  annexBToAvcc,
  avccToAnnexB,
  synthesiseAvcDecoderConfig,
  deriveAvcCodecString,
} from './nal-conversion.ts';

// Backend registration.
export { TsBackend, TS_FORMAT } from './backend.ts';

// Typed error classes (exported so callers can catch by type).
export {
  TsInputTooLargeError,
  TsNoSyncByteError,
  TsScrambledNotSupportedError,
  TsReservedAdaptationControlError,
  TsTooManyProgramsError,
  TsMissingPatError,
  TsMissingPmtError,
  TsCorruptStreamError,
  TsPsiCrcError,
  TsTooManyPacketsError,
  TsEncodeNotImplementedError,
  TsPesTooLargeError,
  TsInvalidAdaptationLengthError,
} from './errors.ts';

// Constants (public caps for consumers).
export {
  MAX_INPUT_BYTES,
  MAX_PACKETS,
  MAX_PSI_SECTION_BYTES,
  MAX_ES_PIDS,
  MAX_PROGRAMS,
  MAX_TOTAL_ES_PIDS,
  MAX_PES_BYTES,
  TS_MIME,
  STREAM_TYPE_AVC,
  STREAM_TYPE_AAC_ADTS,
} from './constants.ts';

// ---------------------------------------------------------------------------
// registerTsBackend — explicit opt-in (no auto-registration)
// ---------------------------------------------------------------------------

import type { BackendRegistry } from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { TsBackend } from './backend.ts';

/**
 * Construct a TsBackend and register it with the given registry (or core's
 * defaultRegistry when omitted). Returns the constructed backend so the caller
 * can later unregister it by name (`registry.unregister('container-ts')`).
 *
 * Must be called explicitly by the application — nothing registers on import.
 *
 * @example
 * ```ts
 * import { registerTsBackend } from '@catlabtech/webcvt-container-ts';
 * registerTsBackend(); // registers into core's defaultRegistry
 * ```
 */
export function registerTsBackend(registry: BackendRegistry = defaultRegistry): TsBackend {
  const backend = new TsBackend();
  registry.register(backend);
  return backend;
}
