import { NoBackendError, UnsupportedFormatError, WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  ApiBadRequestError,
  ApiInputTooLargeError,
  httpStatusForError,
  toApiErrorBody,
} from './errors.ts';

describe('ApiBadRequestError', () => {
  it('carries the BAD_REQUEST code and a WebcvtError lineage', () => {
    const err = new ApiBadRequestError('nope');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.name).toBe('ApiBadRequestError');
    expect(err.message).toBe('nope');
  });
});

describe('ApiInputTooLargeError', () => {
  it('reports the size when known', () => {
    const err = new ApiInputTooLargeError(100, 10);
    expect(err.code).toBe('INPUT_TOO_LARGE');
    expect(err.message).toContain('100');
    expect(err.message).toContain('10');
  });

  it('omits the size when unknown', () => {
    const err = new ApiInputTooLargeError(undefined, 10);
    expect(err.message).toContain('10');
    expect(err.message).not.toContain('undefined');
  });
});

describe('httpStatusForError', () => {
  it('maps each error class to its status', () => {
    expect(httpStatusForError(new ApiBadRequestError('x'))).toBe(400);
    expect(httpStatusForError(new ApiInputTooLargeError(1, 0))).toBe(413);
    expect(httpStatusForError(new UnsupportedFormatError('foo', 'output'))).toBe(415);
    expect(httpStatusForError(new NoBackendError('a', 'b'))).toBe(415);
    expect(httpStatusForError(new WebcvtError('OTHER', 'other'))).toBe(500);
    expect(httpStatusForError(new Error('plain'))).toBe(500);
    expect(httpStatusForError('not even an error')).toBe(500);
  });
});

describe('toApiErrorBody', () => {
  it('prefers the WebcvtError code', () => {
    expect(toApiErrorBody(new ApiBadRequestError('bad'))).toEqual({
      error: { code: 'BAD_REQUEST', message: 'bad' },
    });
  });

  it('uses INTERNAL for a plain Error', () => {
    expect(toApiErrorBody(new Error('boom'))).toEqual({
      error: { code: 'INTERNAL', message: 'boom' },
    });
  });

  it('uses a generic message for a non-error value', () => {
    expect(toApiErrorBody(42)).toEqual({
      error: { code: 'INTERNAL', message: 'Internal server error.' },
    });
  });
});
