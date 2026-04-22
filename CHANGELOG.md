# Changelog

All notable changes to `webcvt` are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-04-22

Initial public release. **22 packages, 3,970 tests, ~110,000 LOC.** All packages published to npm at `@catlabtech/webcvt-*@0.1.0`.

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

- `apps/docs` (VitePress docs site) — in flight.
- More examples (vanilla HTML, React, Next.js, Cloudflare Worker).
- AVIF / JPEG XL / HEIC encode (Phase 6, v0.2+).
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
