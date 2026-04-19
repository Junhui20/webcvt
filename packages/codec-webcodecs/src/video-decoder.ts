import { CodecOperationError, WebCodecsNotSupportedError } from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VideoDecoderOptions {
  readonly config: VideoDecoderConfig;
}

export type DecodedVideoFrameCallback = (frame: VideoFrame) => void;

// ---------------------------------------------------------------------------
// WebCodecsVideoDecoder
// ---------------------------------------------------------------------------

/**
 * Thin wrapper over the browser's VideoDecoder.
 *
 * Usage:
 * ```ts
 * const dec = new WebCodecsVideoDecoder({ config }, (frame) => { ... });
 * dec.decode(chunk);
 * await dec.flush();
 * dec.close();
 * ```
 */
export class WebCodecsVideoDecoder {
  readonly #decoder: VideoDecoder;
  readonly #onFrame: DecodedVideoFrameCallback;
  #closed = false;
  #decodeError: Error | null = null;

  constructor(options: VideoDecoderOptions, onFrame: DecodedVideoFrameCallback) {
    if (typeof globalThis.VideoDecoder === 'undefined') {
      throw new WebCodecsNotSupportedError();
    }

    this.#onFrame = onFrame;

    this.#decoder = new globalThis.VideoDecoder({
      output: (frame) => {
        this.#onFrame(frame);
      },
      error: (err) => {
        this.#decodeError = new CodecOperationError(
          'video decode',
          err instanceof Error ? err.message : String(err),
          { cause: err },
        );
      },
    });

    this.#decoder.configure(options.config);
  }

  /**
   * Decodes a single EncodedVideoChunk.
   *
   * @throws {CodecOperationError} if a previous decoding error was recorded.
   */
  decode(chunk: EncodedVideoChunk): void {
    this.#assertOpen();
    this.#throwIfError();
    this.#decoder.decode(chunk);
  }

  /**
   * Flushes all pending decodes. Resolves after all output frames have been
   * delivered to the onFrame callback.
   *
   * @throws {CodecOperationError} if a previous decoding error was recorded.
   */
  async flush(): Promise<void> {
    this.#assertOpen();
    await this.#decoder.flush();
    this.#throwIfError();
  }

  /** Releases underlying codec resources. Safe to call multiple times. */
  close(): void {
    if (!this.#closed) {
      this.#closed = true;
      this.#decoder.close();
    }
  }

  /** Number of decode requests that have been queued but not yet processed. */
  get decodeQueueSize(): number {
    return this.#decoder.decodeQueueSize;
  }

  /** Current state of the underlying VideoDecoder. */
  get state(): CodecState {
    return this.#decoder.state;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #assertOpen(): void {
    if (this.#closed) {
      throw new CodecOperationError('video decode', 'Decoder has already been closed.');
    }
  }

  #throwIfError(): void {
    if (this.#decodeError !== null) {
      const err = this.#decodeError;
      this.#decodeError = null;
      throw err;
    }
  }
}
