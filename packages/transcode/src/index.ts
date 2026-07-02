/**
 * @catlabtech/webcvt-transcode — WebCodecs-first audio transcode backend.
 *
 * Performs real cross-format audio conversion (any decodable audio → wav,
 * opus-in-ogg, opus-in-webm, aac-ADTS, flac) by chaining
 * demux → decode → encode → mux over the container packages and
 * `codec-webcodecs`. No ffmpeg.wasm, no SharedArrayBuffer / cross-origin
 * isolation required.
 *
 * Nothing registers on import — call {@link registerTranscodeBackend} explicitly
 * (opt-in, tree-shakeable). See docs/design-notes/transcode.md.
 */

export { TranscodeBackend, registerTranscodeBackend } from './backend.ts';

export {
  TranscodeUnsupportedError,
  TranscodeInputTooLargeError,
  TranscodeDemuxError,
  TranscodeCodecError,
  TranscodeMuxError,
} from './errors.ts';

export {
  TRANSCODE_MATRIX,
  INPUT_CODECS,
  OUTPUT_TARGETS,
  MAX_INPUT_BYTES,
  DEFAULT_QUALITY,
  resolveBitrate,
  matrixKey,
  inputCodecFor,
  outputTargetFor,
  type SideCodec,
  type OutputContainer,
  type OutputTarget,
} from './matrix.ts';
