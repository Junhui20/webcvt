/**
 * Tests for boxes/mfra.ts — Movie Fragment Random Access parser (D.3),
 * plus an end-to-end parser-wiring test that feeds a full fragmented file
 * (with appended sidx + mfra) through parseMp4.
 *
 * All fixtures are built programmatically; no binary files are committed.
 * Spec: ISO/IEC 14496-12:2022 §8.8.9–§8.8.11 and §8.16.3.
 */

import { describe, expect, it } from 'vitest';
import { buildMinimalFmp4 } from '../_test-helpers/build-fmp4.ts';
import { walkBoxes } from '../box-tree.ts';
import { Mp4MfraOutOfBoundsError } from '../errors.ts';
import { parseMp4 } from '../parser.ts';
import { parseMfra } from './mfra.ts';

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i) & 0xff;
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function writeUintBE(view: DataView, offset: number, value: number, byteLength: number): void {
  let v = value;
  for (let i = byteLength - 1; i >= 0; i--) {
    view.setUint8(offset + i, v & 0xff);
    v = Math.floor(v / 256);
  }
}

interface TfraEntry {
  time: number;
  moofOffset: number;
  traf: number;
  trun: number;
  sample: number;
}

function tfraPayload(opts: {
  version?: 0 | 1;
  trackId?: number;
  lenTraf?: number;
  lenTrun?: number;
  lenSample?: number;
  entries: TfraEntry[];
}): Uint8Array {
  const version = opts.version ?? 0;
  const lenTraf = opts.lenTraf ?? 1;
  const lenTrun = opts.lenTrun ?? 1;
  const lenSample = opts.lenSample ?? 1;
  const timeBytes = version === 1 ? 8 : 4;
  const entryBytes = timeBytes * 2 + lenTraf + lenTrun + lenSample;
  const out = new Uint8Array(16 + opts.entries.length * entryBytes);
  const view = new DataView(out.buffer);
  out[0] = version;
  view.setUint32(4, opts.trackId ?? 1, false);
  const sizes =
    (((lenTraf - 1) & 0x3) << 4) | (((lenTrun - 1) & 0x3) << 2) | ((lenSample - 1) & 0x3);
  view.setUint32(8, sizes, false);
  view.setUint32(12, opts.entries.length, false);
  let off = 16;
  for (const e of opts.entries) {
    if (version === 1) {
      view.setUint32(off + 4, e.time, false); // low word; hi=0
      view.setUint32(off + 12, e.moofOffset, false);
      off += 16;
    } else {
      view.setUint32(off, e.time, false);
      view.setUint32(off + 4, e.moofOffset, false);
      off += 8;
    }
    writeUintBE(view, off, e.traf, lenTraf);
    off += lenTraf;
    writeUintBE(view, off, e.trun, lenTrun);
    off += lenTrun;
    writeUintBE(view, off, e.sample, lenSample);
    off += lenSample;
  }
  return out;
}

function mfroPayload(size: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setUint32(4, size, false);
  return out;
}

/** Walk a single top-level box and return it (children populated). */
function walkOne(bytes: Uint8Array) {
  const top = walkBoxes(bytes, 0, bytes.length, { value: 0 });
  const first = top[0];
  if (!first) throw new Error('no top-level box');
  return first;
}

// ---------------------------------------------------------------------------
// parseMfra unit tests
// ---------------------------------------------------------------------------

