# @webcvt/container-webm

> WebM container parser and muxer for webcvt.

## Installation

```bash
npm i @webcvt/container-webm
```

## API

Detailed API reference coming in v0.2. See the [source code](https://github.com/Junhui20/webcvt/tree/main/packages/container-webm/src) for now.

## Notes

WebM is a subset of Matroska (MKV) using VP8/VP9/AV1 video and Vorbis/Opus audio. This package uses `@webcvt/ebml` for low-level parsing. Works with `@webcvt/codec-webcodecs` for hardware-accelerated VP9 and AV1 encode/decode.
