import type { ConvertOptions, FormatDescriptor, ProgressEvent } from '@catlabtech/webcvt-core';
import { UnsupportedFormatError } from '@catlabtech/webcvt-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockDOMParser, buildEpub } from './_test-helpers/xml-dom.ts';
import {
  EPUB_FORMAT,
  EpubBackend,
  concatWithCap,
  serializeBookToHtml,
  serializeBookToJson,
  serializeBookToText,
} from './backend.ts';
import { EPUB_MIME, MAX_INPUT_BYTES } from './constants.ts';
import { EpubInputTooLargeError, EpubOutputTooLargeError } from './errors.ts';
import type { EpubBook } from './model.ts';

const TXT: FormatDescriptor = { ext: 'txt', mime: 'text/plain', category: 'document' };
const HTML: FormatDescriptor = { ext: 'html', mime: 'text/html', category: 'document' };
const JSON_FMT: FormatDescriptor = { ext: 'json', mime: 'application/json', category: 'data' };
const PNG: FormatDescriptor = { ext: 'png', mime: 'image/png', category: 'image' };

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Demo</dc:title><dc:creator>Author</dc:creator><dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;

const CH1 = '<html><body><h1>First</h1><p>alpha</p></body></html>';
const CH2 = '<html><body><h1>Second</h1><p>beta</p></body></html>';

function epubBlob(): Promise<Blob> {
  return buildEpub([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', CONTAINER],
    ['content.opf', OPF],
    ['c1.xhtml', CH1],
    ['c2.xhtml', CH2],
  ]).then((bytes) => new Blob([bytes], { type: EPUB_MIME }));
}

const enc = new TextEncoder();
function sampleBook(): EpubBook {
  return {
    version: '3.0',
    metadata: { title: 'a<b>"c"\'d\'', creators: ['Writer'], language: 'en', identifier: 'id-1' },
    opfPath: 'content.opf',
    spine: [
      { href: 'c1.xhtml', mediaType: 'application/xhtml+xml', bytes: enc.encode(CH1) },
      {
        href: 'c2.xhtml',
        mediaType: 'application/xhtml+xml',
        bytes: enc.encode('<p>no wrapper</p>'),
      },
    ],
    manifest: [{ id: 'c1', href: 'c1.xhtml', mediaType: 'application/xhtml+xml' }],
  };
}

