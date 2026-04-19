import { describe, expect, it } from 'vitest';
import { silenceInt16, sineFloat32, sineInt16 } from './audio-synth.ts';

describe('sineInt16', () => {
  it('produces expected sample count', () => {
    const samples = sineInt16(440, { sampleRate: 1000, channels: 1, durationSec: 0.1 });
    expect(samples.length).toBe(100);
  });

  it('interleaves stereo channels', () => {
    const samples = sineInt16(440, { sampleRate: 1000, channels: 2, durationSec: 0.01 });
    expect(samples.length).toBe(20);
    // both channels should hold identical samples
    for (let i = 0; i < samples.length; i += 2) {
      expect(samples[i]).toBe(samples[i + 1]);
    }
  });

  it('respects amplitude', () => {
    const loud = sineInt16(440, { sampleRate: 8000, channels: 1, durationSec: 0.1 }, 1.0);
    const soft = sineInt16(440, { sampleRate: 8000, channels: 1, durationSec: 0.1 }, 0.1);
    const peakLoud = Math.max(...Array.from(loud).map(Math.abs));
    const peakSoft = Math.max(...Array.from(soft).map(Math.abs));
    expect(peakLoud).toBeGreaterThan(peakSoft * 5);
  });
});

describe('silenceInt16', () => {
  it('returns all zeros', () => {
    const samples = silenceInt16({ sampleRate: 100, channels: 2, durationSec: 0.1 });
    expect(samples.length).toBe(20);
    expect(Array.from(samples).every((s) => s === 0)).toBe(true);
  });
});

describe('sineFloat32', () => {
  it('values stay within amplitude bounds', () => {
    const samples = sineFloat32(440, { sampleRate: 8000, channels: 1, durationSec: 0.1 }, 0.5);
    for (const s of samples) {
      expect(Math.abs(s)).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });
});
