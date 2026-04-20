/**
 * Tests for EBML element walker (element.ts).
 *
 * Covers security cap branches:
 * - EbmlTooManyElementsError (maxElements exceeded)
 * - EbmlElementTooLargeError (per-element payload size cap)
 * - EbmlDepthExceededError (depth > MAX_NEST_DEPTH)
 */

import { describe, expect, it } from 'vitest';
import {
  findChild,
  findChildren,
  readChildren,
  readElementHeader,
  walkElements,
} from './element.ts';
import {
  EbmlDepthExceededError,
  EbmlElementTooLargeError,
  EbmlTooManyElementsError,
  EbmlTruncatedError,
  EbmlUnknownSizeError,
} from './errors.ts';
import { writeVintId, writeVintSize } from './vint.ts';

const MAX_NEST_DEPTH = 8;

/**
 * Build a minimal EBML element header for a 1-byte ID element with payload.
 * ID: 0xA3 (1-byte ID, marker bit = 0x80), Size: payload.length (1-byte VINT).
 */
function makeSimpleElement(payloadLength: number): Uint8Array {
  // ID: 0xA3 (1-byte, bit 7 set = VINT width 1, value retained = 0xA3)
  // Size: 0x80 | payloadLength (1-byte size VINT, marker bit stripped → payloadLength)
  const header = new Uint8Array([0xa3, 0x80 | payloadLength]);
  const payload = new Uint8Array(payloadLength);
  const out = new Uint8Array(header.length + payload.length);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

/**
 * Concatenate multiple Uint8Arrays.
 */
function concat(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

describe('readElementHeader', () => {
  it('returns null when fewer than 2 bytes remain', () => {
    const bytes = new Uint8Array([0xa3]); // 1 byte only
    expect(readElementHeader(bytes, 0, 1)).toBeNull();
  });

  it('throws EbmlUnknownSizeError when size VINT is all-ones (unknown size)', () => {
    // 0xA3 = 1-byte ID, 0xFF = 1-byte unknown-size VINT.
    const bytes = new Uint8Array([0xa3, 0xff]);
    expect(() => readElementHeader(bytes, 0, bytes.length)).toThrow(EbmlUnknownSizeError);
  });

  it('returns element with size=-1n when allowUnknownSize=true', () => {
    const bytes = new Uint8Array([0xa3, 0xff]);
    const elem = readElementHeader(bytes, 0, bytes.length, true);
    expect(elem?.size).toBe(-1n);
    expect(elem?.nextOffset).toBe(bytes.length);
  });

  it('throws EbmlTruncatedError when claimed size exceeds container boundary', () => {
    // 0xA3 (1-byte ID), 0x85 (size=5), but only 2 bytes of payload (not 5).
    const bytes = new Uint8Array([0xa3, 0x85, 0x01, 0x02]); // claims 5 bytes, only 2 available
    expect(() => readElementHeader(bytes, 0, bytes.length)).toThrow(EbmlTruncatedError);
  });
});

describe('walkElements security caps', () => {
  it('throws EbmlTooManyElementsError when element count exceeds maxElements', () => {
    // Build 3 simple elements; set maxElements=2 so the third triggers the cap.
    const elem = makeSimpleElement(1);
    const bytes = concat([elem, elem, elem]);
    const count = { value: 0 };

    expect(() => {
      const gen = walkElements(bytes, 0, bytes.length, 0, count, 2, 64 * 1024 * 1024, 0, 0);
      // Drain the generator.
      for (const _ of gen) {
        // consume
      }
    }).toThrow(EbmlTooManyElementsError);
  });

  it('throws EbmlElementTooLargeError when element payload exceeds maxElementPayloadBytes', () => {
    // Build an element with a large declared payload size.
    // Use a 2-byte size VINT to declare 200 bytes payload, but cap maxElementPayloadBytes=10.
    // ID: 0xA3 (1 byte), Size: 0x40 0xC8 (2-byte VINT → 200 - 0x4000... wait, need proper encoding)
    // 2-byte size VINT: first byte 0x40|(size>>8), second byte size&0xff for size < 16383.
    // size=200: 0x40|0=0x40, 0xC8 → value = 200 ✓
    const bytes = new Uint8Array([0xa3, 0x40, 0xc8, ...new Array(200).fill(0)]);
    const count = { value: 0 };
    const maxPayload = 10;

    expect(() => {
      const gen = walkElements(bytes, 0, bytes.length, 0, count, 100_000, maxPayload, 0, 0);
      for (const _ of gen) {
        // consume
      }
    }).toThrow(EbmlElementTooLargeError);
  });

  it('throws EbmlDepthExceededError when depth exceeds MAX_NEST_DEPTH', () => {
    const elem = makeSimpleElement(1);
    const count = { value: 0 };

    expect(() => {
      const gen = walkElements(
        elem,
        0,
        elem.length,
        MAX_NEST_DEPTH + 1, // depth > MAX_NEST_DEPTH
        count,
        100_000,
        64 * 1024 * 1024,
        0,
        0,
      );
      for (const _ of gen) {
        // consume
      }
    }).toThrow(EbmlDepthExceededError);
  });

  it('skips elements that are clusterId or segmentId (no size cap)', () => {
    // Build an element with large declared size, but use clusterId so cap is skipped.
    const clusterId = 0xa3; // use same ID as our element
    const bytes = new Uint8Array([0xa3, 0x40, 0xc8, ...new Array(200).fill(0)]);
    const count = { value: 0 };
    const maxPayload = 10; // tiny cap — would throw if not skipped for clusterId

    // Should NOT throw because elem.id === clusterId.
    const results: number[] = [];
    const gen = walkElements(bytes, 0, bytes.length, 0, count, 100_000, maxPayload, clusterId, 0);
    for (const elem of gen) {
      results.push(elem.id);
    }
    expect(results).toHaveLength(1);
    expect(results[0]).toBe(clusterId);
  });
});

// ---------------------------------------------------------------------------
// readChildren / findChild / findChildren — ported from container-mkv tests
// during Phase 3 wrap-up extraction (these functions had 53% line coverage
// in ebml without these tests because mkv was the only consumer testing them).
// ---------------------------------------------------------------------------

function makeElementWithId(id: number, payload: Uint8Array): Uint8Array {
  return concat([writeVintId(id), writeVintSize(BigInt(payload.length)), payload]);
}

describe('readChildren', () => {
  it('parses two sibling elements', () => {
    const e1 = makeElementWithId(0x86, new Uint8Array([0xaa]));
    const e2 = makeElementWithId(0x83, new Uint8Array([0x01]));
    const payload = concat([e1, e2]);
    const children = readChildren(
      payload,
      0,
      payload.length,
      1,
      { value: 0 },
      100,
      64 * 1024 * 1024,
      0x1f43b675,
      0x18538067,
    );
    expect(children).toHaveLength(2);
    expect(children[0]?.id).toBe(0x86);
    expect(children[1]?.id).toBe(0x83);
  });
});

describe('findChild / findChildren', () => {
  it('finds a child by ID', () => {
    const e1 = makeElementWithId(0x86, new Uint8Array([0xaa]));
    const e2 = makeElementWithId(0x83, new Uint8Array([0x01]));
    const payload = concat([e1, e2]);
    const children = readChildren(
      payload,
      0,
      payload.length,
      1,
      { value: 0 },
      100,
      64 * 1024 * 1024,
      0x1f43b675,
      0x18538067,
    );
    const found = findChild(children, 0x83);
    expect(found).toBeDefined();
    expect(found?.id).toBe(0x83);
  });

  it('returns undefined when child not found', () => {
    expect(findChild([], 0x86)).toBeUndefined();
  });

  it('finds all children with a given ID', () => {
    const e1 = makeElementWithId(0x86, new Uint8Array([0xaa]));
    const e2 = makeElementWithId(0x86, new Uint8Array([0xbb]));
    const payload = concat([e1, e2]);
    const children = readChildren(
      payload,
      0,
      payload.length,
      1,
      { value: 0 },
      100,
      64 * 1024 * 1024,
      0x1f43b675,
      0x18538067,
    );
    const found = findChildren(children, 0x86);
    expect(found).toHaveLength(2);
  });
});
