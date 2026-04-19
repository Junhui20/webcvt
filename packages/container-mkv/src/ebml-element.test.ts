/**
 * Tests for EBML element parsing utilities.
 */

import { describe, expect, it } from 'vitest';
import {
  type EbmlElement,
  findChild,
  findChildren,
  parseFlatChildren,
  readChildren,
  readElementHeader,
} from './ebml-element.ts';
import { MkvElementTooLargeError, MkvTooManyElementsError, MkvUnknownSizeError } from './errors.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeVintId(id: number): Uint8Array {
  if (id >= 0x10000000)
    return new Uint8Array([(id >> 24) & 0xff, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  if (id >= 0x200000) return new Uint8Array([(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  if (id >= 0x4000) return new Uint8Array([(id >> 8) & 0xff, id & 0xff]);
  return new Uint8Array([id & 0xff]);
}

function encodeVintSize(size: number): Uint8Array {
  if (size < 127) return new Uint8Array([0x80 | size]);
  if (size < 16383) return new Uint8Array([0x40 | (size >> 8), size & 0xff]);
  return new Uint8Array([0x20 | (size >> 16), (size >> 8) & 0xff, size & 0xff]);
}

function concatUint8(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function makeElement(id: number, payload: Uint8Array): Uint8Array {
  return concatUint8([encodeVintId(id), encodeVintSize(payload.length), payload]);
}

// ---------------------------------------------------------------------------
// readElementHeader tests
// ---------------------------------------------------------------------------

describe('readElementHeader', () => {
  it('parses a basic 1-byte element', () => {
    const elem = makeElement(0x86, new Uint8Array([0x01]));
    const result = readElementHeader(elem, 0, elem.length);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(0x86);
    expect(result?.size).toBe(1n);
    expect(result?.payloadOffset).toBe(2);
  });

  it('returns null when offset is at container end', () => {
    const elem = makeElement(0x86, new Uint8Array([0x01]));
    expect(readElementHeader(elem, elem.length, elem.length)).toBeNull();
  });

  it('throws MkvUnknownSizeError when size is unknown and allowUnknownSize is false', () => {
    const bytes = new Uint8Array([0x86, 0xff]); // 1-byte ID, unknown size
    expect(() => readElementHeader(bytes, 0, bytes.length, false)).toThrow(MkvUnknownSizeError);
  });

  it('returns element with size=-1n when allowUnknownSize is true', () => {
    const bytes = new Uint8Array([0x86, 0xff]);
    const result = readElementHeader(bytes, 0, bytes.length, true);
    expect(result?.size).toBe(-1n);
  });
});

// ---------------------------------------------------------------------------
// readChildren tests
// ---------------------------------------------------------------------------

describe('readChildren', () => {
  it('parses two sibling elements', () => {
    const e1 = makeElement(0x86, new Uint8Array([0xaa]));
    const e2 = makeElement(0x83, new Uint8Array([0x01]));
    const payload = concatUint8([e1, e2]);
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

// ---------------------------------------------------------------------------
// findChild / findChildren tests
// ---------------------------------------------------------------------------

describe('findChild / findChildren', () => {
  it('finds a child by ID', () => {
    const e1 = makeElement(0x86, new Uint8Array([0xaa]));
    const e2 = makeElement(0x83, new Uint8Array([0x01]));
    const payload = concatUint8([e1, e2]);
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
    const e1 = makeElement(0x86, new Uint8Array([0xaa]));
    const e2 = makeElement(0x86, new Uint8Array([0xbb]));
    const payload = concatUint8([e1, e2]);
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

// ---------------------------------------------------------------------------
// parseFlatChildren — element count cap test
// ---------------------------------------------------------------------------

describe('parseFlatChildren — element count cap', () => {
  it('throws MkvTooManyElementsError when elementCount exceeds maxElements', () => {
    // Build a parent element with many tiny children.
    const childCount = 50;
    const children: Uint8Array[] = [];
    for (let i = 0; i < childCount; i++) {
      children.push(makeElement(0xd9, new Uint8Array(0)));
    }
    const payload = concatUint8(children);
    const parentElem: EbmlElement = {
      id: 0xae,
      size: BigInt(payload.length),
      payloadOffset: 0,
      nextOffset: payload.length,
      idWidth: 1,
      sizeWidth: 1,
    };
    const elementCount = { value: 40 }; // already at 40
    // maxElements = 50 → will exceed on the 11th child
    expect(() => parseFlatChildren(payload, parentElem, elementCount, 50)).toThrow(
      MkvTooManyElementsError,
    );
  });

  it('throws MkvElementTooLargeError when a child exceeds maxPayloadBytes', () => {
    // Build a parent with one large-seeming child (fake large size in bytes).
    // We use a real element but set maxPayloadBytes very low.
    const child = makeElement(0x86, new Uint8Array(10));
    const parentElem: EbmlElement = {
      id: 0xae,
      size: BigInt(child.length),
      payloadOffset: 0,
      nextOffset: child.length,
      idWidth: 1,
      sizeWidth: 1,
    };
    expect(() => parseFlatChildren(child, parentElem, { value: 0 }, 100, 5)).toThrow(
      MkvElementTooLargeError,
    );
  });
});
