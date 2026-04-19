/**
 * Tests for box-tree.ts — iterative box walker.
 *
 * Covers:
 * - Top-level box discovery
 * - Container descent (moov children)
 * - Depth cap enforcement
 * - Box count cap enforcement
 * - Invalid box (overrun) detection
 * - findChild / findChildren helpers
 */

import { describe, expect, it } from 'vitest';
import { findChild, findChildren, walkBoxes, walkPayloadBoxes } from './box-tree.ts';
import { Mp4DepthExceededError, Mp4InvalidBoxError, Mp4TooManyBoxesError } from './errors.ts';

// ---------------------------------------------------------------------------
// Box construction helpers
// ---------------------------------------------------------------------------

function buildSimpleBox(type: string, payloadBytes: Uint8Array = new Uint8Array(0)): Uint8Array {
  const size = 8 + payloadBytes.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, size, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i) & 0xff;
  out.set(payloadBytes, 8);
  return out;
}

function buildContainerBox(type: string, children: Uint8Array[]): Uint8Array {
  const childrenBytes = concatAll(children);
  return buildSimpleBox(type, childrenBytes);
}

function concatAll(parts: Uint8Array[]): Uint8Array {
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

describe('walkBoxes — top level', () => {
  it('discovers top-level boxes', () => {
    const ftyp = buildSimpleBox('ftyp', new Uint8Array(8));
    const moov = buildSimpleBox('moov', new Uint8Array(0));
    const mdat = buildSimpleBox('mdat', new Uint8Array(16));
    const data = concatAll([ftyp, moov, mdat]);
    const boxCount = { value: 0 };
    const boxes = walkBoxes(data, 0, data.length, boxCount);
    expect(boxes.length).toBe(3);
    expect(boxes[0]!.type).toBe('ftyp');
    expect(boxes[1]!.type).toBe('moov');
    expect(boxes[2]!.type).toBe('mdat');
    expect(boxCount.value).toBe(3);
  });

  it('descends into moov and finds children', () => {
    const mvhd = buildSimpleBox('mvhd', new Uint8Array(4));
    const trak = buildSimpleBox('trak', new Uint8Array(4));
    const moov = buildContainerBox('moov', [mvhd, trak]);
    const ftyp = buildSimpleBox('ftyp', new Uint8Array(8));
    const data = concatAll([ftyp, moov]);
    const boxCount = { value: 0 };
    const boxes = walkBoxes(data, 0, data.length, boxCount);
    const moovBox = boxes.find((b) => b.type === 'moov');
    expect(moovBox).toBeDefined();
    expect(moovBox!.children.length).toBe(2);
    expect(moovBox!.children[0]!.type).toBe('mvhd');
    expect(moovBox!.children[1]!.type).toBe('trak');
  });

  it('throws Mp4TooManyBoxesError when box count exceeds MAX_BOXES_PER_FILE', () => {
    // Build 10,001 tiny boxes.
    const parts: Uint8Array[] = [];
    for (let i = 0; i < 10_001; i++) {
      parts.push(buildSimpleBox('free', new Uint8Array(0)));
    }
    const data = concatAll(parts);
    const boxCount = { value: 0 };
    expect(() => walkBoxes(data, 0, data.length, boxCount)).toThrow(Mp4TooManyBoxesError);
  });

  it('throws Mp4InvalidBoxError when a box size overruns the file', () => {
    // A box claiming size=1000 when only 100 bytes are in the file.
    const buf = new Uint8Array(100);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 1000, false);
    buf[4] = 0x6d;
    buf[5] = 0x6f;
    buf[6] = 0x6f;
    buf[7] = 0x76; // 'moov'
    // But we give the walker a rangeEnd = 100.
    const boxCount = { value: 0 };
    expect(() => walkBoxes(buf, 0, 100, boxCount)).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError when a non-mdat box exceeds the 64 MiB per-box cap', () => {
    // Build a box header claiming size = 64 MiB + 1 for a 'free' box.
    const overCapSize = 64 * 1024 * 1024 + 1;
    const buf = new Uint8Array(20);
    const view = new DataView(buf.buffer);
    view.setUint32(0, overCapSize, false);
    buf[4] = 0x66;
    buf[5] = 0x72;
    buf[6] = 0x65;
    buf[7] = 0x65; // 'free'
    // We pass rangeEnd as overCapSize so the boundary check passes, but the cap check fires.
    const boxCount = { value: 0 };
    const bigBuf = new Uint8Array(overCapSize);
    bigBuf.set(buf, 0);
    expect(() => walkBoxes(bigBuf, 0, overCapSize, boxCount)).toThrow(Mp4InvalidBoxError);
  });

  it('returns empty array for empty input', () => {
    const boxCount = { value: 0 };
    const boxes = walkBoxes(new Uint8Array(0), 0, 0, boxCount);
    expect(boxes).toHaveLength(0);
  });
});

