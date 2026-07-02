/**
 * Node-safe WebCodecs mocks, mirroring codec-webcodecs' `vi.stubGlobal`
 * approach. Node has no WebCodecs globals, so tests stub `AudioData`,
 * `EncodedAudioChunk`, `AudioDecoder`, and `AudioEncoder` with these plain
 * classes/factories (no `vi` dependency here — tests do the `stubGlobal`).
 */

// ---------------------------------------------------------------------------
// AudioData — planar-float, serves as `new AudioData(init)` and decoder output.
// ---------------------------------------------------------------------------

interface MockAudioDataInit {
  format?: string;
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  timestamp?: number;
  /** Interleaved-by-plane f32 layout, as `new AudioData({format:'f32-planar'})`. */
  data?: ArrayBufferView | ArrayBuffer;
  /** Test shortcut: supply planes directly (decoder output). */
  planes?: Float32Array[];
}

export class MockAudioData {
  readonly format: string;
  readonly sampleRate: number;
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  readonly timestamp: number;
  readonly duration: number;
  readonly planes: Float32Array[];
  closed = false;

  constructor(init: MockAudioDataInit) {
    this.format = init.format ?? 'f32-planar';
    this.sampleRate = init.sampleRate;
    this.numberOfFrames = init.numberOfFrames;
    this.numberOfChannels = init.numberOfChannels;
    this.timestamp = init.timestamp ?? 0;
    this.duration = Math.round((init.numberOfFrames / init.sampleRate) * 1_000_000);
    if (init.planes) {
      this.planes = init.planes;
    } else {
      const src = toFloat32(init.data);
      this.planes = [];
      for (let c = 0; c < this.numberOfChannels; c++) {
        this.planes.push(src.slice(c * this.numberOfFrames, (c + 1) * this.numberOfFrames));
      }
    }
  }

  allocationSize(): number {
    return this.numberOfFrames * 4;
  }

  copyTo(dest: ArrayBufferView | ArrayBuffer, opts: { planeIndex: number }): void {
    const plane = this.planes[opts.planeIndex] ?? new Float32Array(this.numberOfFrames);
    const view =
      dest instanceof Float32Array
        ? dest
        : new Float32Array(
            (dest as ArrayBufferView).buffer ?? (dest as ArrayBuffer),
            (dest as ArrayBufferView).byteOffset ?? 0,
            this.numberOfFrames,
          );
    view.set(plane.subarray(0, this.numberOfFrames));
  }

