# @webcvt/image-animation

> Animated image format support for webcvt: GIF, APNG, and animated WebP.

## Installation

```bash
npm i @webcvt/image-animation
```

## Supported formats

| Format | Decode | Encode |
|---|---|---|
| GIF | yes | yes |
| APNG | yes | yes |
| Animated WebP | yes | yes |

## API

Detailed API reference coming in v0.2. See the [source code](https://github.com/Junhui20/webcvt/tree/main/packages/image-animation/src) for now.

## Notes

Pure TypeScript — no WASM required. Implements full LZW decode/encode for GIF, DEFLATE-based APNG, and RIFF/VP8X WebP animation containers.
