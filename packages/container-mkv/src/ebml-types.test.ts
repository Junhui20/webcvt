/**
 * Tests for EBML typed value readers and writers (ebml-types.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  concatBytes,
  readBinary,
  readFloat,
  readInt,
  readString,
  readUint,
  readUintNumber,
  readUtf8,
  writeFloat32,
  writeFloat64,
  writeString,
  writeUint,
  writeUtf8,
} from './ebml-types.ts';

// ---------------------------------------------------------------------------
// readUint tests
// ---------------------------------------------------------------------------

describe('readUint', () => {
  it('reads 1-byte uint', () => {
    expect(readUint(new Uint8Array([0x42]))).toBe(0x42n);
  });

  it('reads 2-byte uint big-endian', () => {
    expect(readUint(new Uint8Array([0x01, 0x00]))).toBe(256n);
  });

  it('reads 4-byte uint', () => {
    expect(readUint(new Uint8Array([0x00, 0x00, 0x00, 0xff]))).toBe(255n);
  });

  it('reads 8-byte uint (max safe bigint)', () => {
    const bytes = new Uint8Array([0x00, 0x1f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(readUint(bytes)).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });

  it('returns 0n for empty payload', () => {
    expect(readUint(new Uint8Array([]))).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// readUintNumber tests
// ---------------------------------------------------------------------------

describe('readUintNumber', () => {
  it('returns number for small values', () => {
    expect(readUintNumber(new Uint8Array([0xab]))).toBe(0xab);
  });

  it('returns 1000000 for 3-byte 0x0F4240', () => {
    expect(readUintNumber(new Uint8Array([0x0f, 0x42, 0x40]))).toBe(1_000_000);
  });
});

// ---------------------------------------------------------------------------
// readInt tests
// ---------------------------------------------------------------------------

describe('readInt', () => {
  it('reads positive 1-byte', () => {
    expect(readInt(new Uint8Array([0x01]))).toBe(1n);
  });

  it('reads negative 1-byte: 0xFF → -1', () => {
    expect(readInt(new Uint8Array([0xff]))).toBe(-1n);
  });

  it('reads negative 2-byte: 0xFF 0xFE → -2', () => {
    expect(readInt(new Uint8Array([0xff, 0xfe]))).toBe(-2n);
  });

  it('reads positive 2-byte: 0x00 0x64 → 100', () => {
    expect(readInt(new Uint8Array([0x00, 0x64]))).toBe(100n);
  });

  it('returns 0n for empty payload', () => {
    expect(readInt(new Uint8Array([]))).toBe(0n);
  });

  it('reads max negative 1-byte: 0x80 → -128', () => {
    expect(readInt(new Uint8Array([0x80]))).toBe(-128n);
  });
});

// ---------------------------------------------------------------------------
// readFloat tests
// ---------------------------------------------------------------------------

describe('readFloat', () => {
  it('decodes 4-byte float32', () => {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setFloat32(0, 44100.0, false);
    const result = readFloat(buf);
    expect(result).toBeCloseTo(44100.0, 0);
  });

  it('decodes 8-byte float64', () => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setFloat64(0, 1.5, false);
    expect(readFloat(buf)).toBe(1.5);
  });

  it('returns NaN for empty payload', () => {
    expect(readFloat(new Uint8Array([]))).toBeNaN();
  });

  it('returns NaN for 2-byte payload (unsupported)', () => {
    expect(readFloat(new Uint8Array([0x3f, 0x80]))).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// readString / readUtf8 tests
// ---------------------------------------------------------------------------

describe('readString', () => {
  it('decodes ASCII bytes to string', () => {
    const bytes = new Uint8Array([0x76, 0x70, 0x38]); // 'vp8'
    expect(readString(bytes)).toBe('vp8');
  });

  it('strips trailing null bytes', () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63, 0x00, 0x00]); // 'abc\0\0'
    expect(readString(bytes)).toBe('abc');
  });

  it('handles empty string', () => {
    expect(readString(new Uint8Array([]))).toBe('');
  });

  it('handles all-null bytes', () => {
    expect(readString(new Uint8Array([0x00, 0x00]))).toBe('');
  });
});

describe('readUtf8', () => {
  it('decodes UTF-8 bytes with multi-byte characters', () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('hello');
    expect(readUtf8(bytes)).toBe('hello');
  });

  it('strips trailing null bytes', () => {
    const bytes = new Uint8Array([0x41, 0x00, 0x00]); // 'A\0\0'
    expect(readUtf8(bytes)).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// readBinary tests
// ---------------------------------------------------------------------------

describe('readBinary', () => {
  it('returns a subarray view of payload', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    const result = readBinary(payload);
    expect(result).toEqual(payload);
    expect(result.buffer).toBe(payload.buffer); // zero-copy
  });
});

// ---------------------------------------------------------------------------
// writeUint tests
// ---------------------------------------------------------------------------

describe('writeUint', () => {
  it('encodes 0 as single 0x00', () => {
    expect(writeUint(0n)).toEqual(new Uint8Array([0x00]));
  });

  it('encodes 1 as 0x01', () => {
    expect(writeUint(1n)).toEqual(new Uint8Array([0x01]));
  });

  it('encodes 256 as 2-byte big-endian', () => {
    expect(writeUint(256n)).toEqual(new Uint8Array([0x01, 0x00]));
  });

  it('encodes 1_000_000 with minimum width', () => {
    const result = writeUint(1_000_000n);
    expect(result).toEqual(new Uint8Array([0x0f, 0x42, 0x40]));
  });

  it('forces width 4 even for small values', () => {
    const result = writeUint(1n, 4);
    expect(result).toHaveLength(4);
    expect(result[3]).toBe(1);
  });

  it('round-trips: readUint(writeUint(x)) === x', () => {
    const values = [0n, 1n, 255n, 256n, 65535n, 16777215n];
    for (const v of values) {
      expect(readUint(writeUint(v))).toBe(v);
    }
  });
});

// ---------------------------------------------------------------------------
// writeFloat64 / writeFloat32 tests
// ---------------------------------------------------------------------------

describe('writeFloat64', () => {
  it('encodes 1.5 as 8-byte big-endian double', () => {
    const result = writeFloat64(1.5);
    expect(result).toHaveLength(8);
    expect(readFloat(result)).toBe(1.5);
  });

  it('encodes 0.0', () => {
    const result = writeFloat64(0.0);
    expect(readFloat(result)).toBe(0.0);
  });
});

describe('writeFloat32', () => {
  it('encodes 44100.0 as 4-byte big-endian float', () => {
    const result = writeFloat32(44100.0);
    expect(result).toHaveLength(4);
    expect(readFloat(result)).toBeCloseTo(44100.0, 0);
  });
});

// ---------------------------------------------------------------------------
// writeString / writeUtf8 tests
// ---------------------------------------------------------------------------

describe('writeString', () => {
  it('encodes ASCII to bytes', () => {
    expect(writeString('vp8')).toEqual(new Uint8Array([0x76, 0x70, 0x38]));
  });

  it('round-trips with readString', () => {
    const s = 'matroska';
    expect(readString(writeString(s))).toBe(s);
  });
});

describe('writeUtf8', () => {
  it('encodes UTF-8 string', () => {
    const result = writeUtf8('hello');
    expect(readUtf8(result)).toBe('hello');
  });

  it('round-trips app string', () => {
    const s = '@webcvt/container-mkv';
    expect(readUtf8(writeUtf8(s))).toBe(s);
  });
});

// ---------------------------------------------------------------------------
// concatBytes tests
// ---------------------------------------------------------------------------

describe('concatBytes', () => {
  it('concatenates two arrays', () => {
    const a = new Uint8Array([0x01, 0x02]);
    const b = new Uint8Array([0x03, 0x04]);
    expect(concatBytes([a, b])).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
  });

  it('handles empty parts array', () => {
    expect(concatBytes([])).toEqual(new Uint8Array(0));
  });

  it('handles single part', () => {
    const a = new Uint8Array([0xaa, 0xbb]);
    expect(concatBytes([a])).toEqual(a);
  });

  it('handles empty sub-arrays', () => {
    const a = new Uint8Array([0x01]);
    const empty = new Uint8Array(0);
    expect(concatBytes([empty, a, empty])).toEqual(a);
  });
});
