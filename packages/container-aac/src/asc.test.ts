/**
 * Tests for the AudioSpecificConfig builder (asc.ts).
 *
 * Covers design-note test case:
 * - builds 5-byte AudioSpecificConfig for AAC-LC stereo 44100
 */

import { describe, expect, it } from 'vitest';
import { buildAudioSpecificConfig } from './asc.ts';
import { AdtsInvalidProfileError } from './errors.ts';
import type { AdtsHeader } from './header.ts';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeHeader(
  profile: AdtsHeader['profile'],
  sfi: number,
  channelConfig: AdtsHeader['channelConfiguration'],
): AdtsHeader {
  const sampleRates: Record<number, number> = {
    4: 44100,
    3: 48000,
    5: 32000,
  };
  return {
    mpegVersion: 4,
    profile,
    sampleRate: sampleRates[sfi] ?? 44100,
    sampleRateIndex: sfi,
    channelConfiguration: channelConfig,
    frameBytes: 100,
    hasCrc: false,
    bufferFullness: 0x7ff,
    rawBlocks: 0,
  };
}

// ---------------------------------------------------------------------------
// Design-note test cases
// ---------------------------------------------------------------------------

describe('builds 5-byte AudioSpecificConfig for AAC-LC stereo 44100', () => {
  it('returns a 5-byte Uint8Array', () => {
    const h = makeHeader('LC', 4, 2);
    const asc = buildAudioSpecificConfig(h);
    expect(asc).toBeInstanceOf(Uint8Array);
    expect(asc.length).toBe(5);
  });

  it('encodes audio_object_type=2 (LC) correctly in top 5 bits of byte 0', () => {
    // audio_object_type = LC+1 = 2 = 0b00010
    // byte0[7:3] = 0b00010 -> 0x10 at top half with sfi=4(0b0100) giving byte0[2:0] = 0b010
    // byte0 = 0b00010_010 = 0x12
    const h = makeHeader('LC', 4, 2);
    const asc = buildAudioSpecificConfig(h);
    // Verify the audio_object_type is in bits [7:3] of byte 0
    const aot = (asc[0]! >> 3) & 0x1f;
    expect(aot).toBe(2); // LC = 2
  });

  it('encodes sampling_frequency_index=4 (44100 Hz) across bytes 0-1', () => {
    const h = makeHeader('LC', 4, 2);
    const asc = buildAudioSpecificConfig(h);
    // sfi (4 bits): byte0[2:0] = top 3 bits, byte1[7] = bottom 1 bit
    const sfiHigh = asc[0]! & 0x7; // bottom 3 bits of byte 0
    const sfiLow = (asc[1]! >> 7) & 0x1; // top bit of byte 1
    const sfi = (sfiHigh << 1) | sfiLow;
    expect(sfi).toBe(4);
  });

  it('encodes channel_configuration=2 (stereo) in byte 1 bits [6:3]', () => {
    const h = makeHeader('LC', 4, 2);
    const asc = buildAudioSpecificConfig(h);
    const channelConfig = (asc[1]! >> 3) & 0xf;
    expect(channelConfig).toBe(2);
  });

  it('sets frame_length_flag, depends_on_core_coder, extension_flag to 0', () => {
    const h = makeHeader('LC', 4, 2);
    const asc = buildAudioSpecificConfig(h);
    const flags = asc[1]! & 0x7;
    expect(flags).toBe(0);
  });

  it('bytes 2-4 are 0x00', () => {
    const h = makeHeader('LC', 4, 2);
    const asc = buildAudioSpecificConfig(h);
    expect(asc[2]).toBe(0);
    expect(asc[3]).toBe(0);
    expect(asc[4]).toBe(0);
  });
});

describe('AudioSpecificConfig for MAIN profile', () => {
  it('encodes audio_object_type=1 for MAIN', () => {
    const h = makeHeader('MAIN', 4, 2);
    const asc = buildAudioSpecificConfig(h);
    const aot = (asc[0]! >> 3) & 0x1f;
    expect(aot).toBe(1); // MAIN = 1
  });
});

describe('AudioSpecificConfig for SSR profile', () => {
  it('encodes audio_object_type=3 for SSR', () => {
    const h = makeHeader('SSR', 4, 2);
    const asc = buildAudioSpecificConfig(h);
    const aot = (asc[0]! >> 3) & 0x1f;
    expect(aot).toBe(3); // SSR = 3
  });
});

describe('AudioSpecificConfig for LTP profile', () => {
  it('encodes audio_object_type=4 for LTP', () => {
    const h = makeHeader('LTP', 4, 2);
    const asc = buildAudioSpecificConfig(h);
    const aot = (asc[0]! >> 3) & 0x1f;
    expect(aot).toBe(4); // LTP = 4
  });
});

describe('AudioSpecificConfig with different sample rates', () => {
  it('encodes sfi=3 (48000 Hz)', () => {
    const h = makeHeader('LC', 3, 2);
    const asc = buildAudioSpecificConfig(h);
    const sfiHigh = asc[0]! & 0x7;
    const sfiLow = (asc[1]! >> 7) & 0x1;
    expect((sfiHigh << 1) | sfiLow).toBe(3);
  });

  it('encodes sfi=11 (8000 Hz)', () => {
    const h = makeHeader('LC', 11, 1);
    const asc = buildAudioSpecificConfig(h);
    const sfiHigh = asc[0]! & 0x7;
    const sfiLow = (asc[1]! >> 7) & 0x1;
    expect((sfiHigh << 1) | sfiLow).toBe(11);
  });
});

describe('AudioSpecificConfig with different channel configurations', () => {
  it('encodes channelConfig=1 (mono)', () => {
    const h = makeHeader('LC', 4, 1);
    const asc = buildAudioSpecificConfig(h);
    const channelConfig = (asc[1]! >> 3) & 0xf;
    expect(channelConfig).toBe(1);
  });

  it('encodes channelConfig=6 (5.1 surround)', () => {
    const h = makeHeader('LC', 4, 6);
    const asc = buildAudioSpecificConfig(h);
    const channelConfig = (asc[1]! >> 3) & 0xf;
    expect(channelConfig).toBe(6);
  });
});

describe('buildAudioSpecificConfig from real fixture header', () => {
  it('produces correct ASC from parsed fixture first frame', async () => {
    const { loadFixture } = await import('@catlabtech/webcvt-test-utils');
    const { parseAdts } = await import('./parser.ts');
    const bytes = await loadFixture('audio/sine-1s-44100-mono.aac');
    const file = parseAdts(bytes);
    const firstFrame = file.frames[0];
    expect(firstFrame).toBeDefined();
    const asc = buildAudioSpecificConfig(firstFrame!.header);
    expect(asc.length).toBe(5);
    // LC = aot 2
    const aot = (asc[0]! >> 3) & 0x1f;
    expect(aot).toBe(2);
    // sfi = 4 (44100)
    const sfiHigh = asc[0]! & 0x7;
    const sfiLow = (asc[1]! >> 7) & 0x1;
    expect((sfiHigh << 1) | sfiLow).toBe(4);
    // channel = 1 (mono)
    const channelConfig = (asc[1]! >> 3) & 0xf;
    expect(channelConfig).toBe(1);
  });
});
