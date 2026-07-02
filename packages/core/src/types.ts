export type Category =
  | 'image'
  | 'audio'
  | 'video'
  | 'subtitle'
  | 'data'
  | 'document'
  | 'archive'
  | 'font'
  | 'email';

export interface FormatDescriptor {
  /** File extension without leading dot, lowercased. e.g. "mp4", "webp" */
  readonly ext: string;
  /** MIME type. e.g. "video/mp4" */
  readonly mime: string;
  /** Coarse category used for routing. */
  readonly category: Category;
  /** Human-readable name. e.g. "MPEG-4 Part 14" */
  readonly description?: string;
}

export interface ProgressEvent {
  /** Percent complete, 0–100. */
  readonly percent: number;
  /** Bytes processed so far (best-effort, may be undefined for streaming). */
  readonly bytesProcessed?: number;
  /** Total bytes expected (best-effort, may be undefined). */
  readonly bytesTotal?: number;
  /** Optional phase label. e.g. "demux", "encode", "mux" */
  readonly phase?: string;
}

export type HardwareAcceleration = 'auto' | 'preferred' | 'required' | 'no';

export interface ConvertOptions {
  /** Target format — either extension string ("mp4") or a FormatDescriptor. */
  readonly format: string | FormatDescriptor;
  /** Codec override. Pass e.g. "h264", "vp9", "mp3". Inferred from format when omitted. */
  readonly codec?: string;
  /** Quality hint, 0–1. Codec-specific meaning. */
  readonly quality?: number;
  /** Hardware acceleration preference. Default "auto". */
  readonly hardwareAcceleration?: HardwareAcceleration;
  /** Progress callback invoked roughly every 100ms or every 1% change. */
  readonly onProgress?: (progress: ProgressEvent) => void;
  /** Abort signal for cancelling in-progress conversion. */
  readonly signal?: AbortSignal;
  /** Explicit input format — extension ("json"), MIME, or descriptor.
   *  Takes precedence over detection. Required for text formats when no
   *  filename is available (JSON/CSV/YAML/… have no magic bytes). */
  readonly inputFormat?: string | FormatDescriptor;
  /** Original filename, used as an extension fallback when magic-byte
   *  detection fails. Auto-derived from File inputs. */
  readonly filename?: string;
}

export interface ConvertResult {
  /** Output data as a Blob. */
  readonly blob: Blob;
  /** Actual format of output (may differ from requested on fallback). */
  readonly format: FormatDescriptor;
  /** Duration of the conversion in milliseconds. */
  readonly durationMs: number;
  /** Backend that produced the output. */
  readonly backend: string;
  /** Whether hardware acceleration was used. */
  readonly hardwareAccelerated: boolean;
}

export interface Backend {
  /** Stable identifier. e.g. "webcodecs", "ffmpeg-wasm", "canvas". */
  readonly name: string;
  /** Returns true if this backend can perform the given conversion. */
  canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean>;
  /** Perform the conversion. */
  convert(input: Blob, output: FormatDescriptor, options: ConvertOptions): Promise<ConvertResult>;
}

export class WebcvtError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WebcvtError';
    this.code = code;
  }
}

export class UnsupportedFormatError extends WebcvtError {
  // `hint` is an optional third arg appended as an extra sentence. Additive: the
  // existing 2-arg call sites keep their exact message (no trailing hint).
  constructor(format: string, direction: 'input' | 'output', hint?: string) {
    super(
      'UNSUPPORTED_FORMAT',
      `Unsupported ${direction} format: "${format}". Install an additional @catlabtech/webcvt-* package or check the format name.${
        hint ? ` ${hint}` : ''
      }`,
    );
    this.name = 'UnsupportedFormatError';
  }
}

export class NoBackendError extends WebcvtError {
  constructor(input: string, output: string) {
    super(
      'NO_BACKEND',
      `No backend can convert ${input} → ${output}. Install a matching @catlabtech/webcvt-backend-* or @catlabtech/webcvt-codec-* package.`,
    );
    this.name = 'NoBackendError';
  }
}
