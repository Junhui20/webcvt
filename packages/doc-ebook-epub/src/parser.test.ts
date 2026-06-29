import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockDOMParser, buildEpub } from './_test-helpers/xml-dom.ts';
import { MAX_INPUT_BYTES } from './constants.ts';
import {
  EpubInputTooLargeError,
  EpubInvalidContainerError,
  EpubInvalidMimetypeError,
  EpubInvalidOpfError,
  EpubMissingContainerError,
  EpubMissingContentError,
  EpubMissingOpfError,
  EpubPathTraversalError,
  EpubTooManyManifestItemsError,
  EpubTooManySpineItemsError,
} from './errors.ts';
import { parseEpub, resolveHref } from './parser.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
    <dc:creator>Alan Turing</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">urn:uuid:abc-123</dc:identifier>
  </metadata>
  <manifest>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;

const CH1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title></head><body><h1>Chapter One</h1><p>Hello &amp; welcome.</p></body></html>`;

const CH2 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch2</title></head><body><h1>Chapter Two</h1><p>Second chapter text.</p></body></html>`;

function standardEntries(): Array<[string, string]> {
  return [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', CONTAINER],
    ['OEBPS/content.opf', OPF],
    ['OEBPS/chapter1.xhtml', CH1],
    ['OEBPS/text/chapter2.xhtml', CH2],
    ['OEBPS/style.css', '.a{}'],
  ];
}

