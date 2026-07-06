import type { WavFile } from '@catlabtech/webcvt-container-wav';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockAudioData } from './_test-helpers/webcodecs.ts';
import {
  type DecodedAudio,
  PlanarAccumulator,
  buildAudioData,
  interleaveInt16,
  wavToDecoded,
} from './pcm.ts';

function int16Samples(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) out.push(view.getInt16(i, true));
  return out;
}

describe('interleaveInt16', () => {
  it('interleaves planar float channels to LE int16 in frame order', () => {
    const decoded: DecodedAudio = {
      sampleRate: 8000,
      numberOfChannels: 2,
      numberOfFrames: 2,
      channels: [new Float32Array([0, 1]), new Float32Array([-1, 0.25])],
    };
    const bytes = interleaveInt16(decoded);
    // Order: ch0f0, ch1f0, ch0f1, ch1f1.
    expect(int16Samples(bytes)).toEqual([0, -32767, 32767, 8192]);
  });

  it('clamps full-scale values without overflow', () => {
    const decoded: DecodedAudio = {
      sampleRate: 8000,
      numberOfChannels: 1,
      numberOfFrames: 3,
      channels: [new Float32Array([2, -2, 1.5])],
    };
    expect(int16Samples(interleaveInt16(decoded))).toEqual([32767, -32768, 32767]);
  });
});

describe('wavToDecoded', () => {
  it('decodes 16-bit interleaved PCM to normalised planar float', () => {
    const pcm = new Uint8Array(6);
    const view = new DataView(pcm.buffer);
    view.setInt16(0, 0, true);
    view.setInt16(2, 16384, true); // +0.5
    view.setInt16(4, -16384, true); // -0.5
    const file: WavFile = {
      format: {
        audioFormat: 1,
        channels: 1,
        sampleRate: 8000,
        bitsPerSample: 16,
        blockAlign: 2,
        byteRate: 16000,
      },
      audioData: pcm,
    };
    const decoded = wavToDecoded(file);
    expect(decoded.numberOfChannels).toBe(1);
    expect(decoded.numberOfFrames).toBe(3);
    expect(decoded.sampleRate).toBe(8000);
    const ch = decoded.channels[0]!;
    expect(ch[0]).toBeCloseTo(0, 5);
    expect(ch[1]).toBeCloseTo(0.5, 4);
    expect(ch[2]).toBeCloseTo(-0.5, 4);
  });

  it('round-trips planar float → int16 → planar float', () => {
    const original: DecodedAudio = {
      sampleRate: 8000,
      numberOfChannels: 2,
      numberOfFrames: 2,
      channels: [new Float32Array([0, 0.5]), new Float32Array([-0.5, 0.25])],
    };
    const audioData = interleaveInt16(original);
    const file: WavFile = {
      format: {
        audioFormat: 1,
        channels: 2,
        sampleRate: 8000,
        bitsPerSample: 16,
        blockAlign: 4,
        byteRate: 32000,
      },
      audioData,
    };
    const decoded = wavToDecoded(file);
    expect(decoded.channels[0]![1]).toBeCloseTo(0.5, 3);
    expect(decoded.channels[1]![0]).toBeCloseTo(-0.5, 3);
  });
});

describe('buildAudioData', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds an f32-planar AudioData window from a DecodedAudio', () => {
    vi.stubGlobal('AudioData', MockAudioData);
    const decoded: DecodedAudio = {
      sampleRate: 48000,
      numberOfChannels: 2,
      numberOfFrames: 4,
      channels: [new Float32Array([0, 1, 2, 3]), new Float32Array([4, 5, 6, 7])],
    };
    const data = buildAudioData(decoded, 1, 2, 1000) as unknown as MockAudioData;
    expect(data.format).toBe('f32-planar');
    expect(data.numberOfChannels).toBe(2);
    expect(data.numberOfFrames).toBe(2);
    expect(data.timestamp).toBe(1000);
    expect(Array.from(data.planes[0]!)).toEqual([1, 2]);
    expect(Array.from(data.planes[1]!)).toEqual([5, 6]);
  });
});

function wavFile(
  audioData: Uint8Array,
  opts: { audioFormat: number; channels: number; bitsPerSample: number },
): WavFile {
  const blockAlign = (opts.channels * opts.bitsPerSample) / 8;
  return {
    format: {
      audioFormat: opts.audioFormat,
      channels: opts.channels,
      sampleRate: 8000,
      bitsPerSample: opts.bitsPerSample,
      blockAlign,
      byteRate: 8000 * blockAlign,
    },
    audioData,
  };
}

