# Supported formats

webcvt is modular: each format lives in its own package, and you install only
what you need. This page lists what the library can parse/convert today and what
the [live playground](https://webcvt.pages.dev) wires up out of the box.

> Status: pre-release (v0.1.0 in launch prep). Package names are
> `@catlabtech/webcvt-*`. See the [CHANGELOG](../CHANGELOG.md) for what is and
> isn't shipped.

## Try it now — playground conversions

These pairs are enabled in the [browser playground](https://webcvt.pages.dev)
today (100% client-side, no upload). Drag a file in and pick a target:

| Input | Convert to | Backend package |
|-------|-----------|-----------------|
| PNG | WebP, JPEG, BMP, ICO, **JXL**, **AVIF** | `image-canvas`, `image-jsquash-jxl`, `image-jsquash-avif` |
| JPG / JPEG | PNG, WebP, BMP, ICO, **JXL**, **AVIF** | `image-canvas`, `image-jsquash-jxl`, `image-jsquash-avif` |
| WebP | PNG, JPEG, BMP, **JXL**, **AVIF** | `image-canvas`, `image-jsquash-jxl`, `image-jsquash-avif` |
| GIF | PNG, WebP | `image-canvas` |
| BMP | PNG, WebP, JPEG | `image-canvas` |
| **JXL** | PNG, JPEG, WebP | `image-jsquash-jxl` |
| **AVIF** | PNG, JPEG, WebP | `image-jsquash-avif` |
| **HEIC / HEIF** (iPhone) | JPEG, PNG, WebP | `image-heic` |
| **JPEG / PNG / WebP / GIF / BMP** | **PDF** | `image-pdf` |
| TIFF | PNG, BMP | `image-legacy` |
| TGA | PNG, BMP | `image-legacy` |
| QOI | PNG, BMP | `image-legacy` |
| SRT | VTT, ASS | `subtitle` |
| VTT | SRT, ASS | `subtitle` |
| ASS | SRT, VTT | `subtitle` |
| CSV | TSV, JSON | `data-text` |
| TSV | CSV, JSON | `data-text` |
| JSON | CSV, YAML | `data-text` |
| ZIP | TAR | `archive-zip` |

The full library supports many more formats than the demo wires up — see below.

## Library format support by package

Runtime key: 🌐 browser · 🟢 Node.js · ⚙️ Cloudflare Workers. Most packages run
in all three; WebCodecs-backed paths require a runtime that provides WebCodecs.

### Images

| Package | Formats | Notes |
|---------|---------|-------|
| `image-canvas` | PNG, JPEG, WebP, BMP, ICO | Canvas API decode/encode; hand-rolled BMP/ICO writers |
| `image-legacy` | PBM, PGM, PPM, PFM, QOI, TIFF, TGA, XBM, PCX, XPM, ICNS | Hand-rolled parsers; byte-equivalent round-trip where the spec allows |
| `image-animation` | GIF, APNG, animated WebP | Frame extraction + assembly |
| `image-svg` | SVG → raster | Canvas rasterize behind aggressive security gates (XXE / billion-laughs / external-entity blocks) |
| `image-jsquash-avif` | AVIF (encode + decode) | via `@jsquash/avif` WASM (libavif) |
| `image-jsquash-jxl` | JPEG XL / JXL (encode + decode) | royalty-free; via `@jsquash/jxl` WASM (libjxl) |
| `image-jsquash-mozjpeg` | JPEG (encode + decode) | smaller JPEGs via `@jsquash/jpeg` WASM (MozJPEG); overlaps `image-canvas` |
| `image-jsquash-oxipng` | PNG (lossless optimise / encode) | smaller PNGs via `@jsquash/oxipng` WASM (OxiPNG); overlaps `image-canvas` |
| `image-pdf` | image → PDF | clean-room PDF writer (no deps); JPEG via DCTDecode, others via Flate + alpha SMask |
| `image-heic` | HEIC / HEIF → PNG, JPEG, WebP | decode-only iPhone photos; via `libheif-js` WASM (libheif); canvas pixel-bridge |

### Audio & video containers

| Package | Formats | Notes |
|---------|---------|-------|
| `container-wav` | WAV (RIFF) | WAVEFORMATEXTENSIBLE recognition |
| `container-mp3` | MP3 (MPEG-1/2/2.5 Layer III) | ID3v2/v1, Xing/LAME/VBRI |
| `container-flac` | FLAC | Native demux/serialize + WebCodecs decode |
| `container-ogg` | Ogg (Vorbis, Opus) | Stream chaining |
| `container-aac` | AAC (ADTS) | AudioSpecificConfig |
| `container-mp4` | MP4 / M4A | Classic + fragmented; multi-track; avc1/avc3/hev1/hvc1/vp09/av01 + AAC; edit lists; iTunes metadata |
| `container-webm` | WebM | VP8/VP9 + Opus/Vorbis |
| `container-mkv` | Matroska (MKV) | AVC/HEVC/VP9 + AAC/FLAC/Opus/Vorbis |
| `container-ts` | MPEG-TS / HLS | H.264 + AAC ADTS |
| `ebml` | — | Shared EBML primitives (RFC 8794) used by MKV/WebM |
| `codec-webcodecs` | — | Hardware-accelerated encode/decode adapter |
| `backend-wasm` | ~203 MIME pairs | ffmpeg.wasm fallback, lazy-loaded only when no native path exists |

### Subtitles

| Package | Formats | Notes |
|---------|---------|-------|
| `subtitle` | SRT, WebVTT, ASS, SSA, MicroDVD (SUB), MPL | Any pair round-trips |

### Data & text

| Package | Formats | Notes |
|---------|---------|-------|
| `data-text` | JSON, JSONL, CSV, TSV, INI, ENV, TOML, FWF, XML, YAML | Security gates: billion-laughs + XXE (XML/YAML), prototype-pollution (INI/ENV/YAML), depth bombs |

### Email + Ebook

| Package | Formats | Notes |
|---------|---------|-------|
| `email` | EML (RFC 5322 + MIME) → text / JSON | Self-written, zero deps; multipart, base64/QP, RFC 2047 encoded-words; depth/size security caps |
| `doc-ebook-epub` | EPUB (OCF + OPF) → text / HTML / JSON | Read-only; composes `archive-zip` (unzip) + `data-text` (`parseXml`); spine-ordered extraction; `../`-traversal + bomb caps |

### Archives

| Package | Formats | Notes |
|---------|---------|-------|
| `archive-zip` | ZIP, POSIX ustar TAR, gzip | bz2/xz routed to `backend-wasm`; zip-slip / decompression-bomb hardened |

## Notes

- **Modular install** — e.g. `npm i @catlabtech/webcvt-core @catlabtech/webcvt-container-mp3`
  for just MP3. The browser bundle stays in the 5–500 KB range instead of
  ffmpeg.wasm's ~30 MB.
- **Hardware acceleration** — video/audio decode/encode uses WebCodecs where the
  runtime supports it, falling back to `backend-wasm` (ffmpeg.wasm) only when no
  native or in-house path exists.
- **Privacy** — every conversion above runs locally; files never leave the device.

This list grows as new format packages land. For per-package API docs see the
[documentation site](https://webcvt.pages.dev) and the package READMEs.
