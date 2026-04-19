import { describe, expect, it } from 'vitest';
import { detectFormat, detectFormatWithHint } from './detect.ts';

function bytes(...xs: number[]): Uint8Array {
  return Uint8Array.from(xs);
}

describe('detectFormat', () => {
  it('detects PNG by magic bytes', async () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
    const result = await detectFormat(png);
    expect(result?.ext).toBe('png');
    expect(result?.mime).toBe('image/png');
  });

  it('detects JPEG (JFIF marker)', async () => {
    const jpg = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46);
    const result = await detectFormat(jpg);
    expect(result?.ext).toBe('jpeg');
  });

  it('detects WebP (RIFF + WEBP)', async () => {
    const webp = bytes(
      0x52,
      0x49,
      0x46,
      0x46, // RIFF
      0,
      0,
      0,
      0, // size
      0x57,
      0x45,
      0x42,
      0x50, // WEBP
    );
    const result = await detectFormat(webp);
    expect(result?.ext).toBe('webp');
  });

  it('detects WAV (RIFF + WAVE)', async () => {
    const wav = bytes(
      0x52,
      0x49,
      0x46,
      0x46,
      0,
      0,
      0,
      0,
      0x57,
      0x41,
      0x56,
      0x45, // WAVE
    );
    const result = await detectFormat(wav);
    expect(result?.ext).toBe('wav');
  });

  it('detects GIF89a', async () => {
    const gif = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0);
    const result = await detectFormat(gif);
    expect(result?.ext).toBe('gif');
  });

  it('detects BMP', async () => {
    const bmp = bytes(0x42, 0x4d, 0, 0, 0, 0);
    const result = await detectFormat(bmp);
    expect(result?.ext).toBe('bmp');
  });

  it('detects ICO', async () => {
    const ico = bytes(0x00, 0x00, 0x01, 0x00, 0, 0);
    const result = await detectFormat(ico);
    expect(result?.ext).toBe('ico');
  });

  it('detects MP3 with ID3 tag', async () => {
    const mp3 = bytes(0x49, 0x44, 0x33, 0x04, 0, 0);
    const result = await detectFormat(mp3);
    expect(result?.ext).toBe('mp3');
  });

  it('detects MP3 by MPEG frame sync', async () => {
    const mp3 = bytes(0xff, 0xfb, 0x90, 0x00);
    const result = await detectFormat(mp3);
    expect(result?.ext).toBe('mp3');
  });

  it('detects AAC ADTS by sync word 0xFF 0xF1 (id=0, pa=1)', async () => {
    // 0xFF 0xF1 = sync (top 12 bits) + id=0 + layer=00 + protection_absent=1
    const aac = bytes(0xff, 0xf1, 0x50, 0x80);
    const result = await detectFormat(aac);
    expect(result?.ext).toBe('aac');
    expect(result?.mime).toBe('audio/aac');
  });

  it('detects AAC ADTS by sync word 0xFF 0xF0 (id=0, pa=0, with CRC)', async () => {
    const aac = bytes(0xff, 0xf0, 0x50, 0x80);
    const result = await detectFormat(aac);
    expect(result?.ext).toBe('aac');
  });

  it('detects AAC ADTS by sync word 0xFF 0xF9 (id=1, pa=1)', async () => {
    // 0xFF 0xF9 = sync + id=1 (MPEG-2) + layer=00 + protection_absent=1
    const aac = bytes(0xff, 0xf9, 0x50, 0x80);
    const result = await detectFormat(aac);
    expect(result?.ext).toBe('aac');
  });

  it('does NOT detect AAC for 0xFF 0xFB (MP3 frame sync — higher priority)', async () => {
    const mp3 = bytes(0xff, 0xfb, 0x90, 0x00);
    const result = await detectFormat(mp3);
    expect(result?.ext).toBe('mp3');
  });

  it('detects MPEG-TS by sync byte 0x47 at offset 0 and offset 188', async () => {
    // Build a 189-byte buffer with 0x47 at positions 0 and 188
    const ts = new Uint8Array(189);
    ts[0] = 0x47;
    ts[188] = 0x47;
    const result = await detectFormat(ts);
    expect(result?.ext).toBe('ts');
    expect(result?.mime).toBe('video/mp2t');
  });

  it('does NOT detect MPEG-TS when 0x47 only at offset 0 (too short for confirmation)', async () => {
    // Only 100 bytes (< 189 needed for second anchor)
    const buf = new Uint8Array(100);
    buf[0] = 0x47;
    // Should not detect as TS — head.length < 189
    const result = await detectFormat(buf);
    // 0x47 = 'G' from GIF but other bytes don't match GIF magic
    expect(result?.ext).not.toBe('ts');
  });

  it('detects GIF before TS even though GIF starts with 0x47', async () => {
    // GIF89a: 0x47 0x49 0x46 0x38 0x39 0x61
    const gif = new Uint8Array(189);
    gif[0] = 0x47;
    gif[1] = 0x49;
    gif[2] = 0x46;
    gif[3] = 0x38;
    gif[4] = 0x39;
    gif[5] = 0x61;
    gif[188] = 0x47; // could look like TS second anchor
    const result = await detectFormat(gif);
    expect(result?.ext).toBe('gif');
  });

  it('returns undefined for unknown magic bytes', async () => {
    const unknown = bytes(0x00, 0x01, 0x02, 0x03);
    expect(await detectFormat(unknown)).toBeUndefined();
  });

  it('handles too-short input gracefully', async () => {
    expect(await detectFormat(bytes(0x89))).toBeUndefined();
  });

  it('works with Blob input', async () => {
    const blob = new Blob([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)]);
    const result = await detectFormat(blob);
    expect(result?.ext).toBe('png');
  });
});

describe('detectFormatWithHint', () => {
  it('falls back to filename when magic bytes unknown', async () => {
    const txt = bytes(0x68, 0x65, 0x6c, 0x6c, 0x6f); // "hello"
    const result = await detectFormatWithHint(txt, 'subtitle.srt');
    expect(result?.ext).toBe('srt');
  });

  it('prefers magic bytes over filename when both exist', async () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const result = await detectFormatWithHint(png, 'actually_a.jpg');
    expect(result?.ext).toBe('png');
  });

  it('returns undefined when hint has no extension', async () => {
    const unknown = bytes(0, 0, 0, 0);
    expect(await detectFormatWithHint(unknown, 'no_extension_file')).toBeUndefined();
  });
});
