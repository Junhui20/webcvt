import { readFile, writeFile } from 'node:fs/promises';
import { CliBadUsageError, CliInputTooLargeError } from './errors.ts';

/** 256 MiB — enforced before Blob construction. */
export const MAX_INPUT_BYTES = 256 * 1024 * 1024;

export type InputSource = { kind: 'file'; path: string } | { kind: 'stdin' };

export type OutputSink = { kind: 'file'; path: string } | { kind: 'stdout' };

/**
 * Read input bytes from a file path or from stdin.
 * Throws CliInputTooLargeError when the input exceeds MAX_INPUT_BYTES.
 * Throws CliBadUsageError when stdin is a TTY (nothing piped).
 */
export async function readInput(src: InputSource): Promise<Uint8Array> {
  if (src.kind === 'file') {
    const buf = await readFile(src.path);
    if (buf.length > MAX_INPUT_BYTES) {
      /* v8 ignore next 2 -- impractical to write 256 MiB in unit tests; spawn tests cover the real cap */
      throw new CliInputTooLargeError(buf.length, MAX_INPUT_BYTES);
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  // stdin path
  if (process.stdin.isTTY) {
    throw new CliBadUsageError('stdin is a TTY; pipe input or use a file path');
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    // chunk may be Buffer or Uint8Array from Node streams
    const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk as ArrayBufferLike);
    total += buf.length;
    if (total > MAX_INPUT_BYTES) {
      throw new CliInputTooLargeError(total, MAX_INPUT_BYTES);
    }
    chunks.push(buf);
  }
  const merged = Buffer.concat(chunks);
  return new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength);
}

/**
 * Write output bytes to a file path or to stdout.
 */
export async function writeOutput(sink: OutputSink, bytes: Uint8Array): Promise<void> {
  if (sink.kind === 'file') {
    await writeFile(sink.path, bytes);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(bytes, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** Map a CLI input string ('-' or path) to an InputSource. */
export function srcOf(input: string): InputSource {
  return input === '-' ? { kind: 'stdin' } : { kind: 'file', path: input };
}

/** Map a CLI output string ('-' or path) to an OutputSink. */
export function sinkOf(output: string): OutputSink {
  return output === '-' ? { kind: 'stdout' } : { kind: 'file', path: output };
}
