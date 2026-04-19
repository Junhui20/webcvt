/**
 * Byte-level comparison helpers for binary format tests.
 *
 * Designed for container/codec tests where byte-exact equality matters
 * (e.g., MP4 muxer output must match a reference file produced by ffmpeg).
 */

export interface DiffResult {
  readonly equal: boolean;
  readonly firstDiffOffset?: number;
  readonly expected?: number;
  readonly actual?: number;
  readonly expectedLength: number;
  readonly actualLength: number;
}

/**
 * Compare two byte buffers and return the first divergence point.
 * Useful for diagnostic output rather than just a boolean.
 */
export function diffBytes(expected: Uint8Array, actual: Uint8Array): DiffResult {
  const minLen = Math.min(expected.length, actual.length);
  for (let i = 0; i < minLen; i += 1) {
    if (expected[i] !== actual[i]) {
      return {
        equal: false,
        firstDiffOffset: i,
        expected: expected[i],
        actual: actual[i],
        expectedLength: expected.length,
        actualLength: actual.length,
      };
    }
  }
  if (expected.length !== actual.length) {
    return {
      equal: false,
      firstDiffOffset: minLen,
      expectedLength: expected.length,
      actualLength: actual.length,
    };
  }
  return {
    equal: true,
    expectedLength: expected.length,
    actualLength: actual.length,
  };
}

/**
 * Throw a descriptive error if `actual` does not byte-equal `expected`.
 * The error message includes the first diverging offset and a hex preview
 * around it — invaluable when debugging container muxer bugs.
 */
export function assertBytesEqual(expected: Uint8Array, actual: Uint8Array, message?: string): void {
  const diff = diffBytes(expected, actual);
  if (diff.equal) return;

  const lead = message ? `${message}\n` : '';
  if (diff.firstDiffOffset === undefined) {
    throw new Error(
      `${lead}Length mismatch: expected ${diff.expectedLength}, got ${diff.actualLength}`,
    );
  }
  const offset = diff.firstDiffOffset;
  const expectedHex = hexAround(expected, offset);
  const actualHex = hexAround(actual, offset);
  throw new Error(
    `${lead}First diff at offset ${offset} (0x${offset.toString(16)}):\n` +
      `  expected: ${expectedHex}\n` +
      `  actual:   ${actualHex}\n` +
      `  lengths:  expected=${diff.expectedLength}, actual=${diff.actualLength}`,
  );
}

function hexAround(buf: Uint8Array, center: number, radius = 8): string {
  const start = Math.max(0, center - radius);
  const end = Math.min(buf.length, center + radius + 1);
  const slice = Array.from(buf.subarray(start, end));
  const hex = slice
    .map((b, i) => {
      const h = b.toString(16).padStart(2, '0');
      return start + i === center ? `[${h}]` : h;
    })
    .join(' ');
  return hex;
}

/**
 * Convert a hex string like "89 50 4E 47" or "89504e47" into Uint8Array.
 * Whitespace is stripped. Useful for inline byte literals in tests.
 */
export function hex(input: string): Uint8Array {
  const clean = input.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) {
    throw new Error(`Hex string has odd length: "${input}"`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex pair: "${clean.slice(i * 2, i * 2 + 2)}"`);
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Concatenate multiple byte arrays into one.
 */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
