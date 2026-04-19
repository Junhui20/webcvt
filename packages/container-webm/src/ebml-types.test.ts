/**
 * Tests for EBML typed value readers (ebml-types.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  concatBytes,
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

describe('readUint', () => {
  it('reads 1-byte unsigned integer', () => {
    expect(readUint(new Uint8Array([0x07]))).toBe(7n);
  });

  it('reads 4-byte unsigned integer', () => {
    // 0x00 0x0F 0x42 0x40 = 1_000_000
    expect(readUint(new Uint8Array([0x00, 0x0f, 0x42, 0x40]))).toBe(1_000_000n);
  });

  it('reads 8-byte unsigned integer', () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]);
    expect(readUint(bytes)).toBe(1n);
  });

  it('reads zero-length as 0n', () => {
    expect(readUint(new Uint8Array(0))).toBe(0n);
  });
});

describe('readUintNumber', () => {
  it('reads timecodeScale default value 1_000_000', () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0x42, 0x40]);
    expect(readUintNumber(bytes)).toBe(1_000_000);
  });
});

describe('readInt', () => {
  it('reads positive int', () => {
    expect(readInt(new Uint8Array([0x10]))).toBe(16n);
  });

  it('reads negative int from 2-byte value', () => {
    // Two's complement: 0xFF 0xFF = -1 as int16
    expect(readInt(new Uint8Array([0xff, 0xff]))).toBe(-1n);
  });

  it('reads zero-length as 0n', () => {
    expect(readInt(new Uint8Array(0))).toBe(0n);
  });
});

describe('readFloat', () => {
  it('reads 4-byte float', () => {
    const bytes = new Uint8Array(4);
    const view = new DataView(bytes.buffer);
    view.setFloat32(0, 44100.0, false);
    const result = readFloat(bytes);
    expect(result).toBeCloseTo(44100.0, 0);
  });

  it('reads 8-byte float', () => {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setFloat64(0, 44100.0, false);
    const result = readFloat(bytes);
    expect(result).toBeCloseTo(44100.0, 3);
  });

  it('returns NaN for unsupported size', () => {
    expect(Number.isNaN(readFloat(new Uint8Array(3)))).toBe(true);
  });
});

describe('readString', () => {
  it('reads ASCII string', () => {
    const bytes = new TextEncoder().encode('webm');
    expect(readString(bytes)).toBe('webm');
  });

  it('strips null terminator', () => {
    const bytes = new Uint8Array([0x56, 0x5f, 0x56, 0x50, 0x38, 0x00, 0x00]);
    expect(readString(bytes)).toBe('V_VP8');
  });

  it('reads codec IDs correctly', () => {
    const ids = ['V_VP8', 'V_VP9', 'A_VORBIS', 'A_OPUS'];
    for (const id of ids) {
      const bytes = new TextEncoder().encode(id);
      expect(readString(bytes)).toBe(id);
    }
  });
});

describe('readUtf8', () => {
  it('reads utf-8 string', () => {
    const bytes = new TextEncoder().encode('Lavf58.76.100');
    expect(readUtf8(bytes)).toBe('Lavf58.76.100');
  });

  it('strips null terminator', () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x00]);
    expect(readUtf8(bytes)).toBe('ab');
  });
});

describe('writeUint', () => {
  it('writes 0 as single byte', () => {
    expect(writeUint(0n)).toEqual(new Uint8Array([0]));
  });

  it('writes 1_000_000 correctly', () => {
    const result = writeUint(1_000_000n);
    expect(readUintNumber(result)).toBe(1_000_000);
  });

  it('writes with forced width', () => {
    const result = writeUint(1n, 4);
    expect(result.length).toBe(4);
    expect(result).toEqual(new Uint8Array([0, 0, 0, 1]));
  });
});

describe('writeFloat64', () => {
  it('round-trips a float64 value', () => {
    const bytes = writeFloat64(1234.5678);
    const result = readFloat(bytes);
    expect(result).toBeCloseTo(1234.5678, 4);
  });
});

describe('writeString', () => {
  it('encodes ASCII string', () => {
    const bytes = writeString('webm');
    expect(bytes).toEqual(new Uint8Array([0x77, 0x65, 0x62, 0x6d]));
  });
});

describe('writeUtf8', () => {
  it('encodes utf-8 string', () => {
    const bytes = writeUtf8('hello');
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });
});

describe('concatBytes', () => {
  it('concatenates arrays', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4]);
    const result = concatBytes([a, b]);
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('handles empty arrays', () => {
    const result = concatBytes([new Uint8Array(0), new Uint8Array([1])]);
    expect(result).toEqual(new Uint8Array([1]));
  });
});
