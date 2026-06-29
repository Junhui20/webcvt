/**
 * Test-only helpers (excluded from coverage and the published build).
 *
 * happy-dom's DOMParser parses XML as HTML (uppercasing names and mis-nesting
 * self-closing elements), so — exactly like the data-text and image-svg test
 * suites — we stub `DOMParser` with a tiny but correct recursive-descent XML
 * parser. data-text's `parseXml` runs its real security pre-scan and then
 * converts the DOM produced here, giving proper XML (sibling) semantics.
 *
 * Also includes a builder that zips synthetic EPUB entries with archive-zip's
 * `serializeZip`, so no binary fixtures are committed.
 */

import { type ZipEntry, serializeZip } from '@catlabtech/webcvt-archive-zip';

// ---------------------------------------------------------------------------
// Minimal DOM node shape consumed by data-text's convertElement()
// ---------------------------------------------------------------------------

interface MockNode {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  attributes: { name: string; value: string }[];
  childNodes: MockNode[];
}

function elementNode(name: string): MockNode {
  return { nodeType: 1, nodeName: name, nodeValue: null, attributes: [], childNodes: [] };
}

function textNode(value: string): MockNode {
  return { nodeType: 3, nodeName: '#text', nodeValue: value, attributes: [], childNodes: [] };
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const WS = /\s/;
const NAME_END = /[\s/>=]/;

/** Parse an XML string into a single root MockNode (correct sibling semantics). */
export function parseXmlToNode(src: string): MockNode {
  let i = 0;
  const n = src.length;

  const skipWs = (): void => {
    while (i < n && WS.test(src[i] as string)) i += 1;
  };

  const readName = (): string => {
    let name = '';
    while (i < n && !NAME_END.test(src[i] as string)) {
      name += src[i];
      i += 1;
    }
    return name;
  };

  const skipProlog = (): void => {
    for (;;) {
      skipWs();
      if (src.startsWith('<?', i)) {
        const end = src.indexOf('?>', i);
        i = end === -1 ? n : end + 2;
        continue;
      }
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i);
        i = end === -1 ? n : end + 3;
        continue;
      }
      break;
    }
  };

  const parseElement = (): MockNode => {
    i += 1; // skip '<'
    const node = elementNode(readName());

    for (;;) {
      skipWs();
      const ch = src[i];
      if (ch === '/' || ch === '>' || ch === undefined) break;
      const attrName = readName();
      skipWs();
      let attrValue = '';
      if (src[i] === '=') {
        i += 1;
        skipWs();
        const quote = src[i] as string;
        i += 1;
        const end = src.indexOf(quote, i);
        attrValue = decodeBasicEntities(src.slice(i, end === -1 ? n : end));
        i = end === -1 ? n : end + 1;
      }
      node.attributes.push({ name: attrName, value: attrValue });
    }

    skipWs();
    if (src[i] === '/') {
      i += 2; // skip '/>'
      return node;
    }
    i += 1; // skip '>'

    for (;;) {
      if (i >= n) break;
      if (src.startsWith('</', i)) {
        i += 2;
        readName();
        skipWs();
        i += 1; // skip '>'
        break;
      }
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i);
        i = end === -1 ? n : end + 3;
        continue;
      }
      if (src[i] === '<') {
        node.childNodes.push(parseElement());
        continue;
      }
      const lt = src.indexOf('<', i);
      const stop = lt === -1 ? n : lt;
      node.childNodes.push(textNode(decodeBasicEntities(src.slice(i, stop))));
      i = stop;
    }
    return node;
  };

  skipProlog();
  return parseElement();
}

/** A stub DOMParser whose document satisfies data-text's parseWithDomParser. */
export class MockDOMParser {
  parseFromString(
    source: string,
    _type: string,
  ): {
    documentElement: MockNode;
    querySelector: (selector: string) => null;
  } {
    return { documentElement: parseXmlToNode(source), querySelector: () => null };
  }
}

// ---------------------------------------------------------------------------
// Synthetic EPUB builder
// ---------------------------------------------------------------------------

const TEXT_ENCODER = new TextEncoder();

/** Build a stored ZipEntry from a name + string content. */
export function zipEntry(name: string, content: string): ZipEntry {
  const bytes = TEXT_ENCODER.encode(content);
  return {
    name,
    method: 0,
    crc32: 0,
    compressedSize: bytes.length,
    uncompressedSize: bytes.length,
    modified: new Date('2024-01-01T00:00:00Z'),
    isDirectory: false,
    localHeaderOffset: 0,
    data: async () => bytes,
    stream: () => new ReadableStream<Uint8Array>(),
  };
}

/** Zip a list of [name, content] entries into raw EPUB/OCF bytes. */
export function buildEpub(entries: ReadonlyArray<readonly [string, string]>): Promise<Uint8Array> {
  return serializeZip({
    entries: entries.map(([name, content]) => zipEntry(name, content)),
    comment: '',
  });
}
