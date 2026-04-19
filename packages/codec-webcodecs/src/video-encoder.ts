import { CodecOperationError, WebCodecsNotSupportedError } from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VideoEncoderOptions {
  readonly config: VideoEncoderConfig;
  /** Maximum number of encoded chunks to buffer before back-pressure applies. */
  readonly queueSize?: number;
}

export type EncodedVideoChunkCallback = (
  chunk: EncodedVideoChunk,
  metadata: EncodedVideoChunkMetadata,
) => void;

// ---------------------------------------------------------------------------
// WebCodecsVideoEncoder
// ---------------------------------------------------------------------------

/**
 * Thin wrapper over the browser's VideoEncoder.
 *
 * Usage:
 * ```ts
 * const enc = new WebCodecsVideoEncoder({ config }, (chunk, meta) => { ... });
 * await enc.encode(frame);
 * await enc.flush();
 * enc.close();
 * ```
 */
export class WebCodecsVideoEncoder {
  readonly #encoder: VideoEncoder;
  readonly #onChunk: EncodedVideoChunkCallback;
  #closed = false;
  #encodeError: Error | null = null;

  constructor(options: VideoEncoderOptions, onChunk: EncodedVideoChunkCallback) {
    if (typeof globalThis.VideoEncoder === 'undefined') {
      throw new WebCodecsNotSupportedError();
    }

    this.#onChunk = onChunk;

    this.#encoder = new globalThis.VideoEncoder({
      output: (chunk, metadata) => {
        this.#onChunk(chunk, metadata ?? {});
      },
      error: (err) => {
        this.#encodeError = new CodecOperationError(
          'video encode',
          err instanceof Error ? err.message : String(err),
          { cause: err },
        );
      },
    });

    this.#encoder.configure(options.config);
  }

  /**
   * Encodes a single VideoFrame. The frame is closed after encoding regardless
   * of whether encoding succeeds, matching WebCodecs ownership semantics.
   *
   * @throws {CodecOperationError} if a previous encoding error was recorded.
   */
  encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void {
    this.#assertOpen();
    this.#throwIfError();
    this.#encoder.encode(frame, options);
  }

  /**
   * Flushes all pending encodes. Resolves after all output chunks have been
   * delivered to the onChunk callback.
   *
   * @throws {CodecOperationError} if a previous encoding error was recorded.
   */
  async flush(): Promise<void> {
    this.#assertOpen();
    await this.#encoder.flush();
    this.#throwIfError();
  }

  /** Releases underlying codec resources. Safe to call multiple times. */
  close(): void {
    if (!this.#closed) {
      this.#closed = true;
      this.#encoder.close();
    }
  }

  /** Number of encode requests that have been queued but not yet processed. */
  get encodeQueueSize(): number {
    return this.#encoder.encodeQueueSize;
  }

  /** Current state of the underlying VideoEncoder. */
  get state(): CodecState {
    return this.#encoder.state;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #assertOpen(): void {
    if (this.#closed) {
      throw new CodecOperationError('video encode', 'Encoder has already been closed.');
    }
  }

  #throwIfError(): void {
    if (this.#encodeError !== null) {
      const err = this.#encodeError;
      this.#encodeError = null;
      throw err;
    }
  }
}
