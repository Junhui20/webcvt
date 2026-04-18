/**
 * Minimal uncompressed 24-bit BMP writer.
 *
 * Spec reference: https://en.wikipedia.org/wiki/BMP_file_format
 * Microsoft BMP v3 (BITMAPINFOHEADER), BI_RGB compression.
 *
 * Used as a fallback when the browser's canvas does not support
 * `toBlob('image/bmp')` / `convertToBlob({ type: 'image/bmp' })`.
 *
 * Limitations (Phase 1):
 *   - 24-bit RGB only (alpha channel is discarded)
 *   - No ICC colour profile embedding
 *   - Rows padded to 4-byte boundary per spec
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILE_HEADER_SIZE = 14; // BITMAPFILEHEADER
const DIB_HEADER_SIZE = 40; // BITMAPINFOHEADER
const TOTAL_HEADER_SIZE = FILE_HEADER_SIZE + DIB_HEADER_SIZE; // 54

const BMP_MAGIC_B = 0x42; // 'B'
const BMP_MAGIC_M = 0x4d; // 'M'
const BITS_PER_PIXEL = 24;
const BYTES_PER_PIXEL_RGB = 3;
const BI_RGB = 0; // no compression

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode raw RGBA pixel data as an uncompressed 24-bit BMP file.
 *
 * @param pixels - Flat RGBA bytes in row-major, top-to-bottom order,
 *                 as returned by `CanvasRenderingContext2D.getImageData().data`
 *                 or `ImageData.data`.
 * @param width  - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns Uint8Array containing the complete .bmp file bytes.
 */
export function writeBmp(pixels: Uint8ClampedArray, width: number, height: number): Uint8Array {
  // Row stride: each row is padded to the next 4-byte boundary.
  const rowStride = Math.ceil((width * BYTES_PER_PIXEL_RGB) / 4) * 4;
  const pixelDataSize = rowStride * height;
  const fileSize = TOTAL_HEADER_SIZE + pixelDataSize;

  const buf = new Uint8Array(fileSize);
  const view = new DataView(buf.buffer);

  // -------------------------------------------------------------------------
  // BITMAPFILEHEADER (14 bytes)
  // -------------------------------------------------------------------------
  buf[0] = BMP_MAGIC_B;
  buf[1] = BMP_MAGIC_M;
  view.setUint32(2, fileSize, true); // bfSize
  view.setUint16(6, 0, true); // bfReserved1
  view.setUint16(8, 0, true); // bfReserved2
  view.setUint32(10, TOTAL_HEADER_SIZE, true); // bfOffBits

  // -------------------------------------------------------------------------
  // BITMAPINFOHEADER (40 bytes, starting at offset 14)
  // -------------------------------------------------------------------------
  view.setUint32(14, DIB_HEADER_SIZE, true); // biSize
  view.setInt32(18, width, true); // biWidth
  view.setInt32(22, height, true); // biHeight (positive = bottom-up storage)
  view.setUint16(26, 1, true); // biPlanes
  view.setUint16(28, BITS_PER_PIXEL, true); // biBitCount
  view.setUint32(30, BI_RGB, true); // biCompression
  view.setUint32(34, pixelDataSize, true); // biSizeImage
  view.setInt32(38, 0, true); // biXPelsPerMeter
  view.setInt32(42, 0, true); // biYPelsPerMeter
  view.setUint32(46, 0, true); // biClrUsed
  view.setUint32(50, 0, true); // biClrImportant

  // -------------------------------------------------------------------------
  // Pixel data — stored bottom-to-top, BGR order, rows padded to 4 bytes
  // -------------------------------------------------------------------------
  for (let srcRow = 0; srcRow < height; srcRow++) {
    // BMP bottom-to-top: the last source row is the first BMP row.
    const bmpRow = height - 1 - srcRow;
    const destRowOffset = TOTAL_HEADER_SIZE + bmpRow * rowStride;

    for (let col = 0; col < width; col++) {
      const srcPixelOffset = (srcRow * width + col) * 4;
      const r = pixels[srcPixelOffset] ?? 0;
      const g = pixels[srcPixelOffset + 1] ?? 0;
      const b = pixels[srcPixelOffset + 2] ?? 0;
      // Alpha is intentionally discarded (24-bit BMP has no alpha channel).

      const destPixelOffset = destRowOffset + col * BYTES_PER_PIXEL_RGB;
      buf[destPixelOffset] = b; // BMP stores BGR
      buf[destPixelOffset + 1] = g;
      buf[destPixelOffset + 2] = r;
    }
    // Padding bytes in the remaining positions of the row are already 0
    // because buf was zero-initialised via new Uint8Array().
  }

  return buf;
}
