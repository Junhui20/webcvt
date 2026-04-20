import { defaultRegistry } from '@webcvt/core';

/** The full --help text. */
export function buildHelpText(): string {
  const backends = defaultRegistry.list();
  const backendIds = backends.map((b) => b.name).join(', ') || '(none installed)';

  return `\
Usage: webcvt [options] <input> <output>

Convert a file from one format to another using installed backend packages.

Arguments:
  <input>   Input file path, or '-' to read from stdin
  <output>  Output file path, or '-' to write to stdout

Options:
  -h, --help           Show this help message and exit
  -V, --version        Show version number and exit
      --list-formats   List all formats supported by installed backends
      --from <hint>    Override input format detection (extension or MIME type)
      --to <hint>      Override output format (extension or MIME type)
                       Required when <output> is '-' (stdout)
  -v, --verbose        Print progress to stderr during conversion

Installed backends: ${backendIds}

Examples:
  webcvt image.qoi image-copy.qoi
  webcvt data.json data-copy.json
  webcvt - out.json --from application/json --to application/json < data.json
  webcvt data.json - --to application/json

Notes:
  - Install @webcvt/* backend packages to add format support.
  - Use --from/--to for formats without detectable magic bytes (e.g. JSON, CSV).
  - Large files are buffered in memory; first pass supports up to 256 MiB.
  - Long conversions without --verbose will be silent; this is not a hang.
`;
}

/** The --list-formats output: one row per registered backend and its formats. */
export function buildListFormatsText(): string {
  const backends = defaultRegistry.list();

  if (backends.length === 0) {
    return 'No backends installed. Install @webcvt/* backend packages to add format support.\n';
  }

  const lines: string[] = ['Installed backends and formats:\n'];
  for (const backend of backends) {
    lines.push(`  ${backend.name}`);
  }
  lines.push('');
  return lines.join('\n');
}
