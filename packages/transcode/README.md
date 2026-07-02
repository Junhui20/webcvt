# @catlabtech/webcvt-transcode

WebCodecs-first **audio** transcode backend for [webcvt](https://github.com/Junhui20/webcvt). Performs real cross-format audio conversion by chaining `demux → decode → encode → mux` over the container packages and the browser's WebCodecs codecs — no ffmpeg.wasm, no `SharedArrayBuffer`, no cross-origin isolation.

This is the "hardware path": WebCodecs runs in any secure context (HTTPS) and uses the platform's codecs. When a codec pair is unsupported at runtime (e.g. Safari < 26 has no `AudioEncoder`/`AudioDecoder`), `canHandle` returns `false` and routing falls through to the ffmpeg-wasm backend automatically.

## Install

```sh
npm install @catlabtech/webcvt-transcode
```

## Usage

Nothing registers on import — register explicitly (keeps the backend tree-shakeable):

```ts
import { convert } from '@catlabtech/webcvt-core';
import { registerTranscodeBackend } from '@catlabtech/webcvt-transcode';

registerTranscodeBackend(); // into core's defaultRegistry

const wav = await convert(mp3File, { format: 'wav' });
const opus = await convert(flacFile, { format: 'ogg', quality: 0.8 });
```

Register into a custom registry and unregister by name:

```ts
import { BackendRegistry } from '@catlabtech/webcvt-core';
const registry = new BackendRegistry();
registerTranscodeBackend(registry);
registry.unregister('webcodecs-transcode');
```

## v1 audio matrix

**Inputs (decodable):** wav (PCM), mp3, aac (ADTS), flac, opus-in-ogg.
**Outputs:** wav, opus-in-ogg, opus-in-webm, aac (ADTS), flac.

| To → | Path |
|---|---|
| **wav** | decode → interleave int16 PCM → `serializeWav` (no encoder needed) |
| **ogg / opus** | Opus encode → `serializeOgg` (OpusHead identification packet) |
| **webm** | Opus encode → `serializeWebm` (OpusHead as `CodecPrivate`, cluster-split for int16 deltas) |
| **aac** | encoder-native ADTS (`aac: { format: 'adts' }`) → concatenate frames |
| **flac** | FLAC encode (Chromium; probe-gated) → `description ++ frames` |

Off-matrix by design → routed to ffmpeg-wasm: `→ mp3` (no WebCodecs MP3 encoder), `→ ogg(vorbis)` (no Vorbis encoder), `→ mp4/m4a` (no from-scratch mp4 muxer yet), and all video.

## `canHandle` — two-stage, cached

1. **Static matrix gate** — O(1) reject for any off-matrix pair, with no probing.
2. **Concrete codec probe** — `AudioDecoder.isConfigSupported` for the input codec **and** `AudioEncoder.isConfigSupported` for the output codec. Only both-supported → `true`. A missing WebCodecs global is treated as `false` (never throws).
3. **Per-session cache** — probe results are memoised, so repeated registry lookups don't re-probe.

## Options

- `quality` (0–1, default 0.7) → bitrate ladder. Opus/AAC stereo land on **128 kbps at q0.7**; ends at 64→256 kbps (Opus) / 96→256 kbps (AAC). Mono ≈ 0.6×.
- `codec` — accepted; the audio targets here have a fixed codec per container.
- `signal` — abort via `AbortSignal`; in-flight codecs are `close()`-d.
- `onProgress` — four weighted phases: `demux` (0–10%), `decode` (10–45%), `encode` (45–90%), `mux` (90–100%), then `done` at 100%.

## Limits

Buffer-all (every serializer takes a complete in-memory model): input is capped at **256 MiB**. mp4/m4a/webm/mkv audio-track inputs and video transcoding are handled by later stages.

## License

MIT
