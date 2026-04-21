# webcvt

> Browser-first, hardware-accelerated file conversion library. Convert anything in the browser, no upload required.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![Status](https://img.shields.io/badge/status-pre--alpha-red)

## Status

🚧 **Pre-alpha** — under active construction. Not ready for use.

- **22 packages** shipped across Phases 1–5 (`@webcvt/core` + 4 codec/image, 9 container, 2 data, 1 CLI, 4 ancillary)
- **3,970 tests** passing; CI green
- Phase 3 (core containers, second-pass Minus): **complete** — classic + fragmented MP4, multi-track, avc/hevc/vp9/av1 video, edit lists, iTunes metadata
- Phase 4 (image, animation, archive, data-text): **complete** (5/5)
- Phase 4.5 (deferred-format roll-up): **11 shipped** — image: TIFF, TGA, XBM, PCX, XPM, ICNS; data-text: JSONL, TOML, FWF, XML, YAML
- Phase 5 (launch prep): `@webcvt/cli` + `@webcvt/backend-wasm` shipped; `apps/playground`, `apps/docs`, examples, v0.1.0 release still open

See [`plan.md`](./plan.md) for the full project plan and
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for how to contribute or resume work.

## What is it

A modular TypeScript library that converts files **in the browser**, using
WebCodecs for hardware acceleration and `ffmpeg.wasm` only as a legacy
fallback. Same code runs in Node.js and Cloudflare Workers.

Target: match Transmute.sh's 200+ formats and 2,000+ conversion pairs, but
as a tree-shakable browser library instead of a Docker server.

## Competitive positioning

| | ffmpeg.wasm | Transmute | Mediabunny | **webcvt** |
|---|---|---|---|---|
| Mode | browser | server (Docker) | browser | **browser-first** |
| Bundle | 30 MB | N/A | ~50 KB | **5–500 KB (modular)** |
| HW accel | ❌ | ✅ native | ✅ | **✅** |
| TS-native | ⚠️ | ❌ | ✅ | **✅** |
| Modular | ❌ | ❌ | ⚠️ | **✅** |
| Scope | AV only | 200+ formats | AV only | **200+ formats** |

## Packages

Live list grows as Phases complete. See [plan.md §3](./plan.md) for the full roadmap.

### Foundation

- `@webcvt/core` — public API, types, format detector, backend registry, capability probe
- `@webcvt/codec-webcodecs` — hardware-accelerated encode/decode adapter
- `@webcvt/test-utils` — shared test fixtures + byte helpers
- `@webcvt/backend-wasm` — ffmpeg.wasm fallback (lazy-loaded; ~203 MIME pairs)

### Audio + video containers

- `@webcvt/container-wav` — RIFF/WAV
- `@webcvt/container-mp3` — MPEG-1/2/2.5 Layer III + ID3v2/v1 + Xing/LAME
- `@webcvt/container-flac` — FLAC (native)
- `@webcvt/container-ogg` — Ogg (Vorbis, Opus)
- `@webcvt/container-aac` — AAC ADTS
- `@webcvt/container-mp4` — M4A / MP4 (classic + fragmented; multi-track; avc1/avc3/hev1/hvc1/vp09/av01 video + AAC audio; edit lists + iTunes metadata)
- `@webcvt/container-webm` — WebM (VP8/VP9 + Opus/Vorbis)
- `@webcvt/container-mkv` — Matroska (AVC/HEVC/VP9 + AAC/FLAC/Opus/Vorbis)
- `@webcvt/container-ts` — MPEG-TS / HLS (H.264 + AAC ADTS)
- `@webcvt/ebml` — shared EBML primitives (RFC 8794)

### Images

- `@webcvt/image-canvas` — PNG/JPG/WebP/BMP/ICO via Canvas API
- `@webcvt/image-svg` — SVG parse + Canvas rasterize (with aggressive security gates)
- `@webcvt/image-animation` — GIF + APNG + animated WebP
- `@webcvt/image-legacy` — PBM/PGM/PPM/PFM/QOI + TIFF + TGA + XBM + PCX + XPM + ICNS

### Archives + data + subtitles

- `@webcvt/archive-zip` — ZIP + POSIX ustar TAR + gzip
- `@webcvt/data-text` — JSON + JSONL + CSV + TSV + INI + ENV + TOML + FWF + XML + YAML
- `@webcvt/subtitle` — SRT/VTT/ASS/SSA/SUB/MPL

### CLI

- `@webcvt/cli` — `npx webcvt in out` Node CLI with optional-dep backend loader

### Planned

See [plan.md §6 Roadmap](./plan.md) — 9 Phases over ~9 months. Next up:
`apps/playground` (browser demo), `apps/docs` (VitePress), examples, v0.1.0
npm release.

## Quickstart (once v0.1 is published)

```typescript
import { convert } from 'webcvt';

const output = await convert(file, { format: 'webp' });
```

## Development

```bash
pnpm install
pnpm build        # build all packages
pnpm test         # run all tests
pnpm typecheck
pnpm lint
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Every package follows the same
TDD + code-review + security-review pipeline.

## License

MIT © 2026 webcvt contributors.
