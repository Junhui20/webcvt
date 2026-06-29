/**
 * Tool resolution for @catlabtech/webcvt-backend-native.
 *
 * findTool(name) resolves a native binary by:
 *   1. honouring a WEBCVT_<TOOL> environment override (absolute path or bare
 *      name searched on PATH), then
 *   2. searching PATH for the tool's known binary name(s).
 *
 * Results are cached per tool. Call clearToolCache() to invalidate (e.g. tests).
 *
 * NOTE: This module imports node:fs and is therefore Node-only.
 */

import { accessSync, constants as fsConstants } from 'node:fs';
import { delimiter, isAbsolute, join, sep } from 'node:path';
import type { ToolName } from './tools.ts';

// ---------------------------------------------------------------------------
// Static tables
// ---------------------------------------------------------------------------

/** Environment variable that overrides the resolved path for each tool. */
const ENV_OVERRIDES: Record<ToolName, string> = {
  ffmpeg: 'WEBCVT_FFMPEG',
  pandoc: 'WEBCVT_PANDOC',
  libreoffice: 'WEBCVT_LIBREOFFICE',
  ghostscript: 'WEBCVT_GHOSTSCRIPT',
};

/** Candidate binary names per tool, tried in order. */
const BINARY_NAMES: Record<ToolName, readonly string[]> = {
  ffmpeg: ['ffmpeg'],
  pandoc: ['pandoc'],
  libreoffice: ['libreoffice', 'soffice'],
  ghostscript: ['gs', 'gswin64c', 'gswin32c'],
};

const IS_WINDOWS = process.platform === 'win32';

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = new Map<ToolName, string | null>();

/** Clear the resolution cache. Primarily for tests / env changes at runtime. */
export function clearToolCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function isExecutable(file: string): boolean {
  try {
    accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** On Windows, try executable extensions; on POSIX the bare name is used. */
function nameCandidates(name: string): string[] {
  /* v8 ignore next 3 -- Windows-only suffixing; CI runs on POSIX */
  if (IS_WINDOWS) {
    return [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name];
  }
  return [name];
}

/** Search every PATH entry for an executable matching `name`. */
function resolveOnPath(name: string): string | null {
  const pathEnv = process.env.PATH ?? '';
  if (pathEnv.length === 0) return null;

  for (const dir of pathEnv.split(delimiter)) {
    if (dir.length === 0) continue;
    for (const candidate of nameCandidates(name)) {
      const full = join(dir, candidate);
      if (isExecutable(full)) return full;
    }
  }
  return null;
}

function resolve(tool: ToolName): string | null {
  // 1. Explicit override wins.
  const override = process.env[ENV_OVERRIDES[tool]];
  if (override !== undefined && override.length > 0) {
    if (isAbsolute(override) || override.includes(sep)) {
      return isExecutable(override) ? override : null;
    }
    return resolveOnPath(override);
  }

  // 2. Fall back to known binary names on PATH.
  for (const bin of BINARY_NAMES[tool]) {
    const found = resolveOnPath(bin);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Resolve the absolute path to the given tool's binary, or null when it cannot
 * be found. Cached per tool.
 */
export function findTool(tool: ToolName): string | null {
  if (cache.has(tool)) return cache.get(tool) ?? null;
  const resolved = resolve(tool);
  cache.set(tool, resolved);
  return resolved;
}
