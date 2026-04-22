# @catlabtech/webcvt-container-mp4

> MP4/M4A container parser and muxer for webcvt.

## Installation

```bash
npm i @catlabtech/webcvt-container-mp4
```

## API

Detailed API reference coming in v0.2. See the [source code](https://github.com/Junhui20/webcvt/tree/main/packages/container-mp4/src) for now.

## Supported operations

- Parse MP4/M4A files (moov, trak, mdat boxes)
- Mux H.264 / H.265 / AV1 video + AAC audio
- Read and write fragmented MP4 (fMP4)

Works with `@catlabtech/webcvt-codec-webcodecs` for hardware-accelerated encode/decode, and falls back to `@catlabtech/webcvt-backend-wasm` for unsupported codecs.
