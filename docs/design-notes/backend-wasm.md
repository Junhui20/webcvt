# @webcvt/backend-wasm design

> Phase 5 fallback backend wrapping ffmpeg.wasm. Pay only when used:
> lazy-loaded, idle-reaped, strict allowlist.
>
> Wrapping ffmpeg.wasm is explicitly allowed per plan.md §11 — the point
> of this package IS to be the wrapper. We don't port or vendor ffmpeg
> source.

## Scope

### In scope (~1,500-2,000 LOC source + ~400-500 tests)

- Dynamic loading via `await import('@ffmpeg/ffmpeg')` on first convert
- Capability probing via curated O(1) allowlist (~180 pairs at launch)
- Covered formats: video containers (MP4/WebM/MKV/MOV/AVI/FLV/3GP),
  audio containers (M4A/MP3/FLAC/OGG/OPUS/WAV/AAC), codecs (H.264/HEVC/
  AV1/VP9/VP8/MPEG-2/MPEG-4/AAC/MP3/Opus/Vorbis/FLAC/PCM), subtitles
  (SRT/ASS/SSA/VTT gated), legacy images (PSD/BLP/DDS/EPS/JP2)
- Command synthesis via lookup tables (NO raw argv passthrough)
- MEMFS marshalling with UUID-prefixed paths + try/finally cleanup
- Progress reporting via on('log', {type:'stderr'}) parsing
  `time=HH:MM:SS.ms` tokens
- Three error classes: WasmLoadError, WasmExecutionError,
  WasmUnsupportedError
- Lifecycle: lazy load with double-checked loading Promise, idle reaper
  at 60s, dispose() method, serial queue with AbortSignal support
- Runtime detection: browser vs Node, SharedArrayBuffer + COOP/COEP
  determines multi-thread vs single-thread core
- registerWasmBackend() explicit opt-in (no auto-register on import)

### Out of scope (deferred)

- Custom slimmed ffmpeg builds
- Streaming I/O (MEMFS only)
- Multi-pass encoding
- GPU-accelerated encoding (not available in wasm)
- Subtitle-only conversion chains (native @webcvt/subtitle exists)
- Raw ffmpeg argv passthrough — NEVER

## File map

| File | LOC | Purpose |
|---|---|---|
| index.ts | 60 | Barrel exports |
| backend.ts | 280 | WasmBackend class implementing Backend interface |
| allowlist.ts | 220 | MIME-pair allowlist + Set for O(1) lookup |
| loader.ts | 160 | Lazy import + double-checked Promise guard |
| command.ts | 280 | buildCommand(inputPath, outputPath, inputMime, output, options) |
| codec-map.ts | 180 | Lookup tables: codec aliases, quality maps |
| memfs.ts | 90 | withMemfsFiles(try/finally cleanup wrapper) |
| progress.ts | 180 | Parse stderr time= tokens with Duration discovery |
| queue.ts | 140 | SerialQueue with AbortSignal support |
| runtime.ts | 70 | Browser vs Node detection; COOP/COEP check |
| errors.ts | 80 | 3 typed WebcvtError subclasses |
| constants.ts | 30 | MAX_INPUT_BYTES, IDLE_TIMEOUT_MS, PROGRESS_THROTTLE_MS |
| **Total source** | **~1,770** | |
| Tests (mirror + 1 integration) | ~450 | |

## Type definitions

