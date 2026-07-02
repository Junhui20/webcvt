/**
 * RoundTripBackend — shared base for the container "parse → re-serialize" backends.
 *
 * The nine `container-*` packages (mp3, wav, aac, flac, ogg, ts, mkv, webm, mp4)
 * all implement the same Phase-1 shape: accept a container MIME, guard the input
 * size, parse the bytes, re-serialize them (a lossless/semantic round-trip), and
 * hand back a `ConvertResult` with `hardwareAccelerated: false`. Encoding from a
 * *different* input is deferred (routed to backend-wasm), so a non-identity
 * output throws a package-specific "encode not implemented" error.
 *
 * This class captures that flow once. Packages subclass it (keeping their named
 * class, e.g. `class WavBackend extends RoundTripBackend<WavFile>`) so that
 * `new WavBackend()` and `instanceof` keep working, and pass a small config for
 * the parts that legitimately differ between containers:
 *
 * - **canHandle semantics** vary: most containers are identity-only, but
 *   container-mp3 accepts any `category: 'audio'` output (decode path), and the
 *   video containers require an *exact* `input.mime === output.mime` match
 *   rather than "both in the MIME set". Modelled via {@link CanHandleMode} plus
 *   an explicit {@link RoundTripBackendConfig.acceptsOutput} override hook.
 * - **size guard** is optional (container-wav has none) and each package throws
 *   ITS OWN typed error with ITS OWN code.
 * - **progress percentages/phase labels** differ (5/50 vs 10/60; `decode` vs
 *   `mux`). The terminal event is always `{ percent: 100, phase: 'done' }`.
 * - **output Blob MIME** is either a fixed container MIME or the requested
 *   `output.mime`.
 *
 * Note: this base deliberately does NOT set `Backend.priority` — the default
 * (undefined → treated as 0 by the registry) is preserved for every container.
 */

import type { Backend, ConvertOptions, ConvertResult, FormatDescriptor } from './types.ts';

/**
 * How {@link RoundTripBackend.canHandle} decides an OUTPUT descriptor is
 * acceptable, once the input MIME is known to be supported.
 *
 * - `'identity-set'` (default): `output.mime` is in the backend's MIME set.
 *   Used by containers whose set has interchangeable relabels (wav/wave/x-wav).
 * - `'strict-identity'`: `output.mime === input.mime`. Used by containers where
 *   a cross-MIME relabel (e.g. `audio/ogg → audio/opus`) would misdescribe the
 *   codec without re-encoding, so only an exact match round-trips.
 *
 * For the looser container-mp3 decode path, supply
 * {@link RoundTripBackendConfig.acceptsOutput} instead of a mode.
 */
export type CanHandleMode = 'identity-set' | 'strict-identity';

/** A single progress checkpoint emitted via `options.onProgress`. */
export interface RoundTripProgressStep {
  readonly percent: number;
  readonly phase: string;
}

/** Optional input-size guard: cap plus the error thrown when it is exceeded. */
export interface RoundTripSizeGuard {
  /** Maximum accepted input size in bytes. */
  readonly maxBytes: number;
  /** Builds the package-specific too-large error (keeps each package's code). */
  readonly error: (size: number, max: number) => Error;
}

/**
 * Configuration for a {@link RoundTripBackend}. `TParsed` is the container's
 * in-memory file model (e.g. `WavFile`), threaded from `parse` to `serialize`.
 */
export interface RoundTripBackendConfig<TParsed> {
  /** Stable backend identifier, e.g. `"container-wav"`. */
  readonly name: string;
  /**
   * MIME types this backend round-trips. Used both to gate `canHandle` input
   * and to decide (in `convert`) whether an output is the identity target.
   */
  readonly mimes: ReadonlySet<string>;
  /** Output-acceptance rule for `canHandle`. Defaults to `'identity-set'`. */
  readonly canHandleMode?: CanHandleMode;
  /**
   * Explicit override for `canHandle`'s output check, evaluated only after the
   * input MIME is confirmed supported. When present it fully replaces
   * {@link canHandleMode}. Used by container-mp3, whose decode path accepts any
   * `output.category === 'audio'`.
   */
  readonly acceptsOutput?: (input: FormatDescriptor, output: FormatDescriptor) => boolean;
  /** Optional input-size guard. Omit for containers with no cap (container-wav). */
  readonly sizeGuard?: RoundTripSizeGuard;
  /** Parse raw input bytes into the container's file model. */
  readonly parse: (bytes: Uint8Array) => TParsed;
  /** Re-serialize the file model back to bytes (may be async, e.g. lazy import). */
  readonly serialize: (parsed: TParsed) => Uint8Array | Promise<Uint8Array>;
  /** Builds the package-specific error thrown for a non-identity output. */
  readonly encodeNotImplemented: (output: FormatDescriptor) => Error;
  /**
   * Fixed MIME for the output Blob. Omit to use the requested `output.mime`
   * (the identity output MIME) instead.
   */
  readonly outputMime?: string;
  /** Progress checkpoint before parsing (all containers label this `'demux'`). */
  readonly demuxStep: RoundTripProgressStep;
  /** Progress checkpoint after parsing, before serializing. */
  readonly serializeStep: RoundTripProgressStep;
}

/**
 * Base backend implementing the container round-trip flow. Instantiable
 * directly (useful for tests), but real containers subclass it so they keep a
 * named class and a zero-argument constructor.
 */
export class RoundTripBackend<TParsed> implements Backend {
  readonly name: string;
  private readonly config: RoundTripBackendConfig<TParsed>;

  constructor(config: RoundTripBackendConfig<TParsed>) {
    this.name = config.name;
    this.config = config;
  }

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    if (!this.config.mimes.has(input.mime)) return false;
    if (this.config.acceptsOutput) return this.config.acceptsOutput(input, output);
    if (this.config.canHandleMode === 'strict-identity') return input.mime === output.mime;
    // Default 'identity-set': output must also be one of the supported MIMEs.
    return this.config.mimes.has(output.mime);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    // Size guard first — reject before touching the bytes, so a hostile `.size`
    // never triggers an allocation. Omitted entirely for uncapped containers.
    const { sizeGuard } = this.config;
    if (sizeGuard && input.size > sizeGuard.maxBytes) {
      throw sizeGuard.error(input.size, sizeGuard.maxBytes);
    }

    const { demuxStep, serializeStep } = this.config;
    options.onProgress?.({ percent: demuxStep.percent, phase: demuxStep.phase });

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const parsed = this.config.parse(inputBytes);

    options.onProgress?.({ percent: serializeStep.percent, phase: serializeStep.phase });

    // Identity / round-trip path: the requested output is one we round-trip.
    if (this.config.mimes.has(output.mime)) {
      const outputBytes = await this.config.serialize(parsed);
      options.onProgress?.({ percent: 100, phase: 'done' });
      const blob = new Blob([outputBytes.buffer as ArrayBuffer], {
        type: this.config.outputMime ?? output.mime,
      });
      return {
        blob,
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    }

    // Non-identity output: encoding from a different source is deferred.
    throw this.config.encodeNotImplemented(output);
  }
}
