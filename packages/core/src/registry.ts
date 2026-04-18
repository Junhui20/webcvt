import type { Backend, FormatDescriptor } from './types.ts';

/**
 * A registry of available backends. Packages register themselves by calling
 * `registerBackend(new MyBackend())` at import time — the core picks the first
 * backend that can handle a given conversion, with priority from registration
 * order.
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
    for (const backend of this.backends) {
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
