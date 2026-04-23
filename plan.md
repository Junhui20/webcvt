# webcvt — Project Plan

> **One-liner:** A lightweight, browser-first, hardware-accelerated file conversion library and API. Convert anything in the browser, no upload required.

- **Name:** `webcvt`
- **Owner:** [Junhui20/webcvt](https://github.com/Junhui20/webcvt)
- **License:** MIT
- **Status:** **Phase 1: 7/8 · Phase 2: 7/8 · Phase 3: 5/6 (+ second-pass A + E + D.1-4 + B + C: Phase 3 second-pass Minus ✅ COMPLETE except D.3 sidx/mfra typed parse + F DRM) · Phase 4: 5/5 ✅ COMPLETE · Phase 4.5: 11/N (image-legacy TIFF + TGA + XBM + PCX + XPM + ICNS, data-text JSONL + TOML + FWF + XML + YAML) · Phase 5: 3/8 (`@catlabtech/webcvt-cli` + `@catlabtech/webcvt-backend-wasm` + `apps/playground`)** · CI green · 3,970 tests passing · 22 packages + 1 app · last revised 2026-04-20

---

## 0. Key Architecture Decision (2026-04-19)

### Strategy: Browser-first, self-written, Mediabunny-style

**webcvt is a browser library first and foremost.** Server-side (Tier 3: Office / pandoc / Ghostscript) is an optional downstream add-on, not the core product. Every architectural decision below prioritizes browser runtime, bundle size, and hardware acceleration. The Node.js and Cloudflare Worker targets reuse the same browser-designed code.

After evaluating three strategies (use Mediabunny / Fork Mediabunny / **Write ourselves**), we commit to **Option B: write our own container layer from scratch**, following Mediabunny's architectural pattern.

**Rationale:**
- Mediabunny proves this approach works: a disciplined TypeScript codebase can cover 10 containers + 25 codecs by delegating actual codec work to the browser's WebCodecs API.
- **We own 100% of our AV pipeline** — no upstream dependency can disappear, change license, or diverge from our needs.
- This is our **core competency** — if we can't do this well, we can't compete with Mediabunny anyway.
- MPL-2.0 license of Mediabunny means we can **study their code** as reference material while writing our own (see §11 clean-room policy).

**What this means:**
- `@catlabtech/webcvt-backend-mediabunny` is **removed**. Replaced with in-house packages (`container-mp4`, `container-webm`, `container-mkv`, `container-mp3`, `container-wav`, `container-ogg`, `container-flac`, `container-ts`, `container-aac`, `codec-webcodecs`).
- `@ffmpeg/ffmpeg` remains **fallback-only** (legacy: AVI, FLV, WMV, 3GP, WMA, AC3, AIFF, MPEG-1/2, ASF, F4V) — lazy-loaded, never bundled by default.
- Additional self-written replacements: **archive (ZIP/TAR), EPUB, EML, CSV, YAML, TOML, XML, TIFF, font parsing, subtitle, data-text**. All feasible because browser provides the hard primitives (`DecompressionStream`, `DOMParser`, `TextDecoder`, Canvas, WebCodecs).
- **Tier 3 server tools are de-prioritised** — Office / pandoc / Ghostscript formats ship late (Month 7+) as an optional `@catlabtech/webcvt-api-server` deployment, not bundled with the browser library.
- **Remaining 3rd-party deps: only where browser has no native support AND regulation (patents/proprietary formats) prevents re-implementation.**

**Realistic scope (revised after planner review):**
- **Total LOC:** ~25,000 (not 15,000 — earlier estimate undercounted image-legacy, subtitle, and container work)
- **MVP ship date:** Month 5 (not Week 13) — MP4 + Matroska are 2× larger than first estimate
- **Phase 3 window extended:** Weeks 6–16 (not 6–9) for MP4 + WebM + MKV + TS container work
- **Quality target:** byte-exact parity with FFmpeg reference outputs for all container muxing

**Benefit:** webcvt becomes the cleanest, most self-contained **browser** conversion library on the market. Every byte in the bundle is code we wrote and understand.

See §5 for the trimmed dependency list.

---

## 1. Mission & Differentiation

### Mission
Build the **browser-native** alternative to ffmpeg.wasm + Transmute + CloudConvert — but **lighter, faster, modular**, with the same code working as a **library**, **website**, and **API**.

### Why now?
- WebCodecs API now ships in 85%+ of browsers (incl. iOS Safari 17+) → real hardware acceleration possible
- ffmpeg.wasm is 30 MB monolithic, ships everything even if you only need MP3
- Transmute.sh is server-only (Docker, FastAPI). No browser SDK.
- ConvertX (1k★) is similar to Transmute — also server-only
- **Gap in market:** no clean, modular, browser-first **library** that developers can drop into their own apps

### Competitive positioning

| Project | Mode | Bundle | HW Accel | TS-native | Modular |
|---|---|---|---|---|---|
| ffmpeg.wasm | Browser | 30 MB | ❌ | ⚠️ | ❌ |
| Transmute | Server (Docker) | N/A | ✅ (native) | ❌ Python | ❌ |
| ConvertX | Server (Docker) | N/A | ✅ (native) | ⚠️ | ❌ |
| MediaBunny | Browser | ~50 KB | ✅ | ✅ | ⚠️ |
| **webcvt** | **Browser-first (Node + Worker reuse same code)** | **5–500 KB (modular)** | **✅** | **✅** | **✅** |

### Differentiation (the 6 selling points)
1. **Browser-first** — designed for the browser, Node/Worker reuse the same code. Server is an optional downstream, not the product.
2. **Modular** — `npm i @catlabtech/webcvt-container-mp3` if you only want MP3. No 30 MB blob.
3. **Hardware-accelerated** — WebCodecs first, ffmpeg.wasm fallback only when needed
4. **TypeScript-native** — proper types, autocomplete works
5. **Privacy-first** — files stay on user's device by default (no upload)
6. **Zero-dependency core** — AV containers, archive, subtitles, data text, EPUB, EML, fonts are all self-written. No npm dependency chain for the common path.

---

## 2. Scope — Format Support

**Target:** Match Transmute.sh format coverage → **200+ formats, 2,000+ conversion combinations** across 12 categories.

### 2.1 Full format matrix (all categories)

```
Images    (40) : apng, avif, blp, bmp, cur, dcx, dds, dib, eps, flc, fli, gif,
                 heic, heif, icns, ico, jp2, jpeg, jxl, mpo, msp, pbm, pcx, pdf,
                 pfm, pgm, png, pnm, ppm, psd, qoi, sgi, svg, tga, tiff, webp,
                 xbm, xpm
Video     (14) : 3gp, asf, avi, f4v, flv, m4v, mkv, mov, mp4, mpeg, ogv, ts,
                 webm, wmv
Audio     (12) : aac, ac3, aiff, flac, m4a, mka, mp2, mp3, oga, opus, wav, wma
Documents (31) : adoc, docx, html, ipynb, key, md, muse, odp, odt, opml, org,
                 pdf, pdf/a, pdf/e, pdf/ua, pdf/vt, pdf/x, pot, potx, pps, ppsx,
                 ppt, pptm, pptx, rst, rtf, tex, textile, txt, vcf, xml
Data      (20) : csv, dta, env, feather, fwf, ini, json, jsonl, ods, orc,
                 parquet, sav, sqlite, toml, toon, tsv, xls, xlsx, xpt, yaml
Archive    (8) : 7z, rar, tar, tar.bz2, tar.gz, tar.xz, tar.zst, zip
Ebook      (6) : azw3, epub, fb2, lrf, mobi, pdb
Subtitle   (6) : ass, mpl, srt, ssa, sub, vtt
Font       (4) : otf, ttf, woff, woff2
Comic      (3) : cb7, cbr, cbz
Email      (2) : eml, msg
Other      (2) : drawio, p7m
```

### 2.2 Browser feasibility triage (critical for "browser-first" scope)

> Not every format Transmute supports is feasible in a **browser library**. Transmute runs on a server with Calibre, LibreOffice, pandoc, Ghostscript, ImageMagick etc. — huge native toolchains. For webcvt we triage:

#### 🟢 Tier 1 — Native browser (tiny, fast, zero/minimal deps)

All rows below are **self-written in webcvt** unless noted. "Browser primitive" names the Web platform API we lean on.

| Category | Formats | Tooling (self-written) | Browser primitive |
|---|---|---|---|
| Image common | JPEG, PNG, WebP, BMP, ICO, GIF | `image-canvas` | Canvas + `toBlob` |
| Image animation | APNG, animated WebP, GIF | `image-animation` | Canvas |
| Vector | SVG ↔ raster | `image-svg` | Canvas + DOMParser |
| Video | MP4, WebM, MOV, MKV, TS | `container-{mp4,webm,mkv,ts}` + `codec-webcodecs` | **WebCodecs** (hardware-accelerated) |
| Audio | MP3, WAV, OGG, AAC, FLAC, Opus | `container-{mp3,wav,ogg,aac,flac}` + `codec-webcodecs` | WebCodecs |
| Subtitle | SRT, VTT, ASS, SSA, SUB, MPL | `subtitle` | TextDecoder |
| Data text | JSON, JSONL, YAML, TOML, CSV, TSV, XML, INI, TOON, FWF, ENV | `data-text` | DOMParser for XML, TextDecoder |
| Font | TTF, OTF, WOFF, WOFF2 | `font` | `DecompressionStream` (Brotli for WOFF2) |
| Archive | ZIP, TAR, .gz, .bz2, .xz | `archive-zip` | `DecompressionStream` / `CompressionStream` |
| EPUB | EPUB 3.3 | `doc-ebook-epub` | `archive-zip` + DOMParser |
| Email | EML (RFC 5322) | `email` | TextDecoder |

→ **Estimated: ~70 formats, ~1,000 conversion pairs, zero npm dependencies for this entire tier**

#### 🟡 Tier 2 — wasm-enabled (larger, lazy-loaded per codec)

Only formats where browser primitives are insufficient AND the codec is patent-encumbered, proprietary, or >10,000 LOC of spec work to re-implement.

| Category | Formats | Tooling |
|---|---|---|
| Modern image | AVIF (encode), JXL, HEIC, HEIF | `@jsquash/avif`, `@jsquash/jxl`, `libheif-js` |
| Legacy image (self-written) | TIFF, TGA, QOI, PCX, PBM, PGM, PNM, PPM, PFM, XBM, XPM, ICNS, CUR, DCX, MPO, MSP, FLC, FLI | `image-legacy` (self-written from specs) |
| Legacy image (wasm) | PSD, BLP, DDS, EPS, JP2 | `image-legacy-wasm` (lazy plugin) |
| Legacy video | AVI, FLV, WMV, 3GP, MPEG, F4V, ASF, OGV | `@ffmpeg/ffmpeg` (fallback only, lazy) |
| Legacy audio | WMA, AC3, AIFF, MKA, MP2 | `@ffmpeg/ffmpeg` (fallback, lazy) |
| Ebook (proprietary) | MOBI, AZW3, FB2, PDB, LRF | `doc-ebook-mobi` (wasm; EPUB is Tier 1) |
| PDF | PDF | `pdfjs-dist` + `pdf-lib` |
| Comic | CBZ, CBR, CB7 | `archive-zip` + `unrar-wasm` + `7z-wasm` |
| Email (proprietary) | MSG (Outlook) | `@kenjiuno/msgreader` (EML is Tier 1) |
| Data binary | Parquet, ORC, Feather, SQLite | `apache-arrow`, `sql.js` |
| Archive (proprietary) | 7z, RAR | `7z-wasm`, `unrar-wasm` |

→ **Estimated: ~50 formats, ~700 conversion pairs**

#### 🔴 Tier 3 — Server-only (API package, not browser core)

| Category | Formats | Reason |
|---|---|---|
| Office suite | DOCX, ODT, PPTX, ODP, XLSX, XLS, KEY, PPT, PPTM, POT, POTX, PPS, PPSX | LibreOffice (~200MB), not browser-feasible |
| Academic / markup | ADOC, RST, TEX, Textile, MUSE, OPML, ORG, IPYNB | pandoc-wasm (~20MB) — possible browser later |
| PDF variants | PDF/A, PDF/E, PDF/UA, PDF/VT, PDF/X | Ghostscript (native) |
| Stats data | DTA (Stata), SAV (SPSS), XPT (SAS), FWF | pyodide + pandas (heavy) |
| Diagram | drawio | drawio SDK |
| Security | P7M | node-forge or OpenSSL |

→ **Estimated: ~30 formats, ~300 conversion pairs — handled via `@catlabtech/webcvt-api-server`**

### 2.3 Release waves (not to be confused with §6 roadmap Phases)

Waves describe *what formats ship when*, independent of the engineering Phase schedule in §6. Format counts are cumulative.

| Wave | Aligns with | Scope | Formats (cum.) | Conversions (cum.) | % of Transmute (2,000) |
|---|---|---|---|---|---|
| **Wave A** | §6 Phase 5 (Month 5 — MVP launch) | Tier 1 core: common image + 5 audio + 4 video containers + subtitle + data-text + archive | ~55 | ~1,100 | 55% |
| **Wave B** | §6 Phase 6 (Month 5–6) | + modern image via wasm (AVIF, HEIC, JXL) | ~70 | ~1,300 | 65% |
| **Wave C** | §6 Phase 7 (Month 6–7) | + fonts, EPUB, EML, 7z/RAR, comic | ~90 | ~1,500 | 75% |
| **Wave D** | §6 Phase 8 (Month 7–9) | + PDF, legacy ebooks, legacy images (PSD/BLP/DDS), Parquet/SQLite | ~140 | ~1,800 | 90% |
| **Wave E** | §6 Phase 9 (Month 9+) | + Tier 3 server: Office (LibreOffice), markup (pandoc), PDF variants (Ghostscript) | **~200** | **~2,000+** ✅ | **100%** |

**Wave A at MVP launch already beats ffmpeg.wasm in usability for common cases. Wave B makes it a serious library. Wave E reaches Transmute parity.**

---

## 3. Architecture

### Monorepo layout (pnpm + turborepo)

```
webcvt/
├── packages/
│   ├── core/                 # Public API, types, registry, format detector
│   ├── codec-webcodecs/      # Thin WebCodecs adapter (HW-accelerated encode/decode)
│   ├── backend-wasm/         # ffmpeg.wasm fallback — ONLY legacy AV (AVI/FLV/WMV/3GP/WMA/AC3/AIFF)
│   ├── backend-native/       # Node.js: spawn native ffmpeg/pandoc/libreoffice
│   │
│   │  # ─── AV containers (all self-written, ~10K LOC total) ─
│   ├── container-mp4/        # 🛠 MP4 / MOV / M4A / M4V (ISOBMFF) muxer + demuxer
│   ├── container-webm/       # 🛠 WebM (Matroska subset) muxer + demuxer
│   ├── container-mkv/        # 🛠 Matroska muxer + demuxer
│   ├── container-mp3/        # 🛠 MP3 frame parsing + ID3 tags
│   ├── container-wav/        # 🛠 RIFF WAV (~150 LOC)
│   ├── container-ogg/        # 🛠 Ogg pages (for OGG/OGA/OGV/Opus)
│   ├── container-flac/       # 🛠 FLAC stream + metadata blocks
│   ├── container-ts/         # 🛠 MPEG-TS packets
│   ├── container-aac/        # 🛠 ADTS framing
│   │
│   │  # ─── Image ─────────────────────────────────────────
│   ├── image-canvas/         # 🛠 Self-written: PNG/JPG/WebP/BMP/ICO via Canvas
│   ├── image-svg/            # 🛠 Self-written: SVG ↔ raster
│   ├── image-animation/      # 🛠 Self-written: GIF/APNG/animated WebP
│   ├── image-legacy/         # 🛠 Self-written: TIFF/TGA/BMP/ICO/QOI/PCX/PBM/PGM/PNM/PPM/PFM/XBM/XPM/ICNS
│   ├── image-jsquash-avif/   # AVIF (browser has no native encoder)
│   ├── image-jsquash-jxl/    # JPEG XL (browser no native support)
│   ├── image-heic/           # HEIC/HEIF (patent-encumbered codec)
│   ├── image-legacy-wasm/    # BLP/DDS/EPS/PSD/JP2 (specialty formats, lazy-loaded)
│   │
│   │  # ─── Subtitle (all self-written) ─────────────────
│   ├── subtitle/             # 🛠 SRT/VTT/ASS/SSA/SUB/MPL
│   │
│   │  # ─── Data / text (all self-written) ──────────────
│   ├── data-text/            # 🛠 JSON/YAML/TOML/CSV/TSV/XML/INI/JSONL/TOON/FWF/ENV
│   ├── data-binary/          # Parquet/ORC/Feather via apache-arrow (spec too complex)
│   ├── data-sqlite/          # SQLite via sql.js (engine, not spec)
│   │
│   │  # ─── Font / Archive (all self-written) ───────────
│   ├── font/                 # 🛠 TTF/OTF/WOFF/WOFF2 (uses DecompressionStream for Brotli)
│   ├── archive-zip/          # 🛠 ZIP/TAR/GZ/BZ2/XZ/ZST (uses DecompressionStream + tiny zstd wasm)
│   ├── archive-7z/           # 7z/CB7 via 7z-wasm (proprietary compression)
│   ├── archive-rar/          # RAR/CBR via unrar-wasm (proprietary)
│   │
│   │  # ─── Document / Ebook / Email ────────────────────
│   ├── doc-pdf/              # PDF via pdf.js + pdf-lib (1000+ page spec)
│   ├── doc-ebook-epub/       # 🛠 EPUB self-written (ZIP + XHTML)
│   ├── doc-ebook-mobi/       # MOBI/AZW3/FB2/PDB/LRF via third-party (Amazon proprietary)
│   ├── email/                # 🛠 EML self-written · MSG via msgreader (Outlook binary)
│   │
│   │  # ─── Server-only (Tier 3) ────────────────────────
│   ├── server-pandoc/        # pandoc CLI — ADOC/RST/TEX/MD/Textile/MUSE/OPML/ORG/IPYNB
│   ├── server-libreoffice/   # LibreOffice headless — DOCX/PPTX/XLSX/ODT/ODP/KEY/PPT
│   ├── server-ghostscript/   # Ghostscript — PDF/A, PDF/X variants
│   │
│   ├── api-server/           # HTTP API (Hono — Workers/Node/Bun/Deno)
│   └── cli/                  # `npx webcvt in.mov out.mp4`
│
│   # 🛠 = fully self-written, no npm deps for that package
│
├── apps/
│   ├── playground/           # Demo website (deployed to Cloudflare Pages)
│   └── docs/                 # VitePress documentation site
│
├── examples/
│   ├── browser-vanilla/
│   ├── react/
│   ├── nodejs/
│   ├── cloudflare-worker/
│   └── nextjs/
│
├── .github/workflows/        # CI/CD: test, build, npm publish
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── tsconfig.base.json
├── README.md
└── LICENSE                   # MIT
```

### Public API design

```typescript
import { convert } from 'webcvt';

// Simple
const out = await convert(file, 'mp4');

// With options
const out = await convert(file, {
  format: 'mp4',
  codec: 'h264',
  quality: 0.8,
  hardwareAcceleration: 'auto',  // 'auto' | 'preferred' | 'required' | 'no'
  onProgress: (p) => console.log(p.percent),
});

// Tree-shakeable: use only what you need
import { convertImage } from 'webcvt/image';
import { convertAudio } from 'webcvt/audio';
```

### Backend selection logic

```
User calls convert(file, target)
   ↓
1. Detect input format (magic bytes, not extension)
2. Route by category:
   ├── Image?    → image-{canvas | svg | animation | legacy | jsquash-avif | jsquash-jxl | heic | legacy-wasm}
   ├── Video?    → container-{mp4 | webm | mkv | ts} + codec-webcodecs → backend-wasm fallback (legacy only)
   ├── Audio?    → container-{mp3 | wav | ogg | flac | aac} + codec-webcodecs → backend-wasm fallback
   ├── Subtitle? → subtitle (pure JS, self-written)
   ├── Data?     → data-{text | binary | sqlite}
   ├── Font?     → font (self-written, uses DecompressionStream)
   ├── Archive?  → archive-{zip | 7z | rar}
   ├── Document? → doc-{pdf | ebook-epub | ebook-mobi} or Tier 3 server-*
   └── Email?    → email (EML self-written, MSG via msgreader)
3. On missing capability → throw with actionable error ("install @catlabtech/webcvt-container-xxx")
```

---

## 4. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript 5.x** | Type-safe lib, great DX |
| Build | **tsup** (esbuild-based) | Fast, outputs ESM + CJS + .d.ts |
| Monorepo | **pnpm + turborepo** | Fast, parallel builds, caching |
| Test | **vitest** | Browser + Node, fast, jest-compatible |
| Lint/Format | **biome** | One tool, 10× faster than ESLint+Prettier |
| Docs | **VitePress** | Light, fast, markdown-first |
| Demo | **Vanilla HTML + JS** | Show off "no framework needed" |
| API | **Hono** | Works on Cloudflare Workers / Node / Bun / Deno |
| CI | **GitHub Actions** | Standard, free for open source |
| Release | **changesets** | Semver, changelog automation |
| Deploy (demo) | **Cloudflare Pages** | Free, auto-deploy from GitHub |
| Deploy (API) | **Cloudflare Workers** | Edge, free tier, fast |

---

## 5. Dependencies — Build vs Buy Decision

> **Question raised:** "Can't we do like Mediabunny — write containers ourselves and leverage browser APIs?"
> **Answer (revised 2026-04-19):** YES. We adopt Option B: self-written wherever the browser provides the hard primitives. Below is the trimmed policy.

### ✅ Self-written (Option B commitment — ~15,000 LOC total)

Browser-primitive used in each row indicates what makes self-writing feasible.

#### Core (~1,500 LOC)

| Component | Browser primitive used | Est. LOC |
|---|---|---|
| Public API & types | — | — |
| Backend selector / capability probe | `VideoEncoder.isConfigSupported` | ~300 |
| Pipeline / progress / error handling | Web Streams | ~400 |
| Format detector (magic bytes) | `FileReader` / `Blob.slice` | ~200 |
| Web Worker pool / scheduling | `Worker` | ~400 |
| CLI wrapper | Node's `fs` | ~200 |

#### AV containers + codec adapter (~16,000 LOC) — the Mediabunny-style core

MP4 / Matroska estimates revised upward after planner review: Mediabunny's `mp4-muxer` alone is ~2,500 LOC and its author had years of spec experience — our first-pass implementation with edit lists, fragmented MP4, and proper sample tables is realistically **2× that**.

Phase 2 audio container estimates revised after design notes (2026-04-19):
the per-spec design exercise revealed every container is bigger than the
initial back-of-envelope. MP3 needs both ID3v2/v1 + Xing/LAME headers; FLAC
needs full subframe metadata block coverage; OGG needs Vorbis + Opus codec
heads + sequential chaining (architectural decision: support chained
streams in Phase 2); AAC needs HE-AAC v1/v2 detection (decode delegated
to backend-wasm).

| Component | Browser primitive | Est. LOC | Phase 2 actual / source |
|---|---|---|---|
| `container-mp4` (MP4/MOV/M4A/M4V, ISOBMFF) | — | **~6,000** | not yet |
| `container-webm` (WebM subset of Matroska) | — | ~2,500 | not yet |
| `container-mkv` (full Matroska, EBML) | — | **~2,000** | not yet |
| `container-ts` (MPEG-TS + PSI/PAT/PMT) | — | ~1,000 | not yet |
| `container-mp3` (frames + ID3v2/v1 + Xing/LAME, MPEG 2.5 read-only) | — | **~700** ⬆ | design note |
| `container-flac` (stream + metadata blocks; encode → backend-wasm) | — | **~720** ⬆ | design note |
| `container-ogg` (pages + packets + Vorbis/Opus heads + chaining) | — | **~1,130** ⬆ | design note (was ~800; +Opus/Vorbis +chain) |
| `container-aac` (ADTS framing; HE-AAC v1/v2 → backend-wasm) | — | **~330** ⬆ | design note |
| `container-wav` (RIFF, EXTENSIBLE, RF64 reject) | — | ~240 | **shipped: 65 tests, 94.8% cov** |
| `codec-webcodecs` adapter (encode/decode abstraction, config negotiation) | **WebCodecs API** | ~1,500 | **shipped: 81 tests, 98.8% cov** |

Subtotal: **~16,120 LOC** (was 15,350)

#### Image (~5,500 LOC)

| Component | Browser primitive | Est. LOC |
|---|---|---|
| `image-canvas` (PNG/JPG/WebP/BMP/ICO) | **Canvas + `toBlob`** | ~300 |
| `image-svg` | **DOMParser + Canvas** | ~200 |
| `image-animation` (GIF / APNG / animated WebP) | Canvas + self-written LZW/PNG chunks | ~1,500 |
| `image-legacy` (13 formats: TIFF/TGA/QOI/PCX/PBM/PGM/PNM/PPM/PFM/XBM/XPM/ICNS/CUR) | Canvas | ~300 shared + ~250 each ≈ **~3,500** |

Subtotal: **~5,500 LOC**

#### Data / text / subtitle / archive / font / email (~6,000 LOC)

| Component | Browser primitive | Est. LOC |
|---|---|---|
| `subtitle` (6 formats: SRT/VTT/ASS/SSA/SUB/MPL) | `TextDecoder` | ~200 shared + ~150 each ≈ **~1,100** |
| `data-text` (11 formats: JSON/YAML/TOML/CSV/TSV/XML/INI/JSONL/TOON/FWF/ENV) | `TextDecoder` / `DOMParser` | **~1,700** (JSON/XML trivial; YAML/TOML ~500 each) |
| `archive-zip` (ZIP/TAR/GZ/BZ2/XZ) | **`DecompressionStream` / `CompressionStream`** | ~800 |
| `font` (TTF/OTF/WOFF/WOFF2) | **`DecompressionStream` (Brotli for WOFF2)** | ~1,500 |
| `doc-ebook-epub` | `archive-zip` + `DOMParser` | ~300 |
| `email` (EML only) | `TextDecoder` | ~400 |

Subtotal: **~5,800 LOC**

#### Integrations / orphans (~1,500 LOC)

| Component | Role | Est. LOC |
|---|---|---|
| `backend-native` (Node: spawn ffmpeg/pandoc) | Node-only escape hatch | ~400 |
| `backend-wasm` (ffmpeg.wasm wiring, lazy loader) | Legacy AV fallback plumbing | ~300 |
| `cli` (`npx webcvt in out`) | Dev ergonomics | ~200 |
| `api-server` (Hono routes + OpenAPI) | Downstream HTTP wrapper | ~600 |

Subtotal: **~1,500 LOC**

---

### Total self-written: **~28,500 LOC**

Breakdown: Core 1,600 + AV 16,120 + Image 5,500 + Data/etc 5,800 + Integrations 1,500 ≈ **28,500 LOC**

Audio container per-spec design exercise (2026-04-19) raised the AV
sub-total from 15,350 to 16,120 LOC. Earlier ~15,000 LOC headline
undercounted by ~2×. Estimates now grounded in design notes, not guesses.

**Phase 2 LOC progress**: shipped ~1,740 LOC (codec-webcodecs 1,500 + container-wav 240) of ~3,120 budget. Remaining: mp3 700 + flac 720 + ogg 1,130 + aac 330 = ~2,880 LOC.

### 🤝 Third-party dependencies (Option B trimmed list — only what's irreducible)

> **Gatekeeping rule:** A dep is only allowed if **all three** are true:
> 1. The browser has no native primitive we can leverage
> 2. The format is patent-encumbered, proprietary, or >10,000 LOC of spec work
> 3. No reasonable single-person effort (<2 weeks) can replicate it

#### Irreducible — patent / proprietary / codec heavy

| Dep | Why it cannot be self-written | License | Size | Load |
|---|---|---|---|---|
| **`@ffmpeg/ffmpeg`** | Legacy AV codecs (WMV3, Sorenson, RV, MS-MPEG4) absent from WebCodecs. Covers AVI/FLV/WMV/3GP/WMA/AC3/AIFF/MPEG-1/2/ASF/F4V. | LGPL-2.1 | ~30 MB | Lazy |
| **`@jsquash/avif`** | AVIF encoder not in browser. Squoosh's wasm is patent-cleared. | Apache-2.0 | ~300 KB | Lazy |
| **`@jsquash/jxl`** | JPEG XL: Chrome removed, Safari partial. Need libjxl wasm. | Apache-2.0 | ~500 KB | Lazy |
| **`libheif-js`** | HEVC is patented. Use catdad-experiments fork. | LGPL-3.0 | ~1 MB | Lazy |
| **`pdfjs-dist`** + **`pdf-lib`** | PDF spec is 1,000+ pages, >1 year of work | Apache-2.0 / MIT | ~1 MB | Lazy |
| **`sql.js`** | SQLite is an engine, not a parseable format | MIT | ~1.5 MB | Lazy |
| **`apache-arrow`** | Parquet/ORC/Feather — official, complex | Apache-2.0 | ~500 KB | Lazy |
| **`7z-wasm`** | 7z compression algos proprietary-heavy | LGPL-like | ~1 MB | Lazy |
| **`unrar-wasm`** | RAR is licensed — no clean-room decoder exists | Special (read-only OK) | ~1 MB | Lazy |
| **`@kenjiuno/msgreader`** | Outlook MSG Compound Binary File Format, proprietary | MIT | ~80 KB | Lazy |
| **Legacy image wasm** (`libpsd.js`, etc.) | PSD/BLP/DDS/JP2/EPS reverse-engineered specs | MIT/BSD | varies | Lazy |

#### Removed in favour of self-written

| Was | Replaced by | Why |
|---|---|---|
| ❌ `mediabunny` | 🛠 `container-*` + `codec-webcodecs` packages | Our core competency — cannot outsource |
| ❌ `mp4-muxer`, `webm-muxer` | 🛠 `container-mp4`, `container-webm` | Deprecated anyway; we implement the spec |
| ❌ `fflate` / `JSZip` | 🛠 `archive-zip` using `DecompressionStream` | Browser has native zlib/deflate now |
| ❌ `fontkit` + `wawoff2` | 🛠 `font` using `DecompressionStream` (Brotli) | Spec-driven, browser helps with compression |
| ❌ `epub.js` | 🛠 `doc-ebook-epub` (= ZIP + XHTML) | Trivial once we have archive + DOMParser |
| ❌ `postal-mime` / `mailparser` | 🛠 `email` (RFC 5322 parser) | Pure text parsing |
| ❌ `papaparse` | 🛠 `data-text/csv` | ~300 LOC; own the edge cases |
| ❌ `yaml`, `smol-toml`, `fast-xml-parser` | 🛠 `data-text/*` | Use native `DOMParser` for XML, hand-written for YAML/TOML |
| ❌ `@jsquash/jpeg` / `png` / `webp` | 🛠 `image-canvas` (`canvas.toBlob`) | Browser has native encoders. Squoosh only wins on compression tuning — optional plugin later |
| ❌ `utif` / `tiff.js` | 🛠 `image-legacy/tiff` | Spec is ~500 LOC worth |
| ❌ `psd.js` / `ag-psd` | ❓ deferred to Tier 3 or plugin | PSD is huge; defer |

#### Tier 3 server-only tools (not bundled, invoked as CLI)

| Tool | Purpose |
|---|---|
| `pandoc` | ADOC/RST/TEX/MD/Textile/MUSE/OPML/ORG/IPYNB conversions |
| `libreoffice --headless` | DOCX/PPTX/XLSX/ODT/ODP/KEY/PPT/POT/POTX/PPS/PPSX/PPTM |
| `ghostscript` | PDF/A, PDF/E, PDF/UA, PDF/VT, PDF/X variants |
| `calibre` ebook-convert | MOBI/AZW3/FB2/PDB/LRF (Amazon proprietary) — preferred over bundling wasm version |

### ❌ Will NOT use (rewrite or skip)

| Avoid | Why |
|---|---|
| `fluent-ffmpeg` | Node-only, doesn't fit browser-first model |
| Anything LGPL that requires us to be LGPL | Use sparingly, isolate, or substitute |
| Heavy frameworks (React, Vue) in core | Core must be framework-agnostic |
| `lodash`, `moment` | Bloat. Native JS is enough. |

### Policy: Dependency criteria

A 3rd-party dep gets in **only if**:
1. It does something **infeasible** to write ourselves in <1 week
2. It is **<50 KB** OR **lazy-loaded on demand**
3. License is **MIT/Apache-2.0/BSD** (LGPL only as optional plugin)
4. Active maintenance (commit in last 12 months) OR we vendor a frozen version
5. We can swap it without breaking our public API (wrap behind interface)

### "Clean code" promise

- Every file <800 lines
- Public API has 100% TS types + JSDoc
- 80%+ test coverage (vitest)
- Zero `any` in public API
- Tree-shakeable: importing `convertImage` shouldn't pull video codecs
- Each package independently versioned + publishable

---

## 6. Roadmap (Option B — self-written, revised 2026-04-19 after planner review)

**MVP delivery: Month 5** (not Week 13 — MP4/Matroska are 2× harder than first estimate). Quality target: byte-exact parity with FFmpeg reference outputs for container muxing.

> 📌 **Phase numbers here are engineering milestones, NOT the format-rollout Waves in §2.3.** See Waves A–E for what ships when.

### Phase 1 — Foundation (Weeks 1–2) — **7/8 (1 item deferred to Phase 5)**
- [x] Monorepo skeleton (pnpm + turborepo + biome + vitest + tsup)
- [x] `@catlabtech/webcvt-core` — public API, types, registry, format detector (magic bytes), capability probe (Worker pool deferred to Phase 2)
- [x] `@catlabtech/webcvt-codec-webcodecs` — thin WebCodecs adapter (encode/decode abstraction); 81 tests, 98.8% coverage
- [x] `@catlabtech/webcvt-image-canvas` — PNG/JPG/WebP/BMP/ICO via Canvas; 67 tests, 96.4% coverage; ICO + BMP writers self-written
- [x] `@catlabtech/webcvt-subtitle` — SRT/VTT/ASS/SSA/SUB/MPL all self-written; 128 tests, 93.1% coverage
- [x] CI: lint (biome) + typecheck + test (Node 20 + 22 matrix) + build, all green on push/PR
- [x] **Test-fixture pipeline** — actually completed as the first task of Phase 2 (see §6 Phase 2). `@catlabtech/webcvt-test-utils` package + `scripts/generate-fixtures.mjs` + 4 reference fixtures.
- [ ] First demo: PNG ↔ JPG ↔ WebP working in browser playground — **deferred to Phase 5** (`apps/playground` ships with launch prep)

**Phase 1 outcome:** 4 packages published-ready, 315 tests passing, ~3,300 LOC source. Bundle sizes: core 3 KB, codec-webcodecs 12 KB, image-canvas 6 KB, subtitle 25 KB. All ESM + CJS + .d.ts.

### Phase 2 — Core containers, set 1 (Weeks 3–5) — **7/8**
- [x] **Test-fixture pipeline** — `@catlabtech/webcvt-test-utils` package (bytes/fixtures/audio-synth helpers, 18 tests) + `scripts/generate-fixtures.mjs` using pinned `ffmpeg-static` + 6 reference fixtures committed under `tests/fixtures/audio/` (wav x2, mp3, flac, aac AAC-LC ADTS, ogg Vorbis) + `.gitattributes` (binary). _Also closes the deferred Phase 1 item._
- [x] **Design notes** — `docs/design-notes/container-{wav,mp3,flac,ogg,aac}.md` written from official specs (clean-room per §11)
- [x] `@catlabtech/webcvt-container-wav` — RIFF/WAV muxer + demuxer, 65 tests, 94.8% coverage, ~12 KB bundle. Includes WAVEFORMATEXTENSIBLE recognition; RF64 throws `WavTooLargeError` (deferred)
- [x] `@catlabtech/webcvt-container-mp3` — MPEG-1/2/2.5 Layer III + ID3v2/v1 + Xing/LAME/VBRI; 131 tests, 96.87% coverage, ~22 KB bundle. Code-reviewed (3 HIGH fixed: APE skip clarity, encodeUnsynchronisation un-export, dead branch). Security-reviewed (3 HIGH + 3 MED DoS vectors fixed: ext-header bounds, APE underflow, 200 MiB input cap, 64 MiB ID3 body cap, frameBytes guard, matchMagic bounds). MPEG 2.5 read-only; free-format throws.
- [x] `@catlabtech/webcvt-container-aac` (ADTS) — 7/9-byte ADTS frame parse + serialize + AudioSpecificConfig builder; 102 tests, ~99% line coverage. Also registered AAC in `@catlabtech/webcvt-core` (formats.ts + detect.ts ADTS magic with explicit nibble allowlist `{0,1,8,9}` to disambiguate from MP3 frame sync). Code-reviewed (1 HIGH fixed: canHandle accepted HE-AAC MIMEs `audio/aacp`/`audio/x-aac`, contradicting design note Trap #7 — narrowed to `audio/aac` exact match, HE-AAC now routes to backend-wasm via registry). Security-reviewed (1 HIGH + 2 MEDIUM all fixed: parseAdtsHeader 9-byte CRC bounds throw, cumulative sync-scan cap at 16 MiB across the parser loop not just per-call, corrupt-stream guard now also fires on ≥95% rejected with ≥32 attempts even when some frames parsed).
- [x] `@catlabtech/webcvt-container-flac` — STREAMINFO/SEEKTABLE/VORBIS_COMMENT/PICTURE/PADDING + frame demux + serializer + 7-byte UTF-8 varint (36-bit) + CRC-8/CRC-16 tables; 158 tests, ~95% line coverage. Code-reviewed (1 HIGH fixed: canHandle was too permissive, now identity-only per design note). Security-reviewed (2 CRITICAL + 3 HIGH + 4 MEDIUM all fixed: parseFlac 200 MiB cap, frame-scan distance cap via maxFrameSize, ID3 syncsafe validation + 64 MiB cap, SEEKTABLE 65k point cap, VORBIS_COMMENT count + per-comment caps, TextDecoder hoist, CRC-16 mismatch threshold throw, varint OOB explicit throw, subarray + 64 MiB metadata cumulative cap, readUint64BE bounds). Encode routes to `@catlabtech/webcvt-backend-wasm` via registry (canHandle returns false for FLAC encode).
- [x] `@catlabtech/webcvt-container-ogg` — Ogg page demux/mux + lacing reassembly + non-reflected CRC-32 (poly 0x04C11DB7) + Vorbis identification/comment/setup + Opus OpusHead/OpusTags + chained-stream iteration (Trap §4b) + multiplex rejection (§4a); 159 tests, ~93% line coverage. Also registered `opus` and `oga` formats in `@catlabtech/webcvt-core/formats.ts`. Code-reviewed (1 HIGH fixed: canHandle accepted cross-MIME `audio/ogg ↔ audio/opus` "identity" — third recurrence of the canHandle-too-permissive pattern; narrowed to strict `input.mime === output.mime`). Security-reviewed (3 HIGH + 2 MEDIUM all fixed: cumulative sync-scan budget MAX_TOTAL_SYNC_SCAN_BYTES wired into parser, Opus channel_mapping_family != 0 rejected, parser now invokes decodeVorbisComment/decodeOpusTags so the per-comment/vendor caps actually fire on the parse path, truncated-stream codec-null silent-empty case throws OggCorruptStreamError, packet-count cap off-by-one fixed). Stage-4 also caught & fixed an OOM in `splitPacketToPages` when targetPageBodySize < 255 (bodySize=0 → infinite pagination loop): clamped to a 255-byte minimum.
- [ ] Demo: WAV ↔ MP3 ↔ FLAC ↔ OGG conversion using our containers + WebCodecs — **deferred to Phase 5** (rolled into `apps/playground`; the 5 containers are individually proven by their own tests, integration demo lands with launch prep)

### Phase 3 — Core containers, set 2 (Weeks 6–16) · **hardest phase, 2.5 months**
- [x] `@catlabtech/webcvt-container-mp4` **first-pass** (single-track audio M4A) — ~1,650 LOC across 14 files in `src/` (incl. `src/boxes/`); 179 tests, 96% line / 81% branch / 98% function coverage. Boxes: ftyp, moov/mvhd, trak/tkhd, mdia/mdhd, hdlr, minf/smhd, dinf/dref, stbl (stsd/mp4a/esds/stts/stsc/stsz/stco/co64), mdat. RLE expansion for stts + stsc; both stco (32-bit) and co64 (64-bit) chunk offsets transparent; AudioSpecificConfig extracted from esds DecoderSpecificInfo (re-implemented inline, ~50 LOC; shared-helper extraction with container-aac is Phase 3.5+). WebCodecs decode path emits EncodedAudioChunks via `iterateAudioSamples`. Round-trip parse → serialize against in-memory parsed bytes (committed-fixture byte-equals not used because AAC byte output drifts across host OS/arch). Iterative box-tree walker (NOT recursive) with depth cap 10. Also registered `m4a` (audio/mp4) in `@catlabtech/webcvt-core/formats.ts`. Code-reviewed (3 HIGH fixed: synthetic mdat-before-moov test added for Trap §8 branch coverage; mvhd/tkhd/mdhd version field now runtime-validated and throws on version > 1 instead of silently mis-parsing as v0; misplaced module-level import moved to top of file). Security-reviewed (2 HIGH + 4 MEDIUM all fixed: box-tree boundary check off-by-one collapsed to single guard, `parseMp4aPayload` inner child-box scan now bounded by global `MAX_BOXES_PER_FILE` cap so 64 MiB mp4a payload can't trigger 8M-iteration CPU DoS, largeSize validated against remaining bytes, `size = 0` rejected for non-mdat boxes per design note Trap §1, dead `Mp4CorruptStreamError` guard restructured per-trak failures now surface typed Mp4MissingBoxError/Mp4InvalidBoxError, `dref` enforces `entry_count === 1` per design note `dinf` self-contained-only requirement). Out of scope (Phase 3.5+): video tracks, multi-track, fragmented MP4 (moof/sidx/tfra/trex), edit lists (elst), metadata (udta/meta), DRM (pssh/cenc), sample groups, subtitles, HEIF, QuickTime legacy boxes, ctts, stz2.
- [ ] `@catlabtech/webcvt-container-mp4` **second-pass (Phase 3.5)** — ~4,500 LOC: edit lists (elst), fragmented MP4 (moof/sidx/tfra/etc.), video tracks (avc1/hev1/vp09/av01), multi-track, movie metadata (udta/meta), DRM (cenc).
- [x] `@catlabtech/webcvt-container-webm` **first-pass** (single video + single audio, codecs `{V_VP8, V_VP9, A_VORBIS, A_OPUS}`) — ~3,216 LOC across 16 files; 189 tests, 94% line / 84% branch / 94% function coverage. EBML primitives (RFC 8794): two distinct VINT entry points (`readVintId` keeps marker bit, `readVintSize` strips); iterative element walker with depth cap 8 (no recursion). Elements implemented: EBML header (DocType="webm" gate, rejects "matroska"), Segment, SeekHead, Info (TimecodeScale default 1_000_000 ns), Tracks/TrackEntry/Video/Audio, Cluster/SimpleBlock (lacing modes 00 + 01 supported; 10 + 11 throw `WebmLacingNotSupportedError`), Cues/CuePoint. CodecPrivate preserved verbatim (Vorbis 3-packet init + Opus OpusHead → WebCodecs `description`). Round-trip parse → serialize (semantic equivalence; byte-identical proven for synthetic canonical-layout inputs without Xiph lacing — Xiph-laced blocks split into separate unlaced SimpleBlocks on serialize, documented limitation). WebmBackend identity-only. Code-reviewed (2 HIGH fixed: round-trip JSDoc claimed false fast-path + missing byte-identity test; `parseFlatChildren` duplicated across 3 modules consolidated to shared helper). Security-reviewed (2 HIGH + 3 MEDIUM all fixed: parser silently tolerated Segment unknown-size contradicting design note + brief — now throws WebmUnknownSizeError; `decodeXiphLacing` returned `[]` silently on malformed lace tables → silent data loss to WebCodecs, now throws WebmCorruptStreamError; child-parsers bypassed global `MAX_ELEMENTS_PER_FILE` cap — shared helper now threads `elementCount`; `SeekPosition`/`CueClusterPosition` not validated against fileBytes.length; VP8/VP9 non-empty CodecPrivate accepted up to 1 MiB, now rejected per design note Trap §13). Out of scope (Phase 3.5+ or container-mkv): generic Matroska DocType, AV1, multiple tracks, subtitles, Chapters/Tags/Attachments, encryption, BlockGroup/BlockAdditions, live/streaming WebM, lacing modes 10+11.
- [x] `@catlabtech/webcvt-container-mkv` **first-pass** (full Matroska superset of WebM, wider codec set H.264/HEVC/VP8/VP9 + AAC/MP3/FLAC/Vorbis/Opus) — ~3,500 LOC across ~20 files (16 top-level + 6 elements + 4 codec-meta); 307 tests, 91.9% line / 83.8% branch / 93.8% function coverage. EBML primitives **intentionally duplicated** from container-webm (per design note §"Code reuse" — premature shared abstraction often locks in wrong API; `@catlabtech/webcvt-ebml` extraction is a Phase 3 wrap-up task). Strict DocType validation: only `"matroska"` accepted, `"webm"` rejected with `MkvDocTypeNotSupportedError` so the registry routes WebM to container-webm. Codec-meta parsers: AVCDecoderConfigurationRecord (avc.ts → `avc1.<6 hex digits>`), HEVCDecoderConfigurationRecord (hevc.ts → `hev1.<profile_space>.<compat_hex_padded>.<L|H><level>.B<constraint>`), AudioSpecificConfig (aac-asc.ts → `mp4a.40.<aot>`), FLAC STREAMINFO autodetect (flac-streaminfo.ts: 42-byte fLaC+block OR 34-byte raw body → 42-byte canonical). Track number > 127 supported via `readVintSize`. Also registered `mkv` (`video/x-matroska`) in `@catlabtech/webcvt-core/formats.ts`; `detect.ts` unchanged (returns `webm` for any EBML file; backend-layer DocType inspection routes correctly). Code-reviewed (1 HIGH fixed: HEVC codec string emitted `LH<level>` for high-tier instead of `H<level>`, plus `compatHex` not zero-padded — both meant browsers would reject real HEVC files; fixed). Security-reviewed (1 HIGH + 3 MEDIUM all fixed: `decodeCluster` inner element loop had no `MAX_ELEMENTS_PER_FILE` cap → 16M-iteration CPU DoS via 256 MiB Cluster of tiny elements; SimpleBlock per-element size cap not enforced inside Cluster → downstream `.slice()` OOM risk; `decodeXiphLacing` per-frame Xiph size accumulation unbounded; `cues.ts` materialized full child array via `findChildren` before count check → ~100 MB heap allocation possible before throw). Out of scope (Phase 3.5+): multi-track, subtitles, Chapters/Tags/Attachments, encryption, AV1, BlockGroup/BlockAdditions, lacing modes 10+11, live/streaming MKV.
- [x] `@catlabtech/webcvt-container-ts` **first-pass** (MPEG-TS / 188-byte packets, single-program PAT, H.264 + AAC ADTS, HLS-style) — ~2,630 LOC across 14 files; 148 tests, 92.25% line / 81.34% branch / 98.11% function coverage. EBML-free flat-packet parser (very different from webm/mkv): triple-anchor sync acquisition (offsets 0/188/376) per Trap §1, PSI section reassembly across packets with pointer_field handling + CRC-32 (poly 0x04C11DB7 init **0xFFFFFFFF** non-reflected, distinct from Ogg's CRC-32 init 0), PES reassembly with both bounded (length>0) and unbounded (length=0 video) cases per Trap §5, PTS/DTS bit-fragmented 3+15+15 with marker-bit validation per Trap §6, AVC Annex-B → AVCC conversion with emulation-prevention-byte handling (Trap §9), AAC ADTS framing reused inline. Codecs: H.264 (stream type 0x1B) + AAC ADTS (0x0F) supported; HEVC/AC-3/MPEG-2/MP3-in-TS marked unsupported (no throw — just skipped). Round-trip is **semantic** equivalence only (continuity counter resets, stuffing distribution, PCR refresh implementation-defined per design note §Muxer). TsBackend identity-only canHandle (`video/mp2t ↔ video/mp2t` exact match). Also added `ts` (mime `video/mp2t`) to `@catlabtech/webcvt-core/formats.ts`, AND modified `@catlabtech/webcvt-core/detect.ts` (raised `HEADER_BYTES_TO_READ` from 32 to 189 + two-anchor TS magic check at offsets 0+188; ordering preserved so GIF magic still matches first to avoid false-positive). Code-reviewed (1 HIGH fixed: `computePsiCrc32` and `removeEmulationPreventionBytes` exported as public API → footgun since CRC requires init 0xFFFFFFFF; both un-exported). Security-reviewed (2 HIGH + 1 MEDIUM all fixed: PES allocator capped allocation size not actual accumulation → 16 PIDs × 32 MiB = 512 MiB peak in Worker context, fixed by enforcing `MAX_PES_BYTES` BEFORE reallocation; `adaptation_field_length` clamped to 183 silently misaligning payload start by N bytes for illegal values 184-255, replaced with throw `TsInvalidAdaptationLengthError`; `decodePtsDts` did not validate marker bits → wrong-timestamp injection possible, now throws on any marker bit ≠ 1). Out of scope (Phase 3.5+): M2TS (192-byte packets), DVB-ASI (204-byte), multi-program PAT, HEVC/AC-3/DTS/MPEG-2/MP3-in-TS stream types, scrambled streams, DVB SI tables, ATSC PSIP, SCTE-35 splice info, subtitle/teletext PIDs.
- [ ] Interop tests: byte-exact muxing + FFmpeg can demux our output
- [ ] Demo: full MP4 ↔ WebM ↔ MOV ↔ MKV pipeline, HW-accelerated

### Phase 4 — Image + Animation + Archive + Data-text (Weeks 17–19)
- [x] `@catlabtech/webcvt-image-svg` **first-pass** (detect + parse + rasterize via Canvas; SVG editing deferred) — ~918 LOC across 7 files; 88 tests, ~88% line / 90% branch / 100% function coverage. Heavy security focus: 5 string-based reject patterns (`<!ENTITY`, `<!DOCTYPE`, `<script`, `<foreignObject`, external `href`/`xlink:href`) ALL run BEFORE DOMParser. Canvas rasterizer with 8192×8192 dimension cap, 5s AbortController timeout, JPEG `#fff` background fill, URL.revokeObjectURL in `finally`. Three minimal hand-crafted SVG fixtures under `tests/fixtures/image/`. Also added `svg` (image/svg+xml) to core/formats.ts + `detectSvgFromBytes` function in core/detect.ts (handles XML preamble + BOM + comments; HEADER_BYTES_TO_READ bumped 264→1024). Code-reviewed (1 HIGH fixed: HEADER_BYTES_TO_READ vs SVG_SCAN_BYTES inconsistency — actual scan was capped at 264 not 1024; bumped). Security-reviewed (PASS — no exploitable vulnerabilities; all 14 attack vectors verified safe; only 1 MEDIUM cosmetic + 1 LOW false-negative-detection).
- [x] `@catlabtech/webcvt-image-animation` **first-pass** (GIF + APNG + animated WebP container parsers/serializers; VP8/VP8L pixel decode deferred to backend-wasm) — ~5,627 LOC across 15 source files + 4 test helpers; 283 tests, 98.87% statements / 84.34% branches / 99% functions coverage. GIF: full container walk + LZW decode/encode end-to-end (variable-bit-width LSB-first codes per Trap §2; kwkwk edge case per Trap §3; CLEAR/EOI dispatch; 4-pass interlace de-interlacing per Trap §14). APNG: chunk walker yielding raw zlib payloads via `payloadBytes` for downstream `DecompressionStream('deflate')`; sequence_number invariant across fcTL+fdAT (Trap §1); 4-byte fdAT prefix strip/prepend (Trap §2); idatIsFirstFrame logic (Trap §5); IHDR-first ordering enforced. Animated WebP: RIFF walker with VP8X bit 1 detection (Trap §20); ANMF biases (x/y stored ÷2, w/h stored -1 — Traps §9 §10); inverted blend bit (Trap §22); VP8/VP8L sub-frame yielded as raw bytes for backend-wasm libwebp decode. Hand-rolled CRC-32 with PNG polynomial 0xEDB88320 (4th CRC variant in codebase). Core registry: `apng` format entry + `disambiguatePng()` in detect.ts (acTL probe in first 1024 bytes). Code-reviewed (4 HIGH all fixed: PLTE chunk wrongly threw `ApngUnknownCriticalChunkError` because `KNOWN_ANCILLARY` set was declared but never consulted; GIF missing `MAX_FRAMES` cap → unbounded frame allocation; LZW encoder code-size transition `>` vs `===` analyzed and confirmed correct empirically — encoder lag-by-one matches decoder via complementary entry-add timing; 4 bare `throw new Error()` on attacker-controlled parse paths replaced with typed errors). Security-reviewed (4 CRITICAL + 6 HIGH + 4 MEDIUM all fixed: GIF LZW `MAX_GIF_FRAME_BYTES` was 50 MiB not 16 MiB AND silently continued past cap instead of throwing — converted to `GifFrameTooLargeError` with correct 16 MiB value; APNG had NO canvas dimension validation (IHDR could declare `width=0,height=0` causing multiplicative cap to always pass) — added IHDR-first ordering enforcement + `ApngBadDimensionError` + per-frame fcTL bounds check `ApngFrameOutOfBoundsError`; 4 bare `Error` throws on parse path → `ApngChunkStreamTruncatedError` / `ApngChunkTruncatedError` / `WebpChunkStreamTruncatedError` / `WebpChunkTruncatedError`; `ApngZeroFramesError` was reused for 3 distinct conditions (literal 0, > MAX_FRAMES, multiplicative cap) misleading error monitoring → split into `ApngTooManyFramesError` + `ApngFramesBytesExceededError`; `lzwMinCodeSize` not validated against [2,8] → `GifBadLzwMinCodeSizeError`; WebP RIFF outer size validation accepted `diff===-1` (file 1 byte SHORTER than declared) → tightened to only allow `diff===0|1`; APNG serializer double-emitted empty IDAT/fdAT chunks for zero-payload frames; NETSCAPE2.0 sub-block silently substituted 0 for OOB → `GifTruncatedExtensionError`). 13 new typed error classes added. canHandle HIGH **沒第 10 次累犯** (5-of-12 prior had it; backend correctly validates MIME identity within format). All-synthetic in-test fixtures via `src/_test-helpers/{bytes,build-gif,build-apng,build-webp-anim}.ts` — no committed binaries. Out of scope (Phase 4.5+): VP8/VP8L per-frame pixel decode (delegate to backend-wasm libwebp); APNG hidden-default-image SERIALIZE (parse OK); GIF palette quantization for >256-color frames; APNG IDAT defiltering (PNG filter types 0-4); animated AVIF; static WebP (covered by future image-webp package).
- [x] `@catlabtech/webcvt-image-legacy` **seventh-pass: + ICNS** (Apple Icon Image; IFF-style FourCC chunk container with multi-resolution heterogeneous icon elements) — added ~1,178 LOC (icns.ts 637 + icns-packbits.ts 96 + build-icns.ts 293 + 7 typed errors + 10 constants + wiring) + 52 new tests; package now 549 tests, 92.68% statements / 84%+ branches package-aggregate. Supports all baseline element types: `ICN#` (32×32 mono + mask), `is32`/`il32`/`ih32`/`it32` (16/32/48/128 PackBits RGB + uncompressed 8-bit alpha masks), `ic07`-`ic14` (PNG/JPEG2000 raw payload with magic-sniff `subFormat` tag). `TOC ` optional, parsed for validation then discarded, regenerated on serialize. Trap §1 `it32` 4-byte zero prefix skipped before PackBits decode; Trap §2 RGB channels decoded SEQUENTIALLY via 3 PackBits runs per element (not interleaved); Trap §3 PNG vs JP2 discriminated by 8- vs 12-byte magic prefix at payload start; Trap §5 masks validated against exact expected sizes (256/1024/2304/16384); Trap §7 header totalSize=0 tolerated as "unknown" but non-zero mismatch rejected; Trap §9 FourCC byte-exact including `'TOC '` trailing space; Trap §10 elementSize counts 8-byte record header. PackBits decoder is a dedicated `icns-packbits.ts` (not reused from tiff.ts) — the ICNS variant returns `{output, consumed}` for cursor advancement across sequential channels, throws `IcnsPackBitsDecodeError` for error-class isolation. High-res elements (`ic07`-`ic14`) return raw `payloadBytes` — PNG/JPEG2000 decode deferred to image-canvas/backend-wasm. Lossy serializer: emits only `ic08`/`ic09`/`ic10` PNG elements; drops classic/lowres/JP2/retina variants with 6 dedicated normalisation flags (`lowres-element-dropped`, `classic-icon-dropped`, `highres-jpeg2000-dropped`, `retina-variant-dropped`, `toc-regenerated`, `opaque-element-preserved`). `otherElements` opaque blobs (`info`/`name`/`sbtp`/`slct`/`open`) preserved verbatim via `.slice()` copy. 7 new typed errors: `IcnsBadMagicError`, `IcnsBadHeaderSizeError`, `IcnsBadElementError`, `IcnsTooManyElementsError`, `IcnsUnsupportedFeatureError`, `IcnsPackBitsDecodeError`, `IcnsMaskSizeMismatchError`. MAX_ICNS_ELEMENTS=64 cap. Big-endian uint32 throughout. Clean-room: Apple Icon Composer Guide + TN2166 + Wikipedia tabular summary only; NO porting from libicns, icnsify, icnsutil, node-icns, ImageMagick coders/icon.c, Darwin CoreServices. Zero bare Error throws. Out of scope (later pass): PackBits ENCODE (low-res emit), `icon` classic pre-System-7, PNG/JPEG2000 decode, thumbnail selection, streaming. canHandle HIGH **沒第 15 次累犯** (5-of-17 prior had it).

- [x] `@catlabtech/webcvt-image-legacy` **sixth-pass: + XPM** (XPM3 / X PixMap; colour successor to XBM sharing the ASCII C-source-fragment shape; `chars_per_pixel` ∈ {1, 2}; colour specs `#RRGGBB`/`#RRRRGGGGBBBB`/`#RGB` shorthand/`None`/~30-entry X11 named-colour table; visual class `c` only with tolerant m/s/g/g4 siblings; optional hotspot round-trip) — added ~2,300 LOC (xpm.ts 898 + build-xpm.ts 139 + 1054 LOC tests + 208 LOC in existing files) + 9 new typed errors + 58 new tests; package now 497 tests, 92.25% statements / 82.83% branches package-aggregate (xpm.ts individually 83.12%/72.08% with remaining branches being defensive unreachable paths). Hand-rolled character-walk tokenizer — ZERO regex (grep-verified; ReDoS 50 MiB whitespace-padded input parses in ~1.15s well under 2s threshold). Colour keys extracted BY BYTE OFFSET `content.slice(0, cpp)` verbatim (NOT whitespace split) — supports space/comma/`#`/`+`/`.` as keys per Trap §3. cpp=2 chunks pixel rows in fixed 2-byte slices (Trap §2). Trap §5 hex expansion: `#F0A`→`#FF00AA` nibble-double; `#RRRRGGGGBBBB` narrowed to high byte. Trap §6 `c None`/`transparent` → alpha 0 binary (XPM3 has no gradient alpha). Trap §7 hotspot: 4 tokens = no hotspot, 6 = hotspot, 5 or 7+ → `XpmBadValuesError`. Trap §8 pixel row length MUST equal `width*cpp`. Trap §10 `/* */` comments skipped anywhere between tokens. Trap §11 multi-class colour def (`c #FF0000 m #FFFFFF s red`) — use first `c` pair, skip siblings; NO `c` pair → typed error. ASCII fatal-mode decode (Trap §9) — non-ASCII rejected. Canonical serializer: `/* XPM */` header + 6-digit `#RRGGBB` hex (no shorthand) + `None` for alpha=0 + deterministic key assignment from `XPM_KEY_ALPHABET` (93 serializer-safe printable chars, backslash excluded to avoid C-literal escape issues); auto cpp=1 for ≤92 colours, cpp=2 for 93-1024. 5 new constants. Out of scope: XPM1/XPM2, visual class m/s/g/g4 OUTPUT, multi-word specs, XPMEXT section, full 750-entry X11 `rgb.txt`, cpp > 2, byte-equal round-trip (input cpp/key-assignment varies; semantic only). Clean-room: XPM3 Manual (Arnaud Le Hors, X Consortium, 1996) only; NO porting from libXpm, ImageMagick, GIMP, stb_image, netpbm. canHandle HIGH **沒第 14 次累犯** (5-of-16 prior had it). Zero bare Error throws.

- [x] `@catlabtech/webcvt-image-legacy` **fifth-pass: + PCX** (ZSoft PC Paintbrush; all 6 practical BPP/NPlanes combinations: 1-bit bilevel, 2-bit CGA, 4-bit EGA-packed + EGA-planar, 8-bit indexed VGA + grayscale, 24-bit truecolor; per-scanline RLE; optional 256-colour VGA palette footer at EOF) — added ~1,227 LOC (pcx.ts 766 + build-pcx.ts 316 + additions) + 6 new typed errors + 66 new tests; package now 439 tests, 95.21% statements / 82.12% branches / 100% functions on pcx.ts. All multi-byte ints LE unconditionally (Trap §1 — no byte-order flag unlike TIFF). Width = Xmax − Xmin + 1 with pre-subtraction validation (Trap §2). BytesPerLine trailing pad bytes stripped on decode; recomputed even-minimum on serialize (Trap §3). Scanline layout PLANAR per scanline for NPlanes>1 — NOT pixel-interleaved (Trap §4); asymmetric per-pixel RGB test patterns verify. RLE count byte 0xC0..0xFF, low 6 bits = count 1-63 NOT biased; byte ≥ 0xC0 wrapped as 1-count RUN on encode (Trap §5 critical asymmetry vs TGA). RLE runs may cross scanline boundaries on decode (spec forbids but real encoders violate — max compat); encoder resets state per scanline (Trap §6). 256-colour palette footer detected via tail-scan at EXACTLY `fileLength − 769` with `0x0C` sentinel — never body-scan (Trap §7). (BPP=8, NPlanes=1) ambiguity resolved by footer presence ALONE, not `PaletteInfo` (Trap §8). 1-bit bilevel stores EGA palette indices not hardcoded black/white (Trap §9). Combined code + security review (0 CRITICAL, 2 HIGH both fixed directly). HIGH-1 was a genuine DoS: `0xC0` byte yields count=0 per naive spec read, creating potential infinite-loop on crafted input (alternating 0xC0/XX pairs consume data bytes without advancing output) — added explicit rejection with new `'zero-length-run'` discriminator in `PcxRleDecodeError`, regression test confirms 10,000-pair adversarial input throws in <100ms. HIGH-2 dead-code destructuring tautology simplified. Plus LOW fix: dead `normalisations` array in serializer removed. canHandle HIGH **沒第 13 次累犯** (5-of-15 prior had it).

- [x] `@catlabtech/webcvt-image-legacy` **fourth-pass: + XBM** (X11 Bitmap; ASCII C-source format; bilevel 1-bit bitmap; optional cursor hotspot; `#define`/`static char` declarations) — added ~1,016 LOC (xbm.ts 744 + build-xbm.ts 120 + additions) + 6 new typed errors + 100 new tests; package now 373 tests, 93.07% statements / 91.81% branches on xbm.ts. Hand-rolled character-walk tokenizer — ZERO regex used anywhere (explicit ReDoS defense: 200 MiB of `0x00,\n` with whitespace padding is a plausible adversarial input). Bit packing LSB-first within each byte (Trap §1) — OPPOSITE of PBM P4's MSB-first; verified via asymmetric L-shape test fixture, not symmetric checkerboard. Row stride `ceil(width/8)` with trailing pad bits zero on serialize + ignored on parse (Trap §2). Prefix extracted from `_width` then validated for consistency across `_height`, `_bits`, and optional `_x_hot`/`_y_hot` defines (Trap §3) — throws `XbmPrefixMismatchError` on mismatch. `_x_hot`/`_y_hot` both-or-neither enforcement (Trap §7) — XOR → `XbmMissingDefineError`. Trailing comma before `}` accepted per C99 initialiser rule (Trap §5). Mixed-case hex `0xAb`/`0Xcd` accepted, emit lowercase padded-to-2 (Trap §8). `static unsigned char` optional qualifier accepted; emit canonical `static char` (Trap §9). Explicit bracket length `foo_bits[N]` tolerated with cross-check against actual byte count (Trap §10). Detection via look-ahead-validated `#define <ident>_width <decimal>` with bound 512 bytes — unambiguous vs other image formats since none start with `#` (Trap §6). ASCII decode via `TextDecoder('ascii', { fatal: true })` — non-ASCII bytes rejected. ReDoS regression test passes in 63ms. Code + security combined-review (0 CRITICAL; 2 HIGH both non-runtime hygiene: `tiff`+`tga`+`xbm` entries to `core/formats.ts` were added in this commit rather than in their respective prior commits, and `validatePrefix` empty-path is unreachable from the parser due to earlier guard — both accepted as maintenance hygiene not bugs). 3 MEDIUMs fixed directly: `?? 0` on unpack loop gained explanatory comment matching the serializer's pattern; CommonJS `require('./constants.ts')` in a test replaced with top-level ESM import; ReDoS test's inaccurate "2 MiB" comment corrected to "~512 KB". Out of scope: XBM v1 (pre-1989), comment pragmas, multi-bitmap files, non-ASCII identifiers, cursor mask companion arrays.

- [x] `@catlabtech/webcvt-image-legacy` **third-pass: + TGA** (Truevision Targa; all 5 baseline image types 1/2/3/9/10/11; 8/16/24/32-bit pixel depths; RLE + uncompressed; 4-variant origin normalisation; TGA 2.0 footer detection + round-trip; Extension/Developer Area preserved as opaque bytes; 15/16-bit palette entries + image types 32/33 deferred) — added ~1,294 LOC (tga.ts 989 + build-tga.ts 305) + 65 new tests + 7 new typed errors; package now 273 tests, 92.41% statements / 82.61% branches / 97.08% functions coverage. Hand-rolled RLE codec with pre-allocated output buffer cap (Trap §12 — bounds are exact, not ratio). All multi-byte ints little-endian unconditionally — no byte-order flag (Trap §1). BGR↔RGB swap per pixel for both truecolor AND palette entries (Traps §2 §15). 16-bit ARGB1555 unpack via `(c5 << 3) | (c5 >> 2)` expansion; attribute bit → alpha 0 or 255 (Trap §3). RLE packet 0x00 is a 1-pixel RAW NOT a no-op — distinct from PackBits (Trap §7). Detection is structural: footer-first via 18-byte byte-exact `TRUEVISION-XFILE.\0` match (Trap §6), then header-heuristic fallback for TGA 1.0 files that have no magic (Trap §5). Lossy round-trip policy: serializer always emits top-left origin + TGA 2.0 footer + canonical form; normalisations surfaced via `TgaFile.normalisations[]` array. Code-reviewed (3 HIGH all fixed: `TgaBadFooterError` was imported but never thrown — now throws on partial signature match (`TRUEVISION` prefix present but rest corrupt); dead-code tautology `cmChannels === 4 ? 4 : 3` simplified; extension/developer area slice silently returned empty `Uint8Array` when offset ordering reversed — now returns `null` + validates offsets against pixel data region and footer start). Security-reviewed (3 HIGH all fixed: palette allocation `new Uint8Array(colorMapLength * channels)` had no `MAX_INPUT_BYTES` guard despite package allocation-order contract; footer offsets only checked `< input.length` allowing confusion via overlap with header/pixel-data/footer — now validates `[pixelDataEnd, footerStart)` range + rejects overlap between dev/ext areas; `isTgaHeader` heuristic silently accepted `colorMapFirstEntryIndex > colorMapLength` (negative `cmOnDiskEntries` clamped to 0) enabling detection false-positive for non-TGA binaries — now early-rejects). Plus 3 MEDIUMs fixed: 15/16-bit entry size check moved BEFORE offset computation (was at step 10, `cmEntrySizeBytes=0` silently miscalculated `pixelDataOffset`); Extension Area validated against spec-minimum 495 bytes (truncation → typed error); redundant `Math.max(0, ...)` removed. canHandle HIGH **沒第 12 次累犯** (5-of-14 prior had it). All-synthetic fixtures via `_test-helpers/build-tga.ts`. Out of scope (future passes): Extension Area subfield parsing (Software ID, Author, Date, Postage Stamp, Color Correction Table, Scan Line Table); 15/16-bit palette entries; image types 32/33.

- [x] `@catlabtech/webcvt-image-legacy` **second-pass: + TIFF** (TIFF 6.0 baseline both byte orders; multi-IFD parse, single-IFD serialize; PackBits + LZW decode; Predictor 2; Photometric 0/1/2/3; BitsPerSample 1/4/8/16; DEFLATE deferred to async follow-up; tiles + BigTIFF + JPEG-in-TIFF + CCITT + EXIF/GPS subIFD parsing all deferred to third pass) — added ~1,400 LOC across 3 new files (tiff.ts, tiff-lzw.ts, _test-helpers/build-tiff.ts) + 9 new typed errors; package now 208 tests, 92.02% statements / 80.34% branches / 96.2% functions coverage. Hand-rolled MSB-first LZW decoder (Trap §9 — distinct from GIF's LSB-first); dictionary growth boundary 510 NOT 511 per TIFF post-6.0 "Bug 5" spec (Trap §10); ClearCode resets dict AND code width to 9 (Trap §11); PackBits header byte is signed int8 with 0x80 NO-OP (Trap §7); RowsPerStrip default `2^32 − 1` clamped to ImageLength (Trap §5). Multi-page IFD chain with cycle detection via `Set<number>` + MAX_PAGES=1024 cap (Trap §13); MAX_IFD_ENTRIES=4096 (Trap §14); MAX_TAG_VALUE_COUNT=268M added per security review to guard `count * typeSize` overflow. Lossy round-trip policy: serializer emits NONE-compressed chunky 8-bit single-page only, surfacing transformations via `TiffFile.normalisations[]` array. ColorMap layout "all R, then all G, then all B" honored (Trap §16). Code-reviewed (4 HIGH all fixed: dead-code tautology in `bitsPerSample` ternary; `readEntryUint` silently returned 0 on OOB → silent strip-offset corruption; serializer `blob?.offset ?? 0` could write external values to header offset 0; test 20 didn't actually exercise the SHORT-typed StripOffsets branch it claimed to test — patched fixture to genuinely flip type=4→3). Security-reviewed (3 HIGH all fixed: type-size×count overflow guard via MAX_TAG_VALUE_COUNT; readEntryUint silent OOB duplicate; cumulative strip decompression now accumulates running total during decode loop, eliminating intermediate double-allocation peak). Plus 5 MEDIUMs fixed: `requireUint` now validates type ∈ {BYTE/SHORT/LONG} preventing ASCII-typed-ImageWidth confusion; `count===0` rejection for required tags; LZW ClearCode storm DoS guard (per-strip `clearCount > input.length` rejection); 1-bit + multi-spp combination rejected at parse time; dead `MAX_DECOMPRESSED_STRIP_BYTES` import + `void` removed. canHandle HIGH **沒第 11 次累犯** (5-of-13 prior had it). All-synthetic in-test fixtures via `_test-helpers/build-tiff.ts` (~16KB). Out of scope (third pass): tiles, BigTIFF, JPEG-in-TIFF, CMYK/YCbCr/CIELab, CCITT fax, 32-bit float, EXIF/GPS SubIFD, ICC profile parsing, multi-page serialization, planar config 2 serialization. **Note: original first-pass also still listed below for reference.**

- [x] `@catlabtech/webcvt-image-legacy` **first-pass sub-batch** (5 formats: PBM/PGM/PPM/PFM + QOI; remaining TIFF [shipped above as 2nd pass], TGA/PCX/XBM/XPM/ICNS/CUR deferred to Phase 4.5+) — ~1,936 LOC across 10 source files + 9 tests + 2 helpers; 146 tests, 95.04% statements / 80.47% branches / 100% functions coverage. Netpbm whitespace tokenizer w/ `#` comment stripping, P4 row padding `Math.ceil(width/8)`, P5/P6 16-bit BIG-ENDIAN samples, P3 ASCII range checks. PFM bottom-up rows flipped on parse + flipped back on serialize, signed scale token → endianness mapping. QOI 8-byte end-marker validation, hash-table init asymmetry (`Object.create(null)`-style fresh Uint8Array), opcode dispatch order (RGB/RGBA early-return BEFORE 2-bit tag dispatch). All-synthetic in-test fixtures via `src/_test-helpers/{bytes,build-netpbm}.ts` — no committed binaries. Five new core/formats.ts entries + QOI signature + `detectNetpbmFromBytes` (P1-P6/Pf/PF magics). Code-reviewed (no HIGHs — `canHandle` recurrence broken for the 2nd straight package). Security-reviewed (3 HIGH all fixed: Sec-H-1 PFM truncated raster threw untyped `RangeError` from DataView — added pre-allocation length check; Sec-H-2 P5/P6 binary `??0` fallback silently substituted 0 for out-of-bounds bytes producing data corruption — added pre-loop `expectedRasterBytes` check; Sec-H-3 QOI_OP_RUN runLen 63/64 defensive reject — annotated `/* v8 ignore */` since RGB/RGBA early-return makes it unreachable). Out of scope (Phase 4.5+): TIFF (LZW/CCITT predictor + EXIF), TGA, PCX RLE, XBM/XPM ASCII, ICNS multi-resolution, CUR cursor.
- [x] `@catlabtech/webcvt-archive-zip` **first-pass** (ZIP stored+Deflate, POSIX ustar TAR, gzip envelope; bz2/xz route to backend-wasm) — ~3,000 LOC across 15 source files + 3 test helpers; 132 tests, ~89% line / 87% branch coverage. ZIP: EOCD backward search (4 KiB cap), central directory walk, lazy entry decompression via `DecompressionStream('deflate-raw')` with `makeSizeCapTransform` enforcing per-entry 256 MiB + cumulative 512 MiB caps + 1000:1 ratio cap incrementally. TAR: 512-byte ustar block walk, octal-string parser (now THROWS on non-octal bytes per Sec-H-3), checksum verification, EOA detection (two consecutive zero blocks + tolerate trailing zero padding). GZip: single-member only, multi-member detection scans for `0x1F 0x8B 0x08` re-occurrence past first member's CRC+ISIZE trailer (Trap §14). bz2/xz: detect magic + throw typed errors so registry routes to backend-wasm. All-synthetic fixture strategy via `src/_test-helpers/build-{zip,tar,gzip}.ts` — no committed binaries. Path-traversal validator rejects `..`/absolute/NUL/backslash-normalized paths. zlib CRC-32 variant (3rd in the codebase). Also added `zip`, `tar`, `gz`, `tgz` to `@catlabtech/webcvt-core/formats.ts` + ZIP/gzip/bz2/xz/ustar(@offset 257) magic detection in `@catlabtech/webcvt-core/detect.ts` (HEADER_BYTES_TO_READ bumped 189→264 for ustar offset). Code-reviewed (4 HIGH fixed: `MAX_ZIP_ENTRIES` agent unilaterally lowered to 1000 — restored to spec value 65536; missing `ZipCommentTooLargeError` enforcement; missing `parseTar` zero-entries guard; missing tgz→tgz canHandle test + dead branches removed). Security-reviewed (4 CRITICAL + 3 HIGH + 2 MEDIUM all fixed: `parseArchive` had NO MAX_INPUT_BYTES guard — direct importers bypassed cap entirely; `gunzip` UNCAPPED — gzip bomb succeeded; `parseTar` had NO cumulative size cap — adversarial 200×256MiB tar = 50GiB references; multi-member gzip detection NEVER IMPLEMENTED — error class was dead code; zip-parser `getPayloadSlice` no bounds check before subarray; TAR entry count off-by-one allowed entry 65537; `parseOctal` silently returned 0 for non-octal bytes → silent block-walk misalignment; TAR name-length cap block was empty; serializer `decompressGzip` also uncapped). canHandle HIGH **沒第 9 次累犯** (5-of-9 prior had it). Out of scope (Phase 4.5+): ZIP64, encryption, compression methods other than 0+8, multi-disk, PAX, GNU tar extensions, multi-member gzip, native bz2/xz, streaming append-mode writes.
- [x] `@catlabtech/webcvt-data-text` **sixth-pass: + YAML** (YAML 1.2.2 Core Schema ONLY; SAFE-BY-CONSTRUCTION subset for config files — aggressively rejects every YAML feature weaponised in the wild: type tags outside `!!str/!!int/!!float/!!bool/!!null/!!seq/!!map` allowlist → `YamlTagForbiddenError` (neutralises `!!python/object`/`!!js/function` RCE class), `<<:` merge keys → `YamlMergeKeyForbiddenError`, multi-doc streams → `YamlMultiDocForbiddenError`, tabs-in-indent → `YamlIndentError`, `%YAML 1.1`/`%TAG` directives → `YamlDirectiveForbiddenError`) — added ~3,058 LOC across 5 files (yaml-tokenizer.ts 950 + yaml-parser.ts 918 + yaml-serializer.ts 332 + yaml.ts 44 facade + yaml.test.ts 814) + 19 new typed errors + 7 new caps + 77 new tests; package now 568 tests (was 491). Split into tokenizer/parser/serializer trio per coding-style.md file-organization guidance because monolithic yaml.ts would have exceeded the 800 LOC soft cap. Hand-rolled indent-aware recursive-descent parser (8 tokenizer states: NORMAL_BLOCK, IN_FLOW_SEQ, IN_FLOW_MAP, IN_SINGLE_QUOTE, IN_DOUBLE_QUOTE, IN_LITERAL_BLOCK, IN_FOLDED_BLOCK, IN_COMMENT); NO regex on untrusted variable-length scalar bodies (ReDoS hedge — regex used ONLY on Core Schema classification of already-extracted bounded scalars, directive first-64-chars, and anchor/alias name validation). 4-phase parse pipeline: decode+BOM → directive+marker scan → indent-aware tokenize+parse → alias expansion+cycle check+cap enforcement. **Norway problem** neutralised: Core Schema booleans match ONLY `true|True|TRUE|false|False|FALSE` — `yes`/`no`/`on`/`off`/`y`/`n` stay as strings; GitHub Actions `on:` key parses correctly. **Billion-laughs defense**: `MAX_YAML_ALIASES=1000` counts every dereference during Phase 4 DFS, not just distinct alias names; forward-reference check added at parse-time (anchor must exist in map before alias node created — throws `YamlAnchorUndefinedError`, spec-compliant §3.2.3). **Anchor cycle detection**: `resolving: Set<name>` stack during expansion → `YamlAnchorCycleError`. **Canonical serializer**: alphabetically-sorted map keys, 2-space indent, LF line endings, block style default, double-quotes YAML 1.1 ambiguous values so `"no"` round-trips as `"no"` not plain `no` (Trap 5). Quoted scalars bypass Core Schema implicit typing (`"123"` stays string, not bigint). `Object.create(null)` for map backing stores (prototype-pollution defense — `__proto__`/`constructor` keys land on null-prototype object). Combined code + security review — 0 CRITICAL, 2 HIGH + 5 MEDIUM + 2 LOW, ALL fixed directly: H-1 stray `- \n` double-emit bug in emitValue nested-array-of-maps path corrupted round-trip of k8s manifests (round-trip regression test added); H-2 `!!int "hello"`/`!!float "hello"` silently coerced to `0n`/`NaN` instead of throwing — now validates against INT_RE/FLOAT_RE before coercion; M-1 tab-in-block-scalar-continuation-lines slipped through (Trap 7 gap) — tab check added to parseBlockScalarContent; M-2 dead `tag: string | null` params removed from parseFlowSeq/parseFlowMap; M-3 unused `YamlSerializeError` import + unused `isKey` param removed; M-sec forward-alias silent resolve fixed; M-sec TC41 trailing-content test strengthened to `.toThrow(YamlParseError)` with second new-line test case; L-sec `|+` keep-chomp blank-line accumulation capped against MAX_YAML_SCALAR_LEN; L-sec `!<tag:yaml.org,2002:python/object>` URI-form tag rejection test added. Security caps: MAX_YAML_DEPTH=64, MAX_YAML_ANCHORS=100, MAX_YAML_ALIASES=1000, MAX_YAML_SCALAR_LEN=1 MiB, MAX_YAML_MAP_KEYS=10K, MAX_YAML_SEQ_ITEMS=1M. Core/formats.ts gained `{ ext: 'yaml', mime: 'application/yaml', category: 'data' }` + `yml` ext alias; backend MIME map handles 4 aliases (`application/yaml`, `application/x-yaml`, `text/yaml`, `text/x-yaml`). Clean-room: YAML 1.2.2 spec (https://yaml.org/spec/1.2.2/) + RFC 3629 only; NO porting from js-yaml, yaml (eemeli/yaml), yamljs, yaml-ast-parser, pyyaml, ruamel.yaml, libyaml, snakeyaml, go-yaml. Zero bare `throw new Error(...)` in any yaml-*.ts file. Out of scope: YAML 1.1 implicit typing, multi-doc streams, tags outside 7-entry allowlist, `<<:` merge keys, `%TAG` directive, complex mapping keys, non-string map keys, comment preservation, quote-flavour preservation, streaming parse/serialize. Known follow-ups (noted but not blocking): yaml-tokenizer.ts and yaml-parser.ts run 950 / 918 LOC — over the 800 soft cap; a future refactor-cleaner pass may split out core-schema.ts + expand.ts + escape.ts submodules. Global node-materialisation counter (across all aliases) and `decodeInput` byte-cap for string inputs deferred as architectural/cross-cutting concerns.

- [x] `@catlabtech/webcvt-data-text` **fifth-pass: + XML** (XML 1.0 Fifth Edition; DOMParser-backed parse with hand-rolled security pre-scan + hand-rolled canonical serializer; XXE/billion-laughs/external-entity/forbidden-PI/CDATA-payload defenses all gated BEFORE `DOMParser` ever sees the input) — added ~1,654 LOC (xml.ts 725 + xml.test.ts 929) + 13 new typed errors + 4 new caps + 49 new tests; package now 491 tests, 89.8% statements / 84.13% branches package-aggregate (93.19% / 90.38% on xml.ts individually). Hand-rolled state-machine pre-scan walks every byte classifying context (NORMAL / IN_TAG / IN_ATTR_VALUE_DQ/SQ / IN_COMMENT / IN_CDATA / IN_PI) — rejects `<!DOCTYPE` / `<!ENTITY` / `SYSTEM` / `PUBLIC` tokens anywhere outside CDATA (Traps §1 §2 §3), rejects all processing instructions except the `<?xml …?>` preamble (Trap §5), scans CDATA payload for `<!DOCTYPE`/`<!ENTITY` as defense-in-depth (Trap §4). ZERO regex on untrusted input — ReDoS hedge (explicit: 200 MiB of nested comments / CDATA sections / attribute values is a plausible adversarial input). Depth + element-count caps enforced **during the pre-scan** (Traps §12 §13) so malicious input never reaches DOMParser. Post-parse walk enforces per-element attribute cap + per-text-node size cap (Traps §14 §15). Parse errors detected via `doc.querySelector('parsererror')` — NOT try/catch (Trap §6) — since DOMParser returns an error document rather than throwing. Canonical serializer alphabetically orders attributes, escapes `& < " > \t \n \r` in attribute values (Trap §7), escapes `& < > \r` in text nodes (Trap §8), emits `<foo/>` never `<foo></foo>` for empty elements (Trap §10), validates QName against XML 1.0 Name production on serialize (Trap §11). QNames treated as opaque strings — no namespace resolution / URI awareness (Trap §9). BOM stripped on parse + `hadBom` preserved for diagnostics; NEVER re-emitted on serialize (Trap §17). Preamble `encoding=` must be UTF-8 or absent (Trap §16). happy-dom ^15.0.0 added as devDependency for Node test environment (DOMParser polyfill); Known happy-dom quirk: it does not honor `'application/xml'` MIME type (returns HTML document) — production code falls back to `'text/xml'` when parsed `nodeName === 'HTML'` (real browsers honor it correctly); tests use `vi.stubGlobal('DOMParser', …)` following the `image-svg` pattern to get deterministic parsererror behavior. Core/formats.ts gained one entry `{ ext: 'xml', mime: 'application/xml', category: 'data', description: 'Extensible Markup Language' }`. 5 security attack vectors all have dedicated regression tests: billion-laughs DOCTYPE+ENTITY, XXE SYSTEM URI, XXE PUBLIC, non-preamble PI, CDATA-wrapped `<!DOCTYPE`/`<!ENTITY`. Combined code + security review passed with full quality gates (biome clean, lockfile frozen, full repo green). Clean-room: W3C XML 1.0 Fifth Edition + XML Information Set + DOM Parsing specs only; NO porting from fast-xml-parser, xml2js, xmlbuilder, @xmldom/xmldom, sax-js, ltx, htmlparser2, parse5. Out of scope: namespace resolution, DOCTYPE internal subset, external entity resolution (always refused), XML Schema/DTD validation, XPath, XQuery, XSLT, streaming SAX-style parse.

- [x] `@catlabtech/webcvt-data-text` **fourth-pass: + FWF** (Fixed-Width Format / flat file / column-aligned text; caller-supplied `columns: FwfColumn[]` schema with 0-based half-open `[start, end)` ranges matching `String.slice()`; configurable padChar + per-column alignment) — added ~480 LOC (fwf.ts 230 + errors 130 + constants 35 + wiring + 60 new tests); package now 442 tests, 95.9% statements / 94.36% branches / 100% functions on fwf.ts. Hand-rolled schema validator runs BEFORE any input processing: rejects overlapping columns (sort-then-walk pairs; adjacent `prev.end === next.start` allowed), zero-width, duplicate names, non-integer offsets, bad alignment, bad padChar length. Parse: pad short lines with padChar to maxEnd then slice per column; long lines accepted with trailing chars silently ignored. Serialize: throw `FwfFieldOverflowError` if value length > declared width (NEVER truncate). BOM stripped on parse + `hadBom` recorded; NEVER emitted on serialize (spec-less format but matches JSONL/TOML convention — leading BOM would shift every column). Hand-rolled `rtrim`/`ltrim` O(n) walkers (NO regex — ReDoS hedge). `padChar` must be exactly 1 UTF-16 code unit (sidesteps astral/emoji pad degenerate case). UTF-16 code-unit width math documented prominently in FwfColumn JSDoc (ASCII inputs trivially correct; astral code points would split mid-surrogate). 6 new typed errors. Backend integration caveat: FWF shares `text/plain` MIME with ENV, so `DataTextBackend.canHandle` CANNOT route FWF — `FWF_FORMAT` registered with `ext: 'fwf'` + `mime: 'text/plain'` but OMITTED from `MIME_TO_FORMAT` map; FWF reachable ONLY via direct `parseFwf`/`serializeFwf` or `parseDataText(input, 'fwf', { columns })`. `parseDataText` gained overloads making `FwfParseOptions` required when `format === 'fwf'`. Security caps: `MAX_FWF_COLUMNS=1024` (schema-bomb DoS defense), `MAX_FWF_LINES=1M` enforced on RAW split count BEFORE skip-empty walk. Clean-room: spec-less format; implementation derived from first principles (String.slice + per-column trim); no code from pandas read_fwf, polars, SAS INPUT, awk FIELDWIDTHS, or any npm FWF library. Zero bare Error throws; zero `?? 0` fallbacks. Out of scope: format auto-detection (no magic), auto-discovery of column widths, multi-line records, type coercion, non-ASCII-aware width math, streaming.

- [x] `@catlabtech/webcvt-data-text` **third-pass: + TOML** (TOML v1.0.0 full spec; hand-rolled tokenizer + recursive-descent parser + canonical serializer; all 4 string flavours, all 4 date/time variants, bigint integers for full 64-bit range, dotted-key conflict detection, array-of-tables, inline tables with immutability enforcement) — added ~806 LOC (toml.ts 580 + errors 145 + constants 35 + wiring + 118 tests); package now 382 tests, 88.34% statements / 81.86% branches / 97.01% functions. Typed date/time objects (`TomlDate`/`TomlTime`/`TomlDateTime` with `kind` discriminant) preserve parse→serialize distinction from literal strings. All integers use `bigint` for 64-bit range preservation. Dotted-key conflict matrix via per-table metadata (`closedViaHeader`, `definedDirectly`, `definedByDotted`) — throws `TomlConflictingTypeError` / `TomlRedefineTableError` on all 3 conflict cases. Inline tables closed-for-modification after `}`. Multi-line basic string `\` line-ending trim; literal strings process NO escapes. `inf`/`-inf`/`nan` (signed variants too); serializer normalizes `+inf`→`inf`. RFC 3339 space-separator accepted between date/time halves. Leading-zero decimal integers rejected (`01` invalid). Unicode escapes `\uXXXX`/`\UXXXXXXXX` validated: surrogates U+D800..U+DFFF AND >U+10FFFF rejected. BOM stripped + `hadBom` preserved for diagnostics; NEVER emitted on serialize (spec forbids). Security caps: `MAX_TOML_DEPTH=64` enforced incrementally (not after buffering), `MAX_TOML_STRING_LEN=1 MiB` per string token, `MAX_TOML_KEYS_PER_TABLE=10K`, `MAX_TOML_ARRAY_LEN=1M`. Combined code + security review (0 CRITICAL, 3 HIGH). 2 spec-compliance HIGHs fixed directly: `+0xFF`/`-0xFF`/`+0o7`/`+0b1` were silently accepted but TOML v1.0 forbids signed base-prefixed integers → now throw `TomlBadNumberError` with 4 new regression tests; multi-line basic string serializer path didn't escape C0/C1 control characters (spec violation for programmatically-constructed strings with embedded NUL bytes) → added dedicated `escapeMultilineBasicString` helper with full C0/DEL/C1 escape plus `"""` → `""\"` guard, regression test verifies NUL escapes as `\u0000`. 1 HIGH noted as bounded-regex-in-tokenizer judgment call (4 regex patterns on length-bounded tokens ≤10 chars; zero practical ReDoS risk; contract-debatable but acceptable). 3 MEDIUMs partially fixed: `index.ts` header comment removed TOML from deferred list. Clean-room: toml.io/en/v1.0.0 + toml.abnf v1.0.0 + RFC 3339 only; NO porting from @iarna/toml, smol-toml, toml, fast-toml, j-toml.

- [x] `@catlabtech/webcvt-data-text` **second-pass: + JSONL** (JSON Lines / ndjson; newline-delimited JSON records; per-record depth pre-scan BEFORE JSON.parse; line-count cap 1M and per-record size cap 1 MiB; BOM parsed-but-dropped on serialize per jsonlines.org recommendation; YAML/TOML/XML/FWF/TOON still deferred) — added ~337 LOC (`jsonl.ts` 190 LOC + 5 new typed errors + wiring) + 59 new tests; package now 259 tests, 92.98% statements / 94.93% branches / 94.44% functions coverage (100% on jsonl.ts). Hand-rolled line splitter (`\r\n|\n` regex only — bare `\r` NOT recognised). Empty/whitespace lines skipped silently on parse per real-world tooling behavior (jq -c, pino). Record-count cap fires on RAW split count BEFORE skip-empty walk (defends against 10M-empty-line DoS bloating the split array). Per-record length cap fires BEFORE depth pre-scan. Serializer detects `JSON.stringify(undefined)` per record and throws typed error (prevents invalid JSONL output). Refactored `prescanJsonDepth` in json.ts from private to module-internal shared helper accepting a thrower closure — behaviour-preserving for existing 25 JSON tests; JSONL passes its own closure that yields `JsonlRecordDepthExceededError(lineNumber)`. Code + security combined-review (0 CRITICAL, 0 HIGH; 2 MEDIUM fixed: dead-code tautology `text.endsWith('\\n') || text.endsWith('\\r\\n')` simplified — any string ending in `\\r\\n` also ends in `\\n`; TC11 misleading comment corrected + added MAX_JSONL_RECORDS boundary test). Core/formats.ts gained one entry `{ext:'jsonl', mime:'application/jsonl', category:'data', description:'JSON Lines'}`; `application/x-ndjson` alias registered in backend's MIME_TO_FORMAT only (NOT core registry, keeping reverse lookup unambiguous). No `detect.ts` magic-byte path added (caller passes explicit MIME hint per first-pass policy).

- [x] `@catlabtech/webcvt-data-text` **first-pass** (JSON + CSV + TSV + INI + ENV; YAML/TOML/XML/FWF/TOON deferred to Phase 4.5+) — ~1,666 LOC across 12 files; 200 tests, ~93% line / 95% branch / 98% function coverage. JSON depth-bomb pre-scan BEFORE JSON.parse (cap 256 levels). CSV state-machine parser (4 states; quote-doubling; embedded newlines; CRLF/LF/CR terminators; BOM strip with hadBom round-trip). INI flat sections + last-wins duplicate-key warnings. ENV with `\n`/`\t`/`\\`/`\"` escapes inside double quotes; raw multi-line rejected. TextDecoder fatal mode hoisted module-scope. Five new core/formats.ts entries (json/csv/tsv/ini/env). No magic-byte detection added (caller must pass format hint per design). Code-reviewed (1 HIGH fixed: backend.ts threw `InputTooLargeError(0,0,...)` for unsupported MIME — replaced with new `UnsupportedFormatError`). Security-reviewed (2 CRITICAL prototype-pollution + 1 MEDIUM cell-cap all fixed: ENV `__proto__=evil` and INI `[__proto__]` would have polluted Object.prototype via plain `{}` data store — switched to `Object.create(null)` for both stores AND inner section objects; CSV billion-cell DoS `MAX_CSV_ROWS × MAX_CSV_COLS = 1.024B cells` could OOM before either individual cap fires — added `MAX_CSV_CELLS = 8M` cumulative cap with new `CsvCellCapError` checked incrementally per push). Regression tests for both prototype-pollution paths confirm Object.prototype is NOT mutated.
- [ ] Test coverage ≥ 80%

### Phase 5 — Launch prep (Week 20 — roughly Month 5) · v0.1.0, Wave A
- [x] `@catlabtech/webcvt-backend-wasm` **first-pass** (ffmpeg.wasm fallback Backend; lazy-loaded 30 MB wasm core; 203-pair curated MIME allowlist; 20 design-note traps + 112 extra regression tests) — replaced 20-LOC placeholder with 1,847 LOC across 12 files; 133 tests, 96.83% statements / 90.06% branches / 92.10% functions coverage. Dynamic `await import('@ffmpeg/ffmpeg')` inside loader.ts ONLY — package import stays side-effect-free, wasm payload never loads at import time; `@ffmpeg/ffmpeg` + `@ffmpeg/util` as peerDependencies. Explicit `registerWasmBackend(registry?, options?)` (no auto-register per Trap §2). Double-checked `_loading` Promise collapses N concurrent first-calls to 1 wasm fetch (Trap §1). Serial queue with 3-tier AbortSignal support (pre-start / mid-run via `terminate()` / post-complete no-op). Idle reaper terminates instance after 60s no-activity; dispose() idempotent. Runtime detection picks multi-thread `@ffmpeg/core-mt` when `crossOriginIsolated && SharedArrayBuffer` available, else single-thread (Trap §5). Command synthesis via CODEC_ALIAS_MAP (`h264`→`libx264` etc.) + CONTAINER_DEFAULT_{VIDEO,AUDIO}_CODEC + mapQualityFlags dispatch by codec family (CRF for x264/x265/vp9/av1; -q:a for libmp3lame; -b:a for aac/opus/vorbis) — NO shell invocation, NO user-controlled paths (UUID-prefixed MEMFS via `globalThis.crypto.randomUUID()`), NO user-controlled argv flags. Progress parsing on stderr only (Trap §3) via `on('log', {type})` filter; emits `percent: -1` sentinel for unknown-duration inputs (Trap §7). withMemfsFiles try/finally guarantees deleteFile for both paths even on exec throw (Trap §4). Abort mid-exec terminates worker AND nulls both `instance` + `_loading` (Trap §12). Security-reviewed (0 CRITICAL, 3 HIGH all fixed directly): H-1 `node:crypto` import would break browser bundles — replaced with `globalThis.crypto.randomUUID()` (works in both browser secure context + Node 19+); H-2 dead `'copy'` in VIDEO_ENCODERS would become latent stream-copy injection if future maintainer added it to CODEC_ALIAS_MAP — removed with explicit comment documenting the rejection; H-3 audio codec alias passed for video output was silently ignored (user intent lost) — now throws WasmUnsupportedError with `codec-output-mismatch` discriminator; regression test added. 4 MEDIUMs + 3 LOWs noted but not blocking (loader retry micro-race, test-isolation singleton mutation, lossless-codec table placement, parametric MIME handling, deferred Node blob: URL trap). Allowlist covers ~203 pairs: 49 video↔video, 48 audio↔audio, 49 video→audio extraction, plus TS (20), WMV (5), F4V (4), WMA (6), AIFF (8), legacy image identities (5), subtitle pairs (9 gated via `enableSubtitleFallback`). Out of scope: custom slimmed ffmpeg builds, streaming I/O, multi-pass encoding, GPU-accelerated encoding, raw argv passthrough, ffmpeg source vendoring/porting.
- [x] `@catlabtech/webcvt-cli` **first-pass** (`npx webcvt in out` Node CLI; argv parser + optional-dep backend loader) — ~667 LOC across 8 source files + 8 test files; 106 tests, 97.09% statements / 95.49% branches / 100% functions coverage. Hand-rolled pure-function argv parser (no CLI framework dep — keeps zero-dep selling point intact); discriminated union `ParsedArgs` returned to dispatcher. Optional-dep loader iterates 16-entry `BACKEND_PACKAGES` const, try-imports each with dynamic `import()`, validates exported `XxxBackend` is a constructable function, registers via `defaultRegistry.register(new Ctor())`. Stdin/stdout binary I/O via `for await process.stdin` chunks (TTY detection rejects with `CliBadUsageError` if stdin is a TTY) + `process.stdout.write(Uint8Array, callback)` Promise wrapper. 256 MiB input cap enforced inside the stdin drain loop (not after `Buffer.concat`). Exit codes: 0 success, 1 typed `WebcvtError` from core/backends, 2 `CliBadUsageError` or unhandled crash. Bin entry `webcvt → dist/cli.js` with explicit `tsup.config.ts` `banner: { js: '#!/usr/bin/env node' }` (per Sec-H-1; was implicitly preserved before — fragile). All log output goes to stderr; stdout reserved for binary payload (Trap §2 — verified by spawn test that captures stdout from `--verbose tiny.json -` and asserts byte-equal with input). Code-reviewed (4 HIGH all fixed: `dispatch()` `switch` had no default branch — fall-off-end returned `undefined` → exitCode 0 silently; `vi.mock` inside `it()` body was silently dead because vitest only hoists module-level mocks; `help.test.ts` mutated `defaultRegistry.list = () => []` directly leaking shared singleton state — replaced with `vi.spyOn` + `restoreAllMocks()`; tsup banner added explicitly). Security-reviewed (2 HIGH all fixed: stack-trace bare-crash leaked home-dir + install-layout to stderr — gated behind `WEBCVT_DEBUG`; `--from`/`--to` hint strings unbounded → DoS-style large-arg injection capped at `MAX_HINT_LEN=255`). Plus 5 MEDIUMs fixed (`Buffer.concat` 3-arg wrap consistency; `process.env.WEBCVT_DEBUG = undefined` left string `"undefined"` instead of deleting; missing `webcvt -- -dash-prefix.mp3` test; `CliInputTooLargeError` exact-byte-count info leak; magic numbers in tests). Three optional-dep loader edge cases noted: `@catlabtech/webcvt-backend-wasm` placeholder lacks `WasmBackend` export → entry removed from `BACKEND_PACKAGES` until backend-wasm grows a real class; `@catlabtech/webcvt-image-animation` package.json `exports` validated correct (false-alarm from stage 1); `register.test.ts` `vi.mock` removed entirely as untestable-without-refactor of `registerInstalledBackends` to accept injected `importFn`. NO CLI framework deps (cac/yargs/oclif rejected — keeps `@catlabtech/webcvt-core` as the sole runtime dep); 16 backends in `optionalDependencies` so `npm i -g @catlabtech/webcvt-cli` opportunistically pulls them but tolerates partial install. ESM-only, Node ≥ 20, `dist/cli.js` chmod 0o755 via `postbuild` script.
- [x] `apps/playground` — Cloudflare Pages demo site (deployed 2026-04-23 → https://webcvt.pages.dev). Vite SPA with multi-format converter UI; uses 9 workspace packages including `@catlabtech/webcvt-codec-webcodecs` + `@catlabtech/webcvt-backend-wasm` (lazy-loaded). COEP/COOP headers set for cross-origin isolation (required for SharedArrayBuffer / ffmpeg.wasm multi-thread). Direct Upload via wrangler.
- [x] `apps/docs` — VitePress docs site (deployed 2026-04-23 → https://webcvt-docs.pages.dev). Per-package pages plus narrative guides; auto-deployed via wrangler from `apps/docs/.vitepress/dist`.
- [x] Examples: vanilla, React, Next.js, Node, Cloudflare Worker — all 5 done. `examples/vanilla-html` + `examples/node-subtitle` shipped 2026-04-22; `examples/react` (Vite + React 18, 48.80 KB gzip), `examples/cloudflare-worker` (single fetch handler, POST SRT → VTT, nodejs_compat flag), `examples/nextjs` (App Router with server-rendered shell + `'use client'` Converter component) shipped 2026-04-23 (commit `99f7dfe`). All five use `@catlabtech/webcvt-subtitle` to keep focus on integration shape rather than format coverage; typecheck + production build green for each.
- [ ] Logo, domain, branding
- [x] npm v0.1.0 release — all 21 publishable packages live as `@catlabtech/webcvt-*@0.1.0` (2026-04-23). Granular access token with "Bypass 2FA" flag, scoped to `@catlabtech` org. `scripts/release.sh` drives the full pipeline (pre-flight → build → CF deploy → publish dry-run → confirmation → publish).
- [ ] Show HN, Reddit, Twitter, Product Hunt

### Phase 6 — Modern image codecs (Weeks 21–22) · Wave B
- [ ] `@catlabtech/webcvt-image-jsquash-avif` (AVIF encoding)
- [ ] `@catlabtech/webcvt-image-jsquash-jxl` (JPEG XL)
- [ ] `@catlabtech/webcvt-image-heic` (HEIC/HEIF)

### Phase 7 — Font + EPUB + EML + Comic archives (Weeks 23–25) · Wave C
- [ ] `@catlabtech/webcvt-font` — TTF/OTF/WOFF/WOFF2 (using `DecompressionStream` for Brotli)
- [ ] `@catlabtech/webcvt-doc-ebook-epub` — self-written EPUB (ZIP + XHTML)
- [ ] `@catlabtech/webcvt-email` — EML parser (RFC 5322)
- [ ] `@catlabtech/webcvt-archive-7z`, `@catlabtech/webcvt-archive-rar` (wasm, lazy)

### Phase 8 — Documents + specialty (Months 7–8) · Wave D
- [ ] `@catlabtech/webcvt-doc-pdf` — pdfjs-dist + pdf-lib
- [ ] `@catlabtech/webcvt-doc-ebook-mobi` — MOBI/AZW3/FB2/PDB/LRF
- [ ] `@catlabtech/webcvt-image-legacy-wasm` — PSD/BLP/DDS/EPS/JP2
- [ ] `@catlabtech/webcvt-data-binary` — Parquet/ORC/Feather via apache-arrow
- [ ] `@catlabtech/webcvt-data-sqlite` — sql.js

### Phase 9 — API Server + Tier 3 (Months 9+) · Wave E, Transmute parity (optional)
- [ ] `@catlabtech/webcvt-api-server` (Hono) — same API over HTTP
- [ ] `@catlabtech/webcvt-backend-native` (Node: spawn ffmpeg/pandoc)
- [ ] Cloudflare Worker deployment template
- [ ] Docker image for self-hosting
- [ ] `@catlabtech/webcvt-server-pandoc`, `server-libreoffice`, `server-ghostscript`
- [ ] Stats formats (DTA/SAV/XPT) via pyodide-pandas (optional plugin)
- [ ] OpenAPI spec + auth + rate limiting

> **Browser-first reminder:** Phases 1–7 (through Wave C) are the product. Phase 8–9 are downstream value-add for server operators — they ship *if* there's demand, not because we need them.

---

## 7. Success Metrics

### Adoption
| When | Metric | Target |
|---|---|---|
| Launch (Month 5, Wave A) | GitHub stars | 500+ |
| Launch month | npm weekly downloads | 1,000+ |
| 6 months post-launch | GitHub stars | 3,000+ |
| 6 months post-launch | npm weekly downloads | 10,000+ |

### Format coverage vs Transmute (denominator: 200 formats / 2,000 conversions)

Cumulative. % columns computed as `formats / 200` and `conversions / 2,000`.

| Milestone | Formats (cum.) | Conversions (cum.) | % formats | % conversions |
|---|---|---|---|---|
| End of Phase 1 (Week 2) | 11 (5 image + 6 subtitle) | ~60 | 5.5% | 3% |
| End of Phase 2 (Week 5) | 16 (+5 audio containers) | ~120 | 8% | 6% |
| End of Phase 3 (Week 16) | 24 (+4 video containers +MOV/M4A/M4V variants) | ~400 | 12% | 20% |
| End of Phase 4 (Week 19) | 55 (+animation +13 legacy image +archive +data-text) | ~1,100 | 27.5% | 55% |
| **Launch = Phase 5 / Wave A (Week 20)** | **55 + ffmpeg.wasm legacy fallbacks** | **~1,100** | **27.5%** | **55%** |
| End of Phase 6 / Wave B (Week 22) | 58 (+AVIF/JXL/HEIC) | ~1,300 | 29% | 65% |
| End of Phase 7 / Wave C (Week 25) | 72 (+fonts +EPUB +EML +7z/RAR +comic) | ~1,500 | 36% | 75% |
| End of Phase 8 / Wave D (Month 8) | 130 (+PDF +legacy ebooks +legacy images +Parquet/SQLite) | ~1,800 | 65% | 90% |
| End of Phase 9 / Wave E (Month 9+) | **200** (+Tier 3 server: Office, pandoc, Ghostscript) | **~2,000+** | **100% ✅** | **100% ✅** |

Note: format count grows slowly up to launch, then jumps hard in Waves D–E when PDF/ebooks/Office/legacy-image-wasm ship. Conversions grow faster because each new format multiplies combinations with existing ones.

### Technical quality (hard limits)
| Metric | Target |
|---|---|
| Bundle size: `JPG → WebP` | <50 KB |
| Bundle size: `MP4 → WebM` (WebCodecs path) | <100 KB |
| Bundle size: `MP4 → MP3` (audio only) | <500 KB |
| Bundle size: fallback to ffmpeg.wasm | <30 MB (pays only when used) |
| Test coverage | 80%+ |
| iOS Safari 17+ support | ✅ Yes |
| Every file LOC | <800 |
| `any` in public API | 0 |

---

## 8. Risks & Mitigation

| Risk | Mitigation |
|---|---|
| **Self-written container bugs** (Option B is hard) | Byte-exact parity tests against FFmpeg reference outputs from Phase 1 onward. Extensive fuzzing via vitest. Clean-room study of Mediabunny architecture (see §11). |
| **Specs misinterpreted** (MP4/Matroska are dense) | Cross-check against ISOBMFF-14496-12, Matroska RFC, reference implementations. Every container has a `/docs/design-notes/container-*.md` written before code. |
| **MP4 / Matroska slip past Phase 3** | Phase 3 window is already extended to 11 weeks (Weeks 6–16). If still slipping, cut MKV scope from MVP and ship MP4+WebM only for Wave A. |
| ffmpeg.wasm unmaintained again | Pin version. Fallback-only means low exposure. |
| WebCodecs API changes | Wrap behind `codec-webcodecs` adapter. |
| iOS Safari memory limits (~1 GB) | Stream/chunk processing from day 1 (not bolted on later) |
| LGPL contamination | Keep LGPL deps as optional lazy-loaded plugins |
| One-person project burnout | Modular design = easier contributor handoff. Accept PRs early. |
| Codec patent issues (HEIC, HEVC) | Those live in separate packages, documented risk, not in core |
| **"Why not just use Mediabunny?"** marketing question | Answer: zero-dependency core (MIT, no MPL-2.0 copyleft footprint), browser-first including non-AV (font/archive/EPUB/EML/subtitle/data-text), modular scope, our own release cadence |

---

## 9. Open Questions

### 🚨 Blockers (must resolve before Phase 1 starts)

1. **npm name availability** — run `npm view webcvt` and `npm view @catlabtech/webcvt-core`. Reserve the scope today.
2. **Domain** — `webcvt.dev` (preferred) vs `webcvt.io` vs `webcvt.js.org`. Buy today.
3. **Solo vs accept contributors** — affects PR review burden and CI setup from day 1.
4. **Test fixture strategy** — where FFmpeg reference files come from, how stored, how versioned. Before writing any container code.

### 📋 Non-blockers (can decide by Phase 5 launch)

5. **Logo / brand colors** — affects readme, demo, docs
6. **Twitter handle** — for launch
7. **Discord vs GitHub Discussions** — community channel
8. **GitHub Sponsors from day 1?**

---

## 10. Next Action

### Where we are

Repo live at https://github.com/Junhui20/webcvt. **🚀 v0.1.0 launched 2026-04-23 — all 21 publishable packages live on npm as `@catlabtech/webcvt-*@0.1.0`.** Phases 1–5 complete (work-track only; logo + announcement deferred to user voice). Playground live at https://webcvt.pages.dev, docs at https://webcvt-docs.pages.dev, 5 examples shipped (vanilla-html, node-subtitle, react, cloudflare-worker, nextjs). 21 packages, 2,215+ tests, lint+typecheck+build all green in CI. Phase 3 wrap-up tasks still deferred (interop tests, second-passes for mp4/webm/mkv/ts). data-text scope-cut: 5 simplest formats only (JSON/CSV/TSV/INI/ENV); YAML/TOML/XML/JSONL/FWF/TOON to Phase 4.5+.

### Proven per-package pipeline (from container-mp3)

The full agent loop ran end-to-end successfully on container-mp3 — every new container should follow the same 5-stage flow:

```
1. typescript-pro agent  → TDD implementation from design note (~1.5K LOC + tests)
2. code-reviewer agent   → quality + API design review
3. security-reviewer     → DoS / OOM / buffer-bounds review (in parallel with #2)
4. typescript-pro agent  → apply review fixes + add regression tests
5. local verify + commit + push
```

container-mp3 numbers from this loop: 120 → 124 → 131 tests, 97.09% → 96.87% coverage. 6 DoS vectors caught and patched before merge — none would have been found by tests alone. The pipeline pays for itself.

### Immediate next step

**Phase 6 / Wave B: `@catlabtech/webcvt-image-jsquash-avif` first-pass** — AVIF encode/decode wrapper around `@jsquash/avif` (Apache-2.0, with patent grant). Lazy wasm load, mirrors the `image-canvas` adapter shape. After: `image-jsquash-jxl` (JPEG XL), then `image-heic` (HEIC/HEIF — Apple iPhone photos). All three follow the proven 5-stage pipeline. Wave B target: ship as a v0.2.0 minor bump.

(`image-legacy` first-pass for the 13 bitmap formats already shipped during Phase 4.)

### Phase 3 remaining

| Container / task | LOC | Pipeline status |
|---|---|---|
| ~~Extract `@catlabtech/webcvt-ebml` from webm + mkv duplicated primitives~~ | ✅ done 2026-04-19 — 19 packages, 65 ebml tests, ~740 LOC duplication eliminated |
| Interop tests (FFmpeg can demux our output) | — | Phase 3 wrap-up |
| Phase-3 demo: full MP4 ↔ WebM ↔ MOV ↔ MKV pipeline | — | Phase 3 wrap-up (or merge into Phase 5 apps/playground) |
| `container-mp4` second-pass (video, fragmented, edit lists, multi-track, DRM) | ~4,500 | Phase 3.5 |
| `container-webm` / `container-mkv` second-pass (multi-track, subtitles, chapters, encryption, AV1, lacing 10+11) | ~3,000 | Phase 3.5 |
| `container-ts` second-pass (M2TS, multi-program, HEVC, AC-3, SI tables) | ~2,000 | Phase 3.5 |

Phase 3 is the make-or-break block. Budget 2.5 months. The container-mp3/flac/ogg experience tells us the design-note → implement → review → security-fix loop adds ~30% to bare implementation time but catches issues that would burn weeks in field debugging — every Phase-2 container's review pass caught real DoS/OOM vectors that 100+ tests didn't.

---

## 11. Reference & Clean-room Policy

> **Principle:** Specs first. Source code is reference material only, and Mediabunny (MPL-2.0) requires special handling.

### 11.1 License handling per reference library

| Library | License | Can reuse code? | How to use |
|---|---|---|---|
| **`mediabunny`** | **MPL-2.0** | ❌ **NO copy-paste** — any copied code stays MPL | Clean-room: read → write design notes → implement from notes + spec |
| `mp4-muxer`, `webm-muxer` | MIT | ✅ With attribution | Architecture reference; we re-derive from ISOBMFF spec |
| `fflate` | MIT | ✅ | Study `DecompressionStream` usage patterns |
| `fontkit`, `wawoff2` | MIT | ✅ | Study WOFF2 Brotli decompression pipeline |
| `epub.js` | BSD-3 | ✅ | Spec-driven (EPUB 3.3 is just ZIP + XHTML) |
| `postal-mime`, `mailparser` | MIT | ✅ | Derive from RFC 5322; check edge cases |
| `papaparse` | MIT | ✅ | Study CSV edge cases (quoting, multiline, BOM) |
| `yaml`, `smol-toml`, `fast-xml-parser` | MIT / ISC | ✅ | Spec-driven (YAML 1.2, TOML 1.0, XML 1.0) |
| `@jsquash/*` | Apache-2.0 (with patent grant) | ✅ | Not needed for JPEG/PNG/WebP (Canvas handles it); kept only for AVIF/JXL |
| `utif`, `tiff.js` | MIT | ✅ | Spec-driven (TIFF 6.0) |
| `psd.js`, `ag-psd` | MIT | ✅ | PSD deferred to Tier 3 |

### 11.2 Clean-room workflow (for Mediabunny and general hygiene)

Even for MIT-licensed code, we adopt clean-room to keep our codebase provably original:

```
Day 1–2 · Study phase
  Read reference source (e.g., Mediabunny container-mp4)
  ↓
  Write design notes in /docs/design-notes/container-mp4.md
  Topics: atom layout, chunking strategy, WebCodecs integration, edge cases
  ↓
Day 3+ · Implement phase (close the reference)
  Open only:
    - Official spec (ISO/IEC 14496-12)
    - Our own design notes
    - FFmpeg sample files for byte-level verification
  ↓
  Write the implementation in TypeScript
  ↓
Day N · Debug phase
  When a test fails, revisit the specific reference function
  Record what we learned back into the design notes
  Never copy code
```

**Benefit:** Implementation is provably ours. All code can be licensed MIT without ambiguity.

### 11.3 Official specification links (read-first priority)

| Format | Spec |
|---|---|
| MP4 / MOV / M4A / M4V | ISO/IEC 14496-12 (ISOBMFF) |
| WebM | webmproject.org/docs/container/ |
| Matroska (MKV) | matroska.org/technical/elements.html |
| MP3 | ISO/IEC 11172-3 + ID3v2.4 |
| FLAC | xiph.org/flac/format.html |
| OGG | RFC 3533 |
| MPEG-TS | ISO/IEC 13818-1 |
| AAC / ADTS | ISO/IEC 14496-3 |
| WAV (RIFF) | mmsp.ece.mcgill.ca WAVE doc |
| ZIP | PKWARE APPNOTE-6.3.10 |
| TIFF 6.0 | Adobe TIFF 6.0 spec |
| OpenType (TTF/OTF) | learn.microsoft.com/typography/opentype/spec |
| WOFF2 | W3C WOFF2 recommendation |
| EPUB 3.3 | W3C EPUB 3.3 |
| EML | RFC 5322 |
| YAML 1.2 | yaml.org/spec/1.2.2 |
| TOML 1.0 | toml.io/en/v1.0.0 |
| JSON | RFC 8259 |
| XML 1.0 | W3C XML 1.0 |
| APNG | wiki.mozilla.org APNG Specification |
| GIF 89a | W3C GIF89a |

Stored in `/docs/specs/LINKS.md` for quick access during implementation.

### 11.4 Test fixtures (legally safe)

- **FFmpeg samples** (`samples.ffmpeg.org`) — LGPL-2.1 files used only as **test inputs**, not redistributed in npm package
- **Mediabunny test fixtures** — check per-file licenses; most are CC-0 or similar
- **W3C WebPlatform Tests** — standardized browser API tests
- Location: `/tests/fixtures/` — listed in `.npmignore` so they're never published

### 11.5 README attribution template (every package)

```markdown
## Implementation references

This package is implemented from the official specification
([ISO/IEC 14496-12](link) for MP4). Architectural inspiration
drawn from studying Mediabunny (MPL-2.0) but no code was copied —
all implementation is original and licensed under MIT.

Test fixtures derived from FFmpeg samples (LGPL-2.1) are stored
in `tests/fixtures/` and are excluded from the published npm
package via `.npmignore`.
```

This:
- Acknowledges influences transparently
- Preempts any "did you copy X?" question
- Protects npm distribution from license contamination
- Is a pattern to copy-paste for each new package

---

**Last updated:** 2026-04-19 (Option B self-written + planner review fixes applied)
**Author:** bryan@instamedia.my
