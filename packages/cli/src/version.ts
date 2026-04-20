import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Read the package version from package.json at runtime.
 * Uses fs.readFile + JSON.parse (compatible with Node 20 ESM).
 */
export async function readPackageVersion(): Promise<string> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // dist/cli.js is one level under the package root
  const pkgPath = join(__dirname, '..', 'package.json');
  const raw = await readFile(pkgPath, 'utf-8');
  const parsed = JSON.parse(raw) as { version?: unknown };
  const version = parsed.version;
  if (typeof version !== 'string') {
    /* v8 ignore next 2 -- defensive fallback for malformed package.json */
    return '0.0.0';
  }
  return version;
}
