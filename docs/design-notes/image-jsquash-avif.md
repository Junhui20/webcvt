# @catlabtech/webcvt-image-jsquash-avif design

> Wave B opening package: lazy-loaded AVIF decode/encode via @jsquash/avif.
> Pay only when used; zero wasm at import time.

## Scope

### In scope (~900 LOC source + ~700 tests)

- AVIF decode: Uint8Array | ArrayBuffer → ImageData via @jsquash/avif
- AVIF encode: ImageData → Uint8Array via @jsquash/avif
- Lazy wasm load: dynamic import('@jsquash/avif') on first use, double-checked Promise guard
- Pixel bridge: ImageData ↔ Blob via OffscreenCanvas (HTMLCanvasElement fallback)
- canHandle matrix (AVIF-gated; see §canHandle matrix below)
- AvifBackend class implementing Backend interface
- registerAvifBackend() explicit opt-in
- Encode option surface: quality, speed, subsample, qualityAlpha, bitDepth (v1)
- Input size cap: MAX_INPUT_BYTES = 256 MiB
- Pixel count cap: MAX_PIXELS = 100 MP
- AbortSignal honoured between every async phase

### Out of scope (deferred to v0.3+)

- Animated AVIF / AVIS image sequences
- HDR / PQ / HLG transfer characteristics
- Custom ICC profile preservation
- Multi-image grids (HEIF-style tiled AVIF)
- 10/12-bit-depth round-trip (canvas bridge clamps to 8-bit; see Trap §7)
- Streaming decode (full-buffer only)
- Worker-thread offload
- Auto-registration on import (explicit registerAvifBackend() only)
- denoiseLevel, tileColsLog2, tileRowsLog2, chromaDeltaQ, sharpness, tune, enableSharpYUV

## File map

| File | LOC | Purpose |
|---|---|---|
| index.ts | ~40 | Barrel exports |
| constants.ts | ~30 | AVIF_MIME, MAX_INPUT_BYTES, MAX_PIXELS, DEFAULT_ENCODE |
| format.ts | ~25 | AVIF_FORMAT FormatDescriptor |
| errors.ts | ~80 | 5 typed WebcvtError subclasses |
| loader.ts | ~140 | Promise singleton, lazy-load, disposeAvif() |
| decode.ts | ~80 | decodeAvif() — boundary validation + jsquash delegate |
| encode.ts | ~120 | encodeAvif() — option clamping + jsquash delegate |
| pixel-bridge.ts | ~110 | ImageData ↔ Blob via OffscreenCanvas/HTMLCanvasElement |
| backend.ts | ~220 | AvifBackend class + canHandle + registerAvifBackend |
| **Total source** | **~845** | |
| Tests | ~740 | |

## Type definitions

```ts
export interface AvifEncodeOptions {
  readonly quality?: number;        // 0..100, default 50
  readonly speed?: number;           // 0..10 (effort), default 6
  readonly subsample?: 0 | 1 | 2 | 3;  // 0=444, 1=422 (default), 2=420, 3=400
  readonly qualityAlpha?: number;    // -1..100, -1 = "use quality"
  readonly bitDepth?: 8 | 10 | 12;   // default 8
}

export interface AvifLoadOptions {
  readonly moduleURL?: string;
  readonly module?: WebAssembly.Module;
}

export function decodeAvif(bytes: Uint8Array | ArrayBuffer): Promise<ImageData>;
export function encodeAvif(image: ImageData, opts?: AvifEncodeOptions): Promise<Uint8Array>;
export function preloadAvif(opts?: AvifLoadOptions): Promise<void>;
export function disposeAvif(): void;

export class AvifBackend implements Backend {
  readonly name: 'image-jsquash-avif';
  constructor(opts?: {
    load?: AvifLoadOptions;
    encode?: AvifEncodeOptions;
    maxInputBytes?: number;
    maxPixels?: number;
  });
  canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean>;
  convert(input: Blob, output: FormatDescriptor, options: ConvertOptions): Promise<ConvertResult>;
}

export function registerAvifBackend(
  registry?: BackendRegistry,
  opts?: ConstructorParameters<typeof AvifBackend>[0],
): void;
```

## Lazy-load model

Cross-ref: backend-wasm Trap §1.

Three module-scoped singletons in loader.ts:

