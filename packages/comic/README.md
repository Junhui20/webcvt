# @catlabtech/webcvt-comic

Comic-book archive support for [webcvt](https://github.com/Junhui20/webcvt): read a **CBZ** and convert it to a **PDF**, entirely client-side.

It is **composed from existing webcvt packages** — no new parsing surface:

- [`@catlabtech/webcvt-archive-zip`](../archive-zip) — `parseZip` reads the CBZ (a ZIP of images), with zip-slip + decompression-bomb protection.
- [`@catlabtech/webcvt-doc-pdf`](../doc-pdf) — `imagesToPdf` wraps the pages into a multi-page PDF.

## Install

```bash
npm install @catlabtech/webcvt-core \
  @catlabtech/webcvt-archive-zip \
  @catlabtech/webcvt-doc-pdf \
  @catlabtech/webcvt-comic
```

## Usage

```typescript
import { parseComic } from '@catlabtech/webcvt-comic';

const book = await parseComic(cbzBytes);  // async
book.pageCount;
book.pages;   // ComicPage[] — { name, bytes, mime }, in natural page order
```

Convert via the backend (opt-in registration):

```typescript
import { convert, defaultRegistry } from '@catlabtech/webcvt-core';
import { ComicBackend } from '@catlabtech/webcvt-comic';

defaultRegistry.register(new ComicBackend());
const pdf = await convert(cbzBlob, { format: 'pdf' });
```

Pages are sorted in **natural order** (`page2` before `page10`), and non-image entries, `__MACOSX/`, and dotfiles are skipped. CBZ shares ZIP magic bytes, so it's recognised by the `.cbz` filename hint.

## Not supported

- **CBR** (RAR) and **CB7** (7z) are detected but **decode is deferred** — they need a RAR/7z wasm decoder (like WOFF2 for fonts). They throw a typed `ComicRarNotSupportedError` / `Comic7zNotSupportedError`.
- cbz→pdf inherits `doc-pdf`'s image support (JPEG + opaque grayscale/RGB PNG). A page in another format throws a typed error advising pre-transcoding.

## Security

512 MiB input cap, ≤5000 pages (enforced before reading bytes); ZIP bomb / zip-slip protection inherited from `archive-zip`.

## License

MIT