beforeEach(() => {
  vi.stubGlobal('DOMParser', MockDOMParser);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Format descriptor + canHandle
// ---------------------------------------------------------------------------

describe('EPUB_FORMAT', () => {
  it('describes the epub format under the document category', () => {
    expect(EPUB_FORMAT).toMatchObject({
      ext: 'epub',
      mime: 'application/epub+zip',
      category: 'document',
    });
  });
});

describe('EpubBackend.canHandle', () => {
  const backend = new EpubBackend();
  it('accepts epub → txt / html / json', async () => {
    expect(await backend.canHandle(EPUB_FORMAT, TXT)).toBe(true);
    expect(await backend.canHandle(EPUB_FORMAT, HTML)).toBe(true);
    expect(await backend.canHandle(EPUB_FORMAT, JSON_FMT)).toBe(true);
  });
  it('rejects epub → png and non-epub inputs', async () => {
    expect(await backend.canHandle(EPUB_FORMAT, PNG)).toBe(false);
    expect(await backend.canHandle(PNG, TXT)).toBe(false);
  });
  it('has a stable name and does not auto-register', () => {
    expect(backend.name).toBe('doc-ebook-epub');
  });
});

// ---------------------------------------------------------------------------
// convert
// ---------------------------------------------------------------------------

describe('EpubBackend.convert', () => {
  const backend = new EpubBackend();
  const opts: ConvertOptions = { format: 'txt' };

  it('converts epub → txt with chapters joined in spine order', async () => {
    const result = await backend.convert(await epubBlob(), TXT, opts);
    const text = await result.blob.text();
    expect(result.backend).toBe('doc-ebook-epub');
    expect(result.format).toBe(TXT);
    expect(text).toContain('First');
    expect(text).toContain('alpha');
    expect(text.indexOf('First')).toBeLessThan(text.indexOf('Second'));
  });

  it('converts epub → html into one document with sections', async () => {
    const result = await backend.convert(await epubBlob(), HTML, opts);
    const html = await result.blob.text();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>Demo</title>');
    expect((html.match(/<section>/g) ?? []).length).toBe(2);
    expect(html).toContain('<h1>First</h1>');
  });

  it('converts epub → json without raw bytes', async () => {
    const result = await backend.convert(await epubBlob(), JSON_FMT, opts);
    const json = JSON.parse(await result.blob.text());
    expect(json.metadata.title).toBe('Demo');
    expect(json.spine.map((s: { href: string }) => s.href)).toEqual(['c1.xhtml', 'c2.xhtml']);
    expect(json.manifest).toHaveLength(2);
    expect(JSON.stringify(json)).not.toContain('bytes');
  });

  it('reports progress', async () => {
    const events: ProgressEvent[] = [];
    await backend.convert(await epubBlob(), TXT, {
      format: 'txt',
      onProgress: (e) => events.push(e),
    });
    expect(events.at(-1)?.percent).toBe(100);
  });

  it('rejects an unsupported output format', async () => {
    await expect(backend.convert(await epubBlob(), PNG, opts)).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );
  });

  it('rejects oversized input by size without reading it', async () => {
    const fake = {
      size: MAX_INPUT_BYTES + 1,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Blob;
    await expect(backend.convert(fake, TXT, opts)).rejects.toBeInstanceOf(EpubInputTooLargeError);
  });
});

// ---------------------------------------------------------------------------
// Serialisers (no DOMParser needed)
// ---------------------------------------------------------------------------

describe('serializeBookToText', () => {
  it('strips chapters to text and blank-line joins them', () => {
    expect(serializeBookToText(sampleBook())).toBe('First\n\nalpha\n\nno wrapper');
  });
});

describe('serializeBookToHtml', () => {
  it('escapes the title and emits a section per chapter', () => {
    const html = serializeBookToHtml(sampleBook());
    expect(html).toContain('<title>a&lt;b&gt;&quot;c&quot;&#39;d&#39;</title>');
    expect(html).toContain('<h1>First</h1>');
    expect(html).toContain('<p>no wrapper</p>');
  });

  it('falls back gracefully for chapters with an unusual or absent body', () => {
    const book: EpubBook = {
      metadata: { creators: [] },
      opfPath: 'content.opf',
      manifest: [],
      spine: [
        { href: 'a', mediaType: 'x', bytes: enc.encode('<body class="x"') },
        { href: 'b', mediaType: 'x', bytes: enc.encode('<body><p>z</p>') },
      ],
    };
    const html = serializeBookToHtml(book);
    expect(html).toContain('<title>EPUB</title>');
    expect(html).toContain('<p>z</p>');
  });
});

describe('serializeBookToJson', () => {
  it('serialises metadata, spine, and manifest as pretty JSON', () => {
    const json = JSON.parse(serializeBookToJson(sampleBook()));
    expect(json.version).toBe('3.0');
    expect(json.metadata.creators).toEqual(['Writer']);
    expect(json.opfPath).toBe('content.opf');
    expect(json.spine).toEqual([
      { href: 'c1.xhtml', mediaType: 'application/xhtml+xml' },
      { href: 'c2.xhtml', mediaType: 'application/xhtml+xml' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// concatWithCap
// ---------------------------------------------------------------------------

describe('concatWithCap', () => {
  it('joins parts with the separator under the default cap', () => {
    expect(concatWithCap(['a', 'b', 'c'], '-')).toBe('a-b-c');
    expect(concatWithCap([], '\n')).toBe('');
  });

  it('counts multi-byte and surrogate-pair characters', () => {
    const part = 'a é € 😀';
    expect(concatWithCap([part], '', 100)).toBe(part);
  });

  it('throws when a part overflows the cap', () => {
    expect(() => concatWithCap(['hello'], '', 4)).toThrow(EpubOutputTooLargeError);
  });

  it('counts the separator toward the cap', () => {
    expect(() => concatWithCap(['a', 'b'], '--', 2)).toThrow(EpubOutputTooLargeError);
  });
});
