# apps/playground — Cloudflare Pages Demo Site

Status: design note, pre-implementation
Owner: @Junhui20
Target: ship alongside v0.1 launch
LOC budget: ~500 app + ~200 CSS + ~150 tests (hard ceiling 700 app LOC)

## 1. Goal

Give a first-time visitor a working, visceral proof of webcvt's core claim in under 10 seconds: drop a file in the browser, see it converted locally with no network request, download the result. The playground is the tip of the marketing spear for the v0.1 launch.

## 2. Scope IN

- MVP conversion flow (drop → detect → pick target → convert → download)
- Vanilla TypeScript + Vite static build
- Hand-rolled CSS (no Tailwind/PostCSS)
- Cloudflare Pages deploy with COEP/COOP headers via `_headers`
- Lazy-load per-format-family packages
- Playwright smoke tests (3–5) for CI
- Mobile-responsive down to 360px
- Wall-clock timing readout
- Sample files catalogue ("try a sample")

## 3. Scope OUT (defer post-launch)

- User accounts, auth, saved presets
- Cloud storage / upload-to-URL
- Analytics / telemetry
- Multi-file batch queue
- Code-snippet panel
- Side-by-side preview
- Service worker / offline
- Cross-browser CI matrix (Chrome-only for v0.1)
- Custom domain (use github.com/Junhui20/webcvt)
- i18n, dark mode toggle (ship dark-first, no toggle)

## 4. Tech stack

| Tool | Version |
|---|---|
| Vite | ^5.4.0 |
| TypeScript | ^5.7.0 |
| @types/node | ^22.10.0 |
| Playwright | ^1.49.0 |
| wrangler | ^3.90.0 (user-installed) |

**NOT using:** React/Vue/Svelte (bundle bloat), Tailwind (no postcss), state libs (tiny graph), UI component kits.

## 5. File layout

```
apps/playground/
  package.json
  tsconfig.json
  vite.config.ts
  playwright.config.ts
  index.html
  README.md
  public/
    _headers                   ← CF Pages COEP/COOP + cache
    favicon.svg
    samples/
      sample.png, sample.jpg, sample.wav, sample.mp4, sample.srt
  src/
    main.ts
    state.ts                   ← createStore<T>() reactive primitive
    styles.css
    conversion.ts
    format-detector.ts
    backend-loader.ts
    types.ts
    ui/
      dropzone.ts
      format-picker.ts
      progress-bar.ts
      preview.ts
      result.ts
      samples.ts
  tests/
    smoke.spec.ts
    fixtures/
```

## 6. Dependencies

```json
{
  "name": "@catlabtech/webcvt-playground",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@catlabtech/webcvt-core": "workspace:*"
  },
  "devDependencies": {
    "@catlabtech/webcvt-archive-zip": "workspace:*",
    "@catlabtech/webcvt-backend-wasm": "workspace:*",
    "@catlabtech/webcvt-codec-webcodecs": "workspace:*",
    "@catlabtech/webcvt-container-mp4": "workspace:*",
    "@catlabtech/webcvt-container-webm": "workspace:*",
    "@catlabtech/webcvt-data-text": "workspace:*",
    "@catlabtech/webcvt-image-canvas": "workspace:*",
    "@catlabtech/webcvt-image-legacy": "workspace:*",
    "@catlabtech/webcvt-subtitle": "workspace:*",
    "@playwright/test": "^1.49.0",
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vite": "^5.4.0"
  }
}
```

Only `@catlabtech/webcvt-core` is static; others lazy-loaded. Landing payload target: ~25 KB gz.

## 7. Build config

```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  optimizeDeps: {
    include: ['@catlabtech/webcvt-core'],
    exclude: [
      '@catlabtech/webcvt-image-canvas', '@catlabtech/webcvt-codec-webcodecs',
      '@catlabtech/webcvt-container-mp4', '@catlabtech/webcvt-container-webm',
      '@catlabtech/webcvt-subtitle', '@catlabtech/webcvt-archive-zip',
      '@catlabtech/webcvt-data-text', '@catlabtech/webcvt-backend-wasm',
    ],
  },
});
```