describe('findChild / findChildren', () => {
  it('findChild returns the first matching child', () => {
    const mvhd = buildSimpleBox('mvhd', new Uint8Array(4));
    const trak = buildSimpleBox('trak', new Uint8Array(4));
    const moov = buildContainerBox('moov', [mvhd, trak]);
    const data = moov;
    const boxCount = { value: 0 };
    const boxes = walkBoxes(data, 0, data.length, boxCount);
    const moovBox = boxes[0]!;
    const found = findChild(moovBox, 'mvhd');
    expect(found).toBeDefined();
    expect(found!.type).toBe('mvhd');
  });

  it('findChild returns undefined for missing child', () => {
    const mvhd = buildSimpleBox('mvhd', new Uint8Array(4));
    const moov = buildContainerBox('moov', [mvhd]);
    const boxCount = { value: 0 };
    const boxes = walkBoxes(moov, 0, moov.length, boxCount);
    expect(findChild(boxes[0]!, 'trak')).toBeUndefined();
  });

  it('findChildren returns all matching children', () => {
    // Use 'free' (non-container type) so the walker does not try to descend
    // into the synthetic zero-byte payloads and misread them as child headers.
    const free1 = buildSimpleBox('free', new Uint8Array(4));
    const free2 = buildSimpleBox('free', new Uint8Array(4));
    const moov = buildContainerBox('moov', [free1, free2]);
    const boxCount = { value: 0 };
    const boxes = walkBoxes(moov, 0, moov.length, boxCount);
    const frees = findChildren(boxes[0]!, 'free');
    expect(frees).toHaveLength(2);
  });
});

describe('walkBoxes — boundary check (Sec-H-1)', () => {
  it('throws Mp4InvalidBoxError when a child box overruns its parent by exactly 1 byte', () => {
    // Build a moov parent containing a child 'free' box that claims one extra byte.
    // Parent moov payload = 16 bytes.
    // Child 'free' claims size = 17 (16 payload + 1 extra byte overrun).
    const childClaimed = 17; // overruns by 1
    const childBuf = new Uint8Array(16); // actual bytes in payload region
    const childView = new DataView(childBuf.buffer);
    childView.setUint32(0, childClaimed, false);
    childBuf[4] = 0x66;
    childBuf[5] = 0x72;
    childBuf[6] = 0x65;
    childBuf[7] = 0x65; // 'free'
    // moov: size(4)+type(4)+child(16) = 24 bytes total, payload = 16 bytes
    const moovBuf = new Uint8Array(24);
    const moovView = new DataView(moovBuf.buffer);
    moovView.setUint32(0, 24, false); // moov size
    moovBuf[4] = 0x6d;
    moovBuf[5] = 0x6f;
    moovBuf[6] = 0x6f;
    moovBuf[7] = 0x76; // 'moov'
    moovBuf.set(childBuf, 8);
    const boxCount = { value: 0 };
    expect(() => walkBoxes(moovBuf, 0, moovBuf.length, boxCount)).toThrow(Mp4InvalidBoxError);
  });
});

describe('walkBoxes — depth cap', () => {
  it('throws Mp4DepthExceededError when nesting exceeds MAX_DEPTH', () => {
    // Build 11 levels of moov containers (each wrapping the next).
    let inner: Uint8Array = buildSimpleBox('leaf', new Uint8Array(4));
    for (let i = 0; i < 12; i++) {
      inner = buildContainerBox('moov', [inner]);
    }
    const boxCount = { value: 0 };
    expect(() => walkBoxes(inner, 0, inner.length, boxCount)).toThrow(Mp4DepthExceededError);
  });
});

describe('walkPayloadBoxes', () => {
  it('parses flat child boxes from a payload region', () => {
    const child1 = buildSimpleBox('esds', new Uint8Array(4));
    const child2 = buildSimpleBox('sttf', new Uint8Array(4));
    const combined = concatAll([child1, child2]);
    const boxCount = { value: 0 };
    const boxes = walkPayloadBoxes(combined, 0, combined.length, 1, boxCount);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.type).toBe('esds');
    expect(boxes[1]!.type).toBe('sttf');
    expect(boxCount.value).toBe(2);
  });

  it('returns empty array for empty payload region', () => {
    const boxCount = { value: 0 };
    const boxes = walkPayloadBoxes(new Uint8Array(0), 0, 0, 1, boxCount);
    expect(boxes).toHaveLength(0);
  });

  it('throws Mp4DepthExceededError when depth exceeds MAX_DEPTH', () => {
    const child = buildSimpleBox('esds', new Uint8Array(4));
    const boxCount = { value: 0 };
    expect(() => walkPayloadBoxes(child, 0, child.length, 11, boxCount)).toThrow(
      Mp4DepthExceededError,
    );
  });

  it('throws Mp4InvalidBoxError when child box overruns payload boundary', () => {
    // Build a box claiming size > available payload.
    const buf = new Uint8Array(16);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 100, false); // claims 100 bytes but payload only has 16
    buf[4] = 0x65;
    buf[5] = 0x73;
    buf[6] = 0x64;
    buf[7] = 0x73; // 'esds'
    const boxCount = { value: 0 };
    expect(() => walkPayloadBoxes(buf, 0, 16, 1, boxCount)).toThrow(Mp4InvalidBoxError);
  });
});
