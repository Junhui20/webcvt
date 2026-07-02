import type { WavFile } from '@catlabtech/webcvt-container-wav';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockAudioData } from './_test-helpers/webcodecs.ts';
import { type DecodedAudio, buildAudioData, interleaveInt16, wavToDecoded } from './pcm.ts';

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
