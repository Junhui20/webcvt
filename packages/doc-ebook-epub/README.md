# @catlabtech/webcvt-doc-ebook-epub

Read-only **EPUB** (EPUB 3.3 OCF + OPF) reader for [webcvt](https://github.com/Junhui20/webcvt) — extract an ebook's metadata and reading order, and convert it to text, HTML, or JSON, entirely client-side.

It is **composed from existing hardened webcvt packages** rather than re-rolling any parsing:

- [`@catlabtech/webcvt-archive-zip`](../archive-zip) — `parseZip` reads the OCF ZIP container (zip-slip + decompression-bomb protection).
- [`@catlabtech/webcvt-data-text`](../data-text) — `parseXml` parses `container.xml` and the OPF package document (DOCTYPE / ENTITY / XXE rejection).

## Install

```bash
npm install @catlabtech/webcvt-core \
  @catlabtech/webcvt-archive-zip \
  @catlabtech/webcvt-data-text \
  @catlabtech/webcvt-doc-ebook-epub
```

## Usage

```typescript
import { parseEpub } from '@catlabtech/webcvt-doc-ebook-epub';

const book = await parseEpub(epubBytes);   // async: ZIP entry reads are async
book.metadata;   // { title?, creators: string[], language?, identifier? }
book.spine;      // ordered EpubChapter[] — { href, mediaType, bytes }
book.manifest;   // EpubManifestItem[]
```

Convert via the backend (opt-in registration — never auto-registers):

```typescript
import { convert, defaultRegistry } from '@catlabtech/webcvt-core';
import { EpubBackend } from '@catlabtech/webcvt-doc-ebook-epub';

defaultRegistry.register(new EpubBackend());
const txt = await convert(epubBlob, { format: 'txt' });   // spine text, concatenated
const html = await convert(epubBlob, { format: 'html' });  // one HTML document
const json = await convert(epubBlob, { format: 'json' });  // metadata + structure
```

A conformant EPUB (a ZIP whose first entry is an uncompressed `mimetype` of `application/epub+zip`) is recognised by `detectFormat`; a plain ZIP stays a ZIP.

## Security

256 MiB input cap, ≤10,000 manifest items, ≤5,000 spine items, 64 MiB concatenated-output cap, depth-64 XML walk, and `../` path-traversal rejection on every manifest/spine href. ZIP and XML bomb / XXE protection are inherited from the two composed packages.

## Out of scope

EPUB authoring/writing, recursive nav-document / NCX table-of-contents modelling, and font/CSS rendering.

## License

MIT