## 8. Deploy — `public/_headers`

```
/*
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
  Cache-Control: public, max-age=3600

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

COEP+COOP unlocks SharedArrayBuffer (backend-wasm multi-thread) + full WebCodecs.

## 9. Conversion flow

```
File drop → detectFormat(file.slice(0, 8192)) → FormatDescriptor
  → preview card ("PNG 1920×1080, 2.3 MB")
  → registry.supportedOutputs(input) → target dropdown
  → user picks → backend-loader dynamic import() → convert(file, {format, onProgress, signal})
  → progress bar updates → Blob URL → download button
  → on unmount: URL.revokeObjectURL()
```

**Invariants:**
- No `fetch()`/`XMLHttpRequest`/`WebSocket` during conversion (visible in devtools)
- Input `File` never leaves the page
- Abort is wired (Cancel button)

## 10. Error handling

| Condition | UX |
|---|---|
| `detectFormat` returns null | "Unrecognized format" + format list link |
| `UnsupportedFormatError` | Pre-filled GitHub issue link |
| `NoBackendError` | Offer WASM fallback (~8 MB lazy-load) |
| File > 256 MiB | Block at drop; recommend CLI |
| WebCodecs unavailable | Banner; proceed with WASM fallback |
| `crossOriginIsolated === false` | Dev warning; prod can't hit (enforced by _headers) |
| Generic error | Show message + code if `WebcvtError`; "Retry" resets state |
| User cancels | Reset state, no error UI |

## 11. Smoke tests (5)

1. **Page loads** — title visible, dropzone present, no external network
2. **Image detection** — upload PNG → preview matches `/PNG.*\d+.*\d+/`
3. **PNG → WebP roundtrip** — download triggered, magic bytes `RIFF....WEBP`
4. **Unsupported format** — `.xyz` random bytes → error UI
5. **Progress bar animates** — MP4 → WebM conversion shows ≥2 intermediate progress values

CI: Chrome-only (headless). Full matrix deferred.

## 12. LOC budget

| File | LOC |
|---|---|
| main.ts | 40 |
| state.ts | 50 |
| conversion.ts | 60 |
| format-detector.ts | 30 |
| backend-loader.ts | 60 |
| types.ts | 30 |
| ui/dropzone.ts | 60 |
| ui/format-picker.ts | 40 |
| ui/progress-bar.ts | 30 |
| ui/preview.ts | 40 |
| ui/result.ts | 50 |
| ui/samples.ts | 30 |
| **app total** | **~520** |
| styles.css | 180 |
| index.html | 40 |
| tests/smoke.spec.ts | 120 |
| vite.config.ts | 35 |
| playwright.config.ts | 25 |

Hard ceiling: 700 LOC app code.

## 13. Domain / URL

Use `https://github.com/Junhui20/webcvt` until real domain arrives. CF Pages preview URL `https://webcvt.pages.dev` once deployed. Search-replace on domain change.

## 14. Cloudflare Pages deployment

One-time:
```bash
npx wrangler login
pnpm --filter @catlabtech/webcvt-playground build
npx wrangler pages deploy apps/playground/dist --project-name=webcvt --branch=main
```

Subsequent:
```bash
pnpm --filter @catlabtech/webcvt-playground build && \
  npx wrangler pages deploy apps/playground/dist --project-name=webcvt
```

GitHub Actions automation deferred until post-v0.1.

## 15. Known limitations for v0.1

- No accounts / saved presets
- Mobile limited to `<input type=file>` picker
- Safari/Firefox may fall back to WASM for some codecs
- WASM fallback requires `crossOriginIsolated`
- Chrome-first testing
- No telemetry
- 256 MiB input cap
- No SSR; pure SPA
- Bundle size claim ("~25 KB") aspirational — measure at ship

## Open questions

1. Does `@catlabtech/webcvt-core` expose `supportedOutputs(input)`? If not, add to core or build allowlist locally.
2. Version badge (`VITE_WEBCVT_VERSION`)? Recommended: yes.
3. Samples in repo or jsDelivr? Recommended: checked in (air-gapped).
4. Telemetry: confirmed NO for v0.1.
