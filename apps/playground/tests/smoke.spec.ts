import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

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

  const pngPath = resolve(__dirname, '../public/samples/sample.png');
  await uploadFile(page, pngPath);

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

  const pngPath = resolve(__dirname, '../public/samples/sample.png');
  await uploadFile(page, pngPath);

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
  const srcPath = resolve(__dirname, '../public/samples/sample.srt');
  const { readFileSync } = await import('node:fs');
  writeFileSync(tmpPath, readFileSync(srcPath));

  await uploadFile(page, tmpPath);

  await expect(page.locator('#picker-section')).toBeVisible({ timeout: 5000 });
  await page.locator('#format-select').selectOption({ value: 'vtt' });
  await page.locator('#convert-btn').click();

  await expect(page.locator('#result-section')).toBeVisible({ timeout: 20000 });

  const downloadBtn = page.locator('#download-btn');
  const downloadAttr = await downloadBtn.getAttribute('download');
  expect(downloadAttr).toMatch(/\.vtt$/i);
});
