import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// WebCodecs transcode e2e — real browser, real codecs.
//
// The transcode package's unit tests run against mocked WebCodecs (Node has
// none), so this spec is the only place the real VideoDecoder/VideoEncoder/
// AudioDecoder/AudioEncoder path is exercised. It runs on the system Chrome
// stable (channel: 'chrome') because Playwright's bundled Chromium may lack
// the proprietary H.264/AAC decoders the mp4 fixture needs.
//
// Each test asserts the result line reads "via webcodecs-transcode" — without
// that check a silent fallback to ffmpeg-wasm would still produce valid
// output and mask a broken probe.
// ---------------------------------------------------------------------------

test.use({ channel: 'chrome' });

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures');

async function convertFixture(
  page: import('@playwright/test').Page,
  fixturePath: string,
  targetExt: string,
): Promise<void> {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(fixturePath);
  await expect(page.locator('#picker-section')).toBeVisible({ timeout: 5000 });
  await page.locator('#format-select').selectOption({ value: targetExt });
  await page.locator('#convert-btn').click();
}

async function readMagicBytes(page: import('@playwright/test').Page): Promise<number[]> {
  const href = await page.locator('#download-btn').getAttribute('href');
  expect(href).toBeTruthy();
  const bytes = await page.evaluate(async (url: string) => {
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    return Array.from(new Uint8Array(buf).slice(0, 4));
  }, href as string);
  return bytes;
}

// ---------------------------------------------------------------------------
// 1. Video: mp4 (H.264 + AAC) → webm via WebCodecs
// ---------------------------------------------------------------------------
test('mp4 → webm transcodes via webcodecs-transcode', async ({ page }) => {
  test.setTimeout(120_000);

  await convertFixture(page, resolve(FIXTURES, 'video/testsrc-1s-160x120-h264-aac.mp4'), 'webm');

  await expect(page.locator('#result-section')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#result-section')).toContainText('webcodecs-transcode');

  const downloadAttr = await page.locator('#download-btn').getAttribute('download');
  expect(downloadAttr).toMatch(/\.webm$/i);

  // EBML magic: 1A 45 DF A3
  const magic = await readMagicBytes(page);
  expect(magic).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
});

// ---------------------------------------------------------------------------
// 2. Audio: mp3 → ogg (Opus) via WebCodecs
// ---------------------------------------------------------------------------
test('mp3 → ogg (Opus) transcodes via webcodecs-transcode', async ({ page }) => {
  test.setTimeout(60_000);

  await convertFixture(page, resolve(FIXTURES, 'audio/sine-1s-44100-mono.mp3'), 'ogg');

  await expect(page.locator('#result-section')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#result-section')).toContainText('webcodecs-transcode');

  const downloadAttr = await page.locator('#download-btn').getAttribute('download');
  expect(downloadAttr).toMatch(/\.ogg$/i);

  // Ogg magic: "OggS"
  const magic = await readMagicBytes(page);
  expect(magic).toEqual([0x4f, 0x67, 0x67, 0x53]);
});
