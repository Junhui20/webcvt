/**
 * Test fixtures: craft minimal JPEG headers / ImageData for unit tests.
 *
 * These produce a parseable SOF marker (enough for parseJpegInfo / jpegToPdf);
 * they are not full decodable images — the browser e2e covers real JPEGs.
 */

/** Build a minimal JPEG with a valid SOF0 marker for the given size/components. */
export function makeJpegHeader(width: number, height: number, components: number): Uint8Array {
  const len = 8 + components * 3; // SOF body length incl. the 2 length bytes
  const compSpecs: number[] = [];
  for (let i = 0; i < components; i++) compSpecs.push(i + 1, 0x11, 0);
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xc0, // SOF0
    (len >> 8) & 0xff,
    len & 0xff,
    0x08, // precision
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    components,
    ...compSpecs,
  ]);
}

/** Build a plain ImageData-like object (RGBA) without requiring DOM. */
export function makeImageData(width: number, height: number, alpha = 255): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 200; // R
    data[i + 1] = 100; // G
    data[i + 2] = 50; // B
    data[i + 3] = alpha; // A
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}
