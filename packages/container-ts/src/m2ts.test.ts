/**
 * Tests for m2ts.ts — M2TS (192-byte BDAV/AVCHD) normalization.
 *
 * Fixtures are built programmatically; no binary files are committed.
 */

import { describe, expect, it } from 'vitest';
import { maybeNormalizeM2ts } from './m2ts.ts';

// ---------------------------------------------------------------------------
// Synthetic packet builders (sync-byte layout only — no valid PSI needed here)
// ---------------------------------------------------------------------------

function tsPacket(marker: number): Uint8Array {
  const p = new Uint8Array(188);
  p[0] = 0x47;
  p[1] = marker;
  return p;
}

function m2tsPacket(marker: number): Uint8Array {
  const p = new Uint8Array(192);
  // 4-byte TP_extra_header (arbitrary, none equal to 0x47).
  p.set([0x10, 0x20, 0x30, 0x40], 0);
  p[4] = 0x47;
  p[5] = marker;
  return p;
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('maybeNormalizeM2ts', () => {
  it('returns null for a plain 188-byte TS stream', () => {
    const ts = concat(tsPacket(1), tsPacket(2), tsPacket(3));
    expect(maybeNormalizeM2ts(ts)).toBeNull();
  });

  it('strips the 4-byte prefixes from a 192-byte M2TS stream', () => {
    const m2ts = concat(m2tsPacket(1), m2tsPacket(2), m2tsPacket(3));
    const out = maybeNormalizeM2ts(m2ts);
    expect(out).not.toBeNull();
    expect(out?.length).toBe(3 * 188);
    // Each stripped packet starts with the sync byte + its marker.
    expect(out?.[0]).toBe(0x47);
    expect(out?.[1]).toBe(1);
    expect(out?.[188]).toBe(0x47);
    expect(out?.[189]).toBe(2);
    expect(out?.[376]).toBe(0x47);
    expect(out?.[377]).toBe(3);
  });

  it('drops a trailing partial packet (keeps only whole 188-byte packets)', () => {
    // Two full M2TS packets + 10 stray trailing bytes.
    const m2ts = concat(m2tsPacket(1), m2tsPacket(2), new Uint8Array(10));
    const out = maybeNormalizeM2ts(m2ts);
    expect(out?.length).toBe(2 * 188);
  });

  it('locks onto M2TS sync even with leading bytes before the first packet', () => {
    const m2ts = concat(new Uint8Array([0x00, 0x99]), m2tsPacket(7), m2tsPacket(8), m2tsPacket(9));
    const out = maybeNormalizeM2ts(m2ts);
    expect(out?.length).toBe(3 * 188);
    expect(out?.[1]).toBe(7);
  });

  it('returns null for non-TS data (no sync pattern)', () => {
    expect(maybeNormalizeM2ts(new Uint8Array(600))).toBeNull();
  });

  it('returns null for a too-short buffer', () => {
    expect(maybeNormalizeM2ts(new Uint8Array([0x47, 0x00, 0x01]))).toBeNull();
  });
});
