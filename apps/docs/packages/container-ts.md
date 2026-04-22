# @catlabtech/webcvt-container-ts

> MPEG-2 Transport Stream (.ts) container parser for webcvt.

## Installation

```bash
npm i @catlabtech/webcvt-container-ts
```

## API

Detailed API reference coming in v0.2. See the [source code](https://github.com/Junhui20/webcvt/tree/main/packages/container-ts/src) for now.

## Notes

Parses MPEG-2 TS packets (188-byte), PAT/PMT tables, and elementary stream PID demuxing. Single-program streams only. Scrambled (encrypted) streams are not supported. Encoding (TS muxing) is not yet implemented.
