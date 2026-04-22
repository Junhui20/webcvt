/**
 * @catlabtech/webcvt-cli — entry point.
 *
 * The shebang (#!/usr/bin/env node) is injected by tsup's banner option in
 * tsup.config.ts — do not add it here or the compiled output will have two.
 * Do NOT use process.exit() inside dispatch(); set process.exitCode instead
 * to let Node drain streams before exit (Trap #11).
 */

import { extname } from 'node:path';
import {
  NoBackendError,
  UnsupportedFormatError,
  WebcvtError,
  defaultRegistry,
  detectFormat,
} from '@catlabtech/webcvt-core';
import { parseArgv } from './argv.ts';
import { CliBadUsageError, USAGE_HINT } from './errors.ts';
import { inferFormatFromPath, resolveHint } from './format.ts';
import { buildHelpText, buildListFormatsText } from './help.ts';
import { readInput, sinkOf, srcOf, writeOutput } from './io.ts';
import { registerInstalledBackends } from './register.ts';
import { readPackageVersion } from './version.ts';

// ---------------------------------------------------------------------------
// ANSI colour helpers (Trap #2: only to stderr; stdout is binary payload)
// ---------------------------------------------------------------------------

const RED = process.stderr.isTTY ? '\x1b[31m' : '';
const GREEN = process.stderr.isTTY ? '\x1b[32m' : '';
const RESET = process.stderr.isTTY ? '\x1b[0m' : '';

function stderrWrite(msg: string): void {
  process.stderr.write(msg);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

async function dispatch(): Promise<number> {
  const args = parseArgv(process.argv.slice(2));

  try {
    switch (args.kind) {
      case 'help': {
        // help text is written before backend registration
        process.stdout.write(buildHelpText());
        return 0;
      }

      case 'version': {
        const version = await readPackageVersion();
        process.stdout.write(`${version}\n`);
        return 0;
      }

      case 'list-formats': {
        await registerInstalledBackends();
        process.stdout.write(buildListFormatsText());
        return 0;
      }

      case 'bad-usage': {
        stderrWrite(`${RED}webcvt: bad usage: ${args.reason}${RESET}\n`);
        stderrWrite(`${USAGE_HINT}\n`);
        return 2;
      }

      case 'convert': {
        return await runConvert(args);
      }

      default: {
        const _exhaustive: never = args;
        void _exhaustive;
        return 2;
      }
    }
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// Convert flow
// ---------------------------------------------------------------------------

async function runConvert(args: {
  input: string;
  output: string;
  fromHint?: string | undefined;
  toHint?: string | undefined;
  verbose: boolean;
}): Promise<number> {
  // Register all available backends
  const registeredIds = await registerInstalledBackends();
  if (args.verbose) {
    stderrWrite(`webcvt: registered backends: ${registeredIds.join(', ') || '(none)'}\n`);
  }

  // Read input
  const inputBytes = await readInput(srcOf(args.input));

  // Resolve input format
  let inputFormat = args.fromHint !== undefined ? resolveHint(args.fromHint) : undefined;

  if (inputFormat === undefined && args.fromHint !== undefined) {
    throw new UnsupportedFormatError(args.fromHint, 'input');
  }

  if (inputFormat === undefined) {
    // detectFormat accepts Uint8Array
    inputFormat = await detectFormat(inputBytes);
    if (inputFormat === undefined) {
      throw new UnsupportedFormatError('(unknown)', 'input');
    }
  }

  // Resolve output format
  let outputFormat = args.toHint !== undefined ? resolveHint(args.toHint) : undefined;

  if (outputFormat === undefined && args.toHint !== undefined) {
    throw new UnsupportedFormatError(args.toHint, 'output');
  }

  if (outputFormat === undefined) {
    // Infer from output path extension (stdout '-' was already rejected without --to)
    outputFormat = inferFormatFromPath(args.output);
    if (outputFormat === undefined) {
      const ext = extname(args.output) || args.output;
      throw new UnsupportedFormatError(ext, 'output');
    }
  }

  if (args.verbose) {
    stderrWrite(`webcvt: input format: ${inputFormat.mime}\n`);
    stderrWrite(`webcvt: output format: ${outputFormat.mime}\n`);
  }

  // Find backend
  const backend = await defaultRegistry.findFor(inputFormat, outputFormat);
  if (!backend) {
    throw new NoBackendError(inputFormat.ext, outputFormat.ext);
  }

  if (args.verbose) {
    stderrWrite(`webcvt: using backend: ${backend.name}\n`);
  }

  // Build input Blob — copy to a plain ArrayBuffer to avoid SharedArrayBuffer issues (Trap #7).
  const plainBuffer =
    inputBytes.buffer instanceof SharedArrayBuffer
      ? (() => {
          const ab = new ArrayBuffer(inputBytes.byteLength);
          new Uint8Array(ab).set(inputBytes);
          return ab;
        })()
      : (inputBytes.buffer as ArrayBuffer);
  const blob = new Blob([plainBuffer], { type: inputFormat.mime });

  const onProgress = args.verbose
    ? (ev: { percent: number; phase?: string | undefined }): void => {
        stderrWrite(`\rwebcvt: ${ev.phase ?? 'progress'}: ${ev.percent}%   `);
      }
    : undefined;

  const result = await backend.convert(blob, outputFormat, {
    format: outputFormat,
    onProgress,
  });

  if (args.verbose) {
    stderrWrite(
      `\nwebcvt: ${GREEN}done${RESET} (${result.durationMs}ms, backend=${result.backend})\n`,
    );
  }

  // Write output
  const outputBytes = new Uint8Array(await result.blob.arrayBuffer());
  await writeOutput(sinkOf(args.output), outputBytes);

  return 0;
}

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

function handleError(err: unknown): number {
  if (err instanceof CliBadUsageError) {
    stderrWrite(`${RED}webcvt: bad usage: ${err.message}${RESET}\n`);
    stderrWrite(`${USAGE_HINT}\n`);
    return 2;
  }
  if (err instanceof WebcvtError) {
    stderrWrite(`${RED}webcvt: ${err.code}: ${err.message}${RESET}\n`);
    return 1;
  }
  const msg = process.env.WEBCVT_DEBUG
    ? err instanceof Error
      ? (err.stack ?? String(err))
      : String(err)
    : err instanceof Error
      ? err.message
      : String(err);
  stderrWrite(`${RED}webcvt: internal: ${msg}${RESET}\n`);
  return 2;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

dispatch()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    const msg = process.env.WEBCVT_DEBUG
      ? err instanceof Error
        ? (err.stack ?? String(err))
        : String(err)
      : err instanceof Error
        ? err.message
        : String(err);
    process.stderr.write(`webcvt: fatal: ${msg}\n`);
    process.exitCode = 2;
  });
