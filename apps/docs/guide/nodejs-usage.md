# Node.js Usage

webcvt works in Node.js ≥ 20. The same packages used in the browser run server-side without modification — backends register themselves against the same `defaultRegistry`.

## Installation

```bash
npm i @webcvt/core @webcvt/image-canvas
# Or with pnpm:
pnpm add @webcvt/core @webcvt/image-canvas
```

## Basic conversion

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { convert, defaultRegistry } from '@webcvt/core';
import { CanvasBackend } from '@webcvt/image-canvas';

// Register backend once
defaultRegistry.register(new CanvasBackend());

// Read input file as a Blob
const buffer = await readFile('photo.jpg');
const input = new Blob([buffer], { type: 'image/jpeg' });

// Convert
const result = await convert(input, { format: 'webp', quality: 0.85 });

// Write output
const outBuffer = Buffer.from(await result.blob.arrayBuffer());
await writeFile('photo.webp', outBuffer);

console.log(`Done in ${result.durationMs}ms via ${result.backend}`);
```

## Full convert() flow with multiple backends

Register multiple backends in priority order. The registry picks the first one that reports `canHandle()` as `true`:

```ts
import { convert, defaultRegistry } from '@webcvt/core';
import { CanvasBackend } from '@webcvt/image-canvas';
import { WasmBackend } from '@webcvt/backend-wasm';

// Canvas backend handles common image formats with no WASM overhead
defaultRegistry.register(new CanvasBackend());
// WASM backend handles everything else (video, audio, rare image formats)
defaultRegistry.register(new WasmBackend());

const result = await convert(input, { format: 'mp4' });
```

## Subtitle conversion

```ts
import { SubtitleBackend } from '@webcvt/subtitle';
import { convert, defaultRegistry } from '@webcvt/core';
import { readFile, writeFile } from 'node:fs/promises';

defaultRegistry.register(new SubtitleBackend());

const buffer = await readFile('subtitles.srt');
const input = new Blob([buffer], { type: 'application/x-subrip' });
const result = await convert(input, { format: 'vtt' });

await writeFile('subtitles.vtt', Buffer.from(await result.blob.arrayBuffer()));
```

## Direct parser / serializer usage

For subtitle and data-text packages, you can bypass the registry and call parsers directly:

```ts
import { parseSrt, serializeVtt } from '@webcvt/subtitle';
import { readFileSync } from 'node:fs';

const srtText = readFileSync('subtitles.srt', 'utf-8');
const track = parseSrt(srtText);
const vttText = serializeVtt(track);
```

## When to use the CLI instead

For simple one-off conversions in shell scripts, the CLI is more ergonomic than writing a Node.js script:

```bash
npx @webcvt/cli photo.jpg photo.webp
npx @webcvt/cli subtitles.srt subtitles.vtt
```

See [CLI usage](/guide/cli-usage) for details.

## Error handling

All webcvt errors extend `WebcvtError` and carry a `.code` property for programmatic handling:

```ts
import { convert, defaultRegistry, UnsupportedFormatError, NoBackendError } from '@webcvt/core';

try {
  const result = await convert(input, { format: 'xyz' });
} catch (err) {
  if (err instanceof UnsupportedFormatError) {
    console.error(`Format not supported: ${err.code}`);
  } else if (err instanceof NoBackendError) {
    console.error('No backend registered for this conversion');
  } else {
    throw err;
  }
}
```

See the [Error Codes reference](/reference/error-codes) for a full list.
