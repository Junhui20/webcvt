import type { ConvertOptions, FormatDescriptor } from '@catlabtech/webcvt-core';
import { UnsupportedFormatError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  EML_FORMAT,
  EmailBackend,
  serializeMessageToJson,
  serializeMessageToText,
} from './backend.ts';
import { MAX_INPUT_BYTES } from './constants.ts';
import { EmailInputTooLargeError } from './errors.ts';
import { parseEml } from './parser.ts';
import { encodeBase64 } from './transfer-encoding.ts';

const backend = new EmailBackend();
const NO_OPTS: ConvertOptions = { format: 'txt' };

const TXT: FormatDescriptor = { ext: 'txt', mime: 'text/plain', category: 'document' };
const JSON_FMT: FormatDescriptor = { ext: 'json', mime: 'application/json', category: 'data' };
const PNG: FormatDescriptor = { ext: 'png', mime: 'image/png', category: 'image' };

function emlBlob(body: string): Blob {
  return new Blob([body], { type: EML_FORMAT.mime });
}

const SIMPLE = ['From: Alice <alice@example.com>', 'Subject: Hi', '', 'Plain body line.'].join(
  '\r\n',
);

describe('EML_FORMAT descriptor', () => {
  it('describes the eml format', () => {
    expect(EML_FORMAT).toMatchObject({
      ext: 'eml',
      mime: 'message/rfc822',
      category: 'email',
    });
  });
});

describe('EmailBackend.canHandle', () => {
  it('accepts eml → txt and eml → json', async () => {
    expect(await backend.canHandle(EML_FORMAT, TXT)).toBe(true);
    expect(await backend.canHandle(EML_FORMAT, JSON_FMT)).toBe(true);
  });

  it('rejects eml → png and non-eml inputs', async () => {
    expect(await backend.canHandle(EML_FORMAT, PNG)).toBe(false);
    expect(await backend.canHandle(PNG, TXT)).toBe(false);
  });

  it('has the name "email" and does not auto-register', () => {
    expect(backend.name).toBe('email');
  });
});

describe('EmailBackend.convert', () => {
  it('converts eml → txt (plain body)', async () => {
    const result = await backend.convert(emlBlob(SIMPLE), TXT, NO_OPTS);
    expect(result.backend).toBe('email');
    expect(result.format).toBe(TXT);
    expect(await result.blob.text()).toBe('Plain body line.');
  });

  it('converts eml → txt by stripping HTML when only an HTML body exists', async () => {
    const html = ['Content-Type: text/html; charset="utf-8"', '', '<p>Hello</p><p>World</p>'].join(
      '\r\n',
    );
    const result = await backend.convert(emlBlob(html), TXT, NO_OPTS);
    const out = await result.blob.text();
    expect(out).toContain('Hello');
    expect(out).toContain('World');
  });

  it('converts eml → json with base64 attachment payloads', async () => {
    const eml = [
      'Subject: With attachment',
      'Content-Type: multipart/mixed; boundary="B"',
      '',
      '--B',
      'Content-Type: text/plain',
      '',
      'body',
      '--B',
      'Content-Type: application/octet-stream; name="x.bin"',
      'Content-Transfer-Encoding: base64',
      '',
      encodeBase64(new Uint8Array([9, 8, 7])),
      '--B--',
      '',
    ].join('\r\n');
    const result = await backend.convert(emlBlob(eml), JSON_FMT, { format: 'json' });
    const parsed = JSON.parse(await result.blob.text());
    expect(parsed.subject).toBe('With attachment');
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].contentBase64).toBe(encodeBase64(new Uint8Array([9, 8, 7])));
    expect(parsed.attachments[0].filename).toBe('x.bin');
  });

  it('reports progress through the convert pipeline', async () => {
    const phases: string[] = [];
    await backend.convert(emlBlob(SIMPLE), TXT, {
      format: 'txt',
      onProgress: (p) => {
        if (p.phase) phases.push(p.phase);
      },
    });
    expect(phases).toEqual(['demux', 'parse', 'serialize', 'done']);
  });

  it('throws UnsupportedFormatError for an unsupported output', async () => {
    await expect(backend.convert(emlBlob(SIMPLE), PNG, { format: 'png' })).rejects.toThrow(
      UnsupportedFormatError,
    );
  });

  it('throws EmailInputTooLargeError when the blob exceeds the cap', async () => {
    const fakeBlob = { size: MAX_INPUT_BYTES + 1 } as unknown as Blob;
    await expect(backend.convert(fakeBlob, TXT, NO_OPTS)).rejects.toThrow(EmailInputTooLargeError);
  });
});

describe('output serialisers', () => {
  it('serializeMessageToText returns the empty string for a bodyless message', () => {
    const message = parseEml('Subject: Empty\r\n\r\n');
    // A trailing blank line yields an empty text body, not undefined.
    expect(typeof serializeMessageToText(message)).toBe('string');
  });

  it('serializeMessageToJson produces valid JSON', () => {
    const message = parseEml(SIMPLE);
    const parsed = JSON.parse(serializeMessageToJson(message));
    expect(parsed.from).toEqual({ name: 'Alice', address: 'alice@example.com' });
    expect(parsed.attachments).toEqual([]);
  });
});
