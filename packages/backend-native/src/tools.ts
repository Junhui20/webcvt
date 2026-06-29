/**
 * Declarative tool routing table for @catlabtech/webcvt-backend-native.
 *
 * Each conversion (input format → output format) maps to exactly one native
 * tool and a `buildArgs` function that produces the argv ARRAY for spawn().
 *
 * The table is keyed by file EXTENSION pairs (e.g. md→html, pdf→pdfa). Keying
 * by extension — rather than MIME — is deliberate: `pdf→pdf` (re-distill) and
 * `pdf→pdfa` (PDF/A) share the `application/pdf` MIME and would collide under a
 * MIME key. Because `convert()` only receives a Blob (which carries a MIME, not
 * an extension) for the input side, each entry also records the input MIME so
 * the backend can recover the input extension at convert time.
 *
 * Security invariant: buildArgs is the ONLY producer of process arguments. It
 * receives our own temp paths (never user-controlled flags) and returns a
 * string[] handed to spawn(bin, argv) — never to a shell. No value here is ever
 * interpolated into a shell command string.
 *
 * NOTE: This module imports node:path and is therefore Node-only.
 */

import { basename, dirname, extname, join } from 'node:path';
import type { ConvertOptions } from '@catlabtech/webcvt-core';

// ---------------------------------------------------------------------------
// Tool identity
// ---------------------------------------------------------------------------

export type ToolName = 'ffmpeg' | 'pandoc' | 'libreoffice' | 'ghostscript';

/**
 * One routing entry: which tool to run, how to build its argv, and (optionally)
 * where the produced file actually lands when it differs from `outPath`.
 */
export interface ToolRoute {
  /** The native tool that performs this conversion. */
  readonly tool: ToolName;
  /**
   * Build the argv array for spawn(). `inPath` and `outPath` are temp paths
   * owned by the backend. `options` is the caller's ConvertOptions (currently
   * unused by built-in routes but available for future per-conversion tuning).
   */
  buildArgs(inPath: string, outPath: string, options: ConvertOptions): string[];
  /**
   * Returns the path the tool actually writes to, given the temp input and the
   * desired temp output path. Defaults to `outPath`. LibreOffice writes into an
   * outdir using the input basename, so its routes override this.
   */
  resolveProducedPath?(inPath: string, outPath: string): string;
}

/** A declarative table entry: (input ext, output ext) → route. */
export interface RouteEntry {
  /** Input file extension (lowercase, no dot). e.g. "md", "docx". */
  readonly input: string;
  /** Canonical MIME for the input ext — used to recover the ext at convert(). */
  readonly inputMime: string;
  /** Output file extension / logical target. e.g. "html", "pdf", "pdfa". */
  readonly output: string;
  readonly route: ToolRoute;
}

// ---------------------------------------------------------------------------
// Route factories — one per tool, keeps buildArgs construction correct + DRY
// ---------------------------------------------------------------------------

/**
 * pandoc: `pandoc -f <from> [-t <to>] -o <out> <in>`.
 * When `to` is null (e.g. PDF output) the writer is inferred from the output
 * file extension, matching pandoc's own behaviour.
 */
function pandocRoute(from: string, to: string | null): ToolRoute {
  return {
    tool: 'pandoc',
    buildArgs(inPath, outPath) {
      const argv = ['-f', from];
      if (to !== null) argv.push('-t', to);
      argv.push('-o', outPath, inPath);
      return argv;
    },
  };
}

/**
 * libreoffice: `libreoffice --headless --convert-to <ext> --outdir <dir> <in>`.
 * LibreOffice ignores any chosen output filename and writes
 * `<outdir>/<input-basename>.<ext>`, so resolveProducedPath reconstructs it.
 */
function libreofficeRoute(targetExt: string): ToolRoute {
  return {
    tool: 'libreoffice',
    buildArgs(inPath, outPath) {
      return ['--headless', '--convert-to', targetExt, '--outdir', dirname(outPath), inPath];
    },
    resolveProducedPath(inPath, outPath) {
      const base = basename(inPath, extname(inPath));
      return join(dirname(outPath), `${base}.${targetExt}`);
    },
  };
}

/** ghostscript: re-distill an existing PDF through the pdfwrite device. */
function ghostscriptRedistillRoute(): ToolRoute {
  return {
    tool: 'ghostscript',
    buildArgs(inPath, outPath) {
      return [
        '-dNOPAUSE',
        '-dBATCH',
        '-dQUIET',
        '-dSAFER',
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        `-sOutputFile=${outPath}`,
        inPath,
      ];
    },
  };
}

/** ghostscript: convert a PDF to PDF/A-2 via the pdfwrite device. */
function ghostscriptPdfaRoute(): ToolRoute {
  return {
    tool: 'ghostscript',
    buildArgs(inPath, outPath) {
      return [
        '-dNOPAUSE',
        '-dBATCH',
        '-dQUIET',
        '-dSAFER',
        '-dPDFA=2',
        '-dPDFACompatibilityPolicy=1',
        '-sColorConversionStrategy=UseDeviceIndependentColor',
        '-sDEVICE=pdfwrite',
        `-sOutputFile=${outPath}`,
        inPath,
      ];
    },
  };
}

