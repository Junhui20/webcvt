/**
 * GIF interlaced frame deinterlacing.
 *
 * GIF interlacing stores rows in a 4-pass order (Trap §14 in the design note):
 *   Pass 1: every 8th row starting at row 0   (rows 0, 8, 16, 24, ...)
 *   Pass 2: every 8th row starting at row 4   (rows 4, 12, 20, 28, ...)
 *   Pass 3: every 4th row starting at row 2   (rows 2, 6, 10, 14, ...)
 *   Pass 4: every 2nd row starting at row 1   (rows 1, 3, 5, 7, ...)
 *
 * The input `indexed` contains rows in the interlaced (pass) order.
 * The output rows are reordered to normal top-down order.
 */

/**
 * Deinterlace an indexed pixel array from GIF 4-pass interlaced order to
 * normal top-down row order.
 *
 * @param indexed - Row data stored in 4-pass GIF interlaced order.
 * @param width - Frame width in pixels.
 * @param height - Frame height in pixels.
 * @returns A new Uint8Array with rows in top-down order (same total size).
 */
export function deinterlace(indexed: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(indexed.length);

  // Define the 4 passes: [starting row, row step]
  const passes: [number, number][] = [
    [0, 8], // Pass 1: rows 0, 8, 16, ...
    [4, 8], // Pass 2: rows 4, 12, 20, ...
    [2, 4], // Pass 3: rows 2, 6, 10, ...
    [1, 2], // Pass 4: rows 1, 3, 5, ...
  ];

  let srcRow = 0; // current row in the interlaced (pass) order

  for (const [start, step] of passes) {
    for (let row = start; row < height; row += step) {
      const srcOffset = srcRow * width;
      const dstOffset = row * width;
      out.set(indexed.subarray(srcOffset, srcOffset + width), dstOffset);
      srcRow++;
    }
  }

  return out;
}
