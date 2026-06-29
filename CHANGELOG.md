# Changelog

All notable changes to `webcvt` are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`@catlabtech/webcvt-email`** — self-written EML (RFC 5322 + MIME) parser with zero runtime dependencies: header folding/unfolding, RFC 2047 encoded-words, multipart (depth-capped), base64 / quoted-printable transfer encodings, address-list parsing, and HTML→text. `EmailBackend` converts `eml` → `txt` / `json` (opt-in registration). Security caps (64 MiB input, ≤1000 headers, MIME depth ≤20, ≤1000 parts) and prototype-pollution-safe header maps. `eml` (`message/rfc822`) added to the core format registry. **(Phase 7 / Wave C)**
- **`@catlabtech/webcvt-container-mp4`** — typed `sidx` (Segment Index) and `mfra`/`tfra`/`mfro` (Movie Fragment Random Access) parsing, surfaced on `Mp4File.sidx[]` / `Mp4File.mfra`.
- **`@catlabtech/webcvt-container-ts`** — M2TS (192-byte BDAV/AVCHD) support: the 4-byte TP_extra_header prefixes are stripped to a standard 188-byte stream; `.m2ts`/`.mts` recognised by `detectFormat`.
- **`@catlabtech/webcvt-container-webm`** / **`@catlabtech/webcvt-container-mkv`** — AV1 (`V_AV01`) video tracks; mkv also derives the `av01.…` WebCodecs codec string from the av1C config record.
- **`@catlabtech/webcvt-image-jsquash-jxl`** — JPEG XL (JXL) decode/encode backend via `@jsquash/jxl` (libjxl WASM): lazy wasm loading, typed errors, security caps (256 MiB / 25 MP), opt-in registration. Wired into the playground (PNG/JPEG/WebP ↔ JXL) and registered in core's format table. Royalty-free modern codec.
- **`@catlabtech/webcvt-image-jsquash-mozjpeg`** — high-quality JPEG decode/encode backend via `@jsquash/jpeg` (MozJPEG WASM): smaller JPEGs (trellis quantisation, progressive). Same lazy-load / typed-error / security-cap design as the other jsquash backends. Overlaps `image-canvas` for `image/jpeg` (register one).
- **`@catlabtech/webcvt-image-jsquash-oxipng`** — lossless PNG optimisation / encoding backend via `@jsquash/oxipng` (OxiPNG WASM): re-compresses existing PNGs or encodes pixels to a smaller PNG than canvas. Overlaps `image-canvas` for `image/png` (register one).
- **`@catlabtech/webcvt-image-pdf`** — wrap an image into a one-page PDF via a clean-room PDF writer (zero runtime dependencies): JPEG embedded losslessly via `DCTDecode`, other formats via Flate-compressed `DeviceRGB` + alpha soft mask. Added `pdf`/`document` to core's format table and wired JPEG/PNG/WebP/GIF/BMP → PDF into the playground.
- **`@catlabtech/webcvt-image-heic`** — HEIC/HEIF **decode** backend via `libheif-js` (libheif WASM): turn iPhone/iPad photos into PNG/JPEG/WebP entirely client-side. Lazy wasm loading, typed errors, security caps (256 MiB / 40 MP), opt-in registration; decode-only (libheif-js has no encoder). Wired into the playground (HEIC/HEIF → JPEG/PNG/WebP) with the `libheif-js/wasm-bundle` codec lazy-loaded only on first HEIC conversion.
- **`@catlabtech/webcvt-core`** — `detectFormat` now disambiguates the shared ISOBMFF `ftyp` box by brand, so HEIC / HEIF / AVIF are no longer mis-detected as MP4; `heic`/`heif` added to the known-format registry.
- **`apps/playground`** — AVIF wired in (PNG/JPEG/WebP ↔ AVIF) alongside JXL; Vite `worker.format: 'es'` so the `@jsquash` multithreaded wasm worker bundles.
- **`.github/workflows/deploy.yml`** — auto-deploy the playground + docs to Cloudflare Pages on push to `main` (replaces the manual `scripts/release.sh` wrangler step).
- **`@catlabtech/webcvt-core`** — `avif`, `jxl`, and `pdf` added to the known-format registry so they are discoverable via `findByExt` / `detectFormatWithHint`.
- **`@catlabtech/webcvt-core`** — `convertBatch(items, options, context)`: convert many files concurrently with a configurable concurrency cap, per-item error isolation (one failure never aborts the batch), index-aligned results, an overall `AbortSignal`, and per-item progress.
- **`apps/playground`** — multi-file **batch conversion**: drop several files to enter batch mode, pick one shared target format, convert all with a bounded concurrency pool + per-file status, then **download everything as a single ZIP** (bundled via `@catlabtech/webcvt-archive-zip`). One file still uses the single-file flow.
- **`.github/workflows/release.yml`** — tag-triggered npm publish workflow (`pnpm -r publish`) using a `NPM_TOKEN` repo secret.
- **`apps/docs`** — VitePress documentation site (guides, per-package reference, error-code reference); added `image-jsquash-avif`, `image-jsquash-jxl`, and `image-heic` package pages.
- **`examples/`** — runnable integrations: `react`, `nextjs`, `cloudflare-worker`, `vanilla-html` (alongside `node-subtitle`).
- **`@catlabtech/webcvt-image-jsquash-avif`** (`0.2.0-rc.0`) — first-pass AVIF encode/decode via `@jsquash` WASM.
- **`docs/supported-formats.md`** — consolidated supported-format / conversion matrix.

