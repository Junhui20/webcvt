/**
 * Minimal ICO container writer.
 *
 * Spec reference: https://en.wikipedia.org/wiki/ICO_(file_format)
 *
 * This implementation writes a single-image ICO file wrapping a PNG payload.
 * The ICO format is defined by Microsoft and is in the public domain.
 *
 * File layout:
 *   ICONDIR       (6 bytes)  — file header
 *   ICONDIRENTRY  (16 bytes) — one entry per image
 *   <PNG data>    (N bytes)  — embedded PNG payload
 *
 * Total header overhead: 22 bytes.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wrap a PNG payload in a single-entry ICO container.
 *
 * @param pngPayload - Raw PNG bytes produced by canvas.toBlob / convertToBlob.
 * @param width  - Image width in pixels (1–256). Pass 256 for max ICO size.
 * @param height - Image height in pixels (1–256). Pass 256 for max ICO size.
 * @returns A Uint8Array containing the complete .ico file bytes.
 */
export function writeIco(pngPayload: Uint8Array, width: number, height: number): Uint8Array {
  const ICONDIR_SIZE = 6;
  const ICONDIRENTRY_SIZE = 16;
  const headerSize = ICONDIR_SIZE + ICONDIRENTRY_SIZE;
  const totalSize = headerSize + pngPayload.byteLength;

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);

  // -------------------------------------------------------------------------
  // ICONDIR header (6 bytes)
  // -------------------------------------------------------------------------
  view.setUint16(0, 0, true); // idReserved — must be 0
  view.setUint16(2, 1, true); // idType     — 1 = ICO
  view.setUint16(4, 1, true); // idCount    — number of images

  // -------------------------------------------------------------------------
  // ICONDIRENTRY (16 bytes, starting at offset 6)
  // -------------------------------------------------------------------------
  // Per spec, width/height of 256 is encoded as 0 in the single-byte field.
  const encodedWidth = width >= 256 ? 0 : width;
  const encodedHeight = height >= 256 ? 0 : height;

  buf[6] = encodedWidth; // bWidth
  buf[7] = encodedHeight; // bHeight
  buf[8] = 0; // bColorCount — 0 for PNG (true-color)
  buf[9] = 0; // bReserved   — must be 0
  view.setUint16(10, 1, true); // wPlanes     — must be 1
  view.setUint16(12, 32, true); // wBitCount   — 32 bpp (RGBA PNG)
  view.setUint32(14, pngPayload.byteLength, true); // dwBytesInRes
  view.setUint32(18, headerSize, true); // dwImageOffset — data starts after headers

  // -------------------------------------------------------------------------
  // PNG payload
  // -------------------------------------------------------------------------
  buf.set(pngPayload, headerSize);

  return buf;
}
