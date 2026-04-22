# @catlabtech/webcvt-image-svg

> SVG parsing, safety-checking, and rasterization for webcvt.

## Installation

```bash
npm i @catlabtech/webcvt-image-svg
```

## API

Detailed API reference coming in v0.2. See the [source code](https://github.com/Junhui20/webcvt/tree/main/packages/image-svg/src) for now.

## Features

- Parse and validate SVG markup
- Strip unsafe content (scripts, external references, `<foreignObject>`)
- Rasterize SVG to PNG, JPG, or WebP via `OffscreenCanvas`

## Usage

```ts
import { SvgBackend } from '@catlabtech/webcvt-image-svg';
import { defaultRegistry, convert } from '@catlabtech/webcvt-core';

defaultRegistry.register(new SvgBackend());

const result = await convert(svgBlob, { format: 'png' });
```

## Security note

The SVG sanitizer rejects inline `<script>`, `javascript:` URLs, external stylesheet references, and `<foreignObject>` elements. This makes it safe to rasterize user-provided SVGs.
