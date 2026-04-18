import { describe, expect, it } from 'vitest';
import { detectCapabilities } from './capability.ts';

describe('detectCapabilities', () => {
  it('returns a full Capabilities object', () => {
    const caps = detectCapabilities();
    expect(caps).toHaveProperty('webCodecs');
    expect(caps).toHaveProperty('videoEncoder');
    expect(caps).toHaveProperty('videoDecoder');
    expect(caps).toHaveProperty('audioEncoder');
    expect(caps).toHaveProperty('audioDecoder');
    expect(caps).toHaveProperty('offscreenCanvas');
    expect(caps).toHaveProperty('compressionStream');
    expect(caps).toHaveProperty('decompressionStream');
    expect(caps).toHaveProperty('webWorker');
    expect(caps).toHaveProperty('sharedArrayBuffer');
  });

  it('all fields are booleans', () => {
    const caps = detectCapabilities();
    for (const value of Object.values(caps)) {
      expect(typeof value).toBe('boolean');
    }
  });

  it('webCodecs reflects VideoEncoder/AudioEncoder availability', () => {
    const caps = detectCapabilities();
    expect(caps.webCodecs).toBe(caps.videoEncoder || caps.audioEncoder);
  });
});
