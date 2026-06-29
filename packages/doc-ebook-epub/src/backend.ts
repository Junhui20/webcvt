/**
 * EpubBackend — webcvt Backend implementation for read-only EPUB conversion.
 *
 * Supported conversions:
 *   epub → txt  : every spine document stripped to plain text, blank-line joined.
 *   epub → html : the spine documents' <body> contents wrapped in one minimal
 *                 HTML document (one <section> per chapter).
 *   epub → json : metadata + spine (href/mediaType) + manifest as pretty JSON.
 *                 Raw bytes are intentionally omitted to keep the result small.
 *
 * This backend deliberately does NOT auto-register itself — consumers wire it
 * into a registry explicitly. EPUB input is recognised by the filename hint /
 * format descriptor (and, optionally, by core's OCF magic-byte disambiguation).
 *
 * Clean-room from the W3C EPUB 3.3 OCF + Packages specifications.
 */

import type {
  Backend,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { UnsupportedFormatError } from '@catlabtech/webcvt-core';
import {
  EPUB_MIME,
  HTML_MIME,
  JSON_MIME,
  MAX_INPUT_BYTES,
  MAX_TOTAL_TEXT_BYTES,
  TXT_MIME,
} from './constants.ts';
import { EpubInputTooLargeError, EpubOutputTooLargeError } from './errors.ts';
import { htmlToText } from './html-to-text.ts';
import type { EpubBook } from './model.ts';
import { parseEpub } from './parser.ts';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false });

// ---------------------------------------------------------------------------
// Format descriptor
// ---------------------------------------------------------------------------

/** Format descriptor for an EPUB Open Container Format publication. */
export const EPUB_FORMAT: FormatDescriptor = {
  ext: 'epub',
  mime: EPUB_MIME,
  category: 'document',
  description: 'EPUB Electronic Publication (EPUB 3 / OCF)',
};

// ---------------------------------------------------------------------------
// Capped concatenation
// ---------------------------------------------------------------------------

/** UTF-8 byte length of a string without allocating an encoded buffer. */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: a full code point is 4 UTF-8 bytes; skip its pair.
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Join string parts with `separator`, enforcing MAX_TOTAL_TEXT_BYTES on the
 * cumulative UTF-8 size. Exposed (with an overridable cap) for testing.
 *
 * @throws {@link EpubOutputTooLargeError} when the running total exceeds `maxBytes`.
 */
export function concatWithCap(
  parts: readonly string[],
  separator: string,
  maxBytes: number = MAX_TOTAL_TEXT_BYTES,
): string {
  const separatorBytes = utf8ByteLength(separator);
  let total = 0;
  let out = '';
  for (let i = 0; i < parts.length; i += 1) {
    if (i > 0) total += separatorBytes;
    total += utf8ByteLength(parts[i] ?? '');
    if (total > maxBytes) throw new EpubOutputTooLargeError(total, maxBytes);
    if (i > 0) out += separator;
    out += parts[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Output serialisation
// ---------------------------------------------------------------------------

function decodeChapter(bytes: Uint8Array): string {
  return UTF8_DECODER.decode(bytes);
}

/** Extract the inner HTML of the first `<body>` element (ReDoS-safe, indexOf). */
function extractBodyInner(html: string): string {
  const lower = html.toLowerCase();
  const open = lower.indexOf('<body');
  if (open === -1) return html.trim();
  const gt = lower.indexOf('>', open);
  if (gt === -1) return html.trim();
  const close = lower.indexOf('</body', gt + 1);
  if (close === -1) return html.slice(gt + 1).trim();
  return html.slice(gt + 1, close).trim();
}

/** Escape the five HTML-significant characters for use in attribute/text context. */
function escapeHtml(value: string): string {
  let out = '';
  for (const ch of value) {
    switch (ch) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case "'":
        out += '&#39;';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/** Render the spine as plain text, one chapter per blank-line-separated block. */
export function serializeBookToText(book: EpubBook): string {
  const parts = book.spine.map((chapter) => htmlToText(decodeChapter(chapter.bytes)));
  return concatWithCap(parts, '\n\n');
}

/** Render the spine bodies into a single minimal HTML document. */
export function serializeBookToHtml(book: EpubBook): string {
  const sections = book.spine.map(
    (chapter) => `<section>\n${extractBodyInner(decodeChapter(chapter.bytes))}\n</section>`,
  );
  const body = concatWithCap(sections, '\n');
  const title = escapeHtml(book.metadata.title ?? 'EPUB');
  const head = `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${title}</title>`;
  return `${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

/** Render metadata + spine + manifest as pretty JSON (no raw chapter bytes). */
export function serializeBookToJson(book: EpubBook): string {
  return JSON.stringify(
    {
      version: book.version,
      metadata: {
        title: book.metadata.title,
        creators: book.metadata.creators,
        language: book.metadata.language,
        identifier: book.metadata.identifier,
      },
      opfPath: book.opfPath,
      spine: book.spine.map((chapter) => ({
        href: chapter.href,
        mediaType: chapter.mediaType,
      })),
      manifest: book.manifest.map((item) => ({
        id: item.id,
        href: item.href,
        mediaType: item.mediaType,
      })),
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Format predicates
// ---------------------------------------------------------------------------

function isEpubInput(input: FormatDescriptor): boolean {
  return input.mime === EPUB_MIME || input.ext === 'epub';
}

function isTxtOutput(output: FormatDescriptor): boolean {
  return output.mime === TXT_MIME || output.ext === 'txt';
}

function isHtmlOutput(output: FormatDescriptor): boolean {
  return output.mime === HTML_MIME || output.ext === 'html' || output.ext === 'htm';
}

function isJsonOutput(output: FormatDescriptor): boolean {
  return output.mime === JSON_MIME || output.ext === 'json';
}

// ---------------------------------------------------------------------------
// EpubBackend
// ---------------------------------------------------------------------------

export class EpubBackend implements Backend {
  readonly name = 'doc-ebook-epub';

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    return (
      isEpubInput(input) && (isTxtOutput(output) || isHtmlOutput(output) || isJsonOutput(output))
    );
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new EpubInputTooLargeError(input.size, MAX_INPUT_BYTES);
    }

    const wantsJson = isJsonOutput(output);
    const wantsHtml = isHtmlOutput(output);
    const wantsText = isTxtOutput(output);
    if (!wantsJson && !wantsHtml && !wantsText) {
      throw new UnsupportedFormatError(output.mime, 'output');
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });
    const bytes = new Uint8Array(await input.arrayBuffer());

    options.onProgress?.({ percent: 40, phase: 'parse' });
    const book = await parseEpub(bytes);

    options.onProgress?.({ percent: 70, phase: 'serialize' });
    const outputText = wantsJson
      ? serializeBookToJson(book)
      : wantsHtml
        ? serializeBookToHtml(book)
        : serializeBookToText(book);

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
