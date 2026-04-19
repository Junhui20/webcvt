#!/usr/bin/env node
/**
 * Regenerate canonical reference fixtures using a pinned ffmpeg binary.
 *
 * Usage:
 *   pnpm fixtures
 *
 * Outputs go under tests/fixtures/. Existing files are overwritten. After
 * running, commit the changes — fixtures are part of the repo so CI does
 * not need ffmpeg installed.
 *
 * Why a pinned ffmpeg via ffmpeg-static instead of the system ffmpeg:
 *  - System ffmpeg version drift would silently change golden bytes
 *  - Contributors don't need to install ffmpeg locally to verify tests
 *  - Same version on Linux / macOS / Windows
 */
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const fixturesRoot = join(repoRoot, 'tests', 'fixtures');

let ffmpegPath;
try {
  // ffmpeg-static is a devDep that ships a pinned native binary per platform.
  ({ default: ffmpegPath } = await import('ffmpeg-static'));
} catch (err) {
  console.error('ffmpeg-static is not installed. Run: pnpm add -Dw ffmpeg-static');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

if (!ffmpegPath) {
  console.error('ffmpeg-static did not resolve a binary path on this platform.');
  process.exit(1);
}

/**
 * Synthetic fixture catalog. Keep small — tens of KB total. Each fixture is
 * a 1-second 440 Hz sine wave at 44100 Hz mono, in various containers.
 *
 * Bumping ffmpeg-static version may change byte output for lossy formats.
 * Re-run this script and commit the new bytes when that happens.
 */
const FIXTURES = [
  {
    out: 'audio/sine-1s-44100-mono.wav',
    args: [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1:sample_rate=44100',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
    ],
  },
  {
    out: 'audio/sine-1s-44100-mono.mp3',
    args: [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1:sample_rate=44100',
      '-ac',
      '1',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
    ],
  },
  {
    out: 'audio/sine-1s-44100-mono.flac',
    args: [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1:sample_rate=44100',
      '-ac',
      '1',
      '-c:a',
      'flac',
    ],
  },
  {
    out: 'audio/sine-1s-48000-stereo.wav',
    args: [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1:sample_rate=48000',
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
    ],
  },
];

async function runFfmpeg(outputPath, args) {
  await mkdir(dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });
  return new Promise((resolveFn, rejectFn) => {
    const proc = spawn(
      ffmpegPath,
      ['-y', '-hide_banner', '-loglevel', 'error', ...args, outputPath],
      {
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );
    proc.on('error', rejectFn);
    proc.on('exit', (code) => {
      if (code === 0) resolveFn();
      else rejectFn(new Error(`ffmpeg exited with code ${code} for ${outputPath}`));
    });
  });
}

console.log(`ffmpeg binary: ${ffmpegPath}`);
console.log(`fixtures root: ${fixturesRoot}\n`);

for (const fixture of FIXTURES) {
  const outPath = join(fixturesRoot, fixture.out);
  console.log(`→ ${fixture.out}`);
  await runFfmpeg(outPath, fixture.args);
}

console.log(`\nGenerated ${FIXTURES.length} fixture(s). Commit changes if any.`);
