# cli design

> Implementation reference for `@webcvt/cli`. Write the code from this
> note plus the linked Node.js documentation. Do not consult competing
> implementations (commander, yargs, oclif, ffmpeg-cli, sharp-cli,
> imagemagick) except for debugging spec-ambiguous edge cases.

## Package overview

`@webcvt/cli` is the **first Phase 5 launch-prep package**. It exists to
give Node.js users a frictionless `npx webcvt in.mp3 out.mp3` entry
point that exercises the same backend registry the browser uses,
proving the API surface composes correctly outside a browser context
and giving prospective adopters a one-line way to try the library.

The CLI is **not** a feature-rich conversion swiss-army knife (that is
what FFmpeg / ImageMagick already are). It is a thin Node-side shell
around `@webcvt/core`'s `Backend.canHandle` + `Backend.convert` APIs,
populated with whatever optional backend packages the user has
installed alongside it. If the user runs `npm i -g @webcvt/cli` with
no backend packages, the CLI is reduced to `--help`, `--version`, and
a `--list-formats` that reports an empty registry — and that is the
intended behaviour: all real conversion capability lives in the
sibling backend packages, and the CLI deliberately never bundles
them.

## Scope statement

**This note covers a FIRST-PASS implementation, not a full Node CLI
framework.** The goal is the smallest argv-grammar + I/O wiring that
calls into `@webcvt/core` and reports typed errors with non-zero exit
codes. Subcommand grammar (`webcvt convert`, `webcvt info`, etc.),
plugin loading, and watch / batch modes are deferred.

**In scope (first pass for `cli`, ~400-600 LOC incl. tests):**

- Single positional grammar: `webcvt <input> <output>` with the input
  and output being filesystem paths or `-` (meaning stdin / stdout).
- Explicit format hints via `--from <mime-or-ext>` and
  `--to <mime-or-ext>`. Override the magic-byte detector / output-
  extension inference respectively.
- Filesystem read via `node:fs/promises.readFile` and write via
  `node:fs/promises.writeFile`. Buffer the entire input and the
  entire output in memory; **no streaming I/O** in first pass.
- Stdin read by draining `process.stdin` chunks into one `Buffer`,
  stdout write via `process.stdout.write(Uint8Array)` after switching
  the stream to binary mode (`setRawMode` is not required — Node's
  `process.stdout.write(Buffer)` is binary-safe by default).
- Format detection delegates to `@webcvt/core`'s `detectFormat` for
  the input bytes; the output format is resolved from the output path
  extension (or `--to` hint) via `@webcvt/core`'s `findByExt` /
  `findByMime`.
- Backend lookup delegates to `defaultRegistry.findFor(input,
  output)`; on success, calls `backend.convert(blob, outputFormat,
  options)`; on failure, throws `NoBackendError` (which is in turn
  caught by the top-level error handler).
- Optional-dependency backend registration at startup: try-import
  every known sibling package (`@webcvt/container-mp3`,
  `@webcvt/image-canvas`, `@webcvt/data-text`, `@webcvt/archive-zip`,
  ...). If the package resolves, register its backend; if not, skip
  silently. This gives the user "what you installed is what you get"
  semantics without a plugin-loader subsystem.
- Flags: `--help` / `-h`, `--version` / `-V`, `--list-formats`,
  `--from <hint>`, `--to <hint>`, `--verbose` / `-v`. No other flags
  in first pass.
- Exit codes: `0` success, `1` typed error from core or a registered
  backend, `2` argv-parse error or bare crash.
- Error format on stderr: `webcvt: <ERROR_CODE>: <message>` for typed
  `WebcvtError` subclasses; bare uncaught throws print `webcvt: ${e
  .stack}` and exit `2`.
