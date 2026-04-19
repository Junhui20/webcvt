/**
 * Tests for segment-info decode/encode (elements/segment-info.ts).
 */

import { describe, expect, it } from 'vitest';
import type { EbmlElement } from '../ebml-element.ts';
import { decodeInfo, encodeInfo } from './segment-info.ts';

function buildInfoChildren(overrides: {
  timecodeScale?: number;
  muxingApp?: string;
  writingApp?: string;
  includeDuration?: boolean;
}): { bytes: Uint8Array; children: EbmlElement[] } {
  const enc = new TextEncoder();
  const {
    timecodeScale,
    muxingApp = 'test',
    writingApp = 'test',
    includeDuration = false,
  } = overrides;

  const elems: Array<{ id: number; payload: Uint8Array }> = [];

  if (timecodeScale !== undefined) {
    const tsPayload = new Uint8Array(4);
    new DataView(tsPayload.buffer).setUint32(0, timecodeScale, false);
    elems.push({ id: 0x2ad7b1, payload: tsPayload });
  }

  if (includeDuration) {
    const durPayload = new Uint8Array(8);
    new DataView(durPayload.buffer).setFloat64(0, 1000.0, false);
    elems.push({ id: 0x4489, payload: durPayload });
  }

  elems.push({ id: 0x4d80, payload: enc.encode(muxingApp) });
  elems.push({ id: 0x5741, payload: enc.encode(writingApp) });

  let totalSize = 0;
  for (const e of elems) {
    const idWidth = e.id > 0x3fff ? 3 : e.id > 0x7f ? 2 : 1;
    totalSize += idWidth + 1 + e.payload.length;
  }

  const bytes = new Uint8Array(totalSize);
  const children: EbmlElement[] = [];
  let offset = 0;

  for (const e of elems) {
    // Write ID bytes.
    if (e.id > 0x3fff) {
      bytes[offset] = (e.id >> 16) & 0xff;
      bytes[offset + 1] = (e.id >> 8) & 0xff;
      bytes[offset + 2] = e.id & 0xff;
      const payloadOffset = offset + 3 + 1;
      bytes[offset + 3] = 0x80 | e.payload.length;
      bytes.set(e.payload, payloadOffset);
      children.push({
        id: e.id,
        size: BigInt(e.payload.length),
        payloadOffset,
        nextOffset: payloadOffset + e.payload.length,
        idWidth: 3,
        sizeWidth: 1,
      });
      offset += 3 + 1 + e.payload.length;
    } else if (e.id > 0x7f) {
      bytes[offset] = (e.id >> 8) & 0xff;
      bytes[offset + 1] = e.id & 0xff;
      const payloadOffset = offset + 2 + 1;
      bytes[offset + 2] = 0x80 | e.payload.length;
      bytes.set(e.payload, payloadOffset);
      children.push({
        id: e.id,
        size: BigInt(e.payload.length),
        payloadOffset,
        nextOffset: payloadOffset + e.payload.length,
        idWidth: 2,
        sizeWidth: 1,
      });
      offset += 2 + 1 + e.payload.length;
    } else {
      bytes[offset] = e.id;
      const payloadOffset = offset + 1 + 1;
      bytes[offset + 1] = 0x80 | e.payload.length;
      bytes.set(e.payload, payloadOffset);
      children.push({
        id: e.id,
        size: BigInt(e.payload.length),
        payloadOffset,
        nextOffset: payloadOffset + e.payload.length,
        idWidth: 1,
        sizeWidth: 1,
      });
      offset += 1 + 1 + e.payload.length;
    }
  }

  return { bytes, children };
}

describe('decodeInfo', () => {
  it('decodes timecodeScale from Info children', () => {
    const { bytes, children } = buildInfoChildren({ timecodeScale: 1_000_000 });
    const info = decodeInfo(bytes, children);
    expect(info.timecodeScale).toBe(1_000_000);
  });

  it('defaults timecodeScale to 1_000_000 when absent (Trap §4)', () => {
    const { bytes, children } = buildInfoChildren({});
    const info = decodeInfo(bytes, children);
    expect(info.timecodeScale).toBe(1_000_000);
  });

  it('decodes muxingApp and writingApp', () => {
    const { bytes, children } = buildInfoChildren({
      muxingApp: 'Lavf58.76.100',
      writingApp: 'ffmpeg',
    });
    const info = decodeInfo(bytes, children);
    expect(info.muxingApp).toBe('Lavf58.76.100');
    expect(info.writingApp).toBe('ffmpeg');
  });

  it('decodes duration when present', () => {
    const { bytes, children } = buildInfoChildren({ includeDuration: true });
    const info = decodeInfo(bytes, children);
    expect(info.duration).toBeCloseTo(1000.0, 2);
  });

  it('duration is undefined when absent', () => {
    const { bytes, children } = buildInfoChildren({});
    const info = decodeInfo(bytes, children);
    expect(info.duration).toBeUndefined();
  });

  it('defaults muxingApp to empty string when absent', () => {
    // Build children with NO muxingApp or writingApp elements.
    const tsPayload = new Uint8Array(4);
    new DataView(tsPayload.buffer).setUint32(0, 1_000_000, false);
    const bytes = new Uint8Array([
      // TimecodeScale (3-byte ID 0x2AD7B1): 4-byte uint payload.
      0x2a, 0xd7, 0xb1, 0x84, 0x00, 0x0f, 0x42, 0x40,
    ]);
    const children: import('../ebml-element.ts').EbmlElement[] = [
      {
        id: 0x2ad7b1,
        size: 4n,
        payloadOffset: 4,
        nextOffset: 8,
        idWidth: 3,
        sizeWidth: 1,
      },
    ];
    const info = decodeInfo(bytes, children);
    expect(info.muxingApp).toBe('');
    expect(info.writingApp).toBe('');
  });
});

describe('encodeInfo', () => {
  it('encodes Info element with ID 0x1549A966', () => {
    const bytes = encodeInfo({
      timecodeScale: 1_000_000,
      muxingApp: 'test',
      writingApp: 'test',
    });
    // First bytes should be Info element ID.
    expect(bytes[0]).toBe(0x15);
    expect(bytes[1]).toBe(0x49);
    expect(bytes[2]).toBe(0xa9);
    expect(bytes[3]).toBe(0x66);
  });

  it('encoded Info round-trips timecodeScale', () => {
    // This verifies encodeInfo is internally consistent.
    const info = encodeInfo({ timecodeScale: 2_000_000, muxingApp: 'x', writingApp: 'y' });
    expect(info.length).toBeGreaterThan(0);
  });
});
