/**
 * Tests for boxes/stbl.ts — sample table parsers.
 *
 * Design note test cases covered:
 *   - "expands stts RLE into per-sample durations"
 *   - "expands stsc RLE and computes per-sample chunk membership correctly"
 *   - "extracts sample table and computes per-sample byte offsets via stsc + stsz + stco"
 *   - "accepts both stco (32-bit) and co64 (64-bit) chunk offsets transparently"
 *   - "handles stsz with sample_size != 0 (constant-size case) without per-sample table"
 *   - "enforces ... per-table 1M entry cap"
 */

import { describe, expect, it } from 'vitest';
import { Mp4InvalidBoxError, Mp4TableTooLargeError } from '../errors.ts';
import {
  buildSampleTable,
  parseStcoOrCo64,
  parseStsc,
  parseStsz,
  parseStts,
  serializeCo64,
  serializeStco,
  serializeStsc,
  serializeStsz,
  serializeStts,
} from './stbl.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSttsPayload(
  entries: Array<{ sampleCount: number; sampleDelta: number }>,
): Uint8Array {
  const out = new Uint8Array(8 + entries.length * 8);
  const view = new DataView(out.buffer);
  // version=0, flags=0
  view.setUint32(4, entries.length, false);
  let off = 8;
  for (const e of entries) {
    view.setUint32(off, e.sampleCount, false);
    view.setUint32(off + 4, e.sampleDelta, false);
    off += 8;
  }
  return out;
}

function buildStscPayload(
  entries: Array<{ firstChunk: number; samplesPerChunk: number; sdi: number }>,
): Uint8Array {
  const out = new Uint8Array(8 + entries.length * 12);
  const view = new DataView(out.buffer);
  view.setUint32(4, entries.length, false);
  let off = 8;
  for (const e of entries) {
    view.setUint32(off, e.firstChunk, false);
    view.setUint32(off + 4, e.samplesPerChunk, false);
    view.setUint32(off + 8, e.sdi, false);
    off += 12;
  }
  return out;
}

function buildStszPayload(constantSize: number, sizes: number[]): Uint8Array {
  const perSampleTable = constantSize === 0;
  const out = new Uint8Array(12 + (perSampleTable ? sizes.length * 4 : 0));
  const view = new DataView(out.buffer);
  // version=0, flags=0
  view.setUint32(4, constantSize, false);
  view.setUint32(8, sizes.length, false);
  if (perSampleTable) {
    let off = 12;
    for (const s of sizes) {
      view.setUint32(off, s, false);
      off += 4;
    }
  }
  return out;
}

function buildStcoPayload(offsets: number[]): Uint8Array {
  const out = new Uint8Array(8 + offsets.length * 4);
  const view = new DataView(out.buffer);
  view.setUint32(4, offsets.length, false);
  let off = 8;
  for (const o of offsets) {
    view.setUint32(off, o, false);
    off += 4;
  }
  return out;
}

function buildCo64Payload(offsets: number[]): Uint8Array {
  const out = new Uint8Array(8 + offsets.length * 8);
  const view = new DataView(out.buffer);
  view.setUint32(4, offsets.length, false);
  let off = 8;
  for (const o of offsets) {
    const hi = Math.floor(o / 0x100000000);
    const lo = o >>> 0;
    view.setUint32(off, hi, false);
    view.setUint32(off + 4, lo, false);
    off += 8;
  }
  return out;
}

// ---------------------------------------------------------------------------
// stts tests
// ---------------------------------------------------------------------------

describe('parseStts', () => {
  it('expands stts RLE with a single entry (constant frame duration)', () => {
    const payload = buildSttsPayload([{ sampleCount: 100, sampleDelta: 1024 }]);
    const entries = parseStts(payload);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.sampleCount).toBe(100);
    expect(entries[0]!.sampleDelta).toBe(1024);
  });

  it('expands stts RLE with multiple entries', () => {
    const payload = buildSttsPayload([
      { sampleCount: 50, sampleDelta: 1024 },
      { sampleCount: 25, sampleDelta: 512 },
    ]);
    const entries = parseStts(payload);
    expect(entries).toHaveLength(2);
    expect(entries[1]!.sampleDelta).toBe(512);
  });

  it('throws Mp4TableTooLargeError when entry_count exceeds 1M', () => {
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    view.setUint32(4, 1_000_001, false);
    expect(() => parseStts(payload)).toThrow(Mp4TableTooLargeError);
  });

  it('throws Mp4InvalidBoxError for too short payload', () => {
    expect(() => parseStts(new Uint8Array(4))).toThrow(Mp4InvalidBoxError);
  });

  it('returns empty array for entry_count=0', () => {
    const payload = buildSttsPayload([]);
    const entries = parseStts(payload);
    expect(entries).toHaveLength(0);
  });

  it('throws Mp4InvalidBoxError when stts payload is too short for declared entries', () => {
    // Claim 5 entries (needs 8+40=48 bytes) but payload is only 8 bytes.
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    view.setUint32(4, 5, false); // entry_count=5
    expect(() => parseStts(payload)).toThrow(Mp4InvalidBoxError);
  });
});

