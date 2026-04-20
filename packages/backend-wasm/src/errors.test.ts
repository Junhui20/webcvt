import { WebcvtError } from '@webcvt/core';
import { describe, expect, it } from 'vitest';
import { MAX_STDERR_BYTES } from './constants.ts';
import { WasmExecutionError, WasmLoadError, WasmUnsupportedError } from './errors.ts';

describe('WasmLoadError', () => {
  it('is instanceof WebcvtError and Error', () => {
    const err = new WasmLoadError('network failure');
    expect(err).toBeInstanceOf(WasmLoadError);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has code WASM_LOAD_FAILED', () => {
    const err = new WasmLoadError('fail');
    expect(err.code).toBe('WASM_LOAD_FAILED');
  });

  it('has name WasmLoadError', () => {
    const err = new WasmLoadError('fail');
    expect(err.name).toBe('WasmLoadError');
  });

  it('stores the message', () => {
    const err = new WasmLoadError('could not fetch core');
    expect(err.message).toBe('could not fetch core');
  });

  it('accepts ErrorOptions with cause', () => {
    const cause = new TypeError('fetch failed');
    const err = new WasmLoadError('network failure', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('WasmExecutionError', () => {
  it('is instanceof WebcvtError and Error', () => {
    const err = new WasmExecutionError(1, '');
    expect(err).toBeInstanceOf(WasmExecutionError);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has code WASM_EXEC_FAILED', () => {
    const err = new WasmExecutionError(1, '');
    expect(err.code).toBe('WASM_EXEC_FAILED');
  });

  it('has name WasmExecutionError', () => {
    const err = new WasmExecutionError(1, '');
    expect(err.name).toBe('WasmExecutionError');
  });

  it('stores exitCode', () => {
    const err = new WasmExecutionError(127, 'not found');
    expect(err.exitCode).toBe(127);
  });

  it('stores stderr when under limit', () => {
    const err = new WasmExecutionError(1, 'some error output');
    expect(err.stderr).toBe('some error output');
  });

  it('truncates stderr at MAX_STDERR_BYTES', () => {
    const huge = 'x'.repeat(MAX_STDERR_BYTES + 1000);
    const err = new WasmExecutionError(1, huge);
    expect(err.stderr.length).toBeLessThanOrEqual(MAX_STDERR_BYTES + 20);
    expect(err.stderr).toContain('[truncated]');
  });

  it('includes exit code in message', () => {
    const err = new WasmExecutionError(42, '');
    expect(err.message).toContain('42');
  });
});

describe('WasmUnsupportedError', () => {
  it('is instanceof WebcvtError and Error', () => {
    const err = new WasmUnsupportedError('video/avi', 'audio/flac');
    expect(err).toBeInstanceOf(WasmUnsupportedError);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has code WASM_UNSUPPORTED', () => {
    const err = new WasmUnsupportedError('video/avi', 'audio/flac');
    expect(err.code).toBe('WASM_UNSUPPORTED');
  });

  it('has name WasmUnsupportedError', () => {
    const err = new WasmUnsupportedError('video/avi', 'audio/flac');
    expect(err.name).toBe('WasmUnsupportedError');
  });

  it('includes both MIME types in message', () => {
    const err = new WasmUnsupportedError('video/avi', 'audio/flac');
    expect(err.message).toContain('video/avi');
    expect(err.message).toContain('audio/flac');
  });
});
