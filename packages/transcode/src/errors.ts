/**
 * Typed error classes for @catlabtech/webcvt-transcode.
 *
 * All extend core's {@link WebcvtError} with a `TRANSCODE_`-prefixed code, so
 * callers can catch by `instanceof` or match on `.code`. Never throw a bare
 * `Error` from this package.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/**
 * Thrown when the requested conversion is not in the transcode backend's
 * capability set (off-matrix pair, or a codec whose runtime probe failed).
 * `convert()` should never be reached for an unsupported pair — `canHandle`
 * gates it — but this guards the defensive path.
 */
export class TranscodeUnsupportedError extends WebcvtError {
  constructor(from: string, to: string) {
    super(
      'TRANSCODE_UNSUPPORTED',
      `Transcode backend cannot convert ${from} → ${to}. This pair is not in the v1 matrix, or the required WebCodecs decoder/encoder is unavailable in this runtime.`,
    );
    this.name = 'TranscodeUnsupportedError';
  }
}

/**
 * Thrown when the input Blob exceeds the buffer-all input cap. The whole
 * pipeline is buffer-all today (every serializer takes a complete in-memory
 * model), so a hard cap protects against OOM.
 */
export class TranscodeInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'TRANSCODE_INPUT_TOO_LARGE',
      `Transcode input is ${size} bytes; maximum supported is ${max} bytes.`,
    );
    this.name = 'TranscodeInputTooLargeError';
  }
}

/** Thrown when demuxing the input container fails or yields no audio. */
export class TranscodeDemuxError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('TRANSCODE_DEMUX_FAILED', `Transcode demux failed: ${message}`, options);
    this.name = 'TranscodeDemuxError';
  }
}

/** Wraps a decode/encode failure surfaced by codec-webcodecs. */
export class TranscodeCodecError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('TRANSCODE_CODEC_ERROR', `Transcode codec error: ${message}`, options);
    this.name = 'TranscodeCodecError';
  }
}

/** Thrown when muxing the encoded output container fails. */
export class TranscodeMuxError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('TRANSCODE_MUX_FAILED', `Transcode mux failed: ${message}`, options);
    this.name = 'TranscodeMuxError';
  }
}
