import { WebcvtError } from '@catlabtech/webcvt-core';

/**
 * Thrown when the current runtime does not expose the WebCodecs API at all
 * (e.g. Node.js without a polyfill, or an older browser).
 */
export class WebCodecsNotSupportedError extends WebcvtError {
  constructor(options?: ErrorOptions) {
    super(
      'WEBCODECS_NOT_SUPPORTED',
      'The WebCodecs API is not available in this runtime. ' +
        'Use a Chromium-based browser (Chrome 94+, Edge 94+) or install a WebCodecs polyfill.',
      options,
    );
    this.name = 'WebCodecsNotSupportedError';
  }
}

/**
 * Thrown when WebCodecs is present but the specific codec + configuration
 * combination is not supported by the current hardware/driver stack.
 */
export class UnsupportedCodecError extends WebcvtError {
  readonly codec: string;

  constructor(codec: string, detail?: string, options?: ErrorOptions) {
    super(
      'UNSUPPORTED_CODEC',
      detail
        ? `Codec "${codec}" is not supported: ${detail}`
        : `Codec "${codec}" is not supported in the current environment.`,
      options,
    );
    this.name = 'UnsupportedCodecError';
    this.codec = codec;
  }
}

/**
 * Thrown when a codec operation (encode / decode) produces an unexpected error
 * that is not covered by the more specific error classes above.
 */
export class CodecOperationError extends WebcvtError {
  constructor(operation: string, detail: string, options?: ErrorOptions) {
    super('CODEC_OPERATION_ERROR', `Codec ${operation} failed: ${detail}`, options);
    this.name = 'CodecOperationError';
  }
}
