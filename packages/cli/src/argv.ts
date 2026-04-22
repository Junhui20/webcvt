/**
 * Pure argv parser for @catlabtech/webcvt-cli.
 *
 * No I/O, no process.exit, no console writes.
 * Input: raw tokens from process.argv.slice(2).
 * Output: ParsedArgs discriminated union.
 */

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'list-formats' }
  | {
      kind: 'convert';
      input: string;
      output: string;
      fromHint?: string | undefined;
      toHint?: string | undefined;
      verbose: boolean;
    }
  | { kind: 'bad-usage'; reason: string };

/** Flags that consume the next token as their value. */
const VALUE_FLAGS = new Set(['--from', '--to']);

/** Maximum allowed length for --from / --to hint values. */
const MAX_HINT_LEN = 255;

/** All recognised flags (short and long). */
const KNOWN_FLAGS = new Set([
  '--help',
  '-h',
  '--version',
  '-V',
  '--list-formats',
  '--from',
  '--to',
  '--verbose',
  '-v',
]);

/**
 * Parse raw argv tokens (process.argv.slice(2)) into a ParsedArgs union.
 *
 * State machine:
 *   1. Walk tokens; classify as flag, value, or positional.
 *   2. After `--`, all remaining tokens are positional.
 *   3. Resolve mode priority: help > version > list-formats > convert.
 *   4. Validate convert mode: input + output required; output `-` requires --to.
 */
export function parseArgv(argv: readonly string[]): ParsedArgs {
  let wantsHelp = false;
  let wantsVersion = false;
  let wantsListFormats = false;
  let fromHint: string | undefined;
  let toHint: string | undefined;
  let verbose = false;
  const positionals: string[] = [];

  let i = 0;
  let pastDoubleDash = false;

  while (i < argv.length) {
    const token = argv[i];
    if (token === undefined) {
      /* v8 ignore next 2 -- defensive guard for noUncheckedIndexedAccess; unreachable in practice */
      i++;
      continue;
    }

    if (pastDoubleDash) {
      positionals.push(token);
      i++;
      continue;
    }

    if (token === '--') {
      pastDoubleDash = true;
      i++;
      continue;
    }

    // Long flag with inline value: --from=mp3
    if (token.startsWith('--') && token.includes('=')) {
      const eqIdx = token.indexOf('=');
      const flag = token.slice(0, eqIdx);
      const val = token.slice(eqIdx + 1);
      if (!KNOWN_FLAGS.has(flag)) {
        return { kind: 'bad-usage', reason: `unknown flag '${flag}'` };
      }
      if (flag === '--from' || flag === '--to') {
        if (val.length > MAX_HINT_LEN) {
          return {
            kind: 'bad-usage',
            reason: `value for '${flag}' is too long (max ${MAX_HINT_LEN} chars)`,
          };
        }
        if (flag === '--from') {
          fromHint = val;
        } else {
          toHint = val;
        }
      } else {
        // known flag that doesn't take values but was passed with = — treat inline val as error
        return { kind: 'bad-usage', reason: `flag '${flag}' does not take a value` };
      }
      i++;
      continue;
    }

    // Long flag
    if (token.startsWith('--')) {
      if (!KNOWN_FLAGS.has(token)) {
        return { kind: 'bad-usage', reason: `unknown flag '${token}'` };
      }
      if (VALUE_FLAGS.has(token)) {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('-')) {
          return { kind: 'bad-usage', reason: `flag '${token}' requires a value` };
        }
        if (next.length > MAX_HINT_LEN) {
          return {
            kind: 'bad-usage',
            reason: `value for '${token}' is too long (max ${MAX_HINT_LEN} chars)`,
          };
        }
        if (token === '--from') fromHint = next;
        if (token === '--to') toHint = next;
        i += 2;
        continue;
      }
      if (token === '--help') wantsHelp = true;
      else if (token === '--version') wantsVersion = true;
      else if (token === '--list-formats') wantsListFormats = true;
      else if (token === '--verbose') verbose = true;
      i++;
      continue;
    }

    // Short flag
    if (token.startsWith('-') && token.length === 2) {
      const flag = token;
      if (!KNOWN_FLAGS.has(flag)) {
        return { kind: 'bad-usage', reason: `unknown flag '${flag}'` };
      }
      if (flag === '-h') wantsHelp = true;
      else if (flag === '-V') wantsVersion = true;
      else if (flag === '-v') verbose = true;
      i++;
      continue;
    }

    // Single dash by itself or unrecognised short: treat as positional
    if (token.startsWith('-') && token.length > 2) {
      return { kind: 'bad-usage', reason: `unknown flag '${token}'` };
    }

    // Positional
    positionals.push(token);
    i++;
  }

  // Priority resolution
  if (wantsHelp) return { kind: 'help' };
  if (wantsVersion) return { kind: 'version' };
  if (wantsListFormats) return { kind: 'list-formats' };

  // Convert mode validation
  if (positionals.length === 0) {
    return { kind: 'bad-usage', reason: 'missing <input> and <output> arguments' };
  }
  if (positionals.length === 1) {
    return { kind: 'bad-usage', reason: 'missing <output> argument' };
  }
  if (positionals.length > 2) {
    return {
      kind: 'bad-usage',
      reason: 'too many positional arguments (expected <input> <output>)',
    };
  }

  const input = positionals[0] as string;
  const output = positionals[1] as string;

  if (output === '-' && toHint === undefined) {
    return {
      kind: 'bad-usage',
      reason: "--to is required when output is stdout ('-')",
    };
  }

  return { kind: 'convert', input, output, fromHint, toHint, verbose };
}
