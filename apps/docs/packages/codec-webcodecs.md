# @webcvt/codec-webcodecs

Thin adapter over the W3C [WebCodecs API](https://www.w3.org/TR/webcodecs/). Provides a uniform `encode` / `decode` surface that higher-level container packages (`@webcvt/container-mp4`, `@webcvt/container-webm`, etc.) depend on to produce and consume raw video frames and audio data.

This package does **not** implement any codec logic — it delegates entirely to the browser's hardware-accelerated codec stack. Its job is to wrap the raw WebCodecs API with ergonomic TypeScript types, consistent error classes, and a `probeCodec()` helper for capability detection.

## Installation

```bash
npm i @webcvt/codec-webcodecs
```

## API surface

```ts
import {
  probeVideoCodec,
  probeAudioCodec,
  WebCodecsVideoEncoder,
  WebCodecsVideoDecoder,
  WebCodecsAudioEncoder,
  WebCodecsAudioDecoder,
  WebCodecsNotSupportedError,
  UnsupportedCodecError,
} from '@webcvt/codec-webcodecs';

// Probe capability
const result = await probeVideoCodec({ codec: 'h264', width: 1920, height: 1080 });
if (!result.supported) throw new UnsupportedCodecError('h264');

// Encode
const enc = new WebCodecsVideoEncoder(
  { config: { codec: 'avc1.42001E', width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 } },
  (chunk, meta) => { /* forward chunk to muxer */ },
);
enc.encode(videoFrame);
await enc.flush();
enc.close();
```

## Browser support

Requires the [WebCodecs API](https://caniuse.com/webcodecs) (Chrome 94+, Edge 94+). Falls back to `@webcvt/backend-wasm` automatically when unavailable if both backends are registered.

## Source

[packages/codec-webcodecs/src](https://github.com/Junhui20/webcvt/tree/main/packages/codec-webcodecs/src)
