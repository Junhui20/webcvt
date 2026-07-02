/**
 * PCM intermediate representation and the AudioData ⇄ planar-float glue.
 *
 * The pipeline normalises every decoded source to planar 32-bit float
 * ({@link DecodedAudio}) — one `Float32Array` per channel. This is the format
 * `AudioData.copyTo('f32-planar')` yields and `new AudioData({format:
 * 'f32-planar'})` accepts, so it bridges the decoder output and the encoder
 * input, and interleaves cleanly to int16 for the WAV sink.
 */

import type { WavFile } from '@catlabtech/webcvt-container-wav';

/** Planar 32-bit-float PCM. `channels[c][f]` is sample `f` of channel `c`. */
export interface DecodedAudio {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  /** Frames (samples per channel). */
  readonly numberOfFrames: number;
  /** One `Float32Array` of length `numberOfFrames` per channel. */
  readonly channels: readonly Float32Array[];
}

// ---------------------------------------------------------------------------
// AudioData → planar float (decode side)
// ---------------------------------------------------------------------------

/** Copy every channel of an `AudioData` out as planar `Float32Array`s. */
export function readAudioDataPlanes(data: AudioData): Float32Array[] {
  const frames = data.numberOfFrames;
  const planes: Float32Array[] = [];
  for (let ch = 0; ch < data.numberOfChannels; ch++) {
    const plane = new Float32Array(frames);
    data.copyTo(plane, { planeIndex: ch, format: 'f32-planar' });
    planes.push(plane);
  }
  return planes;
}

/**
 * Accumulates the planar `AudioData` chunks a decoder emits into a single
 * {@link DecodedAudio}. Channel count / sample rate are taken from the first
 * chunk seen.
 */
export class PlanarAccumulator {
  #perChannel: Float32Array[][] = [];
  #frames = 0;
  #numChannels = 0;
  #sampleRate = 0;

  add(planes: Float32Array[], sampleRate: number): void {
    if (this.#numChannels === 0) {
      this.#numChannels = planes.length;
      this.#sampleRate = sampleRate;
      this.#perChannel = planes.map(() => []);
    }
    for (let ch = 0; ch < this.#numChannels; ch++) {
      this.#perChannel[ch]?.push(planes[ch] ?? planes[0] ?? new Float32Array(0));
    }
    this.#frames += planes[0]?.length ?? 0;
  }

  finish(fallbackSampleRate: number, fallbackChannels: number): DecodedAudio {
    if (this.#numChannels === 0) {
      return {
        sampleRate: fallbackSampleRate,
        numberOfChannels: fallbackChannels,
        numberOfFrames: 0,
        channels: Array.from({ length: fallbackChannels }, () => new Float32Array(0)),
      };
    }
    const channels = this.#perChannel.map((chunks) => concatFloat(chunks, this.#frames));
    return {
      sampleRate: this.#sampleRate,
      numberOfChannels: this.#numChannels,
      numberOfFrames: this.#frames,
      channels,
    };
  }
}

// ---------------------------------------------------------------------------
// WAV raw PCM → planar float (wav is a pcm source; no decoder needed)
// ---------------------------------------------------------------------------

const WAVE_FORMAT_IEEE_FLOAT = 3;

/** Decode a parsed WAV's interleaved PCM into planar float. */
export function wavToDecoded(file: WavFile): DecodedAudio {
  const { format, audioData } = file;
  const ch = Math.max(1, format.channels);
  const bits = format.bitsPerSample;
  const bytesPerSample = bits / 8;
  const frameSize = bytesPerSample * ch;
  const frames = frameSize > 0 ? Math.floor(audioData.length / frameSize) : 0;
  const isFloat = format.audioFormat === WAVE_FORMAT_IEEE_FLOAT;
  const view = new DataView(audioData.buffer, audioData.byteOffset, audioData.byteLength);
  const channels = Array.from({ length: ch }, () => new Float32Array(frames));

  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < ch; c++) {
      const off = f * frameSize + c * bytesPerSample;
      const target = channels[c];
      if (target) target[f] = readSample(view, off, bits, isFloat);
    }
  }
  return { sampleRate: format.sampleRate, numberOfChannels: ch, numberOfFrames: frames, channels };
}

// ---------------------------------------------------------------------------
// Planar float → interleaved int16 (WAV sink)
// ---------------------------------------------------------------------------

/** Interleave planar float to little-endian 16-bit PCM bytes for `serializeWav`. */
export function interleaveInt16(decoded: DecodedAudio): Uint8Array {
  const { numberOfChannels: ch, numberOfFrames: n, channels } = decoded;
  const out = new Uint8Array(n * ch * 2);
  const view = new DataView(out.buffer);
  let pos = 0;
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < ch; c++) {
      view.setInt16(pos, floatToInt16(channels[c]?.[f] ?? 0), true);
      pos += 2;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Planar float → AudioData (encode side)
// ---------------------------------------------------------------------------

/**
 * Build an `AudioData` from a frame window of a {@link DecodedAudio}, in
 * `f32-planar` layout, for feeding an `AudioEncoder`. The encoder takes
 * ownership and closes it.
 */
export function buildAudioData(
  decoded: DecodedAudio,
  startFrame: number,
  frameCount: number,
  timestampUs: number,
): AudioData {
  const ch = decoded.numberOfChannels;
  const data = new Float32Array(ch * frameCount);
  for (let c = 0; c < ch; c++) {
    const plane = decoded.channels[c];
    if (plane) data.set(plane.subarray(startFrame, startFrame + frameCount), c * frameCount);
  }
  return new AudioData({
    format: 'f32-planar',
    sampleRate: decoded.sampleRate,
    numberOfFrames: frameCount,
    numberOfChannels: ch,
    timestamp: timestampUs,
    data,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function concatFloat(chunks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function floatToInt16(v: number): number {
  const s = Math.round(v * 32767);
  return s < -32768 ? -32768 : s > 32767 ? 32767 : s;
}

function readSample(view: DataView, off: number, bits: number, isFloat: boolean): number {
  if (isFloat) {
    return bits === 64 ? view.getFloat64(off, true) : view.getFloat32(off, true);
  }
  switch (bits) {
    case 8:
      return ((view.getUint8(off) - 128) / 128) as number;
    case 16:
      return view.getInt16(off, true) / 32768;
    case 24: {
      const b0 = view.getUint8(off);
      const b1 = view.getUint8(off + 1);
      const b2 = view.getUint8(off + 2);
      let val = b0 | (b1 << 8) | (b2 << 16);
      if (val & 0x800000) val -= 0x1000000; // sign-extend 24-bit
      return val / 8388608;
    }
    case 32:
      return view.getInt32(off, true) / 2147483648;
    default:
      return 0;
  }
}
