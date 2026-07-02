import type { Backend, FormatDescriptor } from './types.ts';

/**
 * A registry of available backends. Backends do NOT self-register — the consumer
 * instantiates a backend and registers it explicitly, e.g.
 * `registry.register(new MozjpegBackend())`. (Auto-registration at import time
 * would defeat tree-shaking and force every backend's wasm to load.)
 *
 * `findFor` returns the highest-priority backend that can handle a conversion:
 * candidates are considered in descending `Backend.priority` order (default 0).
 * Ties keep registration order — `Array.prototype.sort` is stable — so callers
 * that never set a priority see exactly the historical first-match-wins behavior.
 * Priority lets specialized codecs (e.g. MozJPEG for png→jpeg) win over generic
 * any-in/any-out backends (Canvas, ffmpeg-wasm) regardless of registration order.
 */
export class BackendRegistry {
  private readonly backends: Backend[] = [];

  register(backend: Backend): void {
    if (this.backends.some((b) => b.name === backend.name)) {
      throw new Error(`Backend "${backend.name}" is already registered`);
    }
    this.backends.push(backend);
  }

  unregister(name: string): boolean {
    const idx = this.backends.findIndex((b) => b.name === name);
    if (idx < 0) return false;
    this.backends.splice(idx, 1);
    return true;
  }

  list(): readonly Backend[] {
    return [...this.backends];
  }

  async findFor(input: FormatDescriptor, output: FormatDescriptor): Promise<Backend | undefined> {
    // Sort a copy by priority descending. `sort` is stable, so equal-priority
    // backends retain registration order (list() itself stays in that order).
    const ordered = [...this.backends].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    for (const backend of ordered) {
      if (await backend.canHandle(input, output)) return backend;
    }
    return undefined;
  }
}

/**
 * Process-wide default registry. Packages register themselves here by default.
 * Tests should create a fresh `new BackendRegistry()` for isolation.
 */
export const defaultRegistry = new BackendRegistry();