- Bin entry `webcvt` published in `package.json` `"bin"` pointing at
  `./dist/cli.js`. The compiled file starts with the shebang `#!
  /usr/bin/env node` (see Trap #1).

**Out of scope (Phase 5+, DEFERRED):**

- **Streaming I/O** (e.g. piping a 10 GiB MP4 through stdin without
  buffering). The whole-file-in-memory contract bounds CLI usage to
  small-to-medium files. Streaming requires per-backend streaming
  support that none of the Phase 1–4 backends currently provide.
- **Cross-format conversion** (e.g. `webcvt in.png out.jpeg`). First
  pass is **identity-within-format only** — the CLI passes the
  detected input MIME and the resolved output MIME unchanged to
  `Registry.findFor`, and current backends return `false` from
  `canHandle` when the two MIMEs differ. `webcvt in.mp3 out.flac`
  will exit with `NO_BACKEND` until cross-format encoders ship.
- **Plugin loading from filesystem path** (e.g. `--backend
  /path/to/my-backend.js`). The optional-dependency import pattern
  covers the published-package case; arbitrary path loading deferred
  pending a plugin-spec design note.
- **Watch mode** (`webcvt --watch in/ out/`).
- **Glob / batch expansion** (`webcvt *.mp3 -o out/`). The shell can
  do glob expansion, but the CLI accepts only one input + one output
  in first pass.
- **Progress bars / TTY UI**. The `onProgress` callback from
  `ConvertOptions` is wired to a one-line `\r%d%%` printer in
  `--verbose` mode only; no `cli-progress` / `ora` dependency.
- **Color output beyond simple red/green for error/success**. We
  detect TTY via `process.stderr.isTTY` and emit ANSI red `\x1b[31m`
  for error lines, green `\x1b[32m` for the final success summary;
  everything else stays uncoloured. No `chalk` / `kleur` dependency.
- **Auto-install of `@webcvt/backend-wasm`** when the registry has no
  matching backend. We surface a typed `NoBackendError` whose message
  already names the missing package; the user runs `npm i` themselves.
- **Subcommand grammar** (`webcvt convert ...`, `webcvt info ...`).
  Single positional grammar only; the dispatcher is a `switch` on
  the first non-flag arg, not a registered-command system.
- **Config file loading** (`.webcvtrc`, `webcvt.config.js`). Flags
  only; no implicit config.
- **Shell completion scripts**. Deferred.

## Argv grammar

```
webcvt [global-flags] <input> <output> [convert-flags]
```

- **Positional `<input>`**: a filesystem path OR the literal `-`
  meaning "read from stdin".
- **Positional `<output>`**: a filesystem path OR the literal `-`
  meaning "write to stdout". Stdout-as-output **forces** stderr-only
  for log lines (Trap #2).
- **Global flags** (consumed before positionals):
  - `--help`, `-h` — print help to stdout, exit 0.
  - `--version`, `-V` — print version (read from package.json) to
    stdout, exit 0.
  - `--list-formats` — print one row per registered backend.
- **Convert flags**:
  - `--from <hint>` — override input format detection. Accepts an
    extension (`mp3`) OR a MIME (`audio/mpeg`).
  - `--to <hint>` — override output format. Same grammar as `--from`.
    Stdout output (`output === '-'`) **requires** `--to`.
  - `--verbose`, `-v` — enable progress prints to stderr.
- **Unknown flags** exit 2 with `webcvt: bad usage: unknown flag '--xyz'`.
- **`--` separator** — anything after `--` is positional.

## File map

```
packages/cli/
├── package.json
├── tsup.config.ts
├── tsconfig.json
├── README.md
└── src/
    ├── cli.ts                 ENTRY: shebang + main(); parses argv, dispatches
    ├── argv.ts                Pure argv parser → ParsedArgs discriminated union
    ├── io.ts                  readInput / writeOutput
    ├── register.ts            Optional-dep backend registration
    ├── format.ts              Format-hint resolution
    ├── help.ts                buildHelpText() / buildListFormatsText()
    ├── errors.ts              CliBadUsageError + exit-code mapping
    └── version.ts             readPackageVersion()
└── tests/
    ├── argv.test.ts           Unit: argv parser
    ├── format.test.ts         Unit: --from / --to / path-ext resolution
    ├── help.test.ts           Unit: --help / --version snapshots
    ├── register.test.ts       Unit: optional-dep import behaviour
    ├── cli-spawn.test.ts      Integration: spawn dist/cli.js
    └── fixtures/              Tiny inputs reused across tests
```

Estimated source LOC ≈ 380; tests ≈ 220; total ≈ 600.

## Required structures

```ts
export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'list-formats' }
  | {
      kind: 'convert';
      input: string;          // '-' or filesystem path
      output: string;         // '-' or filesystem path
      fromHint?: string;
      toHint?: string;
      verbose: boolean;
    }
  | { kind: 'bad-usage'; reason: string };

export type InputSource =
  | { kind: 'file'; path: string }
  | { kind: 'stdin' };

export type OutputSink =
  | { kind: 'file'; path: string }
  | { kind: 'stdout' };

export async function readInput(src: InputSource): Promise<Uint8Array>;
export async function writeOutput(sink: OutputSink, bytes: Uint8Array): Promise<void>;
export async function registerInstalledBackends(): Promise<readonly string[]>;
```

## Argv parser algorithm

`argv.ts` is 100% pure: `parseArgv(argv: readonly string[]): ParsedArgs`.
No I/O, no `process.exit`, no console writes. Caller in `cli.ts` decides.

1. Slice off runtime prefix: input is `process.argv.slice(2)`.
2. Walk array, classifying tokens:
   - `--` → every remaining token is positional.
   - `--xxx` → long flag. Split on first `=` for `--from=mp3`; otherwise
     next token is value (for `--from`/`--to`).
   - `-x` length > 1 → short flag. `-h`/`-V`/`-v`. No bundles.
   - Else positional; first → input, second → output, third+ → bad-usage.
3. Resolve mode priority: help > version > list-formats > convert.
4. Validate convert: input + output both present. Else bad-usage.
5. Special-case `output === '-'`: if `toHint` undefined → bad-usage
   "--to is required when output is stdout ('-')".
6. Return discriminated union.

## I/O algorithms

```ts
async function readInput(src: InputSource): Promise<Uint8Array> {
  if (src.kind === 'file') {
    const buf = await readFile(src.path);
    if (buf.length > MAX_INPUT_BYTES) throw new InputTooLargeError(...);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_INPUT_BYTES) throw new InputTooLargeError(...);
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function writeOutput(sink: OutputSink, bytes: Uint8Array): Promise<void> {
  if (sink.kind === 'file') {
    await writeFile(sink.path, bytes);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(bytes, (err) => err ? reject(err) : resolve());
  });
}
```

`MAX_INPUT_BYTES = 256 * 1024 * 1024` (256 MiB).

## Backend registration

`register.ts` exports `registerInstalledBackends()`. List of known backend
packages lives as a const (Trap #4). Each entry names: package name,
named export for backend class, stable id.

```ts
const BACKEND_PACKAGES: readonly BackendPkg[] = [
  { pkg: '@webcvt/container-mp3', exportName: 'Mp3Backend', id: 'mp3' },
  { pkg: '@webcvt/container-wav', exportName: 'WavBackend', id: 'wav' },
  { pkg: '@webcvt/container-flac', exportName: 'FlacBackend', id: 'flac' },
  { pkg: '@webcvt/container-ogg', exportName: 'OggBackend', id: 'ogg' },
  { pkg: '@webcvt/container-aac', exportName: 'AacBackend', id: 'aac' },
  { pkg: '@webcvt/container-mp4', exportName: 'Mp4Backend', id: 'mp4' },
  { pkg: '@webcvt/container-webm', exportName: 'WebmBackend', id: 'webm' },
  { pkg: '@webcvt/container-mkv', exportName: 'MkvBackend', id: 'mkv' },
  { pkg: '@webcvt/container-ts', exportName: 'TsBackend', id: 'ts' },
  { pkg: '@webcvt/image-canvas', exportName: 'ImageCanvasBackend', id: 'image-canvas' },
  { pkg: '@webcvt/image-svg', exportName: 'ImageSvgBackend', id: 'image-svg' },
  { pkg: '@webcvt/image-animation', exportName: 'ImageAnimationBackend', id: 'image-animation' },
  { pkg: '@webcvt/image-legacy', exportName: 'ImageLegacyBackend', id: 'image-legacy' },
  { pkg: '@webcvt/data-text', exportName: 'DataTextBackend', id: 'data-text' },
  { pkg: '@webcvt/archive-zip', exportName: 'ArchiveZipBackend', id: 'archive-zip' },
  { pkg: '@webcvt/subtitle', exportName: 'SubtitleBackend', id: 'subtitle' },
  { pkg: '@webcvt/backend-wasm', exportName: 'WasmBackend', id: 'wasm' },
];

async function registerInstalledBackends(): Promise<readonly string[]> {
  const registered: string[] = [];
  for (const { pkg, exportName, id } of BACKEND_PACKAGES) {
    try {
      const mod = await import(pkg);
      const Ctor = mod[exportName];
      if (typeof Ctor !== 'function') continue;
      defaultRegistry.register(new Ctor());
      registered.push(id);
    } catch (err) {
      if (process.env.WEBCVT_DEBUG) {
        process.stderr.write(`webcvt: skip ${pkg}: ${(err as Error).message}\n`);
      }
    }
  }
  return registered;
}
```

Backends MUST be in `optionalDependencies`, NOT `dependencies`. Otherwise
`npm i -g @webcvt/cli` would pull every backend including `backend-wasm`
~30 MiB.

## Pipeline

```
process.argv → parseArgv (pure) → dispatcher
  ├── help        → writeStdout(buildHelpText) exit 0
  ├── version     → writeStdout(packageVersion) exit 0
  ├── list        → writeStdout(buildListFormatsText) exit 0
  ├── bad-usage   → writeStderr(reason+usage) exit 2
  └── convert     →
      registerInstalledBackends()
      inputBytes = await readInput(srcOf(input))
      inputFormat = fromHint ? resolve(fromHint) : detectFormat(inputBytes)
      outputFormat = toHint ? resolve(toHint) : findByExt(extname(output))
      backend = await defaultRegistry.findFor(inputFormat, outputFormat)
      blob = new Blob([inputBytes], { type: inputFormat.mime })
      result = await backend.convert(blob, outputFormat, { onProgress? })
      outputBytes = new Uint8Array(await result.blob.arrayBuffer())
      await writeOutput(sinkOf(output), outputBytes)
      exit 0
```

## Error handling

```ts
async function dispatch(): Promise<number> {
  try {
    await main();
    return 0;
  } catch (err) {
    if (err instanceof CliBadUsageError) {
      process.stderr.write(`webcvt: bad usage: ${err.message}\n`);
      process.stderr.write(USAGE_HINT + '\n');
      return 2;
    }
    if (err instanceof WebcvtError) {
      process.stderr.write(`webcvt: ${err.code}: ${err.message}\n`);
      return 1;
    }
    process.stderr.write(`webcvt: internal: ${(err as Error).stack ?? String(err)}\n`);
    return 2;
  }
}
```

## Bin entry mechanics

```json
{
  "bin": { "webcvt": "./dist/cli.js" },
  "type": "module",
  "files": ["dist"]
}
```

`src/cli.ts` line 1: `#!/usr/bin/env node` (preserved by tsup/esbuild).

`postbuild` script chmods `dist/cli.js` to 0o755 (esbuild does NOT chmod).

## Test plan

### Unit (no spawn, no I/O)
1. `parseArgv parses 'webcvt in.mp3 out.mp3' to convert kind`
2. `parseArgv parses 'webcvt - out.json --to application/json' to stdin source`
3. `parseArgv rejects '-' output without --to`
4. `parseArgv treats anything after '--' as positional`
5. `parseArgv resolves --help even when other flags present`
6. `parseArgv rejects unknown long flag '--badness'`
7. `parseArgv reads --from value from next token AND --from=mp3`
8. `parseArgv rejects three positionals`
9. `resolveHint('mp3') returns FormatDescriptor for audio/mpeg`
10. `resolveHint('audio/mpeg') returns mp3`
11. `resolveHint('unknown') returns undefined`
12. `buildHelpText includes registered backend ids`
13. `buildListFormatsText omits formats with no backend`

### Integration (spawn dist/cli.js)
14. `--version prints '<version>\n', exits 0`
15. `--help prints usage, exits 0, contains 'Usage:'`
16. `--list-formats prints at least one backend, exits 0`
17. `missing args exits 2, stderr 'bad usage'`
18. `--bogus exits 2, stderr 'unknown flag'`
19. `webcvt fixtures/tiny.json /tmp/out.json byte-equals fixture` (data-text round-trip)
20. `webcvt fixtures/tiny.qoi /tmp/out.qoi byte-equals fixture` (image-legacy round-trip)
21. `webcvt - /tmp/out.json --to application/json < tiny.json` (stdin path)
22. `webcvt fixtures/tiny.json - --to application/json > /tmp/out.json` (stdout path)
23. `webcvt tiny.json out.unknownext exits 1, 'UNSUPPORTED_FORMAT'`
24. `webcvt tiny.mp3 out.flac exits 1, 'NO_BACKEND'`
25. `webcvt tiny.json - (no --to) exits 2, '--to required for stdout'`
26. `--verbose tiny.json out.json prints progress on stderr`
27. `dist/cli.js first line == '#!/usr/bin/env node\\n'`

## Dependencies

### Hard
- `@webcvt/core` (workspace)

### Optional (all 17 backends; package.json optionalDependencies)
Every backend listed in BACKEND_PACKAGES.

### Build/dev
- `tsup` ^8.3.0
- `typescript` ^5.7.0
- `vitest` ^2.1.0
- `@vitest/coverage-v8` ^2.1.0

### NO CLI framework dependency
Argv parser hand-rolled (~110 LOC) — keeps zero-dep selling point intact.

## Known traps

1. **ESM shebang preservation**: esbuild preserves leading `#!` only when
   it's the FIRST line. Test: `head -1 dist/cli.js`.

2. **Stdout-as-output must NEVER receive log lines**: ALL log writes to
   stderr. Stdout reserved for binary payload. Test: capture stdout from
   `--verbose tiny.json -` and assert it equals input bytes (zero log noise).

3. **Stdin draining contract**: when nothing is piped (TTY), `for await
   process.stdin` blocks forever. Detect TTY via `process.stdin.isTTY`;
   if true and input is `-`, throw CliBadUsageError.

4. **BACKEND_PACKAGES is maintained, not auto-discovered**. New backend
   packages MUST update the list. Lint rule deferred.

5. **Backend constructors must be no-arg**. Verified for all current
   backends. Future config-needing backend should expose
   `createDefaultBackend()` factory.

6. **`@webcvt/backend-wasm` heavyweight**: ~20 MiB wasm bundle. First
   pass: register at startup; trust backend-wasm itself defers
   `WebAssembly.instantiate` to first convert call.

7. **Buffer vs Uint8Array in Blob**: always wrap as
   `new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)` because
   Node's Buffer pool reuses shared underlying ArrayBuffer.

8. **detectFormat returns undefined for unknown bytes**. Throw
   `UnsupportedFormatError('(unknown)', 'input')` whose message names
   the `--from <hint>` workaround.

9. **Output extension lookup edge cases**: `extname('Makefile')` returns
   `''`. `--to` is the documented escape hatch.

10. **Concurrent stdin from fast producer**: `Buffer.concat` peak memory
    ~512 MiB for 256 MiB cap. Acceptable.

11. **process.exit may truncate stderr**: use `process.exitCode = code;
    return;` from dispatcher, let Node exit naturally.

12. **Windows path normalization**: `extname('C:\\foo\\bar.MP3')` returns
    `.MP3`. Core's findByExt lowercases internally.

13. **Long convert with no --verbose**: silent for many seconds. UX-poor
    but not a bug. Document in --help.

14. **onProgress invocation cost in non-verbose mode**: pass undefined.

## Security caps

- Input cap: 256 MiB. Enforced before Blob construction.
- No filesystem traversal validation: CLI is local-tool shaped.
- No backend-package whitelist beyond BACKEND_PACKAGES const.
- Stderr/stdout separation enforced.
- Only env var consulted: `WEBCVT_DEBUG`.

## LOC budget

| File | LOC est. |
|---|---|
| cli.ts | 80 |
| argv.ts | 110 |
| io.ts | 50 |
| register.ts | 60 |
| format.ts | 25 |
| help.ts | 50 |
| errors.ts | 25 |
| version.ts | 20 |
| **source total** | **~420** |
| Unit tests | 120 |
| Integration tests | 100 |
| Snapshot fixtures | 20 |
| **tests total** | **~240** |
| **grand total** | **~660** |
