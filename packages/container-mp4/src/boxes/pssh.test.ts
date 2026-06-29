/**
 * Tests for boxes/pssh.ts — Protection System Specific Header parser.
 *
 * All fixtures are built programmatically; no binary files are committed.
 * Spec: ISO/IEC 23001-7:2016 §8.1 (Common Encryption) + ISO/IEC 14496-12 FullBox.
 */

import { describe, expect, it } from 'vitest';
import { MAX_PSSH_DATA_SIZE, MAX_PSSH_KIDS } from '../constants.ts';
import {
  Mp4PsshDataSizeTooLargeError,
  Mp4PsshInvalidError,
  Mp4PsshKidCountTooLargeError,
} from '../errors.ts';
import { bytesToHex, parsePssh } from './pssh.ts';

// Widevine SystemID edef8ba9-79d6-4ace-a3c8-27dcd51d21ed.
const WIDEVINE_SYSTEM_ID = new Uint8Array([
  0xed, 0xef, 0x8b, 0xa9, 0x79, 0xd6, 0x4a, 0xce, 0xa3, 0xc8, 0x27, 0xdc, 0xd5, 0x1d, 0x21, 0xed,
]);
const WIDEVINE_HEX = 'edef8ba979d64acea3c827dcd51d21ed';

function kidBytes(seed: number): Uint8Array {
  return new Uint8Array(Array.from({ length: 16 }, (_, i) => (seed + i) & 0xff));
}

// ---------------------------------------------------------------------------
// Raw pssh-payload builders (bytes AFTER the 8-byte box header)
// ---------------------------------------------------------------------------

function psshV0(opts: { systemId?: Uint8Array; data?: Uint8Array }): Uint8Array {
  const data = opts.data ?? new Uint8Array(0);
  const out = new Uint8Array(4 + 16 + 4 + data.length);
  out[0] = 0; // version 0
  out.set(opts.systemId ?? WIDEVINE_SYSTEM_ID, 4);
  new DataView(out.buffer).setUint32(20, data.length, false);
  out.set(data, 24);
  return out;
}

function psshV1(opts: {
  systemId?: Uint8Array;
  kids?: Uint8Array[];
  data?: Uint8Array;
}): Uint8Array {
  const kids = opts.kids ?? [];
  const data = opts.data ?? new Uint8Array(0);
  const out = new Uint8Array(4 + 16 + 4 + kids.length * 16 + 4 + data.length);
  const view = new DataView(out.buffer);
  out[0] = 1; // version 1
  out.set(opts.systemId ?? WIDEVINE_SYSTEM_ID, 4);
  view.setUint32(20, kids.length, false);
  let cursor = 24;
  for (const kid of kids) {
    out.set(kid, cursor);
    cursor += 16;
  }
  view.setUint32(cursor, data.length, false);
  cursor += 4;
  out.set(data, cursor);
  return out;
}

// ---------------------------------------------------------------------------
// bytesToHex
// ---------------------------------------------------------------------------

describe('bytesToHex', () => {
  it('lowercases and zero-pads each byte', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x0f, 0xa0, 0xff]))).toBe('000fa0ff');
  });

  it('returns an empty string for an empty range', () => {
    expect(bytesToHex(new Uint8Array(0))).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parsePssh — happy paths
// ---------------------------------------------------------------------------

describe('parsePssh', () => {
  it('parses a v0 pssh with a data blob and no KIDs', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const pssh = parsePssh(psshV0({ data }));
    expect(pssh.systemId).toBe(WIDEVINE_HEX);
    expect(pssh.kids).toEqual([]);
    expect(pssh.dataSize).toBe(5);
  });

  it('parses a v0 pssh with an empty data blob', () => {
    const pssh = parsePssh(psshV0({}));
    expect(pssh.dataSize).toBe(0);
    expect(pssh.kids).toEqual([]);
  });

  it('parses a v1 pssh with multiple KIDs', () => {
    const data = new Uint8Array([0xaa, 0xbb]);
    const pssh = parsePssh(psshV1({ kids: [kidBytes(0x10), kidBytes(0x20)], data }));
    expect(pssh.systemId).toBe(WIDEVINE_HEX);
    expect(pssh.kids).toHaveLength(2);
    expect(pssh.kids[0]).toBe(bytesToHex(kidBytes(0x10)));
    expect(pssh.kids[1]).toBe(bytesToHex(kidBytes(0x20)));
    expect(pssh.dataSize).toBe(2);
  });

  it('parses a v1 pssh with zero KIDs', () => {
    const pssh = parsePssh(psshV1({ kids: [] }));
    expect(pssh.kids).toEqual([]);
    expect(pssh.dataSize).toBe(0);
  });

  // -- rejection / cap paths -------------------------------------------------

  it('throws on a payload too short for version+flags+SystemID', () => {
    expect(() => parsePssh(new Uint8Array(19))).toThrow(Mp4PsshInvalidError);
  });

  it('throws on an unsupported version (>1)', () => {
    const bytes = psshV0({});
    bytes[0] = 2;
    expect(() => parsePssh(bytes)).toThrow(Mp4PsshInvalidError);
  });

  it('throws when a v1 payload is truncated before KID_count', () => {
    const bytes = new Uint8Array(20);
    bytes[0] = 1; // version 1, but no room for KID_count
    expect(() => parsePssh(bytes)).toThrow(Mp4PsshInvalidError);
  });

  it('throws when a v1 payload is too short for the declared KID list', () => {
    const bytes = psshV1({ kids: [kidBytes(1)] });
    // Claim 5 KIDs but keep the single-KID length.
    new DataView(bytes.buffer).setUint32(20, 5, false);
    expect(() => parsePssh(bytes)).toThrow(Mp4PsshInvalidError);
  });

  it('throws when the payload is truncated before DataSize', () => {
    // v0 needs 24 bytes (4+16+4); give 23.
    const bytes = new Uint8Array(23);
    expect(() => parsePssh(bytes)).toThrow(Mp4PsshInvalidError);
  });

  it('throws when DataSize overruns the box length', () => {
    const bytes = psshV0({ data: new Uint8Array(4) });
    // Declare DataSize=1000 but only 4 data bytes follow.
    new DataView(bytes.buffer).setUint32(20, 1000, false);
    expect(() => parsePssh(bytes)).toThrow(Mp4PsshInvalidError);
  });

  it('throws Mp4PsshKidCountTooLargeError when KID_count exceeds the cap', () => {
    const bytes = psshV1({ kids: [] });
    new DataView(bytes.buffer).setUint32(20, MAX_PSSH_KIDS + 1, false);
    expect(() => parsePssh(bytes)).toThrow(Mp4PsshKidCountTooLargeError);
  });

  it('throws Mp4PsshDataSizeTooLargeError when DataSize exceeds the hard cap', () => {
    const bytes = psshV0({ data: new Uint8Array(0) });
    new DataView(bytes.buffer).setUint32(20, MAX_PSSH_DATA_SIZE + 1, false);
    expect(() => parsePssh(bytes)).toThrow(Mp4PsshDataSizeTooLargeError);
  });
});
