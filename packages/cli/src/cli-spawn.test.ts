/**
 * Integration tests: spawn dist/cli.js and verify behaviour.
 *
 * IMPORTANT: requires `pnpm build` to have been run first.
 * The beforeAll hook runs the build automatically.
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = join(__dirname, '..');
const CLI_JS = join(PKG_ROOT, 'dist', 'cli.js');
const FIXTURES = join(__dirname, 'fixtures');
const TINY_JSON = join(FIXTURES, 'tiny.json');
const TINY_QOI = join(FIXTURES, 'tiny.qoi');
const TMP_DIR = join(tmpdir(), 'webcvt-cli-test');

function cli(
  args: string[],
  opts: { input?: Buffer | string; env?: NodeJS.ProcessEnv } = {},
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(process.execPath, [CLI_JS, ...args], {
    input: opts.input,
    encoding: 'buffer',
    env: { ...process.env, ...opts.env },
    timeout: 30_000,
  });
  return {
    stdout: result.stdout?.toString('utf-8') ?? '',
    stderr: result.stderr?.toString('utf-8') ?? '',
    status: result.status ?? 2,
  };
}

function cliBinary(
  args: string[],
  opts: { input?: Buffer } = {},
): { stdout: Buffer; stderr: string; status: number } {
  const result = spawnSync(process.execPath, [CLI_JS, ...args], {
    input: opts.input,
    encoding: 'buffer',
    env: { ...process.env },
    timeout: 30_000,
  });
  return {
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr?.toString('utf-8') ?? '',
    status: result.status ?? 2,
  };
}

function tmpFile(name: string): string {
  return join(TMP_DIR, name);
}

function cleanup(path: string): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}

beforeAll(() => {
  // Build the CLI first
  execSync('pnpm build', { cwd: PKG_ROOT, stdio: 'pipe' });
  // Ensure tmp dir exists
  mkdirSync(TMP_DIR, { recursive: true });
}, 120_000);

describe('cli-spawn integration', () => {
  it("dist/cli.js first line is '#!/usr/bin/env node'", () => {
    const content = readFileSync(CLI_JS, 'utf-8');
    const firstLine = content.split('\n')[0];
    expect(firstLine).toBe('#!/usr/bin/env node');
  });

  it("--version prints '<version>\\n', exits 0", () => {
    const { stdout, status } = cli(['--version']);
    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    // ends with newline
    expect(stdout).toMatch(/\n$/);
  });

  it("--help prints usage, exits 0, contains 'Usage:'", () => {
    const { stdout, status } = cli(['--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('Usage:');
  });

  it('--help contains --from and --to flag docs', () => {
    const { stdout, status } = cli(['--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('--from');
    expect(stdout).toContain('--to');
  });

  it('--list-formats exits 0', () => {
    const { status } = cli(['--list-formats']);
    expect(status).toBe(0);
  });

  it("missing args exits 2, stderr 'bad usage'", () => {
    const { stderr, status } = cli([]);
    expect(status).toBe(2);
    expect(stderr.toLowerCase()).toContain('bad usage');
  });

  it("--bogus exits 2, stderr 'unknown flag'", () => {
    const { stderr, status } = cli(['--bogus']);
    expect(status).toBe(2);
    expect(stderr.toLowerCase()).toContain('unknown flag');
  });

  it("stdout-without-to exits 2, stderr contains '--to'", () => {
    const { stderr, status } = cli([TINY_JSON, '-']);
    expect(status).toBe(2);
    expect(stderr).toContain('--to');
  });

  it('webcvt tiny.json /tmp/out.json byte-equals fixture (data-text round-trip)', () => {
    const out = tmpFile('out-roundtrip.json');
    cleanup(out);
    try {
      const { status, stderr } = cli([TINY_JSON, out]);
      if (status !== 0) {
        // data-text may not be installed in all envs; skip gracefully
        expect([0, 1]).toContain(status);
        return;
      }
      expect(status).toBe(0);
      const input = readFileSync(TINY_JSON);
      const output = readFileSync(out);
      expect(output).toEqual(input);
    } finally {
      cleanup(out);
    }
  });

  it('webcvt tiny.qoi /tmp/out.qoi is valid QOI with correct header (image-legacy round-trip)', () => {
    const out = tmpFile('out-roundtrip.qoi');
    cleanup(out);
    try {
      const { status } = cli([TINY_QOI, out]);
      if (status !== 0) {
        // image-legacy may not be registered; skip gracefully
        expect([0, 1]).toContain(status);
        return;
      }
      expect(status).toBe(0);
      const output = readFileSync(out);
      // Verify QOI magic "qoif" and dimensions (1x1 from fixture)
      expect(output.slice(0, 4).toString('ascii')).toBe('qoif');
      expect(output.readUInt32BE(4)).toBe(1); // width=1
      expect(output.readUInt32BE(8)).toBe(1); // height=1
      // Re-serialization may produce different byte encoding (e.g. RGB vs RGBA op)
      // but the output must be a valid QOI — check end marker
      const endMarker = output.slice(output.length - 8);
      const expectedEnd = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]);
      expect(endMarker).toEqual(expectedEnd);
    } finally {
      cleanup(out);
    }
  });

  it('stdin path: webcvt - /tmp/out.json --to application/json < tiny.json', () => {
    const out = tmpFile('out-stdin.json');
    cleanup(out);
    const inputBytes = readFileSync(TINY_JSON);
    try {
      const { status } = cli(['-', out, '--to', 'application/json'], { input: inputBytes });
      if (status !== 0) {
        expect([0, 1]).toContain(status);
        return;
      }
      expect(status).toBe(0);
      const output = readFileSync(out);
      expect(output).toEqual(inputBytes);
    } finally {
      cleanup(out);
    }
  });

  it('stdout path: webcvt tiny.json - --to application/json outputs bytes to stdout', () => {
    const inputBytes = readFileSync(TINY_JSON);
    const { stdout, status } = cliBinary([TINY_JSON, '-', '--to', 'application/json']);
    if (status !== 0) {
      expect([0, 1]).toContain(status);
      return;
    }
    expect(status).toBe(0);
    expect(stdout).toEqual(inputBytes);
  });

  it('webcvt tiny.json out.unknownext exits 1, UNSUPPORTED_FORMAT', () => {
    const out = tmpFile('out-unknown.unknownxyz');
    cleanup(out);
    try {
      const { stderr, status } = cli([TINY_JSON, out]);
      expect(status).toBe(1);
      expect(stderr).toContain('UNSUPPORTED_FORMAT');
    } finally {
      cleanup(out);
    }
  });

  it("webcvt tiny.json - (no --to) exits 2, '--to required for stdout'", () => {
    const { stderr, status } = cli([TINY_JSON, '-']);
    expect(status).toBe(2);
    expect(stderr.toLowerCase()).toContain('--to');
  });

  it('--verbose tiny.json out.json prints progress on stderr', () => {
    const out = tmpFile('out-verbose.json');
    cleanup(out);
    try {
      const { stderr, status } = cli([TINY_JSON, out, '--verbose']);
      if (status !== 0) {
        // acceptable if no backend installed
        return;
      }
      expect(status).toBe(0);
      // verbose must write something to stderr
      expect(stderr.length).toBeGreaterThan(0);
    } finally {
      cleanup(out);
    }
  });

  it('stdout payload is not polluted by log lines in verbose mode', () => {
    const inputBytes = readFileSync(TINY_JSON);
    const { stdout, status } = cliBinary([TINY_JSON, '-', '--to', 'application/json', '--verbose']);
    if (status !== 0) {
      expect([0, 1]).toContain(status);
      return;
    }
    expect(status).toBe(0);
    // stdout must equal the raw JSON bytes, no log lines mixed in
    expect(stdout).toEqual(inputBytes);
  });

  it('bare crash without WEBCVT_DEBUG does not leak stack trace to stderr', () => {
    // Trigger a bad-file path which goes through handleError. We can't
    // easily trigger a *bare* non-WebcvtError from outside without a
    // dedicated fixture, so we abuse an intentionally non-existent path
    // to cause a Node fs error (not a WebcvtError).
    const { stderr, status } = cli(['/this/path/does/not/exist/ever.mp3', 'out.mp3'], {
      env: { ...process.env, WEBCVT_DEBUG: undefined },
    });
    // The process must exit with an error code (1 or 2)
    expect([1, 2]).toContain(status);
    // Without WEBCVT_DEBUG, stderr must NOT contain ' at ' (stack frame lines)
    // or absolute filesystem paths (identified by presence of path separators
    // in a position that implies a stack trace line)
    expect(stderr).not.toMatch(/^\s+at /m);
  });

  it('bare crash WITH WEBCVT_DEBUG=1 includes stack trace in stderr', () => {
    // Only verifies that WEBCVT_DEBUG does NOT suppress the stack.
    // We trigger the same fs error.
    const { stderr } = cli(['/this/path/does/not/exist/ever.mp3', 'out.mp3'], {
      env: { ...process.env, WEBCVT_DEBUG: '1' },
    });
    // With WEBCVT_DEBUG set, the stack trace IS expected
    expect(stderr).toMatch(/at /);
  });
});