```ts
export class WasmLoadError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('WASM_LOAD_FAILED', message, options);
    this.name = 'WasmLoadError';
  }
}

export class WasmExecutionError extends WebcvtError {
  readonly exitCode: number;
  readonly stderr: string;
  constructor(exitCode: number, stderr: string) {
    super('WASM_EXEC_FAILED', `ffmpeg exited with code ${exitCode}`);
    this.name = 'WasmExecutionError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class WasmUnsupportedError extends WebcvtError {
  constructor(inputMime: string, outputMime: string) {
    super('WASM_UNSUPPORTED',
      `backend-wasm does not allowlist ${inputMime} → ${outputMime}.`);
    this.name = 'WasmUnsupportedError';
  }
}

export interface WasmLoadOptions {
  readonly coreURL?: string;
  readonly wasmURL?: string;
  readonly workerURL?: string;
  readonly preferMultiThread?: boolean;
}

export interface WasmBackendOptions {
  readonly load?: WasmLoadOptions;
  readonly idleTimeoutMs?: number;
  readonly maxInputBytes?: number;
}

export class WasmBackend implements Backend {
  readonly name = 'ffmpeg-wasm';
  constructor(options?: WasmBackendOptions);
  canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean>;
  convert(input: Blob, output: FormatDescriptor, options: ConvertOptions): Promise<ConvertResult>;
  dispose(): Promise<void>;
}

export const WASM_SUPPORTED_FORMATS: readonly FormatDescriptor[];
export const WASM_SUPPORTED_PAIRS: readonly (readonly [string, string])[];
export function registerWasmBackend(
  registry?: BackendRegistry,
  options?: WasmBackendOptions & { enableSubtitleFallback?: boolean },
): void;
```

## Capability allowlist

Explicit list, no wildcards. Rules:
1. Only pairs with smoke-tested fixtures
2. Don't allowlist pairs a native backend already claims
3. Subtitle pairs gated by `enableSubtitleFallback: true` flag

Categories: video↔video, audio↔audio, video→audio extraction, legacy
image identity, subtitle (gated). Expected ~180 pairs at launch.

## Command synthesis

```ts
export function buildCommand(
  inputPath: string,
  outputPath: string,
  inputMime: string,
  output: FormatDescriptor,
  options: ConvertOptions,
): readonly string[];
```

Steps (all via lookup tables in `codec-map.ts`):
1. Base: `['-hide_banner', '-nostdin', '-y', '-i', inputPath]`
2. Video codec from CONTAINER_DEFAULT_CODECS[output.mime]
3. Audio codec from AUDIO_DEFAULTS[output.mime]
4. Audio-only: append `-vn` if output.category === 'audio'
5. Quality → codec-appropriate flags (CRF for x264/x265/vp9/av1;
   -q:a for libmp3lame; -b:a for aac/opus/vorbis)
6. Override via options.codec through CODEC_ALIAS_MAP
   (`h264`→`libx264`, `hevc`→`libx265`, etc.)
7. Append outputPath

**Argv NEVER joined to shell string.** `ffmpeg.exec(argv[])` takes
string array directly; no shell involved.

## Lifecycle

```ts
private instance: FFmpeg | null = null;
private loading: Promise<FFmpeg> | null = null;
private idleTimer: ReturnType<typeof setTimeout> | null = null;
```

- **Lazy load**: ensureLoaded() double-checks instance, then loading
- **Idle reaper**: 60s default; fires `instance.terminate()`
- **Dispose**: cancel queue, terminate instance, clear timer. Idempotent.

## Concurrency

SerialQueue.enqueue(task, signal?). Promise-chain pattern with
abort support at three tiers:
1. Pre-start: check signal.aborted before task starts
2. Mid-run: terminate() kills worker; next call cold-reloads
3. Post-complete: abort on resolved promise is no-op

## Traps

1. **Lazy load race on concurrent first calls** → double-checked `loading` Promise field, N callers collapse to 1 load.

2. **Auto-register breaks tree-shaking** → NEVER register on import; `registerWasmBackend()` explicit.

3. **Progress on stderr NOT stdout** → filter `type === 'stderr'` in on('log') handler.

4. **MEMFS leaks without explicit deleteFile** → `withMemfsFiles` try/finally cleanup.

5. **Cross-origin isolation required for multi-thread + SharedArrayBuffer** → detectRuntime() checks `crossOriginIsolated === true`; fall back to ST core with one-time info log.

6. **`time=N/A` regex trap** → parse with two branches: literal N/A leaves last percent; HH:MM:SS.ms computes.

7. **Unknown-duration inputs** → emit `percent: -1` sentinel; UI renders indeterminate spinner.