```ts
let _module: AvifModule | null = null;
let _loading: Promise<AvifModule> | null = null;
let _initOptions: AvifLoadOptions | undefined = undefined;
```

`ensureLoaded(opts?)`:
1. If `_module !== null` → return Promise.resolve(_module)  [fast path]
2. If `_loading !== null` → return `_loading`  [N concurrent callers collapse]
3. Otherwise: `_loading = doLoad(opts)`; on success set `_module`; on failure null `_loading`

`doLoad`:
- `const mod = await import('@jsquash/avif')` — dynamic, NEVER static
- Type-check that `decode` and `encode` are functions
- If `opts.module` or `opts.moduleURL` provided, call `await mod.init(opts.module)`
- Wrap errors as `AvifLoadError(message, { cause })`

`disposeAvif()`:
- Sets `_module = null`, `_loading = null`
- jsquash provides no explicit teardown; GC handles wasm memory

INVARIANT: importing this package triggers zero wasm bytes fetched.
Wasm loads only on first decodeAvif() / encodeAvif() / AvifBackend.convert() call.

## canHandle matrix

| Input \ Output | AVIF | PNG | JPEG | WebP |
|---|---|---|---|---|
| **AVIF** | yes | yes (bridge) | yes (bridge) | yes (bridge) |
| **PNG** | yes (bridge) | NO | NO | NO |
| **JPEG** | yes (bridge) | NO | NO | NO |
| **WebP** | yes (bridge) | NO | NO | NO |

Rationale per cell:
- AVIF→AVIF: re-encode for quality adjustment, lossless round-trip testing
- AVIF→{PNG,JPEG,WebP}: decode via jsquash, paint to OffscreenCanvas, export via convertToBlob
- {PNG,JPEG,WebP}→AVIF: decode via createImageBitmap→canvas→ImageData, encode via jsquash
- PNG↔JPEG↔WebP: NOT handled — that is image-canvas's job; AVIF must be on exactly one side

Node.js guard: When typeof OffscreenCanvas === 'undefined', return false for all cells except
AVIF→AVIF (direct bytes-in bytes-out through jsquash decode+encode, no canvas needed).
AVIF→AVIF in Node still works because we never call the pixel bridge for that path.

## Encode option mapping

ConvertOptions.quality (0–1) → AvifEncodeOptions.quality (0–100):
```ts
Math.round((options.quality ?? 0.5) * 100)
```

All AVIF-specific knobs come via AvifBackend({ encode: {...} }) constructor, keeping generic
ConvertOptions clean. Per-call quality from ConvertOptions.quality is merged on top with
constructor defaults as the base.

Clamping in encode.ts:
- quality: clamp([0, 100])
- speed: clamp([0, 10])
- subsample: must be in {0, 1, 2, 3}; throw AvifEncodeError if not
- qualityAlpha: clamp([-1, 100])
- bitDepth: must be in {8, 10, 12}; if 10 or 12, throw AvifEncodeError (Trap §7)

## Traps

1. **Static import would leak wasm into bundle** — All @jsquash/avif access is via
   `await import('@jsquash/avif')` inside loader.ts. Never use a static import at module scope.

2. **N concurrent first-callers double-init** — Promise singleton pattern: once `_loading` is
   set, all concurrent callers join that same Promise. Verified by the "10 concurrent calls = 1
   dynamic import" test in loader.test.ts.

3. **Encoding RGBA where alpha is full-opaque inflates AVIF size** — jsquash will encode the
   alpha channel even when unnecessary. Future optimization: detect full-opaque alpha and
   set qualityAlpha=-1 (use main quality) or strip alpha channel. Flagged as v0.3+ item.

4. **ImageData width×height×4 overflow on huge inputs** — width=50000, height=50001 exceeds
   2^32 bytes. MAX_PIXELS=100_000_000 cap applied pre-encode. Check after decode too:
   decoded ImageData.width × decoded ImageData.height must be ≤ MAX_PIXELS.

5. **AbortSignal mid-encode: jsquash has no abort hook** — check signal.aborted between each
   async phase (ensureLoaded, decode, pixelBridge, encode). Mid-encode abort is impossible;
   document this prominently. Once encode() is called, abort only takes effect after it returns.

6. **SharedArrayBuffer not required** — jsquash AVIF wasm is single-threaded. No COOP/COEP
   gymnastics needed. This is an advantage over backend-wasm.