describe('wavToDecoded: sample-format branches', () => {
  it('decodes 8-bit unsigned PCM (centered at 128)', () => {
    const pcm = new Uint8Array([128, 192, 64]); // 0, +0.5, -0.5
    const decoded = wavToDecoded(wavFile(pcm, { audioFormat: 1, channels: 1, bitsPerSample: 8 }));
    const ch = decoded.channels[0]!;
    expect(ch[0]).toBeCloseTo(0, 5);
    expect(ch[1]).toBeCloseTo(0.5, 5);
    expect(ch[2]).toBeCloseTo(-0.5, 5);
  });

  it('decodes 24-bit signed PCM with sign extension', () => {
    const pcm = new Uint8Array(6);
    const view = new DataView(pcm.buffer);
    // +0.5 → 0x400000, -0.5 → 0xC00000 (sign-extended).
    view.setUint8(0, 0x00);
    view.setUint8(1, 0x00);
    view.setUint8(2, 0x40); // 0x400000 = 4194304 → /8388608 = 0.5
    view.setUint8(3, 0x00);
    view.setUint8(4, 0x00);
    view.setUint8(5, 0xc0); // 0xC00000 sign-extended → -4194304 → -0.5
    const decoded = wavToDecoded(wavFile(pcm, { audioFormat: 1, channels: 1, bitsPerSample: 24 }));
    const ch = decoded.channels[0]!;
    expect(ch[0]).toBeCloseTo(0.5, 5);
    expect(ch[1]).toBeCloseTo(-0.5, 5);
  });

  it('decodes 32-bit signed integer PCM', () => {
    const pcm = new Uint8Array(4);
    new DataView(pcm.buffer).setInt32(0, 1073741824, true); // +0.5
    const decoded = wavToDecoded(wavFile(pcm, { audioFormat: 1, channels: 1, bitsPerSample: 32 }));
    expect(decoded.channels[0]![0]).toBeCloseTo(0.5, 5);
  });

  it('decodes 32-bit IEEE float PCM', () => {
    const pcm = new Uint8Array(4);
    new DataView(pcm.buffer).setFloat32(0, 0.25, true);
    const decoded = wavToDecoded(wavFile(pcm, { audioFormat: 3, channels: 1, bitsPerSample: 32 }));
    expect(decoded.channels[0]![0]).toBeCloseTo(0.25, 6);
  });

  it('decodes 64-bit IEEE float PCM', () => {
    const pcm = new Uint8Array(8);
    new DataView(pcm.buffer).setFloat64(0, -0.75, true);
    const decoded = wavToDecoded(wavFile(pcm, { audioFormat: 3, channels: 1, bitsPerSample: 64 }));
    expect(decoded.channels[0]![0]).toBeCloseTo(-0.75, 10);
  });

  it('returns 0 for unknown integer bit depths (default case)', () => {
    const pcm = new Uint8Array(8); // 64-bit int is not a handled case → 0
    const decoded = wavToDecoded(wavFile(pcm, { audioFormat: 1, channels: 1, bitsPerSample: 64 }));
    expect(decoded.numberOfFrames).toBe(1);
    expect(decoded.channels[0]![0]).toBe(0);
  });

  it('yields zero frames when the frame size is zero (bitsPerSample 0)', () => {
    const decoded = wavToDecoded(
      wavFile(new Uint8Array(4), { audioFormat: 1, channels: 1, bitsPerSample: 0 }),
    );
    expect(decoded.numberOfFrames).toBe(0);
    expect(decoded.channels[0]!.length).toBe(0);
  });
});

describe('interleaveInt16: missing channel fallback', () => {
  it('substitutes 0 when a requested channel plane is absent', () => {
    const decoded: DecodedAudio = {
      sampleRate: 8000,
      numberOfChannels: 2,
      numberOfFrames: 1,
      channels: [new Float32Array([1])], // only one plane for a 2-channel frame
    };
    const bytes = interleaveInt16(decoded);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(32767); // ch0
    expect(view.getInt16(2, true)).toBe(0); // ch1 absent → 0
  });
});

describe('PlanarAccumulator', () => {
  it('returns silent fallback audio when nothing was added', () => {
    const acc = new PlanarAccumulator();
    const decoded = acc.finish(44100, 2);
    expect(decoded.numberOfFrames).toBe(0);
    expect(decoded.numberOfChannels).toBe(2);
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.channels).toHaveLength(2);
  });

  it('accumulates planes and takes rate/channels from the first chunk', () => {
    const acc = new PlanarAccumulator();
    acc.add([new Float32Array([1, 2]), new Float32Array([3, 4])], 48000);
    acc.add([new Float32Array([5, 6]), new Float32Array([7, 8])], 48000);
    const decoded = acc.finish(8000, 1);
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.numberOfChannels).toBe(2);
    expect(decoded.numberOfFrames).toBe(4);
    expect(Array.from(decoded.channels[0]!)).toEqual([1, 2, 5, 6]);
    expect(Array.from(decoded.channels[1]!)).toEqual([3, 4, 7, 8]);
  });

  it('falls back to channel 0 when a later chunk has fewer planes', () => {
    const acc = new PlanarAccumulator();
    acc.add([new Float32Array([1]), new Float32Array([9])], 48000); // establishes 2 channels
    acc.add([new Float32Array([2])], 48000); // second channel missing → reuse plane 0
    const decoded = acc.finish(8000, 1);
    expect(decoded.numberOfChannels).toBe(2);
    expect(Array.from(decoded.channels[1]!)).toEqual([9, 2]);
  });

  it('tolerates an empty planes array on a later chunk', () => {
    const acc = new PlanarAccumulator();
    acc.add([new Float32Array([1])], 48000);
    acc.add([], 48000); // no planes → planes[0] undefined path
    const decoded = acc.finish(8000, 1);
    expect(decoded.numberOfFrames).toBe(1);
  });
});
