/**
 * Runtime capability probe for browser primitives webcvt depends on.
 * Use `detectCapabilities()` at startup to decide which backends are viable.
 */
export interface Capabilities {
  readonly webCodecs: boolean;
  readonly videoEncoder: boolean;
  readonly videoDecoder: boolean;
  readonly audioEncoder: boolean;
  readonly audioDecoder: boolean;
  readonly offscreenCanvas: boolean;
  readonly compressionStream: boolean;
  readonly decompressionStream: boolean;
  readonly webWorker: boolean;
  readonly sharedArrayBuffer: boolean;
}

// biome-ignore lint/suspicious/noExplicitAny: runtime feature detection
function hasGlobal(name: string): boolean {
  try {
    return typeof (globalThis as any)[name] !== 'undefined';
  } catch {
    return false;
  }
}

export function detectCapabilities(): Capabilities {
  return {
    webCodecs: hasGlobal('VideoEncoder') || hasGlobal('AudioEncoder'),
    videoEncoder: hasGlobal('VideoEncoder'),
    videoDecoder: hasGlobal('VideoDecoder'),
    audioEncoder: hasGlobal('AudioEncoder'),
    audioDecoder: hasGlobal('AudioDecoder'),
    offscreenCanvas: hasGlobal('OffscreenCanvas'),
    compressionStream: hasGlobal('CompressionStream'),
    decompressionStream: hasGlobal('DecompressionStream'),
    webWorker: hasGlobal('Worker'),
    sharedArrayBuffer: hasGlobal('SharedArrayBuffer'),
  };
}
