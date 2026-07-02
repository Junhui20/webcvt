# transcode backend design

> Implementation reference for a new `@catlabtech/webcvt-transcode` package: a
> WebCodecs-first backend that performs real cross-format audio/video
> conversion (mp4→webm, wav→opus, …) by chaining `demux → decode → encode →
> mux` over the existing container packages and `codec-webcodecs`. This note is
> a DESIGN ONLY — no source lands with it. Its value is precision about what the
> shipped packages can and cannot do TODAY, so the implementation carries zero
> guesswork.
>
> Every capability claim below is cited to `file:line` in the current tree. A
> "needs verification during Stage N" list at the end captures the honest
> unknowns rather than papering over them.

## Where this sits

Today every `container-*` backend is **identity-only**: it parses a container,
re-serialises the same bytes, and throws `*EncodeNotImplementedError` for any
non-identity output (`packages/core/src/round-trip-backend.ts:163-164`).
Cross-format conversion is entirely delegated to `@catlabtech/webcvt-backend-wasm`
(ffmpeg.wasm) at priority `-10` (`packages/backend-wasm/src/backend.ts:48`).
ffmpeg.wasm works but is heavy: ~30 MB lazy download, and its fast multi-thread
core requires `SharedArrayBuffer`, which requires cross-origin isolation
(COOP/COEP) that most static hosts do not set.

The transcode backend is the "hardware path" the whole architecture was built
for: `plan.md:70` — *"Hardware-accelerated — WebCodecs first, ffmpeg.wasm
fallback only when needed."* It reuses the demuxers/muxers we already shipped
and the `codec-webcodecs` adapter, adding only the orchestration glue between
them.

### Why WebCodecs is worth a dedicated backend

- **No cross-origin isolation required.** WebCodecs runs in any secure context
  (HTTPS). It needs COOP/COEP only if you also use `SharedArrayBuffer`, which we
  do not. This is the headline advantage over multi-threaded ffmpeg.wasm, which
  is stuck on single-thread wherever COOP/COEP is absent.
- **Hardware acceleration** for video decode/encode where the platform offers
  it (`probeVideoCodec` surfaces `hardwareAccelerated`,
  `packages/codec-webcodecs/src/probe.ts:123`).
- **Tiny bundle**: no wasm blob — just the container parsers we already ship.

### Browser-support reality (gates the matrix)

- **Chromium (Chrome/Edge 94+)**: full WebCodecs — video + audio, encode +
  decode. The primary target.
- **Safari 16.4 – 18.7**: **video-only** WebCodecs. `AudioEncoder` /
  `AudioDecoder` are **absent**, so every audio transcode path must
  runtime-probe and fall through to ffmpeg-wasm on these versions.
- **Safari 26+**: full WebCodecs incl. audio.
- **Firefox**: WebCodecs shipping; treat audio encode as probe-gated.
- **MP3 ENCODE does not exist in WebCodecs on any browser.** `→ mp3` always
  routes to ffmpeg-wasm. (Decode of MP3 exists; encode never.)
- **Vorbis ENCODE does not exist in WebCodecs.** `→ ogg(vorbis)` routes to
  ffmpeg-wasm; our Opus paths are unaffected.

Because support is per-codec and per-runtime, `canHandle` MUST be async and
MUST call `isConfigSupported` for the concrete codec pair before claiming a
conversion. A static matrix is necessary but not sufficient.

## Scope statement

