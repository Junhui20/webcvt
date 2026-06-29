import { describe, expect, it } from 'vitest';
import { naturalCompare, naturalSortBy } from './natural-sort.ts';

describe('naturalCompare', () => {
  it('orders single-digit before multi-digit numerically (page2 < page10)', () => {
    expect(naturalCompare('page2', 'page10')).toBeLessThan(0);
    expect(naturalCompare('page10', 'page2')).toBeGreaterThan(0);
  });

  it('sorts a realistic page list in reading order', () => {
    const input = ['page10', 'page2', 'page1', 'page20', 'page3'];
    expect([...input].sort(naturalCompare)).toEqual([
      'page1',
      'page2',
      'page3',
      'page10',
      'page20',
    ]);
  });

  it('treats equal-value runs with fewer leading zeros as smaller', () => {
    expect(naturalCompare('page1', 'page01')).toBeLessThan(0);
    expect(naturalCompare('page001', 'page01')).toBeGreaterThan(0);
  });

  it('compares numeric runs by significant-digit length', () => {
    expect(naturalCompare('p007', 'p10')).toBeLessThan(0); // 7 < 10
  });

  it('returns 0 for identical strings', () => {
    expect(naturalCompare('page1', 'page1')).toBe(0);
  });

  it('orders a pure prefix before the longer string', () => {
    expect(naturalCompare('page', 'page1')).toBeLessThan(0);
    expect(naturalCompare('page1', 'page')).toBeGreaterThan(0);
  });

  it('compares letters case-insensitively then case-sensitively', () => {
    expect(naturalCompare('apple', 'banana')).toBeLessThan(0);
    // Same letters, different case: uppercase sorts first as a stable tie-break.
    expect(naturalCompare('Apple', 'apple')).toBeLessThan(0);
  });

  it('handles multiple numeric segments', () => {
    expect(naturalCompare('ch1-pg2', 'ch1-pg10')).toBeLessThan(0);
    expect(naturalCompare('ch2-pg1', 'ch10-pg1')).toBeLessThan(0);
  });

  it('handles a leading numeric run', () => {
    expect(naturalCompare('9.jpg', '10.jpg')).toBeLessThan(0);
  });
});

describe('naturalSortBy', () => {
  it('sorts objects by a derived key in natural order', () => {
    const items = [{ n: 'p10' }, { n: 'p2' }, { n: 'p1' }];
    expect(naturalSortBy(items, (i) => i.n).map((i) => i.n)).toEqual(['p1', 'p2', 'p10']);
  });

  it('is stable for equal keys (preserves input order)', () => {
    const a = { id: 'a', n: 'p1' };
    const b = { id: 'b', n: 'p1' };
    expect(naturalSortBy([a, b], (i) => i.n)).toEqual([a, b]);
    expect(naturalSortBy([b, a], (i) => i.n)).toEqual([b, a]);
  });

  it('does not mutate the input array', () => {
    const input = [{ n: 'p2' }, { n: 'p1' }];
    const copy = [...input];
    naturalSortBy(input, (i) => i.n);
    expect(input).toEqual(copy);
  });
});
