import { describe, expect, it } from 'vitest';
import { deinterlace } from './gif-deinterlace.ts';

describe('deinterlace', () => {
  it('deinterlaces an 8-row image (1 pixel wide) correctly', () => {
    // 8 rows, 1 pixel each
    // Normal order:  rows 0,1,2,3,4,5,6,7 → values 0,1,2,3,4,5,6,7
    // Interlaced order (pass1: 0, pass2: 4, pass3: 2,6, pass4: 1,3,5,7):
    // storage order: [0, 4, 2, 6, 1, 3, 5, 7]
    const interlaced = new Uint8Array([0, 4, 2, 6, 1, 3, 5, 7]);
    const result = deinterlace(interlaced, 1, 8);
    expect(Array.from(result)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('deinterlaces a 4x8 image correctly', () => {
    // 8 rows × 4 pixels
    // Row values: row i has pixels [i*4, i*4+1, i*4+2, i*4+3]
    // Interlaced storage order: pass1(row0), pass2(row4), pass3(row2,row6), pass4(row1,row3,row5,row7)
    // → rows in storage order: 0, 4, 2, 6, 1, 3, 5, 7
    const rowData = (r: number): number[] => [r * 10, r * 10 + 1, r * 10 + 2, r * 10 + 3];
    const interlacedRows = [0, 4, 2, 6, 1, 3, 5, 7].flatMap(rowData);
    const interlaced = new Uint8Array(interlacedRows);

    const result = deinterlace(interlaced, 4, 8);

    // Expected: rows 0..7 in order
    const expected = [0, 1, 2, 3, 4, 5, 6, 7].flatMap(rowData);
    expect(Array.from(result)).toEqual(expected);
  });

  it('deinterlaces a 16-row image (first 3 passes have multiple rows)', () => {
    // 16 rows, 1 pixel each
    // Pass 1 (step 8, start 0): rows 0, 8          → stored first: [val0, val8]
    // Pass 2 (step 8, start 4): rows 4, 12         → stored next:  [val4, val12]
    // Pass 3 (step 4, start 2): rows 2, 6, 10, 14  → stored next:  [val2, val6, val10, val14]
    // Pass 4 (step 2, start 1): rows 1,3,5,7,9,11,13,15 → stored last
    const W = 1;
    const H = 16;
    // Build interlaced: assign each row a unique value equal to row index
    const pass1 = [0, 8];
    const pass2 = [4, 12];
    const pass3 = [2, 6, 10, 14];
    const pass4 = [1, 3, 5, 7, 9, 11, 13, 15];
    const storageOrder = [...pass1, ...pass2, ...pass3, ...pass4];
    const interlaced = new Uint8Array(H * W);
    storageOrder.forEach((row, srcIdx) => {
      interlaced[srcIdx] = row; // value = original row index
    });

    const result = deinterlace(interlaced, W, H);
    // Each pixel should now be at position = its value (row 0 pixel 0 = 0, etc.)
    for (let i = 0; i < H; i++) {
      expect(result[i]).toBe(i);
    }
  });

  it('preserves total byte count', () => {
    const w = 10;
    const h = 8;
    const pixels = new Uint8Array(w * h).fill(42);
    const result = deinterlace(pixels, w, h);
    expect(result.length).toBe(w * h);
  });

  it('handles 1x1 image without error', () => {
    const pixels = new Uint8Array([99]);
    const result = deinterlace(pixels, 1, 1);
    expect(result[0]).toBe(99);
  });

  it('handles 2-row image (only pass 4 with start=1 produces row 1)', () => {
    // For 2 rows: pass1(start=0) → row 0, pass4(start=1) → row 1
    // Interlaced storage: [value_at_row0, value_at_row1]
    const interlaced = new Uint8Array([10, 20]); // row0=10, row1=20 in pass order
    const result = deinterlace(interlaced, 1, 2);
    expect(Array.from(result)).toEqual([10, 20]);
  });
});
