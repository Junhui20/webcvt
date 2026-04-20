/**
 * MEMFS marshalling helpers for @webcvt/backend-wasm.
 *
 * ffmpeg.wasm operates on an in-memory virtual filesystem (MEMFS).
 * Files written there must be explicitly deleted — no GC (Trap #4).
 *
 * withMemfsFiles() wraps the exec lifecycle in try/finally so both
 * input and output paths are always cleaned up, even on exec failures.
 */

// Use globalThis.crypto.randomUUID() — works in browser (secure context or
// localhost) AND Node 19+. Avoids 'node:crypto' import which bundlers treat
// as a Node-only specifier and either fail to polyfill or error at runtime
// in browser builds.

// ---------------------------------------------------------------------------
// FFmpeg minimal interface (what we need from @ffmpeg/ffmpeg at runtime)
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the FFmpeg class API that memfs.ts depends on.
 * Using a structural interface here avoids importing @ffmpeg/ffmpeg types
 * at the module level (which would defeat the dynamic-import pattern).
 */
export interface MemfsFFmpeg {
  writeFile(name: string, data: Uint8Array): Promise<void>;
  readFile(name: string): Promise<Uint8Array | string>;
  deleteFile(name: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Path generation
// ---------------------------------------------------------------------------

/**
 * Generates a UUID-prefixed MEMFS virtual path.
 *
 * Guarantees no collisions between concurrent (queued) conversions and no
 * user-influenced path names (Trap #4 security cap).
 *
 * @param ext - File extension WITHOUT leading dot, e.g. "mp4"
 */
export function makeMemfsPath(ext: string): string {
  return `${globalThis.crypto.randomUUID()}.${ext}`;
}

// ---------------------------------------------------------------------------
// withMemfsFiles
// ---------------------------------------------------------------------------

export interface MemfsContext {
  /** Virtual MEMFS path for the input file. */
  readonly inputPath: string;
  /** Virtual MEMFS path for the output file. */
  readonly outputPath: string;
}

/**
 * Writes `inputData` to a UUID-prefixed MEMFS path, invokes `fn` with
 * the input and output paths, reads the output bytes, then deletes both
 * files in a finally block — guaranteeing no MEMFS leaks.
 *
 * @param ffmpeg    - Live FFmpeg instance with MEMFS API.
 * @param inputExt  - Extension of the input file (e.g. "mp4").
 * @param outputExt - Extension of the output file (e.g. "webm").
 * @param inputData - Raw bytes of the input file.
 * @param fn        - Async callback that performs the ffmpeg.exec().
 *
 * @returns The output file bytes as a Uint8Array.
 */
export async function withMemfsFiles(
  ffmpeg: MemfsFFmpeg,
  inputExt: string,
  outputExt: string,
  inputData: Uint8Array,
  fn: (ctx: MemfsContext) => Promise<void>,
): Promise<Uint8Array> {
  const inputPath = makeMemfsPath(inputExt);
  const outputPath = makeMemfsPath(outputExt);

  await ffmpeg.writeFile(inputPath, inputData);

  let outputBytes: Uint8Array | undefined;
  try {
    await fn({ inputPath, outputPath });

    const raw = await ffmpeg.readFile(outputPath);
    outputBytes = raw instanceof Uint8Array ? raw : new TextEncoder().encode(raw);
  } finally {
    // Trap #4: always clean up, even on failure
    await ffmpeg.deleteFile(inputPath).catch(() => undefined);
    await ffmpeg.deleteFile(outputPath).catch(() => undefined);
  }

  // outputBytes is guaranteed set here (readFile succeeded or threw)
  return outputBytes;
}
