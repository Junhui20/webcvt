# Getting Started

webcvt is a browser-first, hardware-accelerated file conversion library. It ships as 22 focused npm packages — install only what you need.

## Quick start

### Try the playground

The fastest way to see webcvt in action is the [live playground](https://webcvt.pages.dev). Drop a file, pick an output format, convert — no setup required.

### Node.js (3 lines)

```bash
npm i @catlabtech/webcvt-core @catlabtech/webcvt-image-canvas
```

```ts
import { convert, defaultRegistry } from '@catlabtech/webcvt-core';
import { CanvasBackend } from '@catlabtech/webcvt-image-canvas';

defaultRegistry.register(new CanvasBackend());
const result = await convert(inputBlob, { format: 'webp' });
```

### Browser (3 lines)

```html
<script type="module">
  import { convert, defaultRegistry } from 'https://esm.sh/@catlabtech/webcvt-core';
  import { CanvasBackend } from 'https://esm.sh/@catlabtech/webcvt-image-canvas';

  defaultRegistry.register(new CanvasBackend());
  const result = await convert(file, { format: 'webp' });
  const url = URL.createObjectURL(result.blob);
</script>
```

## What's in webcvt

22 packages across five categories:

| Category | Packages |
|---|---|
| Foundation | `core`, `codec-webcodecs`, `backend-wasm`, `ebml` |
| Audio/Video | `container-wav`, `container-mp3`, `container-flac`, `container-ogg`, `container-aac`, `container-mp4`, `container-webm`, `container-mkv`, `container-ts` |
| Images | `image-canvas`, `image-legacy`, `image-animation`, `image-svg` |
| Archives, data & subtitles | `archive-zip`, `data-text`, `subtitle` |
| CLI | `cli` |

All packages are ESM-only and require Node.js ≥ 20 for server-side use.

## Next steps

- **[Browser usage](/guide/browser-usage)** — COEP/COOP headers, bundler setup, bundle size tips
- **[Node.js usage](/guide/nodejs-usage)** — full convert() flow, backend registration
- **[CLI usage](/guide/cli-usage)** — `npx @catlabtech/webcvt-cli` for shell pipelines
- **[Packages](/packages/core)** — per-package API references
