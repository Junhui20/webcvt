# webcvt — Project Plan

> **One-liner:** A lightweight, browser-first, hardware-accelerated file conversion library and API. Convert anything in the browser, no upload required.

- **Name:** `webcvt`
- **Owner:** [Junhui20/webcvt](https://github.com/Junhui20/webcvt)
- **License:** MIT
- **Status:** **Phase 1: 7/8 (1 deferred to Phase 5) · Phase 2: 4/8 (2/5 containers + fixtures + design notes done)** · CI green · 529 tests passing · last revised 2026-04-19

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
- `@webcvt/backend-mediabunny` is **removed**. Replaced with in-house packages (`container-mp4`, `container-webm`, `container-mkv`, `container-mp3`, `container-wav`, `container-ogg`, `container-flac`, `container-ts`, `container-aac`, `codec-webcodecs`).
- `@ffmpeg/ffmpeg` remains **fallback-only** (legacy: AVI, FLV, WMV, 3GP, WMA, AC3, AIFF, MPEG-1/2, ASF, F4V) — lazy-loaded, never bundled by default.
- Additional self-written replacements: **archive (ZIP/TAR), EPUB, EML, CSV, YAML, TOML, XML, TIFF, font parsing, subtitle, data-text**. All feasible because browser provides the hard primitives (`DecompressionStream`, `DOMParser`, `TextDecoder`, Canvas, WebCodecs).
- **Tier 3 server tools are de-prioritised** — Office / pandoc / Ghostscript formats ship late (Month 7+) as an optional `@webcvt/api-server` deployment, not bundled with the browser library.
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
2. **Modular** — `npm i @webcvt/container-mp3` if you only want MP3. No 30 MB blob.
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

→ **Estimated: ~30 formats, ~300 conversion pairs — handled via `@webcvt/api-server`**

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
3. On missing capability → throw with actionable error ("install @webcvt/container-xxx")
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
- [x] `@webcvt/core` — public API, types, registry, format detector (magic bytes), capability probe (Worker pool deferred to Phase 2)
- [x] `@webcvt/codec-webcodecs` — thin WebCodecs adapter (encode/decode abstraction); 81 tests, 98.8% coverage
- [x] `@webcvt/image-canvas` — PNG/JPG/WebP/BMP/ICO via Canvas; 67 tests, 96.4% coverage; ICO + BMP writers self-written
- [x] `@webcvt/subtitle` — SRT/VTT/ASS/SSA/SUB/MPL all self-written; 128 tests, 93.1% coverage
- [x] CI: lint (biome) + typecheck + test (Node 20 + 22 matrix) + build, all green on push/PR
- [x] **Test-fixture pipeline** — actually completed as the first task of Phase 2 (see §6 Phase 2). `@webcvt/test-utils` package + `scripts/generate-fixtures.mjs` + 4 reference fixtures.
- [ ] First demo: PNG ↔ JPG ↔ WebP working in browser playground — **deferred to Phase 5** (`apps/playground` ships with launch prep)

**Phase 1 outcome:** 4 packages published-ready, 315 tests passing, ~3,300 LOC source. Bundle sizes: core 3 KB, codec-webcodecs 12 KB, image-canvas 6 KB, subtitle 25 KB. All ESM + CJS + .d.ts.

### Phase 2 — Core containers, set 1 (Weeks 3–5) — **4/8**
- [x] **Test-fixture pipeline** — `@webcvt/test-utils` package (bytes/fixtures/audio-synth helpers, 18 tests) + `scripts/generate-fixtures.mjs` using pinned `ffmpeg-static` + 4 reference fixtures committed under `tests/fixtures/audio/` + `.gitattributes` (binary). _Also closes the deferred Phase 1 item._
- [x] **Design notes** — `docs/design-notes/container-{wav,mp3,flac,ogg,aac}.md` written from official specs (clean-room per §11)
- [x] `@webcvt/container-wav` — RIFF/WAV muxer + demuxer, 65 tests, 94.8% coverage, ~12 KB bundle. Includes WAVEFORMATEXTENSIBLE recognition; RF64 throws `WavTooLargeError` (deferred)
- [x] `@webcvt/container-mp3` — MPEG-1/2/2.5 Layer III + ID3v2/v1 + Xing/LAME/VBRI; 131 tests, 96.87% coverage, ~22 KB bundle. Code-reviewed (3 HIGH fixed: APE skip clarity, encodeUnsynchronisation un-export, dead branch). Security-reviewed (3 HIGH + 3 MED DoS vectors fixed: ext-header bounds, APE underflow, 200 MiB input cap, 64 MiB ID3 body cap, frameBytes guard, matchMagic bounds). MPEG 2.5 read-only; free-format throws.
- [ ] `@webcvt/container-aac` (ADTS) — needs fixture generation + design-note revisit (HE-AAC routed to backend-wasm which doesn't exist yet)
- [ ] `@webcvt/container-flac` — has fixture, decode via WebCodecs Chrome 124+/Safari 17+; encode routed to future backend-wasm
- [ ] `@webcvt/container-ogg` — needs fixture; +sequential chaining (~1,130 LOC)
- [ ] Demo: WAV ↔ MP3 ↔ FLAC ↔ OGG conversion using our containers + WebCodecs (depends on all 5 containers)

### Phase 3 — Core containers, set 2 (Weeks 6–16) · **hardest phase, 2.5 months**
- [ ] Weeks 6–10: `@webcvt/container-mp4` (ISOBMFF — MP4/MOV/M4A/M4V) — **~6,000 LOC**
  - First-pass: basic moov/mdat, uncompressed sample table
  - Second-pass: edit lists, fragmented MP4, metadata
- [ ] Weeks 11–13: `@webcvt/container-webm` (Matroska subset) — ~2,500 LOC
- [ ] Weeks 14–15: `@webcvt/container-mkv` (full Matroska, EBML) — ~2,000 LOC
- [ ] Week 16: `@webcvt/container-ts` (MPEG-TS + PAT/PMT) — ~1,000 LOC
- [ ] Interop tests: byte-exact muxing + FFmpeg can demux our output
- [ ] Demo: full MP4 ↔ WebM ↔ MOV ↔ MKV pipeline, HW-accelerated

### Phase 4 — Image + Animation + Archive + Data-text (Weeks 17–19)
- [ ] `@webcvt/image-svg`
- [ ] `@webcvt/image-animation` — GIF/APNG/animated WebP (self-written)
- [ ] `@webcvt/image-legacy` — 13 formats: TIFF/TGA/QOI/PCX/PBM/PGM/PNM/PPM/PFM/XBM/XPM/ICNS/CUR
- [ ] `@webcvt/archive-zip` — ZIP/TAR/GZ/BZ2/XZ (using `DecompressionStream`)
- [ ] `@webcvt/data-text` — JSON/YAML/TOML/CSV/TSV/XML/INI/JSONL/TOON/FWF/ENV
- [ ] Test coverage ≥ 80%

### Phase 5 — Launch prep (Week 20 — roughly Month 5) · v0.1.0, Wave A
- [ ] `@webcvt/backend-wasm` — ffmpeg.wasm fallback wiring (legacy-only)
- [ ] `@webcvt/cli` — `npx webcvt in out` dev ergonomics
- [ ] `apps/playground` — Cloudflare Pages demo site
- [ ] `apps/docs` — VitePress docs site
- [ ] Examples: vanilla, React, Next.js, Node, Cloudflare Worker
- [ ] Logo, domain, branding
- [ ] npm v0.1.0 release
- [ ] Show HN, Reddit, Twitter, Product Hunt

### Phase 6 — Modern image codecs (Weeks 21–22) · Wave B
- [ ] `@webcvt/image-jsquash-avif` (AVIF encoding)
- [ ] `@webcvt/image-jsquash-jxl` (JPEG XL)
- [ ] `@webcvt/image-heic` (HEIC/HEIF)

### Phase 7 — Font + EPUB + EML + Comic archives (Weeks 23–25) · Wave C
- [ ] `@webcvt/font` — TTF/OTF/WOFF/WOFF2 (using `DecompressionStream` for Brotli)
- [ ] `@webcvt/doc-ebook-epub` — self-written EPUB (ZIP + XHTML)
- [ ] `@webcvt/email` — EML parser (RFC 5322)
- [ ] `@webcvt/archive-7z`, `@webcvt/archive-rar` (wasm, lazy)

### Phase 8 — Documents + specialty (Months 7–8) · Wave D
- [ ] `@webcvt/doc-pdf` — pdfjs-dist + pdf-lib
- [ ] `@webcvt/doc-ebook-mobi` — MOBI/AZW3/FB2/PDB/LRF
- [ ] `@webcvt/image-legacy-wasm` — PSD/BLP/DDS/EPS/JP2
- [ ] `@webcvt/data-binary` — Parquet/ORC/Feather via apache-arrow
- [ ] `@webcvt/data-sqlite` — sql.js

### Phase 9 — API Server + Tier 3 (Months 9+) · Wave E, Transmute parity (optional)
- [ ] `@webcvt/api-server` (Hono) — same API over HTTP
- [ ] `@webcvt/backend-native` (Node: spawn ffmpeg/pandoc)
- [ ] Cloudflare Worker deployment template
- [ ] Docker image for self-hosting
- [ ] `@webcvt/server-pandoc`, `server-libreoffice`, `server-ghostscript`
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

1. **npm name availability** — run `npm view webcvt` and `npm view @webcvt/core`. Reserve the scope today.
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

Repo live at https://github.com/Junhui20/webcvt. Phase 1 done. Phase 2: 2/5 containers complete (`container-wav`, `container-mp3`). 7 packages, 529 tests, lint+typecheck+build all green in CI.

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

**`container-aac`** (LOC budget ~330, smallest remaining Phase 2 container). Follow the 5-stage pipeline above. Design note at `docs/design-notes/container-aac.md` is the spec.

### Phase 2 remaining

| Container | LOC | Pipeline status |
|---|---|---|
| `container-aac` | ~330 | 🔜 next |
| `container-flac` | ~720 | design note ready |
| `container-ogg` | ~1,130 | design note ready (incl. sequential chaining) |

Phase 3 (Weeks 6–16) — MP4 + Matroska — is still the make-or-break block. Budget 2.5 months for it, not 1. The container-mp3 experience tells us the design-note → implement → review → security-fix loop adds ~30% to bare implementation time but catches issues that would burn weeks in field debugging.

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
