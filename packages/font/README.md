# @catlabtech/webcvt-font

Self-written, **dependency-free** font-container converter for [webcvt](https://github.com/Junhui20/webcvt): convert between **sfnt (TTF/OTF)** and **WOFF 1.0** entirely client-side.

This is pure **container repackaging** — it rewraps the same font tables, it does not render glyphs or convert outlines.

## What it does

- **sfnt → WOFF**: read the sfnt tables, zlib-deflate each (kept stored when compression doesn't help), and wrap them in a WOFF header + directory.
- **WOFF → sfnt**: inflate each table, rebuild the sfnt offset table + directory, and recompute table checksums + `head.checkSumAdjustment`.
- The output extension follows the font's `flavor`: an `OTTO` (CFF) font becomes `.otf`, otherwise `.ttf`.
- `readFontMeta` exposes basics from the `name`/`head`/`maxp` tables (family/subfamily/full name, unitsPerEm, numGlyphs).

## Install

```bash
npm install @catlabtech/webcvt-core @catlabtech/webcvt-font
```

## Usage

```typescript
import { parseSfnt, serializeWoff, parseWoff, serializeSfnt } from '@catlabtech/webcvt-font';

const woff = await serializeWoff(parseSfnt(ttfBytes));   // TTF/OTF → WOFF
const ttf = serializeSfnt(await parseWoff(woffBytes));    // WOFF → TTF/OTF
```

Via the backend (opt-in registration — never auto-registers):

```typescript
import { convert, defaultRegistry } from '@catlabtech/webcvt-core';
import { FontBackend } from '@catlabtech/webcvt-font';

defaultRegistry.register(new FontBackend());
const woff = await convert(ttfBlob, { format: 'woff' });
const ttf = await convert(woffBlob, { format: 'ttf' });
```

## Not supported

- **WOFF 2.0** (`wOF2`) — rejected with a typed error. It needs Brotli (unavailable in `DecompressionStream`) plus glyf-table transform reconstruction.
- **ttf ↔ otf** outline/CFF conversion — only sfnt↔WOFF repackaging is performed (a TrueType font stays TrueType; a CFF font stays CFF).
- TrueType/OpenType **Collections** (`ttcf`).

## Security

64 MiB input cap, ≤4096 tables, a per-table size cap, and a cumulative decompression-bomb cap enforced while inflating; every table offset/length is bounds-checked against the input.

## License

MIT