beforeEach(() => {
  vi.stubGlobal('DOMParser', MockDOMParser);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// resolveHref (pure)
// ---------------------------------------------------------------------------

describe('resolveHref', () => {
  it('resolves relative to the OPF directory', () => {
    expect(resolveHref(['OEBPS'], 'chapter1.xhtml')).toBe('OEBPS/chapter1.xhtml');
    expect(resolveHref(['OEBPS'], 'text/chapter2.xhtml')).toBe('OEBPS/text/chapter2.xhtml');
  });

  it('normalises "." and ".." within the root', () => {
    expect(resolveHref(['OEBPS', 'text'], '../images/x.png')).toBe('OEBPS/images/x.png');
    expect(resolveHref(['OEBPS'], './a.xhtml')).toBe('OEBPS/a.xhtml');
  });

  it('strips fragments and queries and percent-decodes', () => {
    expect(resolveHref(['OEBPS'], 'a%20b.xhtml#frag')).toBe('OEBPS/a b.xhtml');
    expect(resolveHref(['OEBPS'], 'a.xhtml?x=1')).toBe('OEBPS/a.xhtml');
  });

  it('treats a leading slash as relative to the zip root', () => {
    expect(resolveHref(['OEBPS'], '/top.xhtml')).toBe('top.xhtml');
  });

  it('rejects traversal escaping the root', () => {
    expect(() => resolveHref(['OEBPS'], '../../secret.txt')).toThrow(EpubPathTraversalError);
    expect(() => resolveHref([], '..')).toThrow(EpubPathTraversalError);
    expect(() => resolveHref([], '/')).toThrow(EpubPathTraversalError);
  });

  it('passes a malformed percent-escape through unchanged', () => {
    expect(resolveHref([], 'a%ZZb.xhtml')).toBe('a%ZZb.xhtml');
  });
});

// ---------------------------------------------------------------------------
// parseEpub — happy path
// ---------------------------------------------------------------------------

describe('parseEpub — 2-chapter EPUB', () => {
  it('extracts metadata, version, opfPath, manifest, and ordered spine', async () => {
    const book = await parseEpub(await buildEpub(standardEntries()));

    expect(book.version).toBe('3.0');
    expect(book.opfPath).toBe('OEBPS/content.opf');
    expect(book.metadata).toEqual({
      title: 'Test Book',
      creators: ['Ada Lovelace', 'Alan Turing'],
      language: 'en',
      identifier: 'urn:uuid:abc-123',
    });
    expect(book.manifest).toHaveLength(3);
    expect(book.manifest.map((m) => m.id)).toEqual(['c1', 'c2', 'css']);

    expect(book.spine).toHaveLength(2);
    expect(book.spine.map((c) => c.href)).toEqual([
      'OEBPS/chapter1.xhtml',
      'OEBPS/text/chapter2.xhtml',
    ]);
    expect(book.spine[0]?.mediaType).toBe('application/xhtml+xml');
  });

  it('pulls each spine document’s bytes from the container', async () => {
    const book = await parseEpub(await buildEpub(standardEntries()));
    expect(new TextDecoder().decode(book.spine[0]?.bytes ?? new Uint8Array())).toContain(
      'Chapter One',
    );
    expect(new TextDecoder().decode(book.spine[1]?.bytes ?? new Uint8Array())).toContain(
      'Second chapter text.',
    );
  });

  it('tolerates an absent mimetype entry', async () => {
    const entries = standardEntries().filter(([name]) => name !== 'mimetype');
    const book = await parseEpub(await buildEpub(entries));
    expect(book.metadata.title).toBe('Test Book');
  });
});

// ---------------------------------------------------------------------------
// parseEpub — error paths
// ---------------------------------------------------------------------------

describe('parseEpub — typed errors', () => {
  it('rejects oversized input without allocating', async () => {
    const fake = { length: MAX_INPUT_BYTES + 1 } as unknown as Uint8Array;
    await expect(parseEpub(fake)).rejects.toBeInstanceOf(EpubInputTooLargeError);
  });

  it('rejects a present-but-wrong mimetype', async () => {
    const entries = standardEntries().map(
      ([name, content]) =>
        (name === 'mimetype' ? [name, 'text/plain'] : [name, content]) as [string, string],
    );
    await expect(parseEpub(await buildEpub(entries))).rejects.toBeInstanceOf(
      EpubInvalidMimetypeError,
    );
  });

  it('rejects a missing container.xml', async () => {
    const entries = standardEntries().filter(([name]) => name !== 'META-INF/container.xml');
    await expect(parseEpub(await buildEpub(entries))).rejects.toBeInstanceOf(
      EpubMissingContainerError,
    );
  });

  it('rejects a container.xml with no usable rootfile', async () => {
    const badContainer = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="x.opf" media-type="text/plain"/>
  </rootfiles>
</container>`;
    const entries = standardEntries().map(
      ([name, content]) =>
        (name === 'META-INF/container.xml' ? [name, badContainer] : [name, content]) as [
          string,
          string,
        ],
    );
    await expect(parseEpub(await buildEpub(entries))).rejects.toBeInstanceOf(
      EpubInvalidContainerError,
    );
  });

  it('rejects a missing OPF package document', async () => {
    const entries = standardEntries().filter(([name]) => name !== 'OEBPS/content.opf');
    await expect(parseEpub(await buildEpub(entries))).rejects.toBeInstanceOf(EpubMissingOpfError);
  });

  it('rejects an OPF missing the <spine> element', async () => {
    const noSpine = OPF.replace(/<spine>[\s\S]*<\/spine>/, '');
    const entries = standardEntries().map(
      ([name, content]) =>
        (name === 'OEBPS/content.opf' ? [name, noSpine] : [name, content]) as [string, string],
    );
    await expect(parseEpub(await buildEpub(entries))).rejects.toBeInstanceOf(EpubInvalidOpfError);
  });

  it('rejects a spine referencing an unknown manifest id', async () => {
    const badSpine = OPF.replace('idref="c2"', 'idref="does-not-exist"');
    const entries = standardEntries().map(
      ([name, content]) =>
        (name === 'OEBPS/content.opf' ? [name, badSpine] : [name, content]) as [string, string],
    );
    await expect(parseEpub(await buildEpub(entries))).rejects.toBeInstanceOf(EpubInvalidOpfError);
  });

  it('rejects a spine document missing from the container', async () => {
    const entries = standardEntries().filter(([name]) => name !== 'OEBPS/text/chapter2.xhtml');
    await expect(parseEpub(await buildEpub(entries))).rejects.toBeInstanceOf(
      EpubMissingContentError,
    );
  });

  it('rejects a path-traversal href', async () => {
    const evilOpf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Evil</dc:title></metadata>
  <manifest><item id="bad" href="../../../etc/passwd" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="bad"/></spine>
</package>`;
    const entries = standardEntries().map(
      ([name, content]) =>
        (name === 'OEBPS/content.opf' ? [name, evilOpf] : [name, content]) as [string, string],
    );
    await expect(parseEpub(await buildEpub(entries))).rejects.toBeInstanceOf(
      EpubPathTraversalError,
    );
  });

  it('enforces the manifest item cap', async () => {
    let items = '';
    for (let k = 0; k < 10_001; k += 1) {
      items += `<item id="i${k}" href="c${k}.xhtml" media-type="application/xhtml+xml"/>`;
    }
    const bigOpf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Big</dc:title></metadata>
  <manifest>${items}</manifest>
  <spine><itemref idref="i0"/></spine>
</package>`;
    const entries = standardEntries().map(
      ([name, content]) =>
        (name === 'OEBPS/content.opf' ? [name, bigOpf] : [name, content]) as [string, string],
    );
    await expect(parseEpub(await buildEpub(entries))).rejects.toBeInstanceOf(
      EpubTooManyManifestItemsError,
    );
  });

  it('enforces the spine itemref cap', async () => {
    let refs = '';
    for (let k = 0; k < 5_001; k += 1) refs += '<itemref idref="c1"/>';
    const bigSpineOpf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Big</dc:title></metadata>
  <manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine>${refs}</spine>
</package>`;
    const entries = standardEntries().map(
      ([name, content]) =>
        (name === 'OEBPS/content.opf' ? [name, bigSpineOpf] : [name, content]) as [string, string],
    );
    await expect(parseEpub(await buildEpub(entries))).rejects.toBeInstanceOf(
      EpubTooManySpineItemsError,
    );
  });
});
