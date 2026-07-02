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
  CONTAINER_INPUTS,
  VIDEO_TARGETS,
  CONTAINER_AUDIO_CODEC,
  CONTAINER_VIDEO_CODEC,
  MAX_INPUT_BYTES,
  DEFAULT_QUALITY,
  resolveBitrate,
  resolveVideoBitrate,
  matrixKey,
  inputCodecFor,
  outputTargetFor,
  containerFamilyFor,
  videoTargetFor,
  type SideCodec,
  type VideoSideCodec,
  type OutputContainer,
  type OutputTarget,
  type ContainerFamily,
  type VideoTarget,
} from './matrix.ts';