### Fixed

- **`@catlabtech/webcvt-codec-webcodecs`** — `VideoEncoder`/`AudioEncoder` now close the input `VideoFrame`/`AudioData` after encoding, matching the documented WebCodecs ownership contract (prevents GPU-frame leaks in transcode loops).
- **`@catlabtech/webcvt-image-legacy`** — TIFF LZW decoder rewritten from O(n²) (per-entry `concat`) to a linear prefix/suffix + stack decoder; identical output, no per-entry allocation.

### Security

- **`apps/playground`** — added a Content-Security-Policy plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy`; **`apps/docs`** — added nosniff / frame / referrer headers.
- **`apps/playground`** — `escHtml()` now also escapes single quotes.

## [0.1.0] — Unreleased

First public release, in preparation. **22 packages, 3,970 tests, ~110,000 LOC.** On release, all packages will be published to npm as `@catlabtech/webcvt-*@0.1.0`.

### Design guarantees

- **Browser-first.** Same code in Node.js and Cloudflare Workers.
- **Privacy by default.** Files never leave the device. Zero network requests during conversion.
- **Clean-room implementation.** Every container/codec/format specification parsed from official specs; no porting from ffmpeg, gpac, MP4Box, Bento4, or any other third-party implementation.
- **Typed errors everywhere.** Every failure is a `WebcvtError` subclass with a `UPPER_SNAKE_CASE` code — zero bare `throw new Error(...)` in production code.
- **Every byte audited.** Parsers reject adversarial inputs via per-format security caps; integer overflows guarded; bounds checks before subarray; emulation bytes preserved; no silent data corruption.

### Added — foundation

- **`@catlabtech/webcvt-core`** — public API + types + format detector + backend registry + capability probe. `convert(blob, { format })` dispatches to registered backends. `detectFormat()` (magic bytes) + `detectFormatWithHint()` (filename fallback for text formats).
- **`@catlabtech/webcvt-codec-webcodecs`** — hardware-accelerated encode/decode adapter for browser + Node 24+.
- **`@catlabtech/webcvt-backend-wasm`** — ffmpeg.wasm fallback (lazy-loaded 30 MB core; ~203 curated MIME pairs).
- **`@catlabtech/webcvt-test-utils`** — shared test fixtures + byte helpers.

### Added — audio + video containers

- **`@catlabtech/webcvt-container-wav`** — RIFF/WAV with WAVEFORMATEXTENSIBLE recognition.
- **`@catlabtech/webcvt-container-mp3`** — MPEG-1/2/2.5 Layer III, ID3v2/v1, Xing/LAME/VBRI tags.
- **`@catlabtech/webcvt-container-flac`** — native FLAC demux + serialize + WebCodecs decode.
- **`@catlabtech/webcvt-container-ogg`** — Ogg transport (Vorbis, Opus) with chaining.
- **`@catlabtech/webcvt-container-aac`** — AAC ADTS + AudioSpecificConfig.
- **`@catlabtech/webcvt-container-mp4`** — Classic + fragmented MP4 (DASH/HLS-CMAF/MSE); multi-track audio+video; video codecs avc1/avc3/hev1/hvc1/vp09/av01 with WebCodecs-ready codec strings; edit lists (AAC priming trim); iTunes-style metadata (udta/meta/ilst); keyframe detection via stss + trun sample_is_non_sync_sample; byte-equivalent round-trip for any parseable input.
- **`@catlabtech/webcvt-container-webm`** — WebM (VP8/VP9 + Opus/Vorbis).
- **`@catlabtech/webcvt-container-mkv`** — Matroska (H.264/HEVC/VP9 + AAC/FLAC/Opus/Vorbis).
- **`@catlabtech/webcvt-container-ts`** — MPEG-TS / HLS with H.264 + AAC ADTS.
- **`@catlabtech/webcvt-ebml`** — shared EBML primitives (RFC 8794).

### Added — images

- **`@catlabtech/webcvt-image-canvas`** — PNG/JPG/WebP/BMP/ICO via Canvas API + hand-rolled BMP/ICO writers.
- **`@catlabtech/webcvt-image-legacy`** — 11 formats: PBM/PGM/PPM/PFM/QOI/TIFF/TGA/XBM/PCX/XPM/ICNS. All hand-rolled parsers, byte-equivalent round-trip where the spec allows.
- **`@catlabtech/webcvt-image-animation`** — GIF, APNG, animated WebP.
- **`@catlabtech/webcvt-image-svg`** — SVG parse + Canvas rasterize with aggressive security gates (XXE, billion-laughs, external entity blocks).

### Added — archives + data + subtitles

- **`@catlabtech/webcvt-archive-zip`** — ZIP + POSIX ustar TAR + gzip envelope; bz2/xz routed to backend-wasm.
- **`@catlabtech/webcvt-data-text`** — 10 formats: JSON, JSONL, CSV, TSV, INI, ENV, TOML, FWF, XML, YAML. Aggressive security gates: billion-laughs + XXE (XML/YAML), prototype pollution (INI/ENV/YAML), depth bombs.
- **`@catlabtech/webcvt-subtitle`** — SRT, WebVTT, ASS, SSA, MicroDVD. Any pair round-trips.

### Added — CLI

- **`@catlabtech/webcvt-cli`** — `npx webcvt in out` Node CLI with optional-dep backend loader (16 entries). Exit codes, stdin/stdout binary I/O, 256 MiB input cap, hand-rolled argv parser (no CLI framework dep).

### Added — apps

- **`apps/playground`** — Cloudflare Pages demo site. Vanilla TypeScript + Vite; ~9.3 KB gz landing bundle + lazy format chunks; drag-drop conversion flow; zero network requests during conversion (verified via DevTools); COEP/COOP headers for WebCodecs + SharedArrayBuffer; 5 Playwright smoke tests. Live at [`webcvt.pages.dev`](https://webcvt.pages.dev).

### Added — examples

- **`examples/node-subtitle`** — Minimal Node.js SRT → VTT conversion, ~15 LOC.

### Infrastructure

- **Monorepo**: pnpm 9 workspace + turborepo build graph + biome + vitest.
- **Test coverage**: 3,970 tests passing; per-package thresholds ≥80% branches.
- **CI**: GitHub Actions on Node 20 + Node 22; `pnpm -r test`, `biome check .`, `test:coverage`.
- **Clean-room policy** documented in `plan.md §11`. Every parser cites its primary spec source and an explicit NOT-consulted list.
- **Security review** gate on every non-trivial commit via dedicated security-reviewer agent; typed errors for every validation path.

### Known limitations (documented, not bugs)

- `apps/playground`: no JPG sample button (synthetic sample wouldn't decode in browsers; drag your own file to test JPEG).
- MP4: `sidx`/`mfra` typed parse deferred (opaque round-trip works); DRM (`cenc`) deferred.
- data-text: TOON format not shipped (spec unclear for v0.1).
- Backend-wasm: full WebCodecs fallback wiring is present but curated MIME allowlist is conservative.
- Server-side Tier 3 (Office / pandoc / Ghostscript) deferred to Phase 9 / v0.x later.

### Not yet shipped

- JPEG XL / HEIC encode (Phase 6, v0.2+). AVIF encode/decode ships as a `0.2.0-rc` preview (see Unreleased).
- Font conversion (WOFF/WOFF2), EPUB, EML (Phase 7, v0.3+).
- PDF (Phase 8, v0.4+).

### Acknowledgements

Specifications consulted (primary sources only):

- ISO/IEC 14496-12 (ISOBMFF), 14496-14 (MP4), 14496-15 (AVC/HEVC in ISOBMFF)
- W3C WebCodecs Codec Registry
- VP-Codec-ISOBMFF, AV1-ISOBMFF binding specs
- DASH-IF "ISO BMFF Live Media Profile"
- RFC 2083 (PNG), RFC 8794 (EBML), RFC 3339 (date-time), RFC 5322 (EML), RFC 6350 (vCard)
- Apple QuickTime File Format Specification
- TOML v1.0.0, YAML 1.2.2, XML 1.0 Fifth Edition
- Netpbm, QOI, TIFF 6.0, Truevision Targa, PCX 5.0, X11 XBM/XPM, Apple ICNS
- FLAC format, Xiph Ogg, Matroska/WebM, ISO 13818-1 (MPEG-TS)

No code, algorithms, or byte patterns were copied from existing implementations (ffmpeg, gpac, MP4Box, Bento4, l-smash, shaka-packager, mp4box.js, jsquash, libwebp, libjpeg, xmldom, js-yaml, fast-xml-parser, or any other).
