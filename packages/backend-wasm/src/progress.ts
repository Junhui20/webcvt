/**
 * Progress parsing for @catlabtech/webcvt-backend-wasm.
 *
 * FFmpeg emits progress on stderr (NOT stdout) — Trap #3.
 * We parse `Duration:` to get total time and `time=` to compute percent.
 *
 * Special cases:
 * - `time=N/A`: skip (Trap #6) — do NOT update percent.
 * - No Duration yet: emit percent=-1 sentinel (Trap #7, unknown-duration).
 * - Throttle emissions to PROGRESS_THROTTLE_MS to avoid flooding callers.
 */

import type { ProgressEvent } from '@catlabtech/webcvt-core';
import { PROGRESS_THROTTLE_MS, UNKNOWN_DURATION_SENTINEL } from './constants.ts';

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** Matches `Duration: HH:MM:SS.ms` in ffmpeg stderr header. */
const DURATION_RE = /Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/;

/** Matches `time=HH:MM:SS.ms` in ffmpeg progress line. */
const TIME_RE = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/;

/** Matches `time=N/A` — indicates unknown current time. */
const TIME_NA_RE = /time=N\/A/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts HH:MM:SS.cs (centiseconds) to total seconds as a float.
 */
function hmsToSeconds(h: string, m: string, s: string, cs: string): number {
  return (
    Number.parseInt(h, 10) * 3600 +
    Number.parseInt(m, 10) * 60 +
    Number.parseInt(s, 10) +
    Number.parseInt(cs, 10) / 100
  );
}

// ---------------------------------------------------------------------------
// ProgressParser
// ---------------------------------------------------------------------------

export interface ParsedProgress {
  /** Percent complete 0–100, or UNKNOWN_DURATION_SENTINEL (-1). */
  readonly percent: number;
}

/**
 * Stateful parser for ffmpeg stderr log lines.
 *
 * One instance per ffmpeg.exec() invocation. Holds duration state across calls.
 * Call reset() between runs.
 */
export class ProgressParser {
  private durationSeconds: number | null = null;
  private lastEmitTime = 0;
  private lastPercent = 0;

  /**
   * Resets parser state for a new conversion job.
   * Must be called before starting a new exec.
   */
  reset(): void {
    this.durationSeconds = null;
    this.lastEmitTime = 0;
    this.lastPercent = 0;
  }

  /**
   * Parses a single stderr log line from ffmpeg.
   *
   * @param line  - Raw stderr line text
   * @param now   - Current timestamp in ms (injectable for testing)
   * @returns A ProgressEvent to emit, or null if nothing should be emitted yet.
   */
  parseLine(line: string, now: number = Date.now()): ProgressEvent | null {
    // Try to extract Duration if we don't have it yet
    if (this.durationSeconds === null) {
      const dMatch = DURATION_RE.exec(line);
      if (dMatch !== null) {
        const [, h, m, s, cs] = dMatch;
        if (h !== undefined && m !== undefined && s !== undefined && cs !== undefined) {
          this.durationSeconds = hmsToSeconds(h, m, s, cs);
        }
      }
    }

    // time=N/A: skip — do not emit (Trap #6)
    if (TIME_NA_RE.test(line)) {
      return null;
    }

    // Try to extract current time
    const tMatch = TIME_RE.exec(line);
    if (tMatch === null) {
      return null;
    }

    const [, th, tm, ts, tcs] = tMatch;
    if (th === undefined || tm === undefined || ts === undefined || tcs === undefined) {
      return null;
    }

    const currentSeconds = hmsToSeconds(th, tm, ts, tcs);

    let percent: number;
    if (this.durationSeconds === null || this.durationSeconds === 0) {
      // Unknown duration: emit sentinel (Trap #7)
      percent = UNKNOWN_DURATION_SENTINEL;
    } else {
      percent = Math.min(100, Math.round((currentSeconds / this.durationSeconds) * 100));
    }

    // Throttle: skip if within throttle window AND percent hasn't meaningfully changed.
    // Sentinel (-1) is throttled the same as any other value.
    const sinceLast = now - this.lastEmitTime;
    const percentChanged = percent !== this.lastPercent;
    if (sinceLast < PROGRESS_THROTTLE_MS && !percentChanged) {
      return null;
    }

    this.lastEmitTime = now;
    this.lastPercent = percent;

    return { percent, phase: 'encode' };
  }
}