describe('serializeStts', () => {
  it('round-trips stts entries', () => {
    const entries = [{ sampleCount: 44, sampleDelta: 1024 }];
    const boxBytes = serializeStts(entries);
    // Parse the box payload (skip the 8-byte box header).
    const parsed = parseStts(boxBytes.subarray(8));
    expect(parsed).toEqual(entries);
  });
});

// ---------------------------------------------------------------------------
// stsc tests
// ---------------------------------------------------------------------------

describe('parseStsc', () => {
  it('parses stsc with a single run (all chunks have same samples_per_chunk)', () => {
    const payload = buildStscPayload([{ firstChunk: 1, samplesPerChunk: 1, sdi: 1 }]);
    const entries = parseStsc(payload);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.firstChunk).toBe(1);
    expect(entries[0]!.samplesPerChunk).toBe(1);
  });

  it('parses stsc with multiple runs', () => {
    const payload = buildStscPayload([
      { firstChunk: 1, samplesPerChunk: 3, sdi: 1 },
      { firstChunk: 4, samplesPerChunk: 1, sdi: 1 },
    ]);
    const entries = parseStsc(payload);
    expect(entries).toHaveLength(2);
    expect(entries[1]!.firstChunk).toBe(4);
    expect(entries[1]!.samplesPerChunk).toBe(1);
  });

  it('throws Mp4TableTooLargeError when entry_count exceeds 1M', () => {
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    view.setUint32(4, 1_000_001, false);
    expect(() => parseStsc(payload)).toThrow(Mp4TableTooLargeError);
  });

  it('throws Mp4InvalidBoxError when stsc payload is too short for declared entries', () => {
    // Claim 5 entries (needs 8+60=68 bytes) but payload is only 8 bytes.
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    view.setUint32(4, 5, false); // entry_count=5
    expect(() => parseStsc(payload)).toThrow(Mp4InvalidBoxError);
  });
});

describe('serializeStsc', () => {
  it('round-trips stsc entries', () => {
    const entries = [{ firstChunk: 1, samplesPerChunk: 2, sampleDescriptionIndex: 1 }];
    const boxBytes = serializeStsc(entries);
    const parsed = parseStsc(boxBytes.subarray(8));
    expect(parsed).toEqual(entries);
  });
});

// ---------------------------------------------------------------------------
// stsz tests
// ---------------------------------------------------------------------------

describe('parseStsz', () => {
  it('handles sample_size != 0 (constant size) without per-sample table', () => {
    const payload = buildStszPayload(512, Array(50).fill(512));
    // We pass an empty sizes array because constant mode ignores the table.
    const sizes = parseStsz(buildStszPayload(512, []));
    // parseStsz with constant size reads sampleCount from the payload.
    // Let's re-build properly: constant size=512, 50 samples, NO table.
    const constantPayload = new Uint8Array(12);
    const view = new DataView(constantPayload.buffer);
    view.setUint32(4, 512, false); // sample_size = 512
    view.setUint32(8, 50, false); // sample_count = 50
    const result = parseStsz(constantPayload);
    expect(result.length).toBe(50);
    expect(result.every((s) => s === 512)).toBe(true);
  });

  it('handles sample_size == 0 (per-sample table)', () => {
    const sizes = [100, 200, 150, 80];
    const payload = buildStszPayload(0, sizes);
    const result = parseStsz(payload);
    expect(Array.from(result)).toEqual(sizes);
  });

  it('throws Mp4TableTooLargeError when sample_count exceeds 1M', () => {
    const payload = new Uint8Array(12);
    const view = new DataView(payload.buffer);
    view.setUint32(4, 0, false); // sample_size = 0 (per-sample table)
    view.setUint32(8, 1_000_001, false);
    expect(() => parseStsz(payload)).toThrow(Mp4TableTooLargeError);
  });

  it('throws Mp4InvalidBoxError when per-sample stsz payload is too short for entries', () => {
    const payload = new Uint8Array(12);
    const view = new DataView(payload.buffer);
    view.setUint32(4, 0, false); // per-sample mode
    view.setUint32(8, 10, false); // 10 samples — needs 12+40=52 bytes but only 12
    expect(() => parseStsz(payload)).toThrow(Mp4InvalidBoxError);
  });
});

