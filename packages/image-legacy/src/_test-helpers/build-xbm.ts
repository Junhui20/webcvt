/**
 * Synthetic XBM fixture builder for @webcvt/image-legacy tests.
 *
 * Constructs minimal but spec-valid XBM ASCII byte sequences in memory.
 * NO binary fixtures are committed to disk — all test inputs are built here.
 *
 * XBM is a fragment of C source code, so all "binary" construction here is
 * actually ASCII string construction encoded to Uint8Array.
 */

const ENCODER = new TextEncoder();

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BuildXbmOptions {
  /** Identifier prefix. Default: 'foo'. */
  prefix?: string;
  width: number;
  height: number;
  /**
   * On-disk packed bytes (LSB-first per byte, stride = ceil(width/8) per row).
   * Length must equal height * ceil(width/8).
   * If omitted, all-zero bytes are used.
   */
  packedBytes?: Uint8Array;
  /** Hotspot coordinates. If provided, emits both _x_hot and _y_hot defines. */
  hotspot?: { x: number; y: number };
  /** Whether to include a trailing comma before `}`. Default: false. */
  trailingComma?: boolean;
  /** Whether to include `unsigned` qualifier: `static unsigned char`. Default: false. */
  unsigned?: boolean;
  /** Number of hex bytes per line. Default: 8 (real-world common). */
  bytesPerLine?: number;
  /** Optional explicit array length in brackets: `foo_bits[N]`. Default: none. */
  explicitLength?: number;
  /** Extra whitespace to inject between tokens (stress-test tokenizer). Default: none. */
  extraWhitespace?: string;
  /** Whether to emit _x_hot before _y_hot (true) or _y_hot before _x_hot (false). Default: true. */
  xHotFirst?: boolean;
}

/**
 * Build a raw XBM source byte sequence from the given options.
 *
 * Returns a Uint8Array of ASCII bytes representing the XBM C source fragment.
 */
export function buildXbm(opts: BuildXbmOptions): Uint8Array {
  const prefix = opts.prefix ?? 'foo';
  const { width, height } = opts;
  const stride = Math.ceil(width / 8);
  const totalBytes = height * stride;
  const packedBytes = opts.packedBytes ?? new Uint8Array(totalBytes);
  const bpl = opts.bytesPerLine ?? 8;
  const ws = opts.extraWhitespace ?? '';
  const xHotFirst = opts.xHotFirst !== false;

  const lines: string[] = [];

  lines.push(`#define ${prefix}_width${ws} ${width}`);
  lines.push(`#define ${prefix}_height${ws} ${height}`);

  if (opts.hotspot !== undefined) {
    if (xHotFirst) {
      lines.push(`#define ${prefix}_x_hot ${opts.hotspot.x}`);
      lines.push(`#define ${prefix}_y_hot ${opts.hotspot.y}`);
    } else {
      lines.push(`#define ${prefix}_y_hot ${opts.hotspot.y}`);
      lines.push(`#define ${prefix}_x_hot ${opts.hotspot.x}`);
    }
  }

  const qualifier = opts.unsigned === true ? 'unsigned ' : '';
  const bracketContent = opts.explicitLength !== undefined ? `${opts.explicitLength}` : '';
  lines.push(`static ${qualifier}char ${prefix}_bits[${bracketContent}] = {`);

  // Emit hex bytes
  const hexParts: string[] = [];
  for (let i = 0; i < totalBytes; i++) {
    hexParts.push(`0x${(packedBytes[i] ?? 0).toString(16).padStart(2, '0')}`);
  }

  const bodyParts: string[] = [];
  for (let i = 0; i < hexParts.length; i += bpl) {
    const chunk = hexParts.slice(i, i + bpl);
    bodyParts.push(`   ${chunk.join(', ')}`);
  }

  const bodyStr = bodyParts.join(',\n');

  const trailingCommaStr = opts.trailingComma === true ? ',' : '';

  lines.push(`${bodyStr}${trailingCommaStr} };`);

  const text = `${lines.join('\n')}\n`;
  return ENCODER.encode(text);
}

/**
 * Build a packed byte array from a pixel array (one byte per pixel, 0 or 1).
 * Packs LSB-first within each byte, stride = ceil(width/8).
 */
export function packPixels(width: number, height: number, pixels: number[]): Uint8Array {
  const stride = Math.ceil(width / 8);
  const packed = new Uint8Array(height * stride);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const pixel = pixels[row * width + col] ?? 0;
      if (pixel !== 0) {
        const byteIdx = row * stride + Math.floor(col / 8);
        const bitIdx = col % 8; // LSB-first
        packed[byteIdx] = (packed[byteIdx] ?? 0) | (1 << bitIdx);
      }
    }
  }

  return packed;
}
