import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import { MAX_STDERR_BYTES } from './constants.ts';
import {
  NativeConversionFailedError,
  NativeInputTooLargeError,
  NativeTimeoutError,
  NativeToolNotFoundError,
  NativeUnsupportedPairError,
} from './errors.ts';
import type { ToolName } from './tools.ts';

describe('NativeToolNotFoundError', () => {
  it('carries the tool, UPPER_SNAKE code, and an actionable install hint', () => {
    const err = new NativeToolNotFoundError('ffmpeg');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('NATIVE_TOOL_NOT_FOUND');
    expect(err.tool).toBe('ffmpeg');
    expect(err.message).toContain('WEBCVT_FFMPEG');
    expect(err.name).toBe('NativeToolNotFoundError');
  });

  it('has a distinct hint for every supported tool', () => {
    const tools: ToolName[] = ['ffmpeg', 'pandoc', 'libreoffice', 'ghostscript'];
    const envs = ['WEBCVT_FFMPEG', 'WEBCVT_PANDOC', 'WEBCVT_LIBREOFFICE', 'WEBCVT_GHOSTSCRIPT'];
    tools.forEach((tool, i) => {
      const err = new NativeToolNotFoundError(tool);
      expect(err.message).toContain(envs[i] as string);
    });
  });
});

describe('NativeUnsupportedPairError', () => {
  it('records the input/output exts and code', () => {
    const err = new NativeUnsupportedPairError('md', 'mp3');
    expect(err.code).toBe('NATIVE_UNSUPPORTED_PAIR');
    expect(err.inputExt).toBe('md');
    expect(err.outputExt).toBe('mp3');
    expect(err.message).toContain('md');
    expect(err.message).toContain('mp3');
  });
});

describe('NativeInputTooLargeError', () => {
  it('records size + limit', () => {
    const err = new NativeInputTooLargeError(100, 10);
    expect(err.code).toBe('NATIVE_INPUT_TOO_LARGE');
    expect(err.size).toBe(100);
    expect(err.limit).toBe(10);
  });
});

describe('NativeConversionFailedError', () => {
  it('records tool, exit code, and short stderr verbatim', () => {
    const err = new NativeConversionFailedError('pandoc', 7, 'boom');
    expect(err.code).toBe('NATIVE_CONVERSION_FAILED');
    expect(err.tool).toBe('pandoc');
    expect(err.exitCode).toBe(7);
    expect(err.stderr).toBe('boom');
  });

  it('truncates oversized stderr at MAX_STDERR_BYTES', () => {
    const big = 'x'.repeat(MAX_STDERR_BYTES + 100);
    const err = new NativeConversionFailedError('ffmpeg', 1, big);
    expect(err.stderr.length).toBeLessThan(big.length);
    expect(err.stderr.endsWith('[truncated]')).toBe(true);
  });
});

describe('NativeTimeoutError', () => {
  it('records tool + timeout', () => {
    const err = new NativeTimeoutError('libreoffice', 1234);
    expect(err.code).toBe('NATIVE_TIMEOUT');
    expect(err.tool).toBe('libreoffice');
    expect(err.timeoutMs).toBe(1234);
    expect(err.message).toContain('1234');
  });
});