describe('serializeStsz', () => {
  it('round-trips per-sample stsz sizes', () => {
    const sizes = new Uint32Array([100, 200, 150]);
    const boxBytes = serializeStsz(sizes);
    const parsed = parseStsz(boxBytes.subarray(8));
    expect(Array.from(parsed)).toEqual([100, 200, 150]);
  });
});

// ---------------------------------------------------------------------------
// stco / co64 tests
// ---------------------------------------------------------------------------

describe('parseStcoOrCo64 — too short header', () => {
  it('throws Mp4InvalidBoxError when stco payload is shorter than 8 bytes', () => {
    expect(() => parseStcoOrCo64(new Uint8Array(4), 'stco')).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError when co64 payload is shorter than 8 bytes', () => {
    expect(() => parseStcoOrCo64(new Uint8Array(4), 'co64')).toThrow(Mp4InvalidBoxError);
  });
});

describe('parseStcoOrCo64 (stco)', () => {
  it('accepts 32-bit stco chunk offsets transparently', () => {
    const offsets = [1000, 2000, 3000];
    const payload = buildStcoPayload(offsets);
    const result = parseStcoOrCo64(payload, 'stco');
    expect(result.variant).toBe('stco');
    expect(Array.from(result.offsets)).toEqual(offsets);
  });

  it('throws Mp4TableTooLargeError when entry_count exceeds 1M', () => {
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    view.setUint32(4, 1_000_001, false);
    expect(() => parseStcoOrCo64(payload, 'stco')).toThrow(Mp4TableTooLargeError);
  });

  it('throws Mp4InvalidBoxError when stco payload is too short for entries', () => {
    // Claim 10 entries but payload is only 8 bytes (header only).
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    view.setUint32(4, 10, false); // entry_count=10, needs 8+40=48 bytes
    expect(() => parseStcoOrCo64(payload, 'stco')).toThrow(Mp4InvalidBoxError);
  });
});

describe('parseStcoOrCo64 (co64)', () => {
  it('accepts 64-bit co64 chunk offsets transparently', () => {
    // Use large offsets beyond u32 range.
    const offsets = [0x1_0000_0000, 0x2_0000_0000];
    const payload = buildCo64Payload(offsets);
    const result = parseStcoOrCo64(payload, 'co64');
    expect(result.variant).toBe('co64');
    expect(result.offsets[0]).toBeCloseTo(0x1_0000_0000, 0);
    expect(result.offsets[1]).toBeCloseTo(0x2_0000_0000, 0);
  });

  it('throws Mp4TableTooLargeError for co64 when entry_count exceeds 1M', () => {
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    view.setUint32(4, 1_000_001, false);
    expect(() => parseStcoOrCo64(payload, 'co64')).toThrow(Mp4TableTooLargeError);
  });

  it('throws Mp4InvalidBoxError when co64 payload is too short for entries', () => {
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    view.setUint32(4, 10, false); // entry_count=10, needs 8+80=88 bytes
    expect(() => parseStcoOrCo64(payload, 'co64')).toThrow(Mp4InvalidBoxError);
  });
});

describe('serializeStco / serializeCo64', () => {
  it('round-trips stco offsets', () => {
    const offsets = [100, 200, 300];
    const boxBytes = serializeStco(offsets);
    const parsed = parseStcoOrCo64(boxBytes.subarray(8), 'stco');
    expect(Array.from(parsed.offsets)).toEqual(offsets);
  });

  it('round-trips co64 offsets', () => {
    const offsets = [0x1_0000_0000, 0x2_0000_0000];
    const boxBytes = serializeCo64(offsets);
    const parsed = parseStcoOrCo64(boxBytes.subarray(8), 'co64');
    expect(parsed.offsets[0]).toBeCloseTo(0x1_0000_0000, 0);
  });
});

