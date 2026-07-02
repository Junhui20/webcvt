# @catlabtech/webcvt-integration-tests

Private, never-published package. It exists to close one gap in the monorepo's
test coverage: **`@catlabtech/webcvt-core` cannot depend on backend packages**
(dependency direction), so core's public `convert()` / `convertBatch()` is never
exercised against real backends anywhere else in CI — every other package only
unit-tests itself.

Each suite here builds a fresh `BackendRegistry`, registers **real** backends,
and drives the **real** public pipeline (`convert()` / `convertBatch()`),
asserting on parsed output content wherever feasible (not merely "did not
throw").

## Backends covered

Only backends that run under Node + vitest **without any DOM/browser API** are
registered:

| Package | Backend | Exercised conversion(s) |
| --- | --- | --- |
| `container-wav` | `WavBackend` | wav → wav (identity re-mux) |
| `subtitle` | `SubtitleBackend` | srt → vtt |
| `data-text` | `DataTextBackend` | json ↔ yaml, csv → json, cross-format value bridge |
| `archive-zip` | `ArchiveBackend` | zip → zip (identity) |
| `email` | `EmailBackend` | eml → txt, eml → json |
| `font` | `FontBackend` | ttf → woff → ttf |

## Backends excluded (and why)

- **`image-canvas`, `image-jsquash-avif/jxl/mozjpeg/oxipng`, `image-heic`,
  `image-animation`, `image-svg`, `image-pdf`** — require browser-only APIs
  (`OffscreenCanvas` / `createImageBitmap` / WebAssembly codecs / `DOMParser`)
  that are not available under Node vitest.
- **`doc-ebook-epub`** — its EPUB reader parses `container.xml` / OPF via
  `data-text`'s `parseXml`, which calls the global **`DOMParser`**. There is no
  Node-native XML DOM, and happy-dom parses XML as HTML (wrong semantics), so the
  package's own unit tests stub `DOMParser`. EPUB therefore cannot be driven
  through the *real* pipeline in a Node environment. (Not a bug — it genuinely
  needs a DOM.)
- **`comic`, `doc-pdf`** — Node-safe in principle, but require valid binary
  page-image / PDF inputs; excluded to avoid committing binary fixtures. Left for
  a follow-up.
- **`image-legacy`** — Node-safe but identity/parse-only per format with binary
  fixtures; low cross-package integration value.
- **`backend-wasm`, `backend-native`, `codec-webcodecs`** — need ffmpeg /
  native / WebCodecs runtimes.

## Fixture strategy

Everything is constructed in-memory from tiny inputs — a 48-byte PCM WAV, a ZIP
built by `archive-zip`'s own `serializeZip`, and short EML / SRT / JSON strings.
The **only** committed binary reused is `tests/fixtures/font/UbuntuMono-R.ttf`
(a real sfnt cannot be meaningfully hand-forged). No new binary fixtures are
committed.

## Running

```bash
pnpm turbo run test --filter=@catlabtech/webcvt-integration-tests
```
