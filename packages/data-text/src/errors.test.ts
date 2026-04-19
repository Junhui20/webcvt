/**
 * Tests for errors.ts — verify error classes are WebcvtError subclasses
 * with correct code and name fields.
 */

import { WebcvtError } from '@webcvt/core';
import { describe, expect, it } from 'vitest';
import {
  CsvBadQuoteError,
  CsvColCapError,
  CsvDuplicateHeaderError,
  CsvInvalidUtf8Error,
  CsvRaggedRowError,
  CsvRowCapError,
  CsvUnexpectedQuoteError,
  CsvUnterminatedQuoteError,
  EnvBadEscapeError,
  EnvInvalidUtf8Error,
  EnvSyntaxError,
  IniEmptyKeyError,
  IniInvalidUtf8Error,
  IniSyntaxError,
  InputTooLargeError,
  InputTooManyCharsError,
  JsonDepthExceededError,
  JsonInvalidUtf8Error,
  JsonParseError,
} from './errors.ts';

describe('errors', () => {
  it('InputTooLargeError extends WebcvtError', () => {
    const err = new InputTooLargeError(100, 50, 'JSON');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('DATA_TEXT_INPUT_TOO_LARGE');
    expect(err.name).toBe('InputTooLargeError');
  });

  it('InputTooManyCharsError extends WebcvtError', () => {
    const err = new InputTooManyCharsError(100, 50, 'CSV');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('DATA_TEXT_INPUT_TOO_MANY_CHARS');
    expect(err.name).toBe('InputTooManyCharsError');
  });

  it('JsonInvalidUtf8Error extends WebcvtError', () => {
    const err = new JsonInvalidUtf8Error();
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('JSON_INVALID_UTF8');
    expect(err.name).toBe('JsonInvalidUtf8Error');
  });

  it('JsonDepthExceededError extends WebcvtError', () => {
    const err = new JsonDepthExceededError(300, 256);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('JSON_DEPTH_EXCEEDED');
    expect(err.name).toBe('JsonDepthExceededError');
  });

  it('JsonParseError extends WebcvtError', () => {
    const err = new JsonParseError(new SyntaxError('bad'));
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('JSON_PARSE_ERROR');
    expect(err.name).toBe('JsonParseError');
  });

  it('CsvInvalidUtf8Error extends WebcvtError', () => {
    const err = new CsvInvalidUtf8Error();
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('CSV_INVALID_UTF8');
  });

  it('CsvUnterminatedQuoteError extends WebcvtError', () => {
    const err = new CsvUnterminatedQuoteError();
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('CSV_UNTERMINATED_QUOTE');
  });

  it('CsvUnexpectedQuoteError extends WebcvtError', () => {
    const err = new CsvUnexpectedQuoteError();
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('CSV_UNEXPECTED_QUOTE');
  });

  it('CsvBadQuoteError extends WebcvtError', () => {
    const err = new CsvBadQuoteError();
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('CSV_BAD_QUOTE');
  });

  it('CsvRowCapError extends WebcvtError', () => {
    const err = new CsvRowCapError(1_000_000);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('CSV_ROW_CAP_EXCEEDED');
  });

  it('CsvColCapError extends WebcvtError', () => {
    const err = new CsvColCapError(1024);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('CSV_COL_CAP_EXCEEDED');
  });

  it('CsvDuplicateHeaderError extends WebcvtError', () => {
    const err = new CsvDuplicateHeaderError('name');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('CSV_DUPLICATE_HEADER');
  });

  it('CsvRaggedRowError extends WebcvtError', () => {
    const err = new CsvRaggedRowError(2, 5, 3);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('CSV_RAGGED_ROW');
  });

  it('IniInvalidUtf8Error extends WebcvtError', () => {
    const err = new IniInvalidUtf8Error();
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('INI_INVALID_UTF8');
  });

  it('IniEmptyKeyError extends WebcvtError', () => {
    const err = new IniEmptyKeyError(3);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('INI_EMPTY_KEY');
  });

  it('IniSyntaxError extends WebcvtError', () => {
    const err = new IniSyntaxError(5, 'bad line');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('INI_SYNTAX_ERROR');
  });

  it('EnvInvalidUtf8Error extends WebcvtError', () => {
    const err = new EnvInvalidUtf8Error();
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('ENV_INVALID_UTF8');
  });

  it('EnvSyntaxError extends WebcvtError', () => {
    const err = new EnvSyntaxError(4);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('ENV_SYNTAX_ERROR');
  });

  it('EnvBadEscapeError extends WebcvtError', () => {
    const err = new EnvBadEscapeError(2, 'r');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('ENV_BAD_ESCAPE');
  });
});
