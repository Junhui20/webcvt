import { CodecOperationError, WebCodecsNotSupportedError } from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AudioDecoderOptions {
  readonly config: AudioDecoderConfig;
}

export type DecodedAudioDataCallback = (data: AudioData) => void;

// ---------------------------------------------------------------------------
// WebCodecsAudioDecoder
// ---------------------------------------------------------------------------

/**
 * Thin wrapper over the browser's AudioDecoder.
 *
 * Usage:
 * ```ts
 * const dec = new WebCodecsAudioDecoder({ config }, (data) => { ... });
 * dec.decode(chunk);
 * await dec.flush();
 * dec.close();
 * ```
 */
export class WebCodecsAudioDecoder {
  readonly #decoder: AudioDecoder;
  readonly #onData: DecodedAudioDataCallback;
  #closed = false;
  #decodeError: Error | null = null;

  constructor(options: AudioDecoderOptions, onData: DecodedAudioDataCallback) {
    if (typeof globalThis.AudioDecoder === 'undefined') {
      throw new WebCodecsNotSupportedError();
    }

    this.#onData = onData;

    this.#decoder = new globalThis.AudioDecoder({
      output: (data) => {
        this.#onData(data);
      },
      error: (err) => {
        this.#decodeError = new CodecOperationError(
          'audio decode',
          err instanceof Error ? err.message : String(err),
          { cause: err },
        );
      },
    });

    this.#decoder.configure(options.config);
  }

  /**
   * Decodes a single EncodedAudioChunk.
   *
   * @throws {CodecOperationError} if a previous decoding error was recorded.
   */
  decode(chunk: EncodedAudioChunk): void {
    this.#assertOpen();
    this.#throwIfError();
    this.#decoder.decode(chunk);
  }

  /**
   * Flushes all pending decodes. Resolves after all output AudioData objects
   * have been delivered to the onData callback.
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

  /** Current state of the underlying AudioDecoder. */
  get state(): CodecState {
    return this.#decoder.state;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #assertOpen(): void {
    if (this.#closed) {
      throw new CodecOperationError('audio decode', 'Decoder has already been closed.');
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
