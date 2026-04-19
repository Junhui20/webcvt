/**
 * Tests for AAC/ADTS error classes.
 */

import { WebcvtError } from '@webcvt/core';
import { describe, expect, it } from 'vitest';
import {
  AdtsCorruptStreamError,
  AdtsCrcUnsupportedError,
  AdtsEncodeNotImplementedError,
  AdtsInputTooLargeError,
  AdtsInvalidLayerError,
  AdtsInvalidProfileError,
  AdtsMultipleRawBlocksUnsupportedError,
  AdtsPceRequiredError,
  AdtsReservedSampleRateError,
  AdtsTruncatedFrameError,
} from './errors.ts';

describe('AdtsInputTooLargeError', () => {
  it('is a WebcvtError with correct code', () => {
    const err = new AdtsInputTooLargeError(210 * 1024 * 1024, 200 * 1024 * 1024);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('ADTS_INPUT_TOO_LARGE');
    expect(err.name).toBe('AdtsInputTooLargeError');
    expect(err.message).toContain('200 MiB');
  });
});

describe('AdtsTruncatedFrameError', () => {
  it('includes offset in message', () => {
    const err = new AdtsTruncatedFrameError(1024, 500, 100);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('ADTS_TRUNCATED_FRAME');
    expect(err.offset).toBe(1024);
    expect(err.message).toContain('1024');
  });
});

describe('AdtsCorruptStreamError', () => {
  it('mentions candidate count', () => {
    const err = new AdtsCorruptStreamError(12);
    expect(err.code).toBe('ADTS_CORRUPT_STREAM');
    expect(err.message).toContain('12');
  });
});

describe('AdtsPceRequiredError', () => {
  it('includes offset', () => {
    const err = new AdtsPceRequiredError(0);
    expect(err.code).toBe('ADTS_PCE_REQUIRED');
    expect(err.offset).toBe(0);
    expect(err.name).toBe('AdtsPceRequiredError');
  });
});

describe('AdtsReservedSampleRateError', () => {
  it('describes index 13 as reserved', () => {
    const err = new AdtsReservedSampleRateError(0, 13);
    expect(err.code).toBe('ADTS_RESERVED_SAMPLE_RATE');
    expect(err.index).toBe(13);
    expect(err.message).toContain('13');
  });

  it('describes index 15 as explicit rate', () => {
    const err = new AdtsReservedSampleRateError(0, 15);
    expect(err.message).toContain('explicit');
  });
});

describe('AdtsInvalidLayerError', () => {
  it('includes layer value', () => {
    const err = new AdtsInvalidLayerError(0, 2);
    expect(err.code).toBe('ADTS_INVALID_LAYER');
    expect(err.message).toContain('2');
  });
});

describe('AdtsMultipleRawBlocksUnsupportedError', () => {
  it('is thrown for rawBlocks > 0', () => {
    const err = new AdtsMultipleRawBlocksUnsupportedError(42, 1);
    expect(err.code).toBe('ADTS_MULTIPLE_RAW_BLOCKS_UNSUPPORTED');
    expect(err.offset).toBe(42);
  });
});

describe('AdtsInvalidProfileError', () => {
  it('mentions profile', () => {
    const err = new AdtsInvalidProfileError(7);
    expect(err.code).toBe('ADTS_INVALID_PROFILE');
    expect(err.message).toContain('7');
  });
});

describe('AdtsCrcUnsupportedError', () => {
  it('has correct code', () => {
    const err = new AdtsCrcUnsupportedError();
    expect(err.code).toBe('ADTS_CRC_UNSUPPORTED');
  });

  // Q-3: Exported but not yet thrown (Phase 2 reserved). This test documents
  // its existence so that removing the export requires deliberate test deletion.
  it('is constructible and is a WebcvtError (Q-3 reserved export)', () => {
    const err = new AdtsCrcUnsupportedError();
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err).toBeInstanceOf(AdtsCrcUnsupportedError);
    expect(err.name).toBe('AdtsCrcUnsupportedError');
    expect(err.message).toContain('Phase 1');
  });
});

describe('AdtsEncodeNotImplementedError', () => {
  it('has correct code and name', () => {
    const err = new AdtsEncodeNotImplementedError();
    expect(err.code).toBe('ADTS_ENCODE_NOT_IMPLEMENTED');
    expect(err.name).toBe('AdtsEncodeNotImplementedError');
  });
});
