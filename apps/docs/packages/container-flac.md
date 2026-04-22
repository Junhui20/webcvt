# @catlabtech/webcvt-container-flac

> FLAC (Free Lossless Audio Codec) container parser for webcvt.

## Installation

```bash
npm i @catlabtech/webcvt-container-flac
```

## API

Detailed API reference coming in v0.2. See the [source code](https://github.com/Junhui20/webcvt/tree/main/packages/container-flac/src) for now.

## Notes

Parses FLAC stream info metadata, VORBIS_COMMENT, and PICTURE blocks. Decoding raw FLAC frames requires `@catlabtech/webcvt-backend-wasm` or `@catlabtech/webcvt-codec-webcodecs`. FLAC encoding is not yet implemented in pure TypeScript (planned for v0.2).
