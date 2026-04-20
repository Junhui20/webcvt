import { describe, expect, it } from 'vitest';
import { UNKNOWN_DURATION_SENTINEL } from './constants.ts';
import { ProgressParser } from './progress.ts';

function makeParser(): ProgressParser {
  const p = new ProgressParser();
  p.reset();
  return p;
}

// Constant "now" so throttle doesn't interfere unless we test it explicitly
const FAR_FUTURE = 999_999_999;

describe('ProgressParser — Duration extraction', () => {
  it('extracts Duration from header line', () => {
    const p = makeParser();
    // Feed Duration line first, then a time= line
    p.parseLine('  Duration: 00:00:10.00, start: 0.000000, bitrate: 128 kb/s', FAR_FUTURE);
    const result = p.parseLine(
      'frame= 100 time=00:00:02.50 bitrate=128.0kbits/s',
      FAR_FUTURE + 200,
    );
    expect(result).not.toBeNull();
    expect(result?.percent).toBe(25);
  });
});

describe('ProgressParser — time= parsing', () => {
  it('computes 25% when time=00:00:02.50 and Duration=00:00:10.00', () => {
    const p = makeParser();
    p.parseLine('Duration: 00:00:10.00, start: 0.000', FAR_FUTURE);
    const result = p.parseLine('time=00:00:02.50 bitrate=256', FAR_FUTURE + 200);
    expect(result?.percent).toBe(25);
  });

  it('computes 100% when time equals duration', () => {
    const p = makeParser();
    p.parseLine('Duration: 00:00:10.00', FAR_FUTURE);
    const result = p.parseLine('time=00:00:10.00', FAR_FUTURE + 200);
    expect(result?.percent).toBe(100);
  });

  it('clamps to 100% when time overshoots duration', () => {
    const p = makeParser();
    p.parseLine('Duration: 00:00:10.00', FAR_FUTURE);
    const result = p.parseLine('time=00:00:12.00', FAR_FUTURE + 200);
    expect(result?.percent).toBe(100);
  });
});

describe('ProgressParser — time=N/A (Trap #6)', () => {
  it('emits null for time=N/A lines', () => {
    const p = makeParser();
    p.parseLine('Duration: 00:00:10.00', FAR_FUTURE);
    const result = p.parseLine('time=N/A bitrate=N/A', FAR_FUTURE + 200);
    expect(result).toBeNull();
  });
});

describe('ProgressParser — unknown duration (Trap #7)', () => {
  it('emits percent=-1 sentinel when no Duration header seen', () => {
    const p = makeParser();
    // No Duration line
    const result = p.parseLine('time=00:00:05.00', FAR_FUTURE);
    expect(result).not.toBeNull();
    expect(result?.percent).toBe(UNKNOWN_DURATION_SENTINEL);
  });
});

describe('ProgressParser — throttling', () => {
  it('suppresses duplicate percent within throttle window', () => {
    const p = makeParser();
    p.parseLine('Duration: 00:00:100.00', 0);
    // First emission at t=200 — beyond throttle
    const r1 = p.parseLine('time=00:00:10.00', 200);
    expect(r1).not.toBeNull();
    // Second emission at t=250 — within 100ms throttle, same percent
    const r2 = p.parseLine('time=00:00:10.00', 250);
    expect(r2).toBeNull();
    // Third emission at t=350 — beyond throttle window, same percent
    const r3 = p.parseLine('time=00:00:10.00', 350);
    expect(r3).not.toBeNull();
  });
});

describe('ProgressParser — reset', () => {
  it('clears duration state on reset', () => {
    const p = makeParser();
    p.parseLine('Duration: 00:00:10.00', FAR_FUTURE);
    p.reset();
    // After reset, no duration → sentinel
    const result = p.parseLine('time=00:00:05.00', FAR_FUTURE + 200);
    expect(result?.percent).toBe(UNKNOWN_DURATION_SENTINEL);
  });
});

describe('ProgressParser — non-matching lines', () => {
  it('returns null for lines with no time= token', () => {
    const p = makeParser();
    const result = p.parseLine('video:1234kB audio:56kB', FAR_FUTURE);
    expect(result).toBeNull();
  });
});
