# @webcvt/container-aac

> ADTS-wrapped AAC container parser for webcvt.

## Installation

```bash
npm i @webcvt/container-aac
```

## API

Detailed API reference coming in v0.2. See the [source code](https://github.com/Junhui20/webcvt/tree/main/packages/container-aac/src) for now.

## Notes

Parses ADTS (Audio Data Transport Stream) frame headers and validates AAC bitstreams. Used internally by `@webcvt/container-mp4` for raw AAC track extraction. Encoding requires `@webcvt/codec-webcodecs` or `@webcvt/backend-wasm`.
