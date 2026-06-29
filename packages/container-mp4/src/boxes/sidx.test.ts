/**
 * Tests for boxes/sidx.ts — Segment Index Box parser (D.3).
 *
 * All fixtures are built programmatically; no binary files are committed.
 * Spec: ISO/IEC 14496-12:2022 §8.16.3.
 */

import { describe, expect, it } from 'vitest';
import { Mp4InvalidBoxError, Mp4SidxBadVersionError } from '../errors.ts';
import { parseSidx } from './sidx.ts';

// ---------------------------------------------------------------------------
// Raw sidx-payload builders (bytes AFTER the 8-byte box header)
// ---------------------------------------------------------------------------

interface RefSpec {
  type?: boolean;
  size: number;
  duration: number;
  startsWithSap?: boolean;
  sapType?: number;
  sapDelta?: number;
}

function writeRefs(view: DataView, start: number, refs: RefSpec[]): void {
  let off = start;
  for (const r of refs) {
    const word0 = (((r.type ? 1 : 0) << 31) | (r.size & 0x7fffffff)) >>> 0;
    view.setUint32(off, word0, false);
    view.setUint32(off + 4, r.duration, false);
    const word2 =
      (((r.startsWithSap ? 1 : 0) << 31) | ((r.sapType ?? 0) << 28) | (r.sapDelta ?? 0)) >>> 0;
    view.setUint32(off + 8, word2, false);
    off += 12;
  }
}

function sidxV0(opts: {
  referenceId?: number;
  timescale?: number;
  ept?: number;
  firstOffset?: number;
  references: RefSpec[];
}): Uint8Array {
  const refs = opts.references;
  const out = new Uint8Array(24 + refs.length * 12);
  const view = new DataView(out.buffer);
  out[0] = 0; // version 0
  view.setUint32(4, opts.referenceId ?? 1, false);
  view.setUint32(8, opts.timescale ?? 90000, false);
  view.setUint32(12, opts.ept ?? 0, false);
  view.setUint32(16, opts.firstOffset ?? 0, false);
  view.setUint16(22, refs.length, false);
  writeRefs(view, 24, refs);
  return out;
}

function sidxV1(opts: {
  referenceId?: number;
  timescale?: number;
  ept?: number;
  firstOffset?: number;
  references: RefSpec[];
}): Uint8Array {
  const refs = opts.references;
  const out = new Uint8Array(32 + refs.length * 12);
  const view = new DataView(out.buffer);
  out[0] = 1; // version 1
  view.setUint32(4, opts.referenceId ?? 1, false);
  view.setUint32(8, opts.timescale ?? 90000, false);
  // EPT u64 at 12, first_offset u64 at 20 (low word only — values fit in u32 here).
  view.setUint32(16, opts.ept ?? 0, false);
  view.setUint32(24, opts.firstOffset ?? 0, false);
  view.setUint16(30, refs.length, false);
  writeRefs(view, 32, refs);
  return out;
}

// ---------------------------------------------------------------------------
// Parse tests
// ---------------------------------------------------------------------------

describe('parseSidx', () => {
  it('parses a v0 sidx with a single media reference', () => {
    const idx = parseSidx(
      sidxV0({
        referenceId: 1,
        timescale: 90000,
        ept: 1000,
        firstOffset: 48,
        references: [{ size: 1234, duration: 9000, startsWithSap: true, sapType: 1 }],
      }),
    );
    expect(idx.version).toBe(0);
    expect(idx.referenceId).toBe(1);
    expect(idx.timescale).toBe(90000);
    expect(idx.earliestPresentationTime).toBe(1000);
    expect(idx.firstOffset).toBe(48);
    expect(idx.references).toHaveLength(1);
    const r = idx.references[0];
    expect(r?.referenceType).toBe(false);
    expect(r?.referencedSize).toBe(1234);
    expect(r?.subsegmentDuration).toBe(9000);
    expect(r?.startsWithSap).toBe(true);
    expect(r?.sapType).toBe(1);
  });

  it('parses a v1 sidx (u64 time fields) with multiple references', () => {
    const idx = parseSidx(
      sidxV1({
        ept: 5000,
        firstOffset: 0,
        references: [
          { size: 10, duration: 100 },
          { type: true, size: 20, duration: 200, startsWithSap: true, sapType: 3, sapDelta: 7 },
        ],
      }),
    );
    expect(idx.version).toBe(1);
    expect(idx.earliestPresentationTime).toBe(5000);
    expect(idx.references).toHaveLength(2);
    expect(idx.references[1]?.referenceType).toBe(true); // index reference (nested sidx)
    expect(idx.references[1]?.referencedSize).toBe(20);
    expect(idx.references[1]?.sapType).toBe(3);
    expect(idx.references[1]?.sapDeltaTime).toBe(7);
  });

  it('decodes the reference_type / referenced_size split (top bit vs low 31 bits)', () => {
    // referenced_size 0x7FFFFFFF with reference_type=true must not bleed the sign bit.
    const idx = parseSidx(sidxV0({ references: [{ type: true, size: 0x7fffffff, duration: 1 }] }));
    expect(idx.references[0]?.referenceType).toBe(true);
    expect(idx.references[0]?.referencedSize).toBe(0x7fffffff);
  });

  it('parses an empty reference list', () => {
    const idx = parseSidx(sidxV0({ references: [] }));
    expect(idx.references).toEqual([]);
  });

  // -- rejection paths -------------------------------------------------------

  it('throws Mp4SidxBadVersionError on an unsupported version', () => {
    const bytes = sidxV0({ references: [] });
    bytes[0] = 2;
    expect(() => parseSidx(bytes)).toThrow(Mp4SidxBadVersionError);
  });

  it('throws on a payload shorter than the fixed header', () => {
    expect(() => parseSidx(new Uint8Array(8))).toThrow(Mp4InvalidBoxError);
  });

  it('throws when a v0 payload is truncated before EPT/first_offset', () => {
    // 12 bytes present (passes the >=12 guard) but no room for EPT+first_offset.
    expect(() => parseSidx(new Uint8Array(12))).toThrow(Mp4InvalidBoxError);
  });

  it('throws when a v1 payload is truncated before EPT/first_offset', () => {
    const bytes = new Uint8Array(16);
    bytes[0] = 1; // version 1 needs 12+16 bytes
    expect(() => parseSidx(bytes)).toThrow(Mp4InvalidBoxError);
  });

  it('throws when the payload is truncated before reference_count', () => {
    // v0 needs 24 bytes for the header+count; give 22.
    const bytes = new Uint8Array(22);
    expect(() => parseSidx(bytes)).toThrow(Mp4InvalidBoxError);
  });

  it('throws when the payload is too short for the declared reference_count', () => {
    const bytes = sidxV0({ references: [{ size: 1, duration: 1 }] });
    // Claim 5 references but keep the (single-reference) length.
    new DataView(bytes.buffer).setUint16(22, 5, false);
    expect(() => parseSidx(bytes)).toThrow(Mp4InvalidBoxError);
  });

  it('rejects a v1 earliest_presentation_time beyond the safe-integer range', () => {
    const bytes = sidxV1({ references: [] });
    // Set the high u32 of EPT (offset 12) to a large value → > 2^53.
    new DataView(bytes.buffer).setUint32(12, 0x00200000, false);
    expect(() => parseSidx(bytes)).toThrow(Mp4InvalidBoxError);
  });
});
