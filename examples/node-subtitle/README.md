# node-subtitle

Minimal Node.js example — convert SRT subtitles to WebVTT using
`@webcvt/subtitle`. **~15 LOC, zero setup.**

## Run

```bash
pnpm install                              # from repo root (once)
cd examples/node-subtitle
node index.js sample.srt sample.vtt
```

Output:

```
Converted sample.srt → sample.vtt (3 cues, 267 bytes)
```

`sample.vtt` contains the converted WebVTT subtitles.

## The code

```js
import { readFile, writeFile } from 'node:fs/promises';
import { parseSrt, serializeVtt } from '@webcvt/subtitle';

const srt = await readFile('input.srt', 'utf8');
const track = parseSrt(srt);
const vtt = serializeVtt(track);
await writeFile('output.vtt', vtt);
```

That's it. No registry, no backend wiring, no format detection.

## What it shows

- **Low-level parse/serialize API.** For text formats (SRT, VTT, CSV,
  JSON...) this is the cleanest pattern — pure functions, no setup,
  works anywhere JS runs.
- **Works offline** after `pnpm install`. Zero network calls.
- **Intermediate representation.** `parseSrt` returns a `SubtitleTrack`
  (cues + styles). You can convert between ANY pair of supported
  formats by mixing parse + serialize:

  ```js
  // SRT → ASS
  import { parseSrt, serializeAss } from '@webcvt/subtitle';
  const ass = serializeAss(parseSrt(srt));

  // VTT → SRT
  import { parseVtt, serializeSrt } from '@webcvt/subtitle';
  const srt = serializeSrt(parseVtt(vtt));
  ```

## Supported formats

`@webcvt/subtitle` handles: **SRT, WebVTT, ASS, SSA, MicroDVD** — any pair.

## High-level convert() API

For binary formats (images, audio, video), the `convert()` API from
`@webcvt/core` is the recommended entry point:

```js
import { convert, defaultRegistry } from '@webcvt/core';
import { CanvasBackend } from '@webcvt/image-canvas';

defaultRegistry.register(new CanvasBackend());
const result = await convert(pngBlob, { format: 'webp' });
```

See [`apps/playground`](../../apps/playground) for the full browser
drag-and-drop demo.
