import { WebcvtError } from '@webcvt/core';
import { describe, expect, it } from 'vitest';
import { CliBadUsageError, CliInputTooLargeError, USAGE_HINT } from './errors.ts';
import { MAX_INPUT_BYTES } from './io.ts';

describe('CliBadUsageError', () => {
  it('is an instance of WebcvtError', () => {
    const err = new CliBadUsageError('test message');
    expect(err).toBeInstanceOf(WebcvtError);
  });

  it('has code BAD_USAGE', () => {
    const err = new CliBadUsageError('test message');
    expect(err.code).toBe('BAD_USAGE');
  });

  it('has name CliBadUsageError', () => {
    const err = new CliBadUsageError('test message');
    expect(err.name).toBe('CliBadUsageError');
  });

  it('message is passed through', () => {
    const err = new CliBadUsageError('stdin is a TTY');
    expect(err.message).toBe('stdin is a TTY');
  });
});

describe('CliInputTooLargeError', () => {
  it('is an instance of WebcvtError', () => {
    const err = new CliInputTooLargeError(MAX_INPUT_BYTES + 1, MAX_INPUT_BYTES);
    expect(err).toBeInstanceOf(WebcvtError);
  });

  it('has code INPUT_TOO_LARGE', () => {
    const err = new CliInputTooLargeError(MAX_INPUT_BYTES + 1, MAX_INPUT_BYTES);
    expect(err.code).toBe('INPUT_TOO_LARGE');
  });

  it('has name CliInputTooLargeError', () => {
    const err = new CliInputTooLargeError(MAX_INPUT_BYTES + 1, MAX_INPUT_BYTES);
    expect(err.name).toBe('CliInputTooLargeError');
  });

  it('message does not leak exact byte count', () => {
    const actual = 300 * 1024 * 1024;
    const err = new CliInputTooLargeError(actual, MAX_INPUT_BYTES);
    expect(err.message).not.toContain(String(actual));
  });

  it('message includes MiB limit', () => {
    const err = new CliInputTooLargeError(MAX_INPUT_BYTES + 1, MAX_INPUT_BYTES);
    expect(err.message).toContain('256');
  });

  it('message contains soft limit description without exact bytes', () => {
    const err = new CliInputTooLargeError(MAX_INPUT_BYTES + 1, MAX_INPUT_BYTES);
    expect(err.message).toContain('MiB limit');
    expect(err.message).toContain('Use a smaller file');
  });
});

describe('USAGE_HINT', () => {
  it('is a non-empty string', () => {
    expect(typeof USAGE_HINT).toBe('string');
    expect(USAGE_HINT.length).toBeGreaterThan(0);
  });

  it("contains 'webcvt --help'", () => {
    expect(USAGE_HINT).toContain('webcvt --help');
  });
});
