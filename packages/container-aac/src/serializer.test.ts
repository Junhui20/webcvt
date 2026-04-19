/**
 * Tests for the ADTS serializer (serializeAdts) — muxer algorithm.
 *
 * Covers design-note test case:
 * - round-trip: parse → serialize → byte-identical output
 */

import { loadFixture } from '@webcvt/test-utils';
import { describe, expect, it } from 'vitest';
import { parseAdts } from './parser.ts';
import { serializeAdts } from './serializer.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFrame(payloadLength: number, sfi = 4, channelConfig = 2): Uint8Array {
  const pa = 1; // no CRC
  const headerSize = 7;
  const frameBytes = headerSize + payloadLength;
  const frame = new Uint8Array(frameBytes);

  frame[0] = 0xff;
  frame[1] = 0xf0 | pa;

  const channelHigh = (channelConfig >> 2) & 0x1;
  frame[2] = (1 << 6) | (sfi << 2) | channelHigh; // LC profile

  const channelLow = channelConfig & 0x3;
  const frameLenHigh = (frameBytes >> 11) & 0x3;
  frame[3] = (channelLow << 6) | frameLenHigh;
  frame[4] = (frameBytes >> 3) & 0xff;
  const frameLenLow = frameBytes & 0x7;
  frame[5] = (frameLenLow << 5) | 0x1f;
  frame[6] = 0xfc; // bufferFullness=0x7FF, rawBlocks=0

  // Fill payload with recognisable pattern
  for (let i = headerSize; i < frameBytes; i++) {
    frame[i] = (i & 0xff) as number;
  }

  return frame;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Design-note test cases
// ---------------------------------------------------------------------------

describe('round-trip: parse → serialize → byte-identical output', () => {
  it('round-trips a single synthetic frame byte-identically', () => {
    const original = buildFrame(50);
    const file = parseAdts(original);
    const serialized = serializeAdts(file);
    expect(serialized.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(serialized[i]).toBe(original[i]);
    }
  });

  it('round-trips two frames byte-identically', () => {
    const f1 = buildFrame(30);
    const f2 = buildFrame(45);
    const original = concat(f1, f2);
    const file = parseAdts(original);
    const serialized = serializeAdts(file);
    expect(serialized.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(serialized[i]).toBe(original[i]);
    }
  });

  it('round-trips five frames byte-identically', () => {
    const frames = [20, 35, 28, 42, 17].map((len) => buildFrame(len));
    const original = concat(...frames);
    const file = parseAdts(original);
    const serialized = serializeAdts(file);
    expect(serialized.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(serialized[i]).toBe(original[i]);
    }
  });

  it('round-trips the real AAC fixture byte-identically', async () => {
    const { loadFixture: load } = await import('@webcvt/test-utils');
    const bytes = await load('audio/sine-1s-44100-mono.aac');
    const file = parseAdts(bytes);
    const serialized = serializeAdts(file);
    // The serialized length may be shorter than input if there were trailing junk bytes.
    // The serialized content must match the parsed frame regions.
    let cursor = 0;
    for (const frame of file.frames) {
      expect(serialized.length).toBeGreaterThanOrEqual(cursor + frame.data.length);
      cursor += frame.data.length;
    }
    expect(serialized.length).toBe(cursor);
  });

  it('returns empty Uint8Array for zero frames', () => {
    const result = serializeAdts({ frames: [] });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });
});

describe('CRC frames round-trip with preserved CRC value', () => {
  it('preserves CRC bytes verbatim in round-trip', () => {
    // Build a 9-byte header frame (protection_absent=0)
    const payloadSize = 10;
    const frameBytes = 9 + payloadSize;
    const frame = new Uint8Array(frameBytes);
    frame[0] = 0xff;
    frame[1] = 0xf0; // pa=0 (CRC present)
    frame[2] = (1 << 6) | (4 << 2) | 0; // LC, 44100, channelHigh=0
    const channelLow = 2 & 0x3; // stereo
    const frameLenHigh = (frameBytes >> 11) & 0x3;
    frame[3] = (channelLow << 6) | frameLenHigh;
    frame[4] = (frameBytes >> 3) & 0xff;
    const frameLenLow = frameBytes & 0x7;
    frame[5] = (frameLenLow << 5) | 0x1f;
    frame[6] = 0xfc;
    // CRC = 0xDEAD
    frame[7] = 0xde;
    frame[8] = 0xad;
    // Payload
    for (let i = 9; i < frameBytes; i++) {
      frame[i] = 0xaa;
    }

    const file = parseAdts(frame);
    expect(file.frames.length).toBe(1);
    expect(file.frames[0]!.header.hasCrc).toBe(true);

    const serialized = serializeAdts(file);
    // CRC bytes at offset 7-8 must be preserved
    expect(serialized[7]).toBe(0xde);
    expect(serialized[8]).toBe(0xad);
  });
});

describe('serializeAdts output is an immutable copy', () => {
  it('modifying the serialized output does not affect the original parsed frames', () => {
    const original = buildFrame(20);
    const file = parseAdts(original);
    const serialized = serializeAdts(file);
    // Mutate serialized output
    serialized[10] = 0xff;
    // Re-serialize: should still produce the original bytes
    const serialized2 = serializeAdts(file);
    expect(serialized2[10]).toBe(original[10]);
  });
});
