# webcvt — React example

A minimal React + Vite app that converts `.srt` subtitles to WebVTT in the browser using [`@catlabtech/webcvt-subtitle`](https://www.npmjs.com/package/@catlabtech/webcvt-subtitle).

The whole conversion is two function calls:

```ts
import { parseSrt, serializeVtt } from '@catlabtech/webcvt-subtitle';
const vtt = serializeVtt(parseSrt(srtText));
```

No backend registration, no format detection, no wasm — text-format packages stay zero-cost in the bundle.

## Run locally

From the monorepo root:

```bash
pnpm install
pnpm --filter @catlabtech/webcvt-example-react dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

## Build

```bash
pnpm --filter @catlabtech/webcvt-example-react build
```

Output lands in `dist/`. Drop it on any static host (CF Pages, Netlify, S3 + CloudFront, …).

## Files

- `src/App.tsx` — single component; useState-driven; ~80 LOC
- `src/main.tsx` — React entry
- `src/styles.css` — dark theme (no UI lib)
- `vite.config.ts` — `@vitejs/plugin-react`, ES2022 target

## What this proves

- `@catlabtech/webcvt-subtitle` works in a real React + Vite bundle (not just CDN)
- No SSR / hydration concerns — everything is client-side
- The text-subtitle path is build-tool-friendly (no COEP/COOP, no wasm headers)

For the full multi-format playground (with WebCodecs + ffmpeg.wasm fallback), see [`apps/playground`](../../apps/playground).