/** ffmpeg: `ffmpeg -y -i <in> <out>` — container/codec inferred from exts. */
function ffmpegRoute(): ToolRoute {
  return {
    tool: 'ffmpeg',
    buildArgs(inPath, outPath) {
      return ['-y', '-i', inPath, outPath];
    },
  };
}

// ---------------------------------------------------------------------------
// Canonical input MIMEs (only the input side needs this, for ext recovery)
// ---------------------------------------------------------------------------

const MIME = {
  md: 'text/markdown',
  rst: 'text/x-rst',
  html: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  latex: 'text/x-tex',
  avi: 'video/x-msvideo',
  flv: 'video/x-flv',
} as const;

// ---------------------------------------------------------------------------
// The routing table
// ---------------------------------------------------------------------------

/**
 * The complete, declarative routing table. Extending the backend is a matter
 * of adding entries here — no other file needs to change.
 */
export const ROUTE_TABLE: readonly RouteEntry[] = [
  // -- pandoc: markup / document text ----------------------------------------
  { input: 'md', inputMime: MIME.md, output: 'html', route: pandocRoute('markdown', 'html') },
  { input: 'md', inputMime: MIME.md, output: 'docx', route: pandocRoute('markdown', 'docx') },
  { input: 'rst', inputMime: MIME.rst, output: 'html', route: pandocRoute('rst', 'html') },
  { input: 'html', inputMime: MIME.html, output: 'md', route: pandocRoute('html', 'markdown') },
  { input: 'docx', inputMime: MIME.docx, output: 'md', route: pandocRoute('docx', 'markdown') },
  { input: 'latex', inputMime: MIME.latex, output: 'pdf', route: pandocRoute('latex', null) },

  // -- libreoffice: office → pdf and office ↔ office --------------------------
  { input: 'docx', inputMime: MIME.docx, output: 'pdf', route: libreofficeRoute('pdf') },
  { input: 'odt', inputMime: MIME.odt, output: 'pdf', route: libreofficeRoute('pdf') },
  { input: 'xlsx', inputMime: MIME.xlsx, output: 'pdf', route: libreofficeRoute('pdf') },
  { input: 'pptx', inputMime: MIME.pptx, output: 'pdf', route: libreofficeRoute('pdf') },
  { input: 'docx', inputMime: MIME.docx, output: 'odt', route: libreofficeRoute('odt') },

  // -- ghostscript: PDF variants ---------------------------------------------
  { input: 'pdf', inputMime: MIME.pdf, output: 'pdf', route: ghostscriptRedistillRoute() },
  { input: 'pdf', inputMime: MIME.pdf, output: 'pdfa', route: ghostscriptPdfaRoute() },

  // -- ffmpeg: legacy AV fallbacks -------------------------------------------
  { input: 'avi', inputMime: MIME.avi, output: 'mp4', route: ffmpegRoute() },
  { input: 'flv', inputMime: MIME.flv, output: 'mp4', route: ffmpegRoute() },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Build the canonical table key for an (input, output) ext pair. */
export function routeKey(inputExt: string, outputExt: string): string {
  return `${inputExt.toLowerCase()}|${outputExt.toLowerCase()}`;
}

/** Index the table once at module load for O(1) lookups. */
const ROUTE_INDEX: ReadonlyMap<string, ToolRoute> = new Map(
  ROUTE_TABLE.map((entry) => [routeKey(entry.input, entry.output), entry.route]),
);

/** Recover an input extension from a Blob's MIME type. */
const INPUT_MIME_TO_EXT: ReadonlyMap<string, string> = new Map(
  ROUTE_TABLE.map((entry) => [entry.inputMime.toLowerCase(), entry.input]),
);

/**
 * Resolve a route for the given input/output formats, or undefined when the
 * pair is not in the table. Only `.ext` is consulted.
 */
export function findRoute(
  input: { readonly ext: string },
  output: { readonly ext: string },
): ToolRoute | undefined {
  return ROUTE_INDEX.get(routeKey(input.ext, output.ext));
}

/**
 * Recover the input file extension for a given Blob MIME type. Falls back to
 * the MIME subtype when the type is not a known input. Returns '' when nothing
 * can be derived.
 */
export function inputExtForMime(mime: string): string {
  const direct = INPUT_MIME_TO_EXT.get(mime.toLowerCase());
  if (direct !== undefined) return direct;
  return (mime.split('/')[1] ?? '').toLowerCase();
}

/** A flat, introspectable view of the table — handy for docs/tests. */
export function listRoutes(): readonly { input: string; output: string; tool: ToolName }[] {
  return ROUTE_TABLE.map((entry) => ({
    input: entry.input,
    output: entry.output,
    tool: entry.route.tool,
  }));
}
