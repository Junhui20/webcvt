# @catlabtech/webcvt-container-aac

> ADTS-wrapped AAC container parser for webcvt.

## Installation

```bash
npm i @catlabtech/webcvt-container-aac
```

## API

Detailed API reference coming in v0.2. See the [source code](https://github.com/Junhui20/webcvt/tree/main/packages/container-aac/src) for now.

## Notes

Parses ADTS (Audio Data Transport Stream) frame headers and validates AAC bitstreams. Used internally by `@catlabtech/webcvt-container-mp4` for raw AAC track extraction. Encoding requires `@catlabtech/webcvt-codec-webcodecs` or `@catlabtech/webcvt-backend-wasm`.
