import { describe, expect, it } from 'vitest';
import {
  BACKEND_WASM_AVAILABLE,
  NotImplementedError,
  decodeWithWasm,
  encodeWithWasm,
} from './index.ts';

describe('NotImplementedError', () => {
  it('is an instance of Error', () => {
    const err = new NotImplementedError('test feature');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NotImplementedError);
  });

  it('has name "NotImplementedError"', () => {
    const err = new NotImplementedError('test feature');
    expect(err.name).toBe('NotImplementedError');
  });

  it('includes the feature name in the message', () => {
    const err = new NotImplementedError('my feature');
    expect(err.message).toContain('my feature');
  });
});

describe('decodeWithWasm', () => {
  it('throws NotImplementedError', () => {
    expect(() => decodeWithWasm(new ArrayBuffer(0))).toThrow(NotImplementedError);
  });

  it('throws with options present', () => {
    expect(() => decodeWithWasm(new ArrayBuffer(4), { codec: 'aac' })).toThrow(NotImplementedError);
  });
});

describe('encodeWithWasm', () => {
  it('throws NotImplementedError', () => {
    expect(() => encodeWithWasm(new ArrayBuffer(0))).toThrow(NotImplementedError);
  });

  it('throws with options present', () => {
    expect(() => encodeWithWasm(new ArrayBuffer(4), { codec: 'flac', bitrate: 128 })).toThrow(
      NotImplementedError,
    );
  });
});

describe('BACKEND_WASM_AVAILABLE', () => {
  it('is false', () => {
    expect(BACKEND_WASM_AVAILABLE).toBe(false);
  });
});