// ---------------------------------------------------------------------------
// buildSampleTable integration
// ---------------------------------------------------------------------------

describe('buildSampleTable', () => {
  it('computes per-sample offsets correctly via stsc + stsz + stco', () => {
    // 4 samples, 1 per chunk, 4 chunks.
    const stts = [{ sampleCount: 4, sampleDelta: 1024 }];
    const stsc = [{ firstChunk: 1, samplesPerChunk: 1, sampleDescriptionIndex: 1 }];
    const sizes = new Uint32Array([100, 200, 150, 80]);
    const chunkOffsets = [1000, 1100, 1300, 1450];

    const table = buildSampleTable(stts, sizes, stsc, chunkOffsets);

    expect(table.sampleCount).toBe(4);
    // Each chunk has 1 sample, so sampleOffset[i] == chunkOffset[i].
    expect(table.sampleOffsets[0]).toBe(1000);
    expect(table.sampleOffsets[1]).toBe(1100);
    expect(table.sampleOffsets[2]).toBe(1300);
    expect(table.sampleOffsets[3]).toBe(1450);
    // Deltas expanded from RLE.
    expect(Array.from(table.sampleDeltas)).toEqual([1024, 1024, 1024, 1024]);
  });

  it('expands stsc RLE with 2 samples per chunk', () => {
    // 2 chunks, 2 samples each = 4 samples total.
    const stts = [{ sampleCount: 4, sampleDelta: 512 }];
    const stsc = [{ firstChunk: 1, samplesPerChunk: 2, sampleDescriptionIndex: 1 }];
    const sizes = new Uint32Array([100, 100, 100, 100]);
    const chunkOffsets = [500, 700]; // chunk 1 at 500, chunk 2 at 700

    const table = buildSampleTable(stts, sizes, stsc, chunkOffsets);

    expect(table.sampleCount).toBe(4);
    // Chunk 1: sample 0 at 500, sample 1 at 600 (500+100).
    expect(table.sampleOffsets[0]).toBe(500);
    expect(table.sampleOffsets[1]).toBe(600);
    // Chunk 2: sample 2 at 700, sample 3 at 800.
    expect(table.sampleOffsets[2]).toBe(700);
    expect(table.sampleOffsets[3]).toBe(800);
  });

  it('handles empty stts (zero samples)', () => {
    const table = buildSampleTable([], new Uint32Array([]), [], []);
    expect(table.sampleCount).toBe(0);
  });

  it('handles stsc RLE transition (different samples_per_chunk for different chunk ranges)', () => {
    // Trap §3: stsc entries apply from firstChunk until the next entry's firstChunk.
    // Chunks 1–2: 3 samples each. Chunk 3+: 1 sample each.
    // Total chunks: 4 (from stco), total samples = 3+3+1+1 = 8.
    const stts = [{ sampleCount: 8, sampleDelta: 1024 }];
    const stsc = [
      { firstChunk: 1, samplesPerChunk: 3, sampleDescriptionIndex: 1 },
      { firstChunk: 3, samplesPerChunk: 1, sampleDescriptionIndex: 1 },
    ];
    const sizes = new Uint32Array([50, 50, 50, 50, 50, 50, 50, 50]);
    const chunkOffsets = [1000, 1150, 1300, 1350]; // chunk sizes: 150, 150, 50, 50

    const table = buildSampleTable(stts, sizes, stsc, chunkOffsets);

    expect(table.sampleCount).toBe(8);
    // Chunk 1 (3 samples at 1000): sample 0=1000, 1=1050, 2=1100
    expect(table.sampleOffsets[0]).toBe(1000);
    expect(table.sampleOffsets[1]).toBe(1050);
    expect(table.sampleOffsets[2]).toBe(1100);
    // Chunk 2 (3 samples at 1150): sample 3=1150, 4=1200, 5=1250
    expect(table.sampleOffsets[3]).toBe(1150);
    expect(table.sampleOffsets[4]).toBe(1200);
    expect(table.sampleOffsets[5]).toBe(1250);
    // Chunk 3 (1 sample at 1300): sample 6=1300
    expect(table.sampleOffsets[6]).toBe(1300);
    // Chunk 4 (1 sample at 1350): sample 7=1350
    expect(table.sampleOffsets[7]).toBe(1350);
  });
});
