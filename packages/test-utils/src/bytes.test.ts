import { describe, expect, it } from 'vitest';
import { assertBytesEqual, concatBytes, diffBytes, hex } from './bytes.ts';

describe('hex', () => {
  it('parses spaced hex', () => {
    expect(hex('89 50 4e 47')).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it('parses unspaced hex', () => {
    expect(hex('89504e47')).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it('throws on odd-length input', () => {
    expect(() => hex('abc')).toThrow(/odd length/);
  });

  it('throws on invalid hex pair', () => {
    expect(() => hex('xy')).toThrow(/Invalid hex pair/);
  });
});

describe('concatBytes', () => {
  it('concatenates multiple parts', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4, 5]);
    const c = new Uint8Array([6]);
    expect(concatBytes(a, b, c)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it('returns empty for no arguments', () => {
    expect(concatBytes()).toEqual(new Uint8Array(0));
  });
});

describe('diffBytes', () => {
  it('reports equal arrays', () => {
    const r = diffBytes(hex('010203'), hex('010203'));
    expect(r.equal).toBe(true);
  });

  it('reports first byte difference', () => {
    const r = diffBytes(hex('010203'), hex('019903'));
    expect(r.equal).toBe(false);
    expect(r.firstDiffOffset).toBe(1);
    expect(r.expected).toBe(0x02);
    expect(r.actual).toBe(0x99);
  });

  it('reports length difference', () => {
    const r = diffBytes(hex('0102'), hex('010203'));
    expect(r.equal).toBe(false);
    expect(r.firstDiffOffset).toBe(2);
    expect(r.expectedLength).toBe(2);
    expect(r.actualLength).toBe(3);
  });
});

describe('assertBytesEqual', () => {
  it('passes for equal arrays', () => {
    expect(() => assertBytesEqual(hex('010203'), hex('010203'))).not.toThrow();
  });

  it('throws with diagnostic on mismatch', () => {
    expect(() => assertBytesEqual(hex('010203'), hex('019903'))).toThrow(/First diff at offset 1/);
  });

  it('throws on length mismatch', () => {
    expect(() => assertBytesEqual(hex('0102'), hex('010203'))).toThrow(/offset 2/);
  });

  it('includes user message in error', () => {
    expect(() => assertBytesEqual(hex('00'), hex('ff'), 'WAV header check')).toThrow(
      /WAV header check/,
    );
  });
});
