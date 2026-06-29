/**
 * EmailBackend — webcvt Backend implementation for EML conversion.
 *
 * Supported conversions:
 *   eml → txt  : the text body (or HTML stripped to text when only HTML exists).
 *   eml → json : a JSON document of the structured message (attachment payloads
 *                are base64-encoded so the result is lossless and serialisable).
 *
 * This backend deliberately does NOT auto-register itself — consumers wire it
 * into a registry explicitly. Detection of EML relies on the filename hint
 * (there is no reliable EML magic-byte signature).
 */

import type {
  Backend,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { UnsupportedFormatError } from '@catlabtech/webcvt-core';
import { EML_MIME, JSON_MIME, MAX_INPUT_BYTES, TXT_MIME } from './constants.ts';
import { EmailInputTooLargeError } from './errors.ts';
import { stripHtml } from './html.ts';
import type { EmailMessage } from './model.ts';
import { parseEml } from './parser.ts';
import { encodeBase64 } from './transfer-encoding.ts';

// ---------------------------------------------------------------------------
// Format descriptor
// ---------------------------------------------------------------------------

/** Format descriptor for an EML / RFC 5322 message. */
export const EML_FORMAT: FormatDescriptor = {
  ext: 'eml',
  mime: EML_MIME,
  category: 'email',
  description: 'Email Message (RFC 5322 / MIME)',
};

// ---------------------------------------------------------------------------
// Output serialisation
// ---------------------------------------------------------------------------

/** Render a message as plain text: the text body, or HTML stripped to text. */
export function serializeMessageToText(message: EmailMessage): string {
  if (message.textBody !== undefined) return message.textBody;
  if (message.htmlBody !== undefined) return stripHtml(message.htmlBody);
  return '';
}

/** Render a message as a pretty-printed, lossless JSON document. */
export function serializeMessageToJson(message: EmailMessage): string {
  const json = {
    headers: message.headers,
    from: message.from,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    date: message.date,
    textBody: message.textBody,
    htmlBody: message.htmlBody,
    attachments: message.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      contentId: attachment.contentId,
      contentBase64: encodeBase64(attachment.bytes),
    })),
  };
  return JSON.stringify(json, null, 2);
}

// ---------------------------------------------------------------------------
// Output target detection
// ---------------------------------------------------------------------------

function isEmlInput(input: FormatDescriptor): boolean {
  return input.mime === EML_MIME || input.ext === 'eml';
}

function isTxtOutput(output: FormatDescriptor): boolean {
  return output.mime === TXT_MIME || output.ext === 'txt';
}

function isJsonOutput(output: FormatDescriptor): boolean {
  return output.mime === JSON_MIME || output.ext === 'json';
}

// ---------------------------------------------------------------------------
// EmailBackend
// ---------------------------------------------------------------------------

export class EmailBackend implements Backend {
  readonly name = 'email';

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    return isEmlInput(input) && (isTxtOutput(output) || isJsonOutput(output));
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new EmailInputTooLargeError(input.size, MAX_INPUT_BYTES);
    }

    const wantsJson = isJsonOutput(output);
    const wantsText = isTxtOutput(output);
    if (!wantsJson && !wantsText) {
      throw new UnsupportedFormatError(output.mime, 'output');
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });
    const bytes = new Uint8Array(await input.arrayBuffer());

    options.onProgress?.({ percent: 40, phase: 'parse' });
    const message = parseEml(bytes);

    options.onProgress?.({ percent: 70, phase: 'serialize' });
    const outputText = wantsJson
      ? serializeMessageToJson(message)
      : serializeMessageToText(message);

    options.onProgress?.({ percent: 100, phase: 'done' });

    const blob = new Blob([outputText], { type: output.mime });
    return {
      blob,
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }
}
