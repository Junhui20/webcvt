# @catlabtech/webcvt-doc-pdf

Clean-room **PDF** support for [webcvt](https://github.com/Junhui20/webcvt) — write multi-page PDFs from images, and read basic structural info from a PDF. Self-written from the PDF 1.7 / ISO 32000-1 spec, with **no `pdfjs`/`pdf-lib`**.

## What it does

- **`imagesToPdf(images)`** — wrap an ordered list of JPEG/PNG images into one **multi-page PDF** (one page per image). JPEG is embedded via `DCTDecode`; opaque grayscale/RGB PNG via `FlateDecode` + a PNG predictor. Synchronous. This is the building block a comic-archive (cbz → PDF) pipeline composes.
- **`parsePdfInfo(bytes)`** — a bounded, **read-only** reader returning the PDF version, page count, and `/Info` metadata (title/author/subject/creator/producer).

> Reading is **structural only** — it does **not** extract text or decode content streams/fonts (that needs full font + content-stream parsing and is out of scope).

## Usage

```typescript
import { imagesToPdf, parsePdfInfo } from '@catlabtech/webcvt-doc-pdf';

const pdf = imagesToPdf([
  { bytes: page1Jpeg, mime: 'image/jpeg' },
  { bytes: page2Png, mime: 'image/png' },
]);

const info = parsePdfInfo(pdf);
info.pageCount; // 2
info.title;     // from /Info, if present
```

Read via the backend (opt-in registration):

```typescript
import { convert, defaultRegistry } from '@catlabtech/webcvt-core';
import { registerDocPdfBackend } from '@catlabtech/webcvt-doc-pdf';

registerDocPdfBackend(defaultRegistry);
const json = await convert(pdfBlob, { format: 'json' }); // page count + metadata
```

## Limitations

- **Write:** JPEG and opaque grayscale/RGB PNG (8/16-bit, non-interlaced). Palette/alpha/interlaced PNG and other formats throw a typed error — pre-transcode them first.
- **Read:** page count + `/Info` metadata only; no text extraction, no rendering.

## Security

256 MiB input cap, ≤10,000 pages, 25 MP/page, bounded trailer/dictionary/string scans in the reader (no regex on untrusted input).

## License

MIT