**In scope (v1, this package):** the `demux → decode → encode → mux` pipeline
for the conversions in the [v1 matrix](#v1-feasibility-matrix), a
`TranscodeBackend implements Backend`, async capability probing with per-session
caching, options→encoder-config mapping, four-phase progress, abort via
`options.signal`, and a Node-mockable test suite mirroring `codec-webcodecs`.

**Out of scope (v1, deferred):**

- **MP4 / M4A OUTPUT** — the mp4 muxer cannot build sample tables from raw
  frames (see [Mux audit](#c-mux-capability-audit)); needs a new from-scratch
  mp4 mux builder. Deferred to a later stage. Until then `→ mp4/m4a` stays on
  ffmpeg-wasm.
- **`→ mp3` and `→ ogg(vorbis)`** — no WebCodecs encoder exists. Permanent
  ffmpeg-wasm territory.
- **Legacy codecs** absent from WebCodecs (WMV3/Sorenson/RealVideo/AC-3/…) —
  ffmpeg-wasm only.
- **Streaming muxers.** Every serializer today is buffer-all (takes a complete
  in-memory model). v1 buffers; incremental cluster/page emission is future
  work (see [Memory strategy](#memory-strategy)).
- **Multi-hop planning.** The registry is single-hop by design
  (`packages/core/src/registry.ts:16-22`). One backend, one conversion.

## A. codec-webcodecs — the tools we build on

`packages/codec-webcodecs/src/` is a thin, well-tested adapter (81 tests, 98.8%
cov). The transcode package is its first real consumer. Exact surface:

### Wrapper classes

All four wrappers share the same shape: constructor takes `{ config }` plus an
output callback, calls `configure(config)` immediately, and exposes
`decode`/`encode`, `flush()`, `close()`, `state`, and queue-size getters.

| Class | Ctor | Feed | Output callback | File |
|---|---|---|---|---|
| `WebCodecsVideoDecoder` | `({config: VideoDecoderConfig}, onFrame)` | `decode(EncodedVideoChunk)` | `(frame: VideoFrame)` | `video-decoder.ts:34-55` |
| `WebCodecsVideoEncoder` | `({config: VideoEncoderConfig}, onChunk)` | `encode(VideoFrame, opts?)` | `(chunk, metadata)` | `video-encoder.ts:39-60` |
| `WebCodecsAudioDecoder` | `({config: AudioDecoderConfig}, onData)` | `decode(EncodedAudioChunk)` | `(data: AudioData)` | `audio-decoder.ts:34-55` |
| `WebCodecsAudioEncoder` | `({config: AudioEncoderConfig}, onChunk)` | `encode(AudioData)` | `(chunk, metadata)` | `audio-encoder.ts:37-58` |

Key behaviours the pipeline must respect:

- **Async error latching.** The `error` callback stores the failure; it is
  re-thrown on the *next* `decode`/`encode`/`flush` call, not at the failure
  site (`video-decoder.ts:45-52, 108-114`). The pipeline must call `flush()` and
  check for a throw at each phase boundary.
- **Encoders take frame ownership and always `close()` the input**, even on the
  error/closed paths (`video-encoder.ts:68-81`, `audio-encoder.ts:67-77`). So
  the pipeline must NOT reuse a `VideoFrame`/`AudioData` after handing it to
  `encode()`, and must `close()` any frame it decodes but chooses not to encode.
- **`close()` is idempotent** (`video-encoder.ts:96-101`).
- Constructors throw `WebCodecsNotSupportedError` when the global is absent
  (`video-decoder.ts:35-37`) — this is how the backend detects a runtime with no
  WebCodecs (Node without polyfill, old Safari for audio classes).

### How a caller supplies `description` (H.264 avcC, AAC ASC, OpusHead)

**There is no helper that builds a decoder config.** The caller passes a raw
`VideoDecoderConfig` / `AudioDecoderConfig` straight into the wrapper
constructor, and sets `description` itself. The container packages already
surface the exact bytes needed (see [Demux audit](#b-demux-capability-audit)):

```ts
// H.264 from MP4:
new WebCodecsVideoDecoder({ config: {
  codec: track.sampleEntry.entry.codecString,          // "avc1.640028" (precomputed)
  description: track.sampleEntry.entry.codecConfig.bytes, // verbatim avcC
  codedWidth, codedHeight,
} }, onFrame);

// AAC from MP4:
new WebCodecsAudioDecoder({ config: {
  codec: 'mp4a.40.2',
  description: track.sampleEntry.entry.decoderSpecificInfo, // AudioSpecificConfig
  sampleRate, numberOfChannels,
} }, onData);
```

### Probe surface — and the one gap

`probe.ts` exposes `probeVideoCodec(VideoProbeConfig)` and
`probeAudioCodec(AudioProbeConfig)` returning `ProbeResult { supported,
codecString, hardwareAccelerated, supportedConfig }` (`probe.ts:60-72, 101,
135`). Baseline codec strings are mapped at `probe.ts:20-34` (`h264:
avc1.42001E`, `vp9: vp09.00.10.08`, `vp8`, `av1: av01.0.04M.08`, `hevc`, `aac:
mp4a.40.2`, `opus`, `flac`, `vorbis`, `mp3`).

**GAP:** both probes wrap only the **encoder** side —
`VideoEncoder.isConfigSupported` (`probe.ts:118`) and
`AudioEncoder.isConfigSupported` (`probe.ts:150`). There is **no decoder probe
anywhere in the repo** (grep for `VideoDecoder.isConfigSupported` /
`AudioDecoder.isConfigSupported` returns nothing). A transcode backend must
probe BOTH sides of a pair (can I decode the input codec? can I encode the
output codec?). This is a small, well-scoped addition — see
[category 2](#category-2--small-additions-required).

### Error taxonomy

`WebCodecsNotSupportedError` (`WEBCODECS_NOT_SUPPORTED`), `UnsupportedCodecError`
(`UNSUPPORTED_CODEC`), `CodecOperationError` (`CODEC_OPERATION_ERROR`) — all
extend `WebcvtError` (`errors.ts:7, 23, 43`). The transcode package adds its own
`WebcvtError` subclasses for pipeline-level failures (see
[type defs](#type-definitions)).

### How the tests mock WebCodecs (determines OUR test strategy)

`codec-webcodecs` runs entirely under Node with no polyfill by
`vi.stubGlobal`-ing the four classes plus `isConfigSupported`:

- `vi.stubGlobal('VideoEncoder', MockClass)` where the mock captures
  `init.output` / `init.error` on construction so the test can drive callbacks
  manually (`video-encoder.test.ts:26-33, 63-69`).
- `isConfigSupported` is a `vi.fn()` resolving `{ supported, config }`
  (`probe.test.ts:48-52`).
- `vi.unstubAllGlobals()` in `afterEach` (`video-encoder.test.ts:49-51`).

The transcode package mirrors this exactly (see [Test strategy](#f-test-strategy-under-node)).

## B. Demux capability audit

Can we get, per container, the encoded frames + timestamps + codec-private data
needed to feed a WebCodecs decoder? **Yes for every input we care about.**

| Container | Frame/sample access | Timestamp | Keyframe | `description` source | Cite |
|---|---|---|---|---|---|
| mp4 (audio+video) | `iterateVideoSamples` / `iterateAudioSamples*` → `Mp4Sample{data,presentationTimeUs,durationUs,isKeyframe}` | µs | yes (stss) | avcC: `Mp4AvcConfig.bytes`; AAC: `Mp4AudioSampleEntry.decoderSpecificInfo`; codec string precomputed | `sample-iterator.ts:47-63, 635, 247`; `boxes/avcC.ts:41`; `boxes/hdlr-stsd-mp4a.ts:62`; `boxes/visual-sample-entry.ts:79` |
| webm | `iterateVideoChunks`→`{data,type,timestampUs}`; `iterateAudioChunks`→`{data,timestampUs}` | µs | yes (`type`) | `WebmVideoTrack.codecPrivate` / `WebmAudioTrack.codecPrivate` (OpusHead) | `block-iterator.ts:20-31, 46, 73`; `elements/tracks.ts:84, 101` |
| mkv | same generators; also derives `webcodecsCodecString` (`avc1.…`, `mp4a.40.2`) | µs | yes | `codecPrivate` (verbatim for AVC/HEVC/AV1/AAC/Opus; FLAC normalised) | `block-iterator.ts:44, 69`; `elements/tracks.ts:94, 105, 111, 126` |
| wav | `parseWav → WavFile{format, audioData}` — raw interleaved PCM (decode target, no codec) | — | n/a | `format{audioFormat,channels,sampleRate,bitsPerSample}` | `header.ts:79-105`; `parser.ts:38, 92` |
| mp3 | `parseMp3 → {frames: Mp3Frame[]}`, `Mp3Frame{header,data}` (full frame bytes) | **derive** from `samplesPerFrame/sampleRate` | key each | none needed (mp3) | `parser.ts:53`; `frame-header.ts:74-95` |
| flac | `parseFlac → {streamInfo, frames: FlacFrame[]}`, frame `data` = sync→CRC | `sampleNumber` per frame | key each | `FlacStreamInfo` (→ WebCodecs flac description) | `parser.ts:34, 75`; `frame.ts:30-43`; `streaminfo.ts:29` |
| aac (ADTS) | `parseAdts → {frames: AdtsFrame[]}`; strip 7/9-byte header for raw AU | **derive** | key each | `buildAudioSpecificConfig(header)` → 5-byte ASC | `parser.ts:50`; `serializer.ts:40`; `asc.ts:40` |
| ogg | `parseOgg → {streams:[{identification,comments,setup,packets:OggPacket[]}]}` | packet `granulePosition` | key each | `identification` = OpusHead / Vorbis ident (verbatim) | `parser.ts:53-74, 123`; `packet.ts:24-35` |

Notes / caveats:

- **mp3 and aac carry no explicit PTS.** The pipeline computes timestamps from
  `samplesPerFrame / sampleRate` (`frame-header.ts:88`) or the ADTS frame count.
  Trivial, but must be done — decoders want monotone `timestamp` on each chunk.
- **All audio parsers are eager** (return `frames[]`/`packets[]`, not
  generators). Only mp4 sample iteration is lazy. Fine for v1 (we buffer anyway).
- **mkv audio `codecPrivate` is normalised**: A_FLAC rewritten to canonical
  `fLaC` form, A_MPEG/L3 replaced with empty. AVC/HEVC/AV1/AAC/Opus/Vorbis pass
  through verbatim (`container-mkv/src/elements/tracks.ts:463, 555-582`).

## C. Mux capability audit

Can each serializer write a NEW file from a caller-constructed model (no prior
parse, no original bytes)? **This is the decisive question** — it separates
"ship now with zero container code" from "needs a new muxer." Answer per
container:

| Container | Serialize entry | From-scratch? | Evidence / caveat |
|---|---|---|---|
| **wav** | `serializeWav(WavFile)` `serializer.ts:52` | **YES, clean** | Needs only `format{audioFormat,channels,sampleRate,bitsPerSample}` + `audioData`; `blockAlign`/`byteRate` recomputed (`serializer.ts:105-106`). The ideal PCM sink. |
| **ogg** | `serializeOgg(OggFile)` `serializer.ts:58` | **YES** | Page-wraps arbitrary `packets`, emits BOS OpusHead + OpusTags pages from `identification`/`comments`, computes lacing + CRC. Plain interfaces; proven from-scratch by `serializer.test.ts:117`. Doc contract invites synthesised packets (`serializer.ts:53-57`). **Caveat:** no OpusHead/OpusTags *byte builder* in production — only `decodeOpusHead`/`decodeOpusTags` (`opus.ts:72, 145`). `preSkip`/`sampleRate`/`channels` are ignored on write; pre_skip must be baked into the OpusHead bytes. |
| **webm** | `serializeWebm(WebmFile)` `serializer.ts:56` | **YES** | Pure model→bytes: reads only `ebmlHeader/info/tracks/clusters`, **ignores `fileBytes`, `segmentPayloadOffset`, `cluster.fileOffset`**; rebuilds Cues + SeekHead. `encodeSimpleBlock` concatenates any `block.frames` bytes (`cluster.ts:300, 319, 363`). Audio `CodecPrivate` (OpusHead) written verbatim (`elements/tracks.ts:422`). **Caveats:** fill 3 type-required-but-dead fields with placeholders (`segmentPayloadOffset:0`, `fileBytes:empty`, `cluster.fileOffset:0`); caller owns cluster splitting so per-block delta fits int16 ticks (`cluster.ts:353`); WebM track numbers ≤127 (`cluster.ts:348`). |
| **mkv** | `serializeMkv(MkvFile)` `serializer.ts:53` | **YES** | Identical design to webm; track numbers >127 OK. **Caveats:** also fill `chapters:[]`, `tags:[]` placeholders — and note `serializeMkv` **drops chapters/tags** (never read); `webcodecsCodecString` on tracks is required by the type but ignored on write. |
| **flac** | `serializeFlac(FlacFile)` `serializer.ts:35` | **YES, given pre-encoded frames** | `encodeStreamInfo` builds STREAMINFO from fields (`streaminfo.ts:180`); requires `blocks[0].type===STREAMINFO` (`serializer.ts:39`); writes `frame.data` verbatim — does NOT encode FLAC. Usable only if WebCodecs FLAC encode yields frame bytes we can wrap (verify Stage 2). |
| **aac (ADTS)** | `serializeAdts(AdtsFile)` `serializer.ts:33` | **YES, with layout coupling** | `encodeAdtsHeader` rebuilds the header from fields (`header.ts:189`), BUT `serializeAdts` strips `data.subarray(headerSize)` (`serializer.ts:40`) — so each `frame.data` must be `[headerSize placeholder][AAC AU]`, or supply already-framed ADTS. Set `hasCrc:false` (no fresh-CRC path). |
| **mp3** | `serializeMp3(Mp3File)` `serializer.ts:30` | pure concatenator | Writes `frame.data` verbatim; only reads `header.version`. Moot — no WebCodecs MP3 encoder. |
| **mp4** | `serializeMp4(Mp4File)` `serializer.ts:67` | **NO (re-serialise only)** | Sample tables `stts/stsc/stsz/stco` and `mdat` are sourced from the parsed model / `fileBytes` (`serializer.ts:456-459, 533`). Box writers for `avc1/avcC` (verbatim) and `mp4a/esds` (constructed) DO exist, but there is **no code that synthesises sample tables from raw frames.** MP4 output needs a new from-scratch mux builder. |

**The mp4 backend's "audio-track projection"** (`container-mp4/src/backend.ts:58-67,
95-114`) is a red herring for muxing: it just filters a *parsed* multi-track
`Mp4File` down to its first audio track before re-serialising. It never builds
tables from samples and throws on fragmented input. It does not help us write a
new mp4.

### Consequence for the muxers

- **wav, ogg, webm, mkv are from-scratch capable with zero container changes.**
  We build the in-memory model in the transcode package and call `serializeX`.
- **The only truly missing muxer piece for our v1 audio targets is an
  OpusHead/OpusTags byte builder** (RFC 7845 §5.1). It is ~40 LOC and can live
  inside `@catlabtech/webcvt-transcode` (no need to touch container-ogg/webm), or
  be contributed to container-ogg as `encodeOpusHead`/`encodeOpusTags` — see
  [open questions](#open-questions--director-decisions-needed).
- **flac and aac work but with glue** (STREAMINFO assembly; ADTS placeholder
  prefix). Category 2.
- **mp4 output is a real new muxer** (sample-table builder). Deferred.

## D. v1 feasibility derivation

Combining A (codecs WebCodecs can encode), B (demuxers), and C (muxers):

**WebCodecs encoders available (probe-gated):** video — H.264, VP8, VP9, AV1,
HEVC(partial); audio — Opus, AAC, FLAC(Chromium). **No** MP3, **no** Vorbis
encoder anywhere.

### Category 1 — v1-ready (zero new container code)

1. **anything-audio → wav (PCM).** Decode → interleave `AudioData` planes to an
   int16/float `Uint8Array` → `serializeWav`. The easiest, highest-value win and
   the universal decode sink. Sources: mp3, flac, aac, ogg(opus/vorbis),
   m4a(aac), and the audio track of mp4/webm/mkv.
2. **audio → opus-in-ogg.** Decode → `WebCodecsAudioEncoder{codec:'opus'}` →
   build `OggLogicalStream{identification:OpusHead, comments:OpusTags,
   packets}` → `serializeOgg`. Needs the OpusHead/OpusTags builder (Cat 2, tiny).
3. **audio → opus-in-webm.** Decode → Opus encode → build `WebmAudioTrack`
   (OpusHead in `codecPrivate`) + clusters → `serializeWebm`. Same builder.
4. **video → webm/mkv (VP9/VP8 + Opus)** — incl. the flagship **mp4(H.264+AAC)
   → webm(VP9+Opus)**. Demux mp4 (avcC/ASC descriptions) → decode H.264 + AAC →
   encode VP9/VP8 + Opus → `serializeWebm`/`serializeMkv`. Muxer is ready; this
   is where hardware acceleration pays off most.

### Category 2 — small additions required

| Item | What's needed | Size | Where |
|---|---|---|---|
| Decoder probes | `probeVideoDecoder` / `probeAudioDecoder` wrapping `VideoDecoder.isConfigSupported` / `AudioDecoder.isConfigSupported` (absent today) | ~40 LOC | `codec-webcodecs` |
| OpusHead/OpusTags builders | Byte-assemble per RFC 7845 §5.1 (only decoders exist: `opus.ts:72, 145`) | ~40 LOC | transcode pkg or container-ogg |
| **→ aac (ADTS)** | AAC encode → wrap raw AU. Either prepend a `headerSize` placeholder so `serializeAdts` (`serializer.ts:40`) accepts it, OR configure `AudioEncoder` with `aac:{format:'adts'}` and concat. `hasCrc:false`. | small glue | transcode pkg |
| **→ flac** | FLAC encode (Chromium) → build STREAMINFO via `encodeStreamInfo` + wrap frames verbatim. Verify WebCodecs FLAC chunk→frame mapping. | small, **verify** | transcode pkg |

### Category 3 — out of scope for v1

| Target | Why | Route |
|---|---|---|
| **→ mp4 / m4a** (incl. webm→mp4) | mp4 muxer can't build sample tables from raw frames (`serializer.ts:456-459`). Needs a new from-scratch mp4 mux builder (`stts/stsc/stsz/stco`+`mdat`, using existing `avc1/avcC` + `mp4a/esds` writers). H.264 + AAC *encode* exist in WebCodecs, so this is muxer-limited, not codec-limited. | ffmpeg-wasm now; own stage later |
| **→ mp3** | No WebCodecs MP3 encoder anywhere | ffmpeg-wasm (permanent) |
| **→ ogg(vorbis)** | No WebCodecs Vorbis encoder | ffmpeg-wasm (permanent) |
| Audio transcodes on Safari <26 | No `AudioEncoder`/`AudioDecoder` | probe fails → ffmpeg-wasm |
| Legacy codecs (WMV/AC-3/…) | Not in WebCodecs | ffmpeg-wasm |

## E. Architecture

### Package placement — recommend a NEW package `@catlabtech/webcvt-transcode`

Recommend a new package, **not** extending `codec-webcodecs`. Reasons:

- **Dependency direction.** The transcode backend must import
  `codec-webcodecs` *and* the container packages it muxes/demuxes (wav, ogg,
  webm, mkv, mp4, mp3, flac, aac). `codec-webcodecs` is a leaf adapter that must
  stay dependency-free of containers so any single container can use it in
  isolation. Putting orchestration in `codec-webcodecs` would invert that and
  create a hub that pulls in every container. **None of codec-webcodecs or the
  container packages may depend on transcode; transcode depends on them.**
- **Tree-shaking / opt-in.** Same rule as every other backend: no
  auto-registration; a consumer who only wants wav↔wav identity should never
  pull the webm muxer. A dedicated package with `registerTranscodeBackend()`
  keeps the graph honest.
- **Single responsibility.** `codec-webcodecs` stays a thin, 98.8%-covered
  codec adapter. Pipeline logic (buffering, timestamp math, cluster splitting,
  progress, abort) lives apart.

Dependencies:

```json
{
  "dependencies": {
    "@catlabtech/webcvt-core": "workspace:*",
    "@catlabtech/webcvt-codec-webcodecs": "workspace:*",
    "@catlabtech/webcvt-container-wav": "workspace:*",
    "@catlabtech/webcvt-container-ogg": "workspace:*",
    "@catlabtech/webcvt-container-webm": "workspace:*",
    "@catlabtech/webcvt-container-mkv": "workspace:*",
    "@catlabtech/webcvt-container-mp4": "workspace:*",
    "@catlabtech/webcvt-container-mp3": "workspace:*",
    "@catlabtech/webcvt-container-flac": "workspace:*",
    "@catlabtech/webcvt-container-aac": "workspace:*"
  }
}
```

(Container deps can be tightened to only those a given stage needs; Stage 1
needs just wav + the audio demuxers.)

### The backend — `TranscodeBackend implements Backend`

```ts
export class TranscodeBackend implements Backend {
  readonly name = 'webcodecs-transcode';
  readonly priority = 0; // see "Priority & routing"
  canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean>;
  convert(input: Blob, output: FormatDescriptor, options: ConvertOptions): Promise<ConvertResult>;
}
export function registerTranscodeBackend(registry?: BackendRegistry): TranscodeBackend;
```

**Async `canHandle` (two-stage + cache):**

1. **Static matrix gate.** A frozen table keyed by `${input.category}` +
   `${input.mime}→${output.mime}` listing the pairs from the v1 matrix. Cheap
   O(1) reject for anything off-matrix (e.g. `→ mp3`, `→ mp4` in v1). Also
   rejects if `output.mime` needs an encoder we do not have.
2. **Concrete codec probe.** For the surviving pair, resolve the input codec
   (from container detection) and output codec (from `output` + `options.codec`)
   and call `probe{Video,Audio}Decoder(inputCodec)` **and**
   `probe{Video,Audio}Encoder(outputCodec)`. Only both-supported → `true`. This
   is what makes Safari-audio and no-WebCodecs runtimes fall through cleanly. A
   thrown `WebCodecsNotSupportedError` from a probe is caught and treated as
   `false`.
3. **Per-session cache.** Memoise probe results in a `Map<string, boolean>`
   keyed by the resolved codec config string, cleared never within a session
   (codec support does not change at runtime). `canHandle` is called for every
   registry lookup, so this avoids redundant `isConfigSupported` round-trips.

**Priority & routing (priority = 0, with one caveat to resolve).** Default
`priority` is `0` (`packages/core/src/types.ts:74`); `findFor` sorts descending,
ties by registration order (`registry.ts:45-53`). At `0` the transcode backend
beats ffmpeg-wasm (`-10`) for every pair it accepts, and falls through to
ffmpeg-wasm for everything it rejects — exactly the intended layering.

Overlap with the identity containers is *almost* nil, because they are
identity-gated:

- `strict-identity` containers (ogg, webm, mkv, mp4, ts) only claim
  `input.mime === output.mime` (`round-trip-backend.ts:120`) — e.g. ogg→ogg.
  No cross-format overlap.
- `identity-set` containers (wav, flac, aac) only claim outputs inside their own
  MIME set (`round-trip-backend.ts:122`) — wav→wav, flac→flac. No overlap.

**The one exception is container-mp3**, whose backend over-claims:
`acceptsOutput: (_input, output) => output.category === 'audio'`
(`packages/container-mp3/src/backend.ts:47`). That makes it return `canHandle =
true` for `mp3 → opus/wav/flac/aac` — then `convert` throws
`encodeNotImplemented`. At equal priority `0`, registration order would decide,
and if container-mp3 registered first, `mp3 → opus` would **throw instead of
transcoding.** This must be resolved before Stage 1 ships (see
[open questions](#open-questions--director-decisions-needed)). The clean fix is
to narrow container-mp3's `acceptsOutput` back to identity now that a real
decode backend exists (the comment at `backend.ts:46` calls it "the future
decode path" — this backend *is* that future). The analogous
"widen canHandle … once WebCodecs decode is wired" TODOs in container-flac
(`backend.ts:18`) and container-aac (`backend.ts:22`) should be **left
un-actioned** — the transcode backend supersedes them.

### Options mapping (`ConvertOptions` → encoder config)

`ConvertOptions` gives us `quality?: number (0–1)`, `codec?: string`,
`hardwareAcceleration?` (`packages/core/src/types.ts:36-56`). Mapping:

- **Output codec** = `options.codec` if set, else the container default
  (opus for ogg/webm-audio; vp9 for webm/mkv-video; aac for m4a-later).
- **`quality` → bitrate ladder** (default `quality = 0.7`, mid-ladder):

| Codec | Bitrate at quality 0.7 | Ladder (q 0→1) | Notes |
|---|---|---|---|
| Opus (stereo) | 128 kbps | 64 → 256 kbps | 48 kHz internal; mono ~0.6× |
| AAC-LC (stereo) | 128 kbps | 96 → 256 kbps | `mp4a.40.2` |
| FLAC | n/a (lossless) | maps to compression 0–8 if exposed | verify Stage 2 |
| VP9 | 720p≈3 Mbps | scale ±40% by q; ladder 360p .75 / 480p 1.5 / 720p 3 / 1080p 6 Mbps | resolution-driven |
| VP8 | ≈1.3× VP9 | same shape | fallback when VP9 unsupported |
| AV1 | ≈0.7× VP9 | same shape | probe-gated, software = slow |
| H.264 (mp4, later) | 720p≈4 Mbps | resolution ladder | `avc1.640028` |

- **`hardwareAcceleration`** maps to `VideoEncoderConfig.hardwareAcceleration`
  (`no`→`prefer-software`, `preferred`/`required`→`prefer-hardware`,
  `auto`→`no-preference`), fed through the probe first.
- Video geometry (`codedWidth/Height`, `framerate`) comes from the demuxed
  track; the encoder mirrors the source unless a resize option is added later.

### Progress reporting (four phases)

`ProgressEvent` carries `percent` + optional `phase`
(`packages/core/src/types.ts:23-32`). Emit monotone percent across four
weighted phases (video-heavy vs audio-only weighting differs):

| Phase | `phase` label | Audio-only weight | Video weight |
|---|---|---|---|
| Demux | `"demux"` | 0–10% | 0–5% |
| Decode | `"decode"` | 10–45% | 5–35% |
| Encode | `"encode"` | 45–90% | 35–90% |
| Mux | `"mux"` | 90–100% | 90–100% |

Terminal event is always `{ percent: 100, phase: 'done' }`, matching the
container convention (`round-trip-backend.ts:150`). Within decode/encode,
interpolate by `samplesProcessed / totalSamples` (known for wav/flac/aac/mp3
frame counts; for mp4/webm use the demuxed sample count).

### Memory strategy

**Recommend streaming where possible, but be honest: the muxers force buffer-all
today.** Every `serializeX` takes a *complete* in-memory model (`serializeWebm(file)`,
`serializeOgg(file)`, `serializeWav(file)`) — none exposes an incremental
"append cluster/page" API. And the audio demuxers are eager arrays anyway. So v1
is **bounded buffer-all**:

- Decode→encode can still be pipelined chunk-by-chunk (feed the decoder, encode
  each frame as it emerges, `close()` frames promptly to release GPU surfaces),
  but the *encoded* output accumulates into the model before a single
  `serializeX` call.
- Cap input via each container's existing `MAX_INPUT_BYTES` guard (mirrored in
  the backend before reading the Blob, as `round-trip-backend.ts:135` does).
- Peak memory ≈ input + decoded PCM/frames (transient, released as encoded) +
  encoded output. For video this can be large; document a conservative input cap
  and revisit with a streaming muxer later.

**Future work:** add incremental `serializeCluster`/`writePage` entry points to
webm/ogg so video transcodes stream cluster-by-cluster. Out of scope for v1;
noted so the buffer-all decision is deliberate, not accidental.

### Abort (`options.signal`)

- Check `options.signal?.aborted` before each phase and inside the
  decode/encode loop between chunks; throw `DOMException('Aborted','AbortError')`.
- On abort (or any error) `close()` all open decoders/encoders in a `finally` so
  no GPU surface leaks (the wrappers are idempotent, `video-encoder.ts:96-101`).
- Register a `signal` listener that closes codecs mid-flight to unblock a
  pending `flush()`.

## Type definitions

```ts
// Pipeline-level errors (extend WebcvtError, matching codec-webcodecs).
export class TranscodeUnsupportedError extends WebcvtError {}   // 'TRANSCODE_UNSUPPORTED'
export class TranscodeDemuxError extends WebcvtError {}         // 'TRANSCODE_DEMUX_FAILED'
export class TranscodeCodecError extends WebcvtError {}         // wraps CodecOperationError
export class TranscodeMuxError extends WebcvtError {}           // 'TRANSCODE_MUX_FAILED'

export interface TranscodePair { readonly from: string; readonly to: string; }
export const TRANSCODE_MATRIX: ReadonlySet<string>;             // "inMime|outMime" keys

export class TranscodeBackend implements Backend { /* see above */ }
export function registerTranscodeBackend(registry?: BackendRegistry): TranscodeBackend;
```

## File map (proposed, Stage-incremental)

| File | Purpose | Stage |
|---|---|---|
| `index.ts` | Barrel + `registerTranscodeBackend` | 0 |
| `backend.ts` | `TranscodeBackend`: matrix gate + probe + dispatch | 0 |
| `matrix.ts` | Static v1 pair table + codec resolution | 0 |
| `probe-cache.ts` | Per-session `isConfigSupported` memoisation | 0 |
| `errors.ts` | Typed `WebcvtError` subclasses | 0 |
| `pipeline/audio-to-pcm.ts` | decode → interleave → `serializeWav` | 1 |
| `pipeline/decode.ts` | shared demux→decode driver (per container) | 1 |
| `pcm.ts` | `AudioData` planar→interleaved int16/float | 1 |
| `mux/opus-head.ts` | `buildOpusHead` / `buildOpusTags` (RFC 7845) | 2 |
| `pipeline/audio-to-opus.ts` | encode Opus → ogg / webm mux | 2 |
| `pipeline/audio-to-aac.ts`, `pipeline/audio-to-flac.ts` | Cat-2 audio targets | 2 |
| `mux/webm-builder.ts` | model builder (placeholder fields, cluster splitting) | 3 |
| `pipeline/video-transcode.ts` | mp4/webm/mkv video → webm/mkv | 3 |

Plus, in **`codec-webcodecs`**: add `probeVideoDecoder` / `probeAudioDecoder`
(Stage 0).

## F. Test strategy (under Node)

Mirror `codec-webcodecs`: no real WebCodecs, everything `vi.stubGlobal`-ed.

**What we mock:**

- `VideoDecoder`/`AudioDecoder`: mock class capturing `init.output`/`init.error`;
  a test-driven `decode()` synthesises `AudioData`/`VideoFrame`-shaped objects
  and invokes the output callback; `isConfigSupported` → `{supported:true}`.
- `VideoEncoder`/`AudioEncoder`: mock captures callbacks; `encode()` emits a
  synthetic `EncodedAudioChunk`/`EncodedVideoChunk` (a `{copyTo, byteLength,
  type, timestamp}` stub); `flush()` resolves.
- Real container parsers/serializers run **unmocked** (they are pure and
  Node-safe) — so the mux/demux glue is exercised against real byte output.

**What integration (browser / playground manual path) covers:** real
hardware decode/encode correctness, actual `isConfigSupported` per platform,
Safari-audio fallthrough, output playability. Gated behind a
`WEBCVT_ENABLE_WEBCODECS_INTEGRATION` flag like backend-wasm's nightly
(`docs/design-notes/backend-wasm.md:245`).

**Named v1 test cases:**

- `canHandle rejects off-matrix pair (mp3→mp4) without probing`
- `canHandle rejects when decoder isConfigSupported=false (Safari audio sim)`
- `canHandle rejects when encoder isConfigSupported=false`
- `canHandle caches probe result across repeated calls (one isConfigSupported)`
- `canHandle returns false (not throws) when WebCodecs global absent`
- `wav sink: decoded AudioData interleaves to correct int16 PCM + WAV header`
- `mp3 → wav produces RIFF/WAVE with fmt+data and right sampleRate/channels`
- `flac → wav / aac → wav / ogg(opus) → wav end-to-end (mocked decode)`
- `buildOpusHead emits RFC 7845 magic + version + channels + pre_skip`
- `buildOpusTags emits valid OpusTags packet`
- `audio → opus-in-ogg: serializeOgg round-trips through parseOgg`
- `audio → opus-in-webm: OpusHead lands in WebmAudioTrack.codecPrivate`
- `webm builder splits clusters so per-block delta stays within int16`
- `mp4(h264) → webm(vp9): video chunks carry avcC description to decoder`
- `progress emits monotone percent across demux/decode/encode/mux then done:100`
- `abort mid-encode closes all codecs and rejects with AbortError`
- `codec/quality options map to expected encoder bitrate (opus 128k @ q0.7)`

## G. Phased implementation plan

**Stage 0 — Scaffold + capability.** New package, `TranscodeBackend` skeleton,
`matrix.ts`, probe cache; add `probeVideoDecoder`/`probeAudioDecoder` to
codec-webcodecs. **Accept:** `canHandle` correctly gates the static matrix and
both-sided probes (all mocked); registers/unregisters cleanly; no real codec
work yet.

**Stage 1 — audio → wav (decode-to-PCM).** The universal sink.
mp3/flac/aac/ogg/m4a and mp4/webm/mkv audio tracks → wav via decode → interleave
→ `serializeWav`. Resolve the **container-mp3 `acceptsOutput` overlap** first.
**Accept:** each source produces a valid PCM WAV in unit tests (mocked decode);
playground manual check on Chromium plays back correctly; Safari falls through to
ffmpeg-wasm.

**Stage 2 — opus + aac (+ flac).** OpusHead/OpusTags builder; audio → opus-in-ogg
and opus-in-webm; audio → aac(adts). FLAC output if WebCodecs FLAC encode
verifies. **Accept:** `serializeOgg`/`serializeWebm` output re-parses cleanly;
Opus pre_skip correct; ADTS output plays; flac gated on probe.

**Stage 3 — video: mp4(h264) → webm(vp9/vp8 + opus).** Demux both tracks →
decode → encode → `serializeWebm` (webm-builder handles cluster splitting +
placeholder fields). **Accept:** flagship mp4→webm produces a playable file on
Chromium; A/V stay in sync; hardware path confirmed via `hardwareAccelerated`.

**Stage 4 — playground wiring behind a capability check.** Follow
`apps/playground/src/backend-loader.ts:23-30` `tryRegister` pattern; add
transcode targets to `BACKEND_ALLOWLIST` only after a runtime WebCodecs +
`isConfigSupported` check, so unsupported browsers never advertise a target that
would fail. **Accept:** targets appear only when actually supported; otherwise
the existing ffmpeg-wasm target still shows.

**Stage 5 (deferred) — mp4/m4a OUTPUT.** New from-scratch mp4 mux builder
(sample-table + mdat synthesis) reusing existing `avc1/avcC`/`mp4a/esds` writers.
Unlocks `→ m4a`, `→ mp4`, and `webm → mp4`.

## Open questions / director decisions needed

1. **container-mp3 routing conflict (blocking Stage 1).** Its backend claims
   `canHandle` for `mp3 → any-audio` but throws on convert
   (`container-mp3/src/backend.ts:47`). Preferred fix: **narrow its
   `acceptsOutput` back to identity now** so transcode at priority `0` wins
   cleanly. Alternative: give `TranscodeBackend` `priority = 1`. Which?
2. **OpusHead/OpusTags builder location.** Put `buildOpusHead`/`buildOpusTags`
   inside `@catlabtech/webcvt-transcode`, or contribute them to container-ogg (and
   reuse for webm `codecPrivate`)? The latter is more reusable but edits a
   shipped package.
3. **FLAC encode reality.** Confirm `AudioEncoder{codec:'flac'}` is supported on
   our target Chromium and that its output chunks wrap cleanly into
   `FlacFrame.data` + a `serializeFlac` STREAMINFO. If flaky, drop `→ flac` from
   v1.
4. **Backend name string.** `"webcodecs-transcode"` proposed; confirm it does
   not collide and reads well in `ConvertResult.backend`.
5. **Input caps for video.** Buffer-all means a hard input cap. Pick a
   conservative default (e.g. 256 MiB) until a streaming muxer exists.
6. **AAC ADTS vs encoder-native ADTS.** Prefer `AudioEncoder{aac:{format:'adts'}}`
   + concat over the container-aac placeholder-prefix dance? Verify the config
   is honoured cross-browser.

## Needs verification during implementation

- **Stage 0:** exact `VideoDecoder.isConfigSupported`/`AudioDecoder.isConfigSupported`
  return shape across Chromium/Firefox (assumed symmetric with the encoder
  probe).
- **Stage 1:** `AudioData` plane format (f32-planar assumed) and channel order
  for interleaving; 24-bit PCM packing if we target it.
- **Stage 2:** Opus encoder `preSkip` value to bake into OpusHead; whether
  `AudioEncoder` emits per-packet chunks 1:1 with `AudioData` inputs.
- **Stage 3:** VP9 keyframe cadence and cluster-boundary policy; timestamp
  rebasing from source µs to WebM `TimecodeScale` ticks within int16 deltas;
  A/V interleave order in clusters.
- **Stage 3:** whether decoded `VideoFrame` needs format/color conversion before
  re-encode (e.g. NV12 vs I420) on some drivers.

## v1 feasibility matrix

Legend: **1** = ready now (no container changes), **2** = small addition (stated),
**3** = out of scope v1 (route to ffmpeg-wasm at −10). "Decodable input" =
mp3, flac, aac, ogg(opus/vorbis), wav(PCM), m4a(aac), and the tracks of
mp4(h264/aac)/webm(vp8/vp9/opus/vorbis)/mkv.

| From → To | Cat | Path / gap |
|---|---|---|
| any decodable audio → **wav** | **1** | decode → interleave PCM → `serializeWav` (from-scratch) |
| any decodable audio → **ogg (opus)** | **1**\* | decode → Opus encode → `serializeOgg`; \*needs OpusHead/OpusTags builder (Cat 2, ~40 LOC) |
| any decodable audio → **webm (opus)** | **1**\* | decode → Opus encode → `serializeWebm` (OpusHead in `codecPrivate`); \*same builder |
| **mp4 (h264+aac) → webm (vp9/vp8 + opus)** | **1** | flagship; demux→decode→encode→`serializeWebm`. Muxer ready |
| webm/mkv (vp8/vp9/opus) → **webm/mkv (vp9 + opus)** | **1** | re-encode video/audio; muxer ready |
| any decodable audio → **aac (ADTS)** | **2** | AAC encode + wrap AU; `serializeAdts` strips a header prefix (`serializer.ts:40`) — prepend placeholder or use encoder-native ADTS |
| any decodable audio → **flac** | **2** | FLAC encode (Chromium) + STREAMINFO via `encodeStreamInfo`; verify chunk→frame |
| decoder/encoder capability probing (both sides) | **2** | add `probeVideoDecoder`/`probeAudioDecoder` to codec-webcodecs (encoder-only today) |
| any → **mp4 / m4a** (incl. webm → mp4) | **3** | mp4 muxer can't build sample tables (`serializer.ts:456-459`); needs new from-scratch mp4 mux (Stage 5). H.264/AAC encode exist — muxer-limited |
| any → **mp3** | **3** | no WebCodecs MP3 encoder (any browser) → ffmpeg-wasm |
| any → **ogg (vorbis)** | **3** | no WebCodecs Vorbis encoder → ffmpeg-wasm |
| audio transcodes on **Safari < 26** | **3** | no `AudioEncoder`/`AudioDecoder`; probe fails → ffmpeg-wasm |
| legacy codecs (WMV/AC-3/Sorenson/…) | **3** | not in WebCodecs → ffmpeg-wasm |

## Clean-room / references

Built from the W3C WebCodecs specification and the WebCodecs Codec Registry
(codec strings, `description` semantics), RFC 7845 (Opus in Ogg — OpusHead /
OpusTags), and the container packages' own design notes in `docs/design-notes/`.
No third-party transcoder source (Mediabunny, ffmpeg, libav) is consulted or
copied — this package only orchestrates our own parsers/serialisers and the
browser's codecs.
