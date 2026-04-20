/**
 * Top-level dispatch serializer for @webcvt/data-text.
 *
 * serializeDataText(file) switches on file.kind and dispatches to the
 * format's serializer. Semantic round-trip equivalence is guaranteed;
 * byte-identical round-trip is NOT (JSON whitespace may vary, CSV may
 * quote more fields than strictly necessary, INI and ENV lose comments
 * and original quoting style).
 */

import { serializeDelimited } from './csv.ts';
import { serializeEnv } from './env.ts';
import { serializeIni } from './ini.ts';
import { serializeJson } from './json.ts';
import { serializeJsonl } from './jsonl.ts';
import type { DataTextFile } from './parser.ts';
import { serializeToml } from './toml.ts';

// Re-export for convenience
export type { DataTextFile };

/**
 * Serialize a DataTextFile to a string.
 *
 * @param file  A discriminated-union value returned by parseDataText or
 *              constructed directly from the format-specific types.
 */
export function serializeDataText(file: DataTextFile): string {
  switch (file.kind) {
    case 'json':
      return serializeJson(file.file);
    case 'csv':
      return serializeDelimited(file.file);
    case 'tsv':
      return serializeDelimited(file.file);
    case 'ini':
      return serializeIni(file.file);
    case 'env':
      return serializeEnv(file.file);
    case 'jsonl':
      return serializeJsonl(file.file);
    case 'toml':
      return serializeToml(file.file);
  }
}
