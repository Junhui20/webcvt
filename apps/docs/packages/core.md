# @webcvt/core

> Public API, types, format detector, capability probe, and backend registry for webcvt.

## Installation

```bash
npm i @webcvt/core
```

## What's here

- `convert(input, options)` — the public entry point
- `detectFormat(blob)` — magic-byte format detection
- `BackendRegistry` — pluggable backend selection
- Shared types: `FormatDescriptor`, `ConvertOptions`, `ConvertResult`, `Backend`, error classes
- `detectCapabilities()` — runtime browser capability probe

## API

### `convert(input, options)`

```ts
import { convert, defaultRegistry } from '@webcvt/core';

const result = await convert(inputBlob, {
  format: 'webp',       // target format (extension string or FormatDescriptor)
  quality: 0.85,        // quality hint 0-1 (codec-specific meaning)
  onProgress: (p) => console.log(p.percent),
  signal: abortController.signal,
});

console.log(result.blob);              // output Blob
console.log(result.durationMs);        // conversion time
console.log(result.backend);           // 'canvas' | 'webcodecs' | 'ffmpeg-wasm' | …
console.log(result.hardwareAccelerated);
```

### `detectFormat(blob)`

```ts
import { detectFormat } from '@webcvt/core';

const format = await detectFormat(myBlob);
console.log(format?.mime);  // e.g. 'image/png'
console.log(format?.ext);   // e.g. 'png'
```

### `BackendRegistry`

```ts
import { BackendRegistry, defaultRegistry } from '@webcvt/core';

// Use the shared default registry
defaultRegistry.register(new MyBackend());

// Or create an isolated registry
const registry = new BackendRegistry();
registry.register(new MyBackend());
```

### `detectCapabilities()`

```ts
import { detectCapabilities } from '@webcvt/core';

const caps = await detectCapabilities();
console.log(caps.webcodecs);    // true | false
console.log(caps.offscreenCanvas);
console.log(caps.sharedArrayBuffer);
```

### Types

```ts
import type {
  FormatDescriptor,
  ConvertOptions,
  ConvertResult,
  Backend,
  ProgressEvent,
  HardwareAcceleration,
  Category,
} from '@webcvt/core';
```

### Error classes

```ts
import { WebcvtError, UnsupportedFormatError, NoBackendError } from '@webcvt/core';
```

| Class | Code | When thrown |
|---|---|---|
| `WebcvtError` | _(base class)_ | Never thrown directly — base for all webcvt errors |
| `UnsupportedFormatError` | `UNSUPPORTED_FORMAT` | Input or output format is not recognized |
| `NoBackendError` | `NO_BACKEND` | No registered backend can handle the input→output pair |

## Source

[packages/core/src](https://github.com/Junhui20/webcvt/tree/main/packages/core/src)
