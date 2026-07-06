import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// ESM replacement for CJS __dirname (this package is "type": "module").
const __dirname = dirname(fileURLToPath(import.meta.url));

// Repo-root shared fixtures (the old public/samples/ files were replaced by
// inline base64 in src/ui/samples.ts, so specs use these instead).
const PNG_FIXTURE = resolve(__dirname, '../../../tests/fixtures/image/testsrc-64x64.png');

const SAMPLE_SRT = `1
00:00:00,000 --> 00:00:02,000
Hello, webcvt!

2
00:00:02,500 --> 00:00:05,000
This is a sample subtitle file.
`;

// ---------------------------------------------------------------------------
// Helper: upload a file via the hidden file input
// ---------------------------------------------------------------------------
async function uploadFile(page: import('@playwright/test').Page, filePath: string): Promise<void> {
  const input = page.locator('#file-input');
  await input.setInputFiles(filePath);
}

function ensureFixturesDir(): void {
  mkdirSync(resolve(__dirname, 'fixtures'), { recursive: true });
}

// ---------------------------------------------------------------------------
// 1. Page loads — title visible, dropzone present, no external network
// ---------------------------------------------------------------------------
test('page loads with title and dropzone', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith('http://localhost') && !url.startsWith('data:')) {
      externalRequests.push(url);
    }
  });

  await page.goto('/');
  await expect(page).toHaveTitle(/webcvt/i);
  await expect(page.locator('#dropzone')).toBeVisible();
  expect(externalRequests).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// 2. Image detection — upload PNG → preview shows "PNG"
// ---------------------------------------------------------------------------
test('PNG upload shows preview with format label', async ({ page }) => {
  await page.goto('/');

  await uploadFile(page, PNG_FIXTURE);

  const preview = page.locator('#preview-card');
  await expect(preview).toBeVisible({ timeout: 5000 });
  const text = await preview.textContent();
  expect(text).toMatch(/PNG/i);
});

// ---------------------------------------------------------------------------
// 3. PNG → WebP roundtrip — download triggered, magic bytes RIFF....WEBP
// ---------------------------------------------------------------------------
test('PNG → WebP conversion produces valid WebP blob', async ({ page }) => {
  await page.goto('/');

  await uploadFile(page, PNG_FIXTURE);

  await expect(page.locator('#picker-section')).toBeVisible({ timeout: 5000 });
  await page.locator('#format-select').selectOption({ value: 'webp' });
  await page.locator('#convert-btn').click();

  await expect(page.locator('#result-section')).toBeVisible({ timeout: 20000 });

  const downloadBtn = page.locator('#download-btn');
  await expect(downloadBtn).toBeVisible();
  const downloadAttr = await downloadBtn.getAttribute('download');
  expect(downloadAttr).toMatch(/\.webp$/i);

  const href = await downloadBtn.getAttribute('href');
  expect(href).toBeTruthy();

  const magicBytes = await page.evaluate(async (url: string | null) => {
    if (!url) return null;
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    return Array.from(new Uint8Array(buf).slice(0, 12));
  }, href);

  expect(magicBytes).not.toBeNull();
  expect(magicBytes?.[0]).toBe(0x52); // 'R'
  expect(magicBytes?.[1]).toBe(0x49); // 'I'
  expect(magicBytes?.[2]).toBe(0x46); // 'F'
  expect(magicBytes?.[3]).toBe(0x46); // 'F'
  expect(magicBytes?.[8]).toBe(0x57); // 'W'
  expect(magicBytes?.[9]).toBe(0x45); // 'E'
  expect(magicBytes?.[10]).toBe(0x42); // 'B'
  expect(magicBytes?.[11]).toBe(0x50); // 'P'
});

// ---------------------------------------------------------------------------
// 4. Unsupported format — random bytes → error UI visible
// ---------------------------------------------------------------------------
test('unrecognized file shows error UI', async ({ page }) => {
  await page.goto('/');

  ensureFixturesDir();
  const xyzPath = resolve(__dirname, 'fixtures/unknown.xyz');
  writeFileSync(xyzPath, Buffer.from([0x00, 0x01, 0x02, 0x03, 0xab, 0xcd, 0xef]));

  await uploadFile(page, xyzPath);

  const errorSection = page.locator('#error-section');
  await expect(errorSection).toBeVisible({ timeout: 5000 });
  const text = await errorSection.textContent();
  expect(text?.toLowerCase()).toMatch(/unrecognized|unsupported|format/i);
});

// ---------------------------------------------------------------------------
// 5. SRT → VTT conversion completes
// ---------------------------------------------------------------------------
test('SRT → VTT conversion succeeds', async ({ page }) => {
  await page.goto('/');

  ensureFixturesDir();
  const tmpPath = resolve(__dirname, 'fixtures/sample.srt');
  writeFileSync(tmpPath, SAMPLE_SRT);

  await uploadFile(page, tmpPath);

  await expect(page.locator('#picker-section')).toBeVisible({ timeout: 5000 });
  await page.locator('#format-select').selectOption({ value: 'vtt' });
  await page.locator('#convert-btn').click();

  await expect(page.locator('#result-section')).toBeVisible({ timeout: 20000 });

  const downloadBtn = page.locator('#download-btn');
  const downloadAttr = await downloadBtn.getAttribute('download');
  expect(downloadAttr).toMatch(/\.vtt$/i);
});