  close(): void {
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// EncodedAudioChunk — decode input (`new EncodedAudioChunk`) + encoder output.
// ---------------------------------------------------------------------------

interface MockEncodedChunkInit {
  type: 'key' | 'delta';
  timestamp: number;
  duration?: number;
  data: ArrayBufferView | ArrayBuffer;
}

export class MockEncodedAudioChunk {
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly duration: number;
  readonly byteLength: number;
  readonly #data: Uint8Array;

  constructor(init: MockEncodedChunkInit) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration ?? 0;
    this.#data = toUint8(init.data);
    this.byteLength = this.#data.length;
  }

  copyTo(dest: ArrayBufferView | ArrayBuffer): void {
    const view =
      dest instanceof Uint8Array
        ? dest
        : new Uint8Array((dest as ArrayBufferView).buffer ?? (dest as ArrayBuffer));
    view.set(this.#data);
  }
}

// ---------------------------------------------------------------------------
// AudioDecoder factory
// ---------------------------------------------------------------------------

export interface DecoderControls {
  readonly instances: MockDecoderInstance[];
}

export interface MockDecoderInstance {
  config?: AudioDecoderConfig;
  closed: boolean;
}

export interface DecoderOptions {
  /** Emit planes (one AudioData) per `decode()` call. `null` emits nothing. */
  emit?: (callIndex: number, config: AudioDecoderConfig | undefined) => Float32Array[] | null;
  /** Invoked at the start of each `decode()` call (e.g. to trigger an abort). */
  onDecode?: (callIndex: number) => void;
}

/**
 * Build a mock `AudioDecoder` class for `vi.stubGlobal('AudioDecoder', …)`.
 * Returns the class plus a `controls.instances` array for assertions
 * (e.g. `instances[0].closed`).
 */
export function makeAudioDecoderClass(opts: DecoderOptions = {}): {
  DecoderClass: typeof MockAudioDecoderBase;
  controls: DecoderControls;
} {
  const instances: MockDecoderInstance[] = [];

  class MockAudioDecoder extends MockAudioDecoderBase {
    constructor(init: { output: (d: MockAudioData) => void; error: (e: unknown) => void }) {
      super(init, opts, instances);
    }
  }
  return { DecoderClass: MockAudioDecoder, controls: { instances } };
}

class MockAudioDecoderBase {
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
  decodeQueueSize = 0;
  readonly #output: (d: MockAudioData) => void;
  readonly #opts: DecoderOptions;
  readonly #self: MockDecoderInstance;
  #config: AudioDecoderConfig | undefined;
  #calls = 0;

  constructor(
    init: { output: (d: MockAudioData) => void; error: (e: unknown) => void },
    opts: DecoderOptions,
    instances: MockDecoderInstance[],
  ) {
    this.#output = init.output;
    this.#opts = opts;
    this.#self = { closed: false };
    instances.push(this.#self);
  }

  configure(config: AudioDecoderConfig): void {
    this.#config = config;
    this.#self.config = config;
    this.state = 'configured';
  }

  decode(_chunk: unknown): void {
    const i = this.#calls++;
    this.#opts.onDecode?.(i);
    const planes = this.#opts.emit ? this.#opts.emit(i, this.#config) : [new Float32Array([0, 0])];
    if (planes) {
      const frames = planes[0]?.length ?? 0;
      this.#output(
        new MockAudioData({
          sampleRate: this.#config?.sampleRate ?? 48_000,
          numberOfChannels: planes.length,
          numberOfFrames: frames,
          planes,
        }),
      );
    }
  }

  async flush(): Promise<void> {}

  close(): void {
    this.state = 'closed';
    this.#self.closed = true;
  }
}

// ---------------------------------------------------------------------------
// AudioEncoder factory
// ---------------------------------------------------------------------------

export interface EncoderControls {
  readonly instances: MockEncoderInstance[];
}

export interface MockEncoderInstance {
  config?: AudioEncoderConfig;
  closed: boolean;
  encodeCount: number;
}

export interface EncoderOutputSpec {
  data: Uint8Array;
  timestamp: number;
  duration: number;
  /** Supplied on the first chunk's metadata as `decoderConfig.description`. */
  description?: Uint8Array;
}

export interface EncoderOptions {
  /** Produce an output chunk per `encode()` call. `null` emits nothing. */
  onEncode?: (audioData: MockAudioData, index: number) => EncoderOutputSpec | null;
}

/** Build a mock `AudioEncoder` class for `vi.stubGlobal('AudioEncoder', …)`. */
export function makeAudioEncoderClass(opts: EncoderOptions = {}): {
  EncoderClass: typeof MockAudioEncoderBase;
  controls: EncoderControls;
} {
  const instances: MockEncoderInstance[] = [];
  class MockAudioEncoder extends MockAudioEncoderBase {
    constructor(init: {
      output: (c: MockEncodedAudioChunk, m: unknown) => void;
      error: (e: unknown) => void;
    }) {
      super(init, opts, instances);
    }
  }
  return { EncoderClass: MockAudioEncoder, controls: { instances } };
}

class MockAudioEncoderBase {
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
  encodeQueueSize = 0;
  readonly #output: (c: MockEncodedAudioChunk, m: unknown) => void;
  readonly #opts: EncoderOptions;
  readonly #self: MockEncoderInstance;
  #config: AudioEncoderConfig | undefined;

  constructor(
    init: { output: (c: MockEncodedAudioChunk, m: unknown) => void; error: (e: unknown) => void },
    opts: EncoderOptions,
    instances: MockEncoderInstance[],
  ) {
    this.#output = init.output;
    this.#opts = opts;
    this.#self = { closed: false, encodeCount: 0 };
    instances.push(this.#self);
  }

  configure(config: AudioEncoderConfig): void {
    this.#config = config;
    this.#self.config = config;
    this.state = 'configured';
  }

  encode(audioData: MockAudioData): void {
    const index = this.#self.encodeCount++;
    const spec = this.#opts.onEncode
      ? this.#opts.onEncode(audioData, index)
      : defaultChunk(audioData, index);
    if (spec) {
      const chunk = new MockEncodedAudioChunk({
        type: 'key',
        timestamp: spec.timestamp,
        duration: spec.duration,
        data: spec.data,
      });
      const metadata =
        index === 0 && spec.description
          ? { decoderConfig: { codec: this.#config?.codec ?? '', description: spec.description } }
          : {};
      this.#output(chunk, metadata);
    }
    // Note: the WebCodecsAudioEncoder wrapper closes the AudioData in `finally`.
  }

  async flush(): Promise<void> {}

  close(): void {
    this.state = 'closed';
    this.#self.closed = true;
  }
}

// ---------------------------------------------------------------------------
// VideoFrame — decoder output / encoder input. Tracks close() discipline.
// ---------------------------------------------------------------------------

interface MockVideoFrameInit {
  timestamp: number;
  duration?: number;
  codedWidth?: number;
  codedHeight?: number;
  /** Test tag so a chunk can echo which frame it came from. */
  tag?: number;
}

export class MockVideoFrame {
  readonly timestamp: number;
  readonly duration: number;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly format = 'I420';
  readonly tag: number;
  closed = false;

  constructor(init: MockVideoFrameInit) {
    this.timestamp = init.timestamp;
    this.duration = init.duration ?? 0;
    this.codedWidth = init.codedWidth ?? 0;
    this.codedHeight = init.codedHeight ?? 0;
    this.tag = init.tag ?? 0;
  }

  close(): void {
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// EncodedVideoChunk — decode input (`new EncodedVideoChunk`) + encoder output.
// ---------------------------------------------------------------------------

interface MockEncodedVideoChunkInit {
  type: 'key' | 'delta';
  timestamp: number;
  duration?: number;
  data: ArrayBufferView | ArrayBuffer;
}

export class MockEncodedVideoChunk {
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly duration: number;
  readonly byteLength: number;
  readonly #data: Uint8Array;

  constructor(init: MockEncodedVideoChunkInit) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration ?? 0;
    this.#data = toUint8(init.data);
    this.byteLength = this.#data.length;
  }

  copyTo(dest: ArrayBufferView | ArrayBuffer): void {
    const view =
      dest instanceof Uint8Array
        ? dest
        : new Uint8Array((dest as ArrayBufferView).buffer ?? (dest as ArrayBuffer));
    view.set(this.#data);
  }
}

// ---------------------------------------------------------------------------
// VideoDecoder factory
// ---------------------------------------------------------------------------

export interface VideoDecoderControls {
  readonly instances: MockVideoCodecInstance[];
  /** Every VideoFrame the mock has emitted (for close() discipline assertions). */
  readonly frames: MockVideoFrame[];
}

export interface MockVideoCodecInstance {
  config?: VideoDecoderConfig | VideoEncoderConfig;
  closed: boolean;
}

export interface VideoDecoderOptions {
  /** Emit a frame per decode() call; return null to emit nothing. */
  emit?: (callIndex: number, chunk: MockEncodedVideoChunk) => MockVideoFrame | null;
  onDecode?: (callIndex: number) => void;
}

export function makeVideoDecoderClass(opts: VideoDecoderOptions = {}): {
  DecoderClass: typeof MockVideoDecoderBase;
  controls: VideoDecoderControls;
} {
  const instances: MockVideoCodecInstance[] = [];
  const frames: MockVideoFrame[] = [];
  class MockVideoDecoder extends MockVideoDecoderBase {
    constructor(init: { output: (f: MockVideoFrame) => void; error: (e: unknown) => void }) {
      super(init, opts, instances, frames);
    }
  }
  return { DecoderClass: MockVideoDecoder, controls: { instances, frames } };
}

class MockVideoDecoderBase {
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
  decodeQueueSize = 0;
  readonly #output: (f: MockVideoFrame) => void;
  readonly #opts: VideoDecoderOptions;
  readonly #self: MockVideoCodecInstance;
  readonly #frames: MockVideoFrame[];
  #config: VideoDecoderConfig | undefined;
  #calls = 0;

  constructor(
    init: { output: (f: MockVideoFrame) => void; error: (e: unknown) => void },
    opts: VideoDecoderOptions,
    instances: MockVideoCodecInstance[],
    frames: MockVideoFrame[],
  ) {
    this.#output = init.output;
    this.#opts = opts;
    this.#frames = frames;
    this.#self = { closed: false };
    instances.push(this.#self);
  }

  configure(config: VideoDecoderConfig): void {
    this.#config = config;
    this.#self.config = config;
    this.state = 'configured';
  }

  decode(chunk: MockEncodedVideoChunk): void {
    const i = this.#calls++;
    this.#opts.onDecode?.(i);
    const frame = this.#opts.emit
      ? this.#opts.emit(i, chunk)
      : new MockVideoFrame({
          timestamp: chunk.timestamp,
          duration: chunk.duration,
          codedWidth: this.#config?.codedWidth ?? 0,
          codedHeight: this.#config?.codedHeight ?? 0,
          tag: i,
        });
    if (frame) {
      this.#frames.push(frame);
      this.#output(frame);
    }
  }

  async flush(): Promise<void> {}

  close(): void {
    this.state = 'closed';
    this.#self.closed = true;
  }
}

// ---------------------------------------------------------------------------
// VideoEncoder factory
// ---------------------------------------------------------------------------

export interface VideoEncoderControls {
  readonly instances: MockVideoEncoderInstance[];
}

export interface MockVideoEncoderInstance {
  config?: VideoEncoderConfig;
  closed: boolean;
  encodeCount: number;
  /** keyFrame flag captured per encode() call. */
  keyFrames: boolean[];
}

export interface VideoEncoderOutputSpec {
  data: Uint8Array;
  /** Defaults to the frame timestamp. */
  timestamp?: number;
  duration?: number;
  /** Defaults to the requested keyFrame flag. */
  type?: 'key' | 'delta';
}

export interface VideoEncoderOptions {
  onEncode?: (frame: MockVideoFrame, index: number) => VideoEncoderOutputSpec | null;
}

export function makeVideoEncoderClass(opts: VideoEncoderOptions = {}): {
  EncoderClass: typeof MockVideoEncoderBase;
  controls: VideoEncoderControls;
} {
  const instances: MockVideoEncoderInstance[] = [];
  class MockVideoEncoder extends MockVideoEncoderBase {
    constructor(init: {
      output: (c: MockEncodedVideoChunk, m: unknown) => void;
      error: (e: unknown) => void;
    }) {
      super(init, opts, instances);
    }
  }
  return { EncoderClass: MockVideoEncoder, controls: { instances } };
}

class MockVideoEncoderBase {
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
  encodeQueueSize = 0;
  readonly #output: (c: MockEncodedVideoChunk, m: unknown) => void;
  readonly #opts: VideoEncoderOptions;
  readonly #self: MockVideoEncoderInstance;
  #config: VideoEncoderConfig | undefined;

  constructor(
    init: { output: (c: MockEncodedVideoChunk, m: unknown) => void; error: (e: unknown) => void },
    opts: VideoEncoderOptions,
    instances: MockVideoEncoderInstance[],
  ) {
    this.#output = init.output;
    this.#opts = opts;
    this.#self = { closed: false, encodeCount: 0, keyFrames: [] };
    instances.push(this.#self);
  }

  configure(config: VideoEncoderConfig): void {
    this.#config = config;
    this.#self.config = config;
    this.state = 'configured';
  }

  // The real VideoEncoder does NOT close the frame — the WebCodecsVideoEncoder
  // wrapper does (in a finally). So this mock must not close it either.
  encode(frame: MockVideoFrame, options?: { keyFrame?: boolean }): void {
    const index = this.#self.encodeCount++;
    const keyFrame = options?.keyFrame === true;
    this.#self.keyFrames.push(keyFrame);
    const spec = this.#opts.onEncode
      ? this.#opts.onEncode(frame, index)
      : defaultVideoChunk(frame, index, keyFrame);
    if (spec) {
      const chunk = new MockEncodedVideoChunk({
        type: spec.type ?? (keyFrame ? 'key' : 'delta'),
        timestamp: spec.timestamp ?? frame.timestamp,
        duration: spec.duration ?? frame.duration,
        data: spec.data,
      });
      this.#output(chunk, { decoderConfig: { codec: this.#config?.codec ?? '' } });
    }
  }

  async flush(): Promise<void> {}

  close(): void {
    this.state = 'closed';
    this.#self.closed = true;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultVideoChunk(
  frame: MockVideoFrame,
  index: number,
  keyFrame: boolean,
): VideoEncoderOutputSpec {
  return {
    data: new Uint8Array([index & 0xff, keyFrame ? 0x01 : 0x00, 0x9d, 0x01]),
    timestamp: frame.timestamp,
    duration: frame.duration,
    type: keyFrame ? 'key' : 'delta',
  };
}

function defaultChunk(audioData: MockAudioData, index: number): EncoderOutputSpec {
  // A small deterministic opus-ish packet; content is opaque to the muxers.
  return {
    data: new Uint8Array([index & 0xff, 0xaa, 0xbb, 0xcc]),
    timestamp: audioData.timestamp,
    duration: audioData.duration,
  };
}

function toFloat32(data: ArrayBufferView | ArrayBuffer | undefined): Float32Array {
  if (!data) return new Float32Array(0);
  if (data instanceof Float32Array) return data;
  if (ArrayBuffer.isView(data)) {
    return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  }
  return new Float32Array(data);
}

function toUint8(data: ArrayBufferView | ArrayBuffer): Uint8Array {
  if (data instanceof Uint8Array) return data.slice();
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  }
  return new Uint8Array(data).slice();
}