8. **Codec-name normalization** → CODEC_ALIAS_MAP translates "h264" to "libx264" etc. Unmapped → WasmUnsupportedError.

9. **Quality-flag misapplication across codec families** → mapQuality(codec, quality) dispatches by codec family.

10. **MP4 ambiguity** (multiple valid codec combinations) → first pass always re-encodes; second pass would probe + `-c copy`.

11. **Blob → Uint8Array allocation cost (3× peak)** → stream reader with pre-sized Uint8Array; drop local ref before exec; MAX_INPUT_BYTES = 1 GiB.

12. **Abort mid-exec poisons instance** → null out both instance AND loading after any terminate() so next call re-loads.

13. **@ffmpeg/ffmpeg not tree-shakeable** → dynamic import() inside loader; peerDependency not dependency.

14. **CSP script-src blocks worker URL** → WasmLoadOptions with coreURL/wasmURL/workerURL overrides; self-hosting recipe in README.

15. **Node 18's Worker can't load blob: URL** → runtime.kind === 'node' resolves worker via `pathToFileURL(require.resolve(...))`.

16. **AbortSignal bridging across queue** → SerialQueue.enqueue(task, signal) checks at task-start AND registers mid-run listener.

17. **FLV/AVI identity not byte-exact** → document: `backend-wasm` identity is SEMANTIC only; byte-exact requires native container package.

## Security caps

- MAX_INPUT_BYTES = 1 GiB (MEMFS addressable)
- No shell invocation (ffmpeg.exec takes string[] argv)
- No user-controlled paths (UUID-prefixed MEMFS names)
- No user-controlled argv (all flags from lookup tables)
- Asset SRI (documented; enforcement caller's responsibility)
- CSP posture documented
- No network at convert time (only at first load)
- stderr truncated at 64 KiB in WasmExecutionError

## Test plan (~21 cases)

Unit tests (no wasm; mock @ffmpeg/ffmpeg):
1. canHandle true for every allowlisted pair
2. canHandle false for non-allowlisted
3. canHandle does NOT trigger import() (spy)
4. buildCommand MP4→MP3 default quality argv
5. buildCommand appends `-vn` for video→audio
6. buildCommand maps codec alias h264→libx264; throws for unknown
7. buildCommand CRF mapping for x264 at quality 0.5/1.0/0.0
8. buildCommand `-q:a` for libmp3lame (not crf)
9. Progress parser: time=00:00:02.50 + Duration=00:00:10.00 → 25%
10. Progress parser: time=N/A emits no event
11. Progress parser: no Duration → emits percent:-1 sentinel
12. SerialQueue 5 concurrent calls execute in order
13. SerialQueue pre-start abort throws AbortError
14. Lazy-load 10 concurrent collapse to 1 import() (spy)
15. Idle reaper: 60s no-op → terminate() called
16. dispose() idempotent
17. MEMFS cleanup: deleteFile called for both paths even on exec throw
18. Runtime detection: no-SAB browser picks ST core + info log
19. Runtime detection: crossOriginIsolated picks MT core
20. Error taxonomy: network fail→WasmLoadError; exit≠0→WasmExecutionError; allowlist miss→WasmUnsupportedError

Integration (nightly, gated on WEBCVT_ENABLE_WASM_INTEGRATION=1):
21. Real MP4 200ms → WebM via VP9+Opus; output non-empty, sniffs video/webm

## Dependencies

```json
"peerDependencies": {
  "@ffmpeg/ffmpeg": "^0.12.0",
  "@ffmpeg/util": "^0.12.0"
},
"dependencies": {
  "@webcvt/core": "workspace:*"
}
```

No runtime deps other than `@webcvt/core`. Wasm path opt-in via peer.

## Clean-room attestation

- Don't vendor ffmpeg source or wasm binary (npm fetches at install)
- Don't port ffmpeg C/ASM
- Consult ffmpeg published CLI documentation only; not source
- Don't copy test fixtures from ffmpeg tree
