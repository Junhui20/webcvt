/**
 * Test case 20: detectImageFormat distinguishes qoif, P1..P6, Pf, PF magics
 */
import { describe, expect, it } from 'vitest';
import { detectImageFormat } from './detect.ts';

function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}

describe('detectImageFormat', () => {
  // Test case 20
  it('recognizes QOI magic "qoif"', () => {
    expect(detectImageFormat(bytes(0x71, 0x6f, 0x69, 0x66, 0x00))).toBe('qoi');
  });

  it('recognizes P1 magic → pbm', () => {
    expect(detectImageFormat(bytes(0x50, 0x31, 0x0a))).toBe('pbm');
  });

  it('recognizes P4 magic → pbm', () => {
    expect(detectImageFormat(bytes(0x50, 0x34, 0x0a))).toBe('pbm');
  });

  it('recognizes P2 magic → pgm', () => {
    expect(detectImageFormat(bytes(0x50, 0x32, 0x0a))).toBe('pgm');
  });

  it('recognizes P5 magic → pgm', () => {
    expect(detectImageFormat(bytes(0x50, 0x35, 0x0a))).toBe('pgm');
  });

  it('recognizes P3 magic → ppm', () => {
    expect(detectImageFormat(bytes(0x50, 0x33, 0x0a))).toBe('ppm');
  });

  it('recognizes P6 magic → ppm', () => {
    expect(detectImageFormat(bytes(0x50, 0x36, 0x0a))).toBe('ppm');
  });

  it('recognizes Pf magic → pfm', () => {
    expect(detectImageFormat(bytes(0x50, 0x66, 0x0a))).toBe('pfm');
  });

  it('recognizes PF magic → pfm', () => {
    expect(detectImageFormat(bytes(0x50, 0x46, 0x0a))).toBe('pfm');
  });

  it('returns null for unknown magic', () => {
    expect(detectImageFormat(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull(); // PNG
  });

  it('returns null for empty input', () => {
    expect(detectImageFormat(new Uint8Array(0))).toBeNull();
  });

  it('returns null for 1-byte input', () => {
    expect(detectImageFormat(bytes(0x50))).toBeNull();
  });

  it('all Netpbm and QOI magics are disjoint', () => {
    const results = [
      detectImageFormat(bytes(0x71, 0x6f, 0x69, 0x66)), // qoif
      detectImageFormat(bytes(0x50, 0x31)), // P1
      detectImageFormat(bytes(0x50, 0x34)), // P4
      detectImageFormat(bytes(0x50, 0x32)), // P2
      detectImageFormat(bytes(0x50, 0x35)), // P5
      detectImageFormat(bytes(0x50, 0x33)), // P3
      detectImageFormat(bytes(0x50, 0x36)), // P6
      detectImageFormat(bytes(0x50, 0x66)), // Pf
      detectImageFormat(bytes(0x50, 0x46)), // PF
    ];
    expect(results).toEqual(['qoi', 'pbm', 'pbm', 'pgm', 'pgm', 'ppm', 'ppm', 'pfm', 'pfm']);
  });
});
