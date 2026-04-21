# Browser Usage

webcvt is designed to run entirely in the browser. Files never leave the device unless you explicitly upload them.

## Via CDN (no build step)

```html
<script type="module">
  import { convert, defaultRegistry } from 'https://esm.sh/@webcvt/core';
  import { CanvasBackend } from 'https://esm.sh/@webcvt/image-canvas';

  defaultRegistry.register(new CanvasBackend());

  const input = document.querySelector('input[type=file]');
  input.addEventListener('change', async () => {
    const [file] = input.files;
    const result = await convert(file, { format: 'webp', quality: 0.85 });
    const url = URL.createObjectURL(result.blob);
    document.querySelector('img').src = url;
  });
</script>
```

## Via Vite / bundler

```bash
npm i @webcvt/core @webcvt/image-canvas
```

```ts
import { convert, defaultRegistry } from '@webcvt/core';
import { CanvasBackend } from '@webcvt/image-canvas';

// Register once, at app startup
defaultRegistry.register(new CanvasBackend());

async function convertImage(file: File): Promise<Blob> {
  const result = await convert(file, { format: 'webp', quality: 0.85 });
  return result.blob;
}
```

## COEP / COOP headers

Some backends require `SharedArrayBuffer`, which is only available in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) with cross-origin isolation. Add these headers to your server when using `@webcvt/backend-wasm` or `@webcvt/codec-webcodecs` with multithreading:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

For Vite in development, add to `vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

Packages that do **not** require these headers (pure Canvas, subtitle, data-text, archive-zip) work in any HTTPS context.

## Bundle size tips

webcvt is modular by design. Import only the packages you need:

```ts
// Good — only loads ~12 KB for pure image conversions
import { CanvasBackend } from '@webcvt/image-canvas';

// Avoid if you only need images — backend-wasm loads a ~4 MB WASM blob
import { WasmBackend } from '@webcvt/backend-wasm';
```

Check per-package sizes in the [Packages](/packages/core) section.

### Lazy loading backends

Register backends lazily to defer loading the WASM blob until it's needed:

```ts
import { defaultRegistry } from '@webcvt/core';

async function ensureWasmBackend() {
  const { WasmBackend } = await import('@webcvt/backend-wasm');
  defaultRegistry.register(new WasmBackend());
}
```

## Progress events

All conversions support an `onProgress` callback:

```ts
const result = await convert(file, {
  format: 'mp4',
  onProgress: ({ percent, phase }) => {
    console.log(`${phase}: ${percent.toFixed(1)}%`);
  },
});
```

## Abort / cancellation

Pass an `AbortSignal` to cancel an in-progress conversion:

```ts
const controller = new AbortController();

const result = await convert(file, {
  format: 'mp4',
  signal: controller.signal,
});

// Cancel from a button click:
cancelButton.onclick = () => controller.abort();
```
