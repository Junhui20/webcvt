import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliBadUsageError, CliInputTooLargeError } from './errors.ts';
import { MAX_INPUT_BYTES, readInput, sinkOf, srcOf, writeOutput } from './io.ts';

const TMP = tmpdir();

describe('srcOf', () => {
  it("'-' maps to stdin", () => {
    expect(srcOf('-')).toEqual({ kind: 'stdin' });
  });

  it('file path maps to file', () => {
    expect(srcOf('/foo/bar.json')).toEqual({ kind: 'file', path: '/foo/bar.json' });
  });
});

describe('sinkOf', () => {
  it("'-' maps to stdout", () => {
    expect(sinkOf('-')).toEqual({ kind: 'stdout' });
  });

  it('file path maps to file', () => {
    expect(sinkOf('/foo/bar.json')).toEqual({ kind: 'file', path: '/foo/bar.json' });
  });
});

describe('MAX_INPUT_BYTES', () => {
  it('is 256 MiB', () => {
    expect(MAX_INPUT_BYTES).toBe(256 * 1024 * 1024);
  });
});

describe('readInput (file)', () => {
  it('reads file bytes correctly', async () => {
    const path = join(TMP, `webcvt-read-test-${Math.random().toString(36).slice(2)}`);
    await writeFile(path, new Uint8Array([1, 2, 3, 4, 5]));
    try {
      const bytes = await readInput({ kind: 'file', path });
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      try {
        await unlink(path);
      } catch {
        /* ignore */
      }
    }
  });

  it('returns Uint8Array for text content', async () => {
    const text = '{"ok":true}';
    const path = join(TMP, `webcvt-read-txt-${Math.random().toString(36).slice(2)}`);
    await writeFile(path, text);
    try {
      const bytes = await readInput({ kind: 'file', path });
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(bytes)).toBe(text);
    } finally {
      try {
        await unlink(path);
      } catch {
        /* ignore */
      }
    }
  });
});

describe('readInput (stdin)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws CliBadUsageError when stdin is a TTY', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
      writable: true,
    });
    try {
      await expect(readInput({ kind: 'stdin' })).rejects.toBeInstanceOf(CliBadUsageError);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(process.stdin, 'isTTY', originalDescriptor);
      } else {
        // @ts-expect-error -- restoring prototype isTTY
        process.stdin.isTTY = undefined;
      }
    }
  });

  it('collects stdin chunks into a Uint8Array when stdin is not a TTY', async () => {
    // Build a fake async iterable simulating a piped stdin stream
    const fakeChunks = [Buffer.from([1, 2, 3]), Buffer.from([4, 5])];
    const fakeStream = (async function* () {
      for (const chunk of fakeChunks) yield chunk;
    })();

    // Patch process.stdin.isTTY and [Symbol.asyncIterator]
    const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const originalAsyncIterator = process.stdin[Symbol.asyncIterator].bind(process.stdin);

    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
      writable: true,
    });
    vi.spyOn(process.stdin, Symbol.asyncIterator as never).mockReturnValue(fakeStream as never);

    try {
      const bytes = await readInput({ kind: 'stdin' });
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      if (originalIsTTY) {
        Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
      } else {
        // @ts-expect-error -- restoring prototype isTTY
        process.stdin.isTTY = undefined;
      }
      vi.restoreAllMocks();
    }
  });

  it('throws CliInputTooLargeError when stdin total exceeds MAX_INPUT_BYTES', async () => {
    // Create a large chunk that exceeds MAX_INPUT_BYTES
    const hugeChunk = Buffer.alloc(MAX_INPUT_BYTES + 1);
    const fakeStream = (async function* () {
      yield hugeChunk;
    })();

    const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
      writable: true,
    });
    vi.spyOn(process.stdin, Symbol.asyncIterator as never).mockReturnValue(fakeStream as never);

    try {
      await expect(readInput({ kind: 'stdin' })).rejects.toBeInstanceOf(CliInputTooLargeError);
    } finally {
      if (originalIsTTY) {
        Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
      } else {
        // @ts-expect-error -- restoring prototype isTTY
        process.stdin.isTTY = undefined;
      }
      vi.restoreAllMocks();
    }
  });
});

describe('writeOutput (file)', () => {
  it('writes bytes to a file', async () => {
    const path = join(TMP, `webcvt-write-test-${Math.random().toString(36).slice(2)}`);
    const content = new Uint8Array([10, 20, 30]);
    try {
      await writeOutput({ kind: 'file', path }, content);
      const read = await readFile(path);
      expect(Array.from(read)).toEqual([10, 20, 30]);
    } finally {
      try {
        await unlink(path);
      } catch {
        /* ignore */
      }
    }
  });
});

describe('writeOutput (stdout)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes bytes to stdout without error', async () => {
    const bytes = new Uint8Array([65, 66, 67]); // "ABC"
    const writes: Buffer[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown, cb?: unknown) => {
      if (chunk instanceof Uint8Array || Buffer.isBuffer(chunk)) {
        writes.push(Buffer.from(chunk));
      }
      if (typeof cb === 'function') (cb as () => void)();
      return true;
    });
    await writeOutput({ kind: 'stdout' }, bytes);
    expect(writes.length).toBeGreaterThan(0);
  });

  it('rejects when stdout.write calls back with an error', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.spyOn(process.stdout, 'write').mockImplementation((_chunk: unknown, cb?: unknown) => {
      if (typeof cb === 'function') (cb as (err: Error) => void)(new Error('write error'));
      return false;
    });
    await expect(writeOutput({ kind: 'stdout' }, bytes)).rejects.toThrow('write error');
  });
});
