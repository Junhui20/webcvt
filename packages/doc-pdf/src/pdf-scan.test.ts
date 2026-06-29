import { describe, expect, it } from 'vitest';
import { latin1 } from './_test-helpers/fixtures.ts';
import {
  decodeLatin1,
  findObjectDict,
  indexOfSeq,
  isDelim,
  isWs,
  lastIndexOfSeq,
  matchDictEnd,
} from './pdf-scan.ts';

describe('byte predicates', () => {
  it('classifies whitespace and delimiters', () => {
    expect(isWs(0x20)).toBe(true);
    expect(isWs(0x41)).toBe(false);
    expect(isDelim(0x2f)).toBe(true);
    expect(isDelim(0x41)).toBe(false);
  });
});

describe('indexOfSeq / lastIndexOfSeq', () => {
  const b = latin1('abXYabZZ');
  it('finds forward and backward', () => {
    expect(indexOfSeq(b, 'ab')).toBe(0);
    expect(indexOfSeq(b, 'ab', 1)).toBe(4);
    expect(lastIndexOfSeq(b, 'ab')).toBe(4);
    expect(lastIndexOfSeq(b, 'ab', 4)).toBe(0);
  });
  it('returns -1 when absent', () => {
    expect(indexOfSeq(b, 'QQ')).toBe(-1);
    expect(lastIndexOfSeq(b, 'QQ')).toBe(-1);
  });
  it('handles the empty needle', () => {
    expect(indexOfSeq(b, '')).toBe(0);
    expect(lastIndexOfSeq(b, '')).toBe(b.length);
  });
});

describe('matchDictEnd', () => {
  it('matches a balanced dict including nested dicts', () => {
    const b = latin1('<< /A << /B 1 >> /C 2 >> tail');
    const end = matchDictEnd(b, 0, 1024);
    expect(decodeLatin1(b, 0, end)).toBe('<< /A << /B 1 >> /C 2 >>');
  });
  it('ignores >> inside a literal string', () => {
    const b = latin1('<< /T (a >> b) >>');
    const end = matchDictEnd(b, 0, 1024);
    expect(decodeLatin1(b, 0, end)).toBe('<< /T (a >> b) >>');
  });
  it('ignores >> and << inside a hex string', () => {
    const b = latin1('<< /H <3e3e> >>');
    const end = matchDictEnd(b, 0, 1024);
    expect(decodeLatin1(b, 0, end)).toBe('<< /H <3e3e> >>');
  });
  it('returns -1 for an unbalanced dict', () => {
    const b = latin1('<< /A 1 ');
    expect(matchDictEnd(b, 0, 1024)).toBe(-1);
  });
  it('respects the byte budget', () => {
    const b = latin1('<< /A 1 >>');
    expect(matchDictEnd(b, 0, 3)).toBe(-1);
  });
});

describe('findObjectDict', () => {
  const pdf = latin1('1 0 obj << /Type /Catalog >> endobj\n12 0 obj << /X 9 >> endobj');
  it('locates an object dictionary', () => {
    expect(findObjectDict(pdf, 1, 0, 1024)).toBe('<< /Type /Catalog >>');
    expect(findObjectDict(pdf, 12, 0, 1024)).toBe('<< /X 9 >>');
  });
  it('does not confuse "2 0 obj" with "12 0 obj"', () => {
    expect(findObjectDict(pdf, 2, 0, 1024)).toBeUndefined();
  });
  it('returns undefined when the object is absent', () => {
    expect(findObjectDict(pdf, 99, 0, 1024)).toBeUndefined();
  });
  it('returns undefined when the dict is unterminated', () => {
    const broken = latin1('5 0 obj << /A 1 endobj');
    expect(findObjectDict(broken, 5, 0, 1024)).toBeUndefined();
  });
  it('returns the newest definition on incremental update', () => {
    const updated = latin1('3 0 obj << /V 1 >> endobj\n3 0 obj << /V 2 >> endobj');
    expect(findObjectDict(updated, 3, 0, 1024)).toBe('<< /V 2 >>');
  });
});
