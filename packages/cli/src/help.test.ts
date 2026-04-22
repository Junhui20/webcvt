import {
  type Backend,
  BackendRegistry,
  type ConvertOptions,
  type ConvertResult,
  type FormatDescriptor,
  defaultRegistry,
} from '@catlabtech/webcvt-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHelpText, buildListFormatsText } from './help.ts';

// We create a minimal mock Backend for testing help output
function makeBackend(name: string): Backend {
  return {
    name,
    canHandle: async (_i: FormatDescriptor, _o: FormatDescriptor) => false,
    convert: async (
      _i: Blob,
      _o: FormatDescriptor,
      _opts: ConvertOptions,
    ): Promise<ConvertResult> => {
      throw new Error('not implemented');
    },
  };
}

describe('buildHelpText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("contains 'Usage:'", () => {
    const text = buildHelpText();
    expect(text).toContain('Usage:');
  });

  it('contains --help flag description', () => {
    const text = buildHelpText();
    expect(text).toContain('--help');
  });

  it('contains --version flag description', () => {
    const text = buildHelpText();
    expect(text).toContain('--version');
  });

  it('contains --list-formats flag description', () => {
    const text = buildHelpText();
    expect(text).toContain('--list-formats');
  });

  it('contains --from and --to flag descriptions', () => {
    const text = buildHelpText();
    expect(text).toContain('--from');
    expect(text).toContain('--to');
  });

  it('lists registered backend ids when backends are present', () => {
    // Register a backend, then build help, then unregister
    const backend = makeBackend('test-help-backend-xyz');
    defaultRegistry.register(backend);
    try {
      const text = buildHelpText();
      expect(text).toContain('test-help-backend-xyz');
    } finally {
      defaultRegistry.unregister('test-help-backend-xyz');
    }
  });

  it("shows '(none installed)' when no backends registered", () => {
    vi.spyOn(defaultRegistry, 'list').mockReturnValue([]);
    const text = buildHelpText();
    expect(text).toContain('(none installed)');
  });
});

describe('buildListFormatsText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows 'No backends installed' when registry is empty", () => {
    vi.spyOn(defaultRegistry, 'list').mockReturnValue([]);
    const text = buildListFormatsText();
    expect(text).toContain('No backends installed');
  });

  it('includes backend name in output when backend is registered', () => {
    const backend = makeBackend('test-list-backend-abc');
    defaultRegistry.register(backend);
    try {
      const text = buildListFormatsText();
      expect(text).toContain('test-list-backend-abc');
    } finally {
      defaultRegistry.unregister('test-list-backend-abc');
    }
  });
});
