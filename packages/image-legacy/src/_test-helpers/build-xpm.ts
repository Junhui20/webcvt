/**
 * Synthetic XPM3 fixture builder for @catlabtech/webcvt-image-legacy tests.
 *
 * Constructs minimal but spec-valid XPM ASCII byte sequences in memory.
 * NO binary fixtures are committed to disk — all test inputs are built here.
 *
 * XPM3 is a C source fragment, so all "binary" construction here is
 * ASCII string construction encoded to Uint8Array.
 */

const ENCODER = new TextEncoder();

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ColorDef {
  /** The key string (must be exactly cpp chars). */
  key: string;
  /** The colour spec: '#RRGGBB', 'None', a named colour, etc. */
  spec: string;
}

export interface BuildXpmOptions {
  /** Array name (without _xpm suffix). Default: 'image'. */
  name?: string;
  width: number;
  height: number;
  /** Colour definitions. Length must equal ncolors. If omitted, a single black entry is used. */
  colors?: ColorDef[];
  /** Pixel rows as an array of strings, each exactly width*cpp chars.
   * If omitted, all pixels are set to the first colour key. */
  pixelRows?: string[];
  /** Hotspot coordinates. If provided, emits 6-token header. */
  hotspot?: { x: number; y: number };
  /** chars_per_pixel. Default: 1. */
  cpp?: 1 | 2;
  /** Whether to prepend the XPM magic comment. Default: true. */
  xpmComment?: boolean;
  /**
   * Inject a block comment between string literals (stress-test Trap #10).
   * Pass the literal comment text e.g. "/ * comment * /" (without the spaces).
   * If provided, this string is inserted between every pair of string entries.
   */
  interComment?: string;
  /**
   * Override the raw header string (for testing malformed headers).
   * When set, width/height/cpp/hotspot are ignored for header generation.
   */
  rawHeader?: string;
  /**
   * Extra whitespace to inject before the static keyword.
   */
  leadingWhitespace?: string;
}

/**
 * Build a raw XPM3 source byte sequence from the given options.
 * Returns a Uint8Array of ASCII bytes.
 */
export function buildXpm(opts: BuildXpmOptions): Uint8Array {
  const name = opts.name ?? 'image';
  const { width, height } = opts;
  const cpp = opts.cpp ?? 1;
  const xpmComment = opts.xpmComment !== false;

  // Default: single black colour, key = ' ' (space for cpp=1)
  const defaultKey = cpp === 1 ? ' ' : '  ';
  const colors: ColorDef[] = opts.colors ?? [{ key: defaultKey, spec: '#000000' }];

  const ncolors = colors.length;

  // Default pixel rows: all first colour key
  const firstKey = colors[0]?.key ?? defaultKey;
  const pixelRows: string[] =
    opts.pixelRows ?? Array.from({ length: height }, () => firstKey.repeat(width));

  const inter = opts.interComment !== undefined ? `\n${opts.interComment}\n` : '\n';

  const parts: string[] = [];

  if (xpmComment) {
    parts.push('/* XPM */\n');
  }

  const ws = opts.leadingWhitespace ?? '';
  parts.push(`${ws}static char * ${name}_xpm[] = {\n`);

  // Header string
  let headerStr: string;
  if (opts.rawHeader !== undefined) {
    headerStr = opts.rawHeader;
  } else if (opts.hotspot !== undefined) {
    headerStr = `${width} ${height} ${ncolors} ${cpp} ${opts.hotspot.x} ${opts.hotspot.y}`;
  } else {
    headerStr = `${width} ${height} ${ncolors} ${cpp}`;
  }
  parts.push(`"${headerStr}",${inter}`);

  // Colour defs
  for (let i = 0; i < colors.length; i++) {
    const { key, spec } = colors[i] ?? { key: defaultKey, spec: '#000000' };
    const isLastColor = i === colors.length - 1 && pixelRows.length === 0;
    const comma = isLastColor ? '' : ',';
    parts.push(`"${key} c ${spec}"${comma}${inter}`);
  }

  // Pixel rows
  for (let i = 0; i < pixelRows.length; i++) {
    const row = pixelRows[i] ?? '';
    const isLast = i === pixelRows.length - 1;
    const comma = isLast ? '' : ',';
    parts.push(`"${row}"${comma}${inter}`);
  }

  parts.push('};\n');

  return ENCODER.encode(parts.join(''));
}

/**
 * Build an RGBA pixel array from a colour grid.
 * grid is a flat array of [r, g, b, a] tuples, row-major.
 */
export function buildRgbaPixels(
  width: number,
  height: number,
  grid: ReadonlyArray<readonly [number, number, number, number]>,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b, a] = grid[i] ?? [0, 0, 0, 255];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return out;
}