7. **Encoding 10/12-bit-depth not supported by browser canvas getImageData** — The canvas
   pixel bridge always produces 8-bit ImageData (Uint8ClampedArray). Passing bitDepth: 10 or 12
   would encode 8-bit data as if it were HDR, producing incorrect output. v1 throws
   AvifEncodeError if bitDepth !== 8 is requested. Future work: use VideoFrame API for true HDR.

8. **jsquash subpath imports may differ across versions** — We use the package root import
   `import('@jsquash/avif')`. Pin peerDependencies to `^1.3.0`. If jsquash restructures
   exports in 2.0, this will fail at runtime with a clear error message from doLoad().

9. **CSP `wasm-unsafe-eval` requirement** — The wasm binary instantiated by jsquash requires
   CSP `script-src: 'wasm-unsafe-eval'`. Document in README. AvifLoadOptions.moduleURL lets
   callers pre-instantiate and pass a WebAssembly.Module to avoid this CSP requirement (the
   module was already compiled, only instantiation needed).

10. **License: jsquash Apache-2.0 + AV1 patent grant — wrapper MIT** — @jsquash/avif is
    Apache-2.0 with an explicit AV1 patent grant. This wrapper is MIT. The combination is safe
    for most uses but implementers should consult their legal team if shipping in contexts with
    active AV1 patent disputes. README documents this explicitly.

## Test plan

Unit tests (no wasm; mock @jsquash/avif via _test-helpers/mock-jsquash.ts):
1. loader: 10 concurrent ensureLoaded() calls → 1 dynamic import
2. loader: retry after failed load
3. loader: disposeAvif() clears singletons; next call cold-reloads
4. loader: barrel import → _module remains null (zero side effects)
5. decode: rejects input > MAX_INPUT_BYTES before calling jsquash
6. decode: propagates jsquash decode error as AvifDecodeError
7. decode: rejects decoded image > MAX_PIXELS
8. encode: clamps quality to [0, 100]
9. encode: clamps speed to [0, 10]
10. encode: rejects invalid subsample value
11. encode: rejects bitDepth 10 and 12
12. encode: propagates jsquash encode error as AvifEncodeError
13. pixel-bridge: encodes ImageData to AVIF blob via OffscreenCanvas mock
14. pixel-bridge: decodes AVIF blob to ImageData via createImageBitmap mock
15. backend: canHandle matrix — all true/false cells
16. backend: canHandle returns false when OffscreenCanvas unavailable (except AVIF→AVIF)
17. backend: convert AVIF→AVIF (no bridge)
18. backend: convert AVIF→PNG (jsquash decode + canvas bridge)
19. backend: convert PNG→AVIF (canvas bridge + jsquash encode)
20. backend: abort before ensureLoaded → throws AbortError
21. backend: abort between phases → throws AbortError
22. backend: input > MAX_INPUT_BYTES → AvifInputTooLargeError
23. backend: decoded pixels > MAX_PIXELS → AvifDimensionsTooLargeError
24. errors: all 5 subclasses extend WebcvtError; code fields correct
25. index: registerAvifBackend registers backend; second call throws duplicate error

Integration (round-trip, uses real @jsquash/avif wasm):
26. decodeAvif(8×8 solid-red AVIF) → ImageData with correct dimensions
27. encodeAvif(ImageData) → Uint8Array starting with AVIF ftyp box bytes

## Performance budget

- Wasm download: ~390 KiB (jsquash avif.wasm); cached after first decode
- Encode 8×8 image: <100ms (dominated by wasm init on first call)
- Encode 4MP image: <500ms target (wasm encode only)
- MAX_INPUT_BYTES: 256 MiB — prevents OOM on pathological inputs

## Future work

- Animated AVIF: jsquash does not yet support AVIS sequences; watch for support in 2.x
- JXL sibling: @catlabtech/webcvt-image-jsquash-jxl (Wave B)
- HEIC sibling: @catlabtech/webcvt-image-jsquash-heic (Wave B)
- HDR round-trip: VideoFrame API for 10/12-bit ImageData
- Worker-thread offload: postMessage ImageData → worker → encode → postMessage result
- denoiseLevel, tileColsLog2, tileRowsLog2, chromaDeltaQ, sharpness, tune, enableSharpYUV
