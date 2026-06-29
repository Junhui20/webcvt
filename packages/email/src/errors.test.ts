import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  EmailAttachmentsTooLargeError,
  EmailHeaderLineTooLongError,
  EmailInputTooLargeError,
  EmailMimeTooDeepError,
  EmailMissingBoundaryError,
  EmailTooManyHeadersError,
  EmailTooManyPartsError,
  EmailUnsupportedTransferEncodingError,
} from './errors.ts';

describe('typed errors', () => {
  const cases: Array<[WebcvtError, string, string]> = [
    [new EmailInputTooLargeError(100, 64), 'EMAIL_INPUT_TOO_LARGE', 'EmailInputTooLargeError'],
    [new EmailTooManyHeadersError(1000), 'EMAIL_TOO_MANY_HEADERS', 'EmailTooManyHeadersError'],
    [
      new EmailHeaderLineTooLongError(20000, 16384),
      'EMAIL_HEADER_LINE_TOO_LONG',
      'EmailHeaderLineTooLongError',
    ],
    [new EmailMimeTooDeepError(21, 20), 'EMAIL_MIME_TOO_DEEP', 'EmailMimeTooDeepError'],
    [new EmailTooManyPartsError(1000), 'EMAIL_TOO_MANY_PARTS', 'EmailTooManyPartsError'],
    [
      new EmailMissingBoundaryError('multipart/mixed'),
      'EMAIL_MISSING_BOUNDARY',
      'EmailMissingBoundaryError',
    ],
    [
      new EmailUnsupportedTransferEncodingError('x-uuencode'),
      'EMAIL_UNSUPPORTED_TRANSFER_ENCODING',
      'EmailUnsupportedTransferEncodingError',
    ],
    [
      new EmailAttachmentsTooLargeError(999, 64),
      'EMAIL_ATTACHMENTS_TOO_LARGE',
      'EmailAttachmentsTooLargeError',
    ],
  ];

  it.each(cases)('%o exposes its code and name', (error, code, name) => {
    expect(error).toBeInstanceOf(WebcvtError);
    expect(error.code).toBe(code);
    expect(error.name).toBe(name);
    expect(error.message.length).toBeGreaterThan(0);
  });
});
