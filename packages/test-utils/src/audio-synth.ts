/**
 * Synthetic audio sample generators for unit tests.
 *
 * These produce raw PCM data without any container — wrap them with the
 * appropriate container muxer in tests. Generating sine waves, silence,
 * and impulse trains lets us avoid shipping large audio fixtures while
 * still exercising the muxer/codec edge cases.
 */

export interface PcmOptions {
  /** Sample rate in Hz. e.g. 44100, 48000 */
  readonly sampleRate: number;
  /** Number of channels. 1 = mono, 2 = stereo */
  readonly channels: number;
  /** Duration in seconds */
  readonly durationSec: number;
}

/**
 * Generate a sine wave as Int16 little-endian PCM samples.
 * Channels are interleaved (L, R, L, R, ...).
 *
 * @param frequency Tone frequency in Hz (e.g., 440 for A4)
 * @param amplitude 0–1 (1 = full scale)
 */
export function sineInt16(frequency: number, options: PcmOptions, amplitude = 0.5): Int16Array {
  const { sampleRate, channels, durationSec } = options;
  const numFrames = Math.floor(sampleRate * durationSec);
  const out = new Int16Array(numFrames * channels);
  const peak = Math.floor(32767 * amplitude);
  for (let i = 0; i < numFrames; i += 1) {
    const sample = Math.round(peak * Math.sin((2 * Math.PI * frequency * i) / sampleRate));
    for (let c = 0; c < channels; c += 1) {
      out[i * channels + c] = sample;
    }
  }
  return out;
}

/**
 * Generate silent Int16 PCM (all zeros). Useful for testing muxers without
 * worrying about codec output.
 */
export function silenceInt16(options: PcmOptions): Int16Array {
  return new Int16Array(Math.floor(options.sampleRate * options.durationSec) * options.channels);
}

/**
 * Generate a sine wave as Float32 PCM (range -1 to 1). Used by WebCodecs
 * AudioData and many AAC encoders.
 */
export function sineFloat32(frequency: number, options: PcmOptions, amplitude = 0.5): Float32Array {
  const { sampleRate, channels, durationSec } = options;
  const numFrames = Math.floor(sampleRate * durationSec);
  const out = new Float32Array(numFrames * channels);
  for (let i = 0; i < numFrames; i += 1) {
    const sample = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    for (let c = 0; c < channels; c += 1) {
      out[i * channels + c] = sample;
    }
  }
  return out;
}