describe('parseMfra', () => {
  it('parses a v0 mfra with one tfra and mfro', () => {
    const tfra = box(
      'tfra',
      tfraPayload({
        trackId: 1,
        entries: [{ time: 0, moofOffset: 900, traf: 1, trun: 1, sample: 1 }],
      }),
    );
    const mfra = box('mfra', concat(tfra, box('mfro', mfroPayload(48))));
    const result = parseMfra(walkOne(mfra));

    expect(result.trackEntries).toHaveLength(1);
    expect(result.trackEntries[0]?.trackId).toBe(1);
    expect(result.trackEntries[0]?.entries[0]).toEqual({
      time: 0,
      moofOffset: 900,
      trafNumber: 1,
      trunNumber: 1,
      sampleNumber: 1,
    });
    expect(result.declaredSize).toBe(48);
  });

  it('decodes variable-width traf/trun/sample numbers', () => {
    const tfra = box(
      'tfra',
      tfraPayload({
        lenTraf: 2,
        lenTrun: 2,
        lenSample: 4,
        entries: [{ time: 10, moofOffset: 2048, traf: 0x0102, trun: 0x0304, sample: 0x01020304 }],
      }),
    );
    const result = parseMfra(walkOne(box('mfra', concat(tfra, box('mfro', mfroPayload(0))))));
    const e = result.trackEntries[0]?.entries[0];
    expect(e?.trafNumber).toBe(0x0102);
    expect(e?.trunNumber).toBe(0x0304);
    expect(e?.sampleNumber).toBe(0x01020304);
  });

  it('parses a v1 tfra with u64 time/moof_offset', () => {
    const tfra = box(
      'tfra',
      tfraPayload({
        version: 1,
        entries: [{ time: 123456, moofOffset: 7654321, traf: 1, trun: 2, sample: 3 }],
      }),
    );
    const result = parseMfra(walkOne(box('mfra', concat(tfra, box('mfro', mfroPayload(0))))));
    const e = result.trackEntries[0]?.entries[0];
    expect(e?.time).toBe(123456);
    expect(e?.moofOffset).toBe(7654321);
    expect(e?.sampleNumber).toBe(3);
  });

  it('handles multiple tfra boxes (one per track)', () => {
    const t1 = box('tfra', tfraPayload({ trackId: 1, entries: [] }));
    const t2 = box('tfra', tfraPayload({ trackId: 2, entries: [] }));
    const result = parseMfra(walkOne(box('mfra', concat(t1, t2, box('mfro', mfroPayload(0))))));
    expect(result.trackEntries.map((t) => t.trackId)).toEqual([1, 2]);
  });

  it('returns declaredSize=null when mfro is absent', () => {
    const tfra = box('tfra', tfraPayload({ entries: [] }));
    const result = parseMfra(walkOne(box('mfra', tfra)));
    expect(result.declaredSize).toBeNull();
  });

  // -- rejection paths -------------------------------------------------------

  it('throws on an unsupported tfra version', () => {
    const payload = tfraPayload({ entries: [] });
    payload[0] = 2;
    expect(() => parseMfra(walkOne(box('mfra', box('tfra', payload))))).toThrow(
      Mp4MfraOutOfBoundsError,
    );
  });

  it('throws when a tfra payload is shorter than its fixed header', () => {
    expect(() => parseMfra(walkOne(box('mfra', box('tfra', new Uint8Array(10)))))).toThrow(
      Mp4MfraOutOfBoundsError,
    );
  });

  it('throws when number_of_entry exceeds the payload length', () => {
    const payload = tfraPayload({ entries: [] });
    new DataView(payload.buffer).setUint32(12, 3, false); // claim 3 entries, ship 0
    expect(() => parseMfra(walkOne(box('mfra', box('tfra', payload))))).toThrow(
      Mp4MfraOutOfBoundsError,
    );
  });

  it('throws when number_of_entry exceeds MAX_TFRA_ENTRIES', () => {
    const payload = tfraPayload({ entries: [] });
    new DataView(payload.buffer).setUint32(12, 1_000_001, false);
    expect(() => parseMfra(walkOne(box('mfra', box('tfra', payload))))).toThrow(
      Mp4MfraOutOfBoundsError,
    );
  });

  it('throws when there are more than MAX_MFRA_TFRA_BOXES tfra boxes', () => {
    const tfras: Uint8Array[] = [];
    for (let i = 0; i < 257; i++) tfras.push(box('tfra', tfraPayload({ entries: [] })));
    expect(() => parseMfra(walkOne(box('mfra', concat(...tfras))))).toThrow(
      Mp4MfraOutOfBoundsError,
    );
  });

  it('rejects a v1 tfra time beyond the safe-integer range', () => {
    const payload = tfraPayload({
      version: 1,
      entries: [{ time: 0, moofOffset: 0, traf: 1, trun: 1, sample: 1 }],
    });
    // Overwrite the high u32 of the first entry's time (offset 16) with a huge value.
    new DataView(payload.buffer).setUint32(16, 0x00200000, false);
    expect(() => parseMfra(walkOne(box('mfra', box('tfra', payload))))).toThrow(
      Mp4MfraOutOfBoundsError,
    );
  });
});

// ---------------------------------------------------------------------------
// End-to-end parser wiring: sidx + mfra surface on the Mp4File
// ---------------------------------------------------------------------------

/** Minimal v0 sidx payload with one media reference. */
function sidxPayload(): Uint8Array {
  const out = new Uint8Array(24 + 12);
  const view = new DataView(out.buffer);
  view.setUint32(4, 1, false); // reference_ID
  view.setUint32(8, 90000, false); // timescale
  view.setUint32(12, 0, false); // EPT
  view.setUint32(16, 0, false); // first_offset
  view.setUint16(22, 1, false); // reference_count
  view.setUint32(24, 0x00000064, false); // ref0: type=0, referenced_size=100
  view.setUint32(28, 3000, false); // subsegment_duration
  view.setUint32(32, 0x90000000, false); // starts_with_SAP=1, SAP_type=1
  return out;
}

describe('parseMp4 surfaces sidx + mfra (D.3 wiring)', () => {
  it('populates file.sidx and file.mfra from appended boxes', () => {
    const base = buildMinimalFmp4({ sampleCount: 2, sampleSize: 4 });
    const tfra = box(
      'tfra',
      tfraPayload({
        trackId: 1,
        entries: [{ time: 0, moofOffset: 900, traf: 1, trun: 1, sample: 1 }],
      }),
    );
    const mfra = box('mfra', concat(tfra, box('mfro', mfroPayload(0))));
    const file = parseMp4(concat(base, box('sidx', sidxPayload()), mfra));

    expect(file.isFragmented).toBe(true);
    expect(file.sidx).toHaveLength(1);
    expect(file.sidx[0]?.referenceId).toBe(1);
    expect(file.sidx[0]?.references[0]?.referencedSize).toBe(100);
    expect(file.sidx[0]?.references[0]?.startsWithSap).toBe(true);

    expect(file.mfra).not.toBeNull();
    expect(file.mfra?.trackEntries).toHaveLength(1);
    expect(file.mfra?.trackEntries[0]?.entries[0]?.moofOffset).toBe(900);
  });
});
