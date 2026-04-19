// Placeholder package — real WASM backend lands in Phase 4. See plan.md.

export class NotImplementedError extends Error {
  override name = 'NotImplementedError';

  constructor(feature: string) {
    super(`Not implemented: ${feature}`);
  }
}

export function decodeWithWasm(_input: ArrayBuffer, _options?: { codec?: string }): never {
  throw new NotImplementedError('decodeWithWasm: backend-wasm is a Phase 4 placeholder');
}

export function encodeWithWasm(
  _samples: ArrayBuffer,
  _options?: { codec?: string; bitrate?: number },
): never {
  throw new NotImplementedError('encodeWithWasm: backend-wasm is a Phase 4 placeholder');
}

export const BACKEND_WASM_AVAILABLE = false as const;
