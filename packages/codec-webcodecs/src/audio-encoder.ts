import { CodecOperationError, WebCodecsNotSupportedError } from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AudioEncoderOptions {
  readonly config: AudioEncoderConfig;
}

export type EncodedAudioChunkCallback = (
  chunk: EncodedAudioChunk,
  metadata: EncodedAudioChunkMetadata,
) => void;

// ---------------------------------------------------------------------------
// WebCodecsAudioEncoder
// ---------------------------------------------------------------------------

/**
 * Thin wrapper over the browser's AudioEncoder.
 *
 * Usage:
 * ```ts
 * const enc = new WebCodecsAudioEncoder({ config }, (chunk, meta) => { ... });
 * enc.encode(audioData);
 * await enc.flush();
 * enc.close();
 * ```
 */
export class WebCodecsAudioEncoder {
  readonly #encoder: AudioEncoder;
  readonly #onChunk: EncodedAudioChunkCallback;
  #closed = false;
  #encodeError: Error | null = null;

  constructor(options: AudioEncoderOptions, onChunk: EncodedAudioChunkCallback) {
    if (typeof globalThis.AudioEncoder === 'undefined') {
      throw new WebCodecsNotSupportedError();
    }

    this.#onChunk = onChunk;

    this.#encoder = new globalThis.AudioEncoder({
      output: (chunk, metadata) => {
        this.#onChunk(chunk, metadata ?? {});
      },
      error: (err) => {
        this.#encodeError = new CodecOperationError(
          'audio encode',
          err instanceof Error ? err.message : String(err),
          { cause: err },
        );
      },
    });

    this.#encoder.configure(options.config);
  }

  /**
   * Encodes a single AudioData object.
   *
   * @throws {CodecOperationError} if a previous encoding error was recorded.
   */
  encode(data: AudioData): void {
    this.#assertOpen();
    this.#throwIfError();
    this.#encoder.encode(data);
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

  /** Current state of the underlying AudioEncoder. */
  get state(): CodecState {
    return this.#encoder.state;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #assertOpen(): void {
    if (this.#closed) {
      throw new CodecOperationError('audio encode', 'Encoder has already been closed.');
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
