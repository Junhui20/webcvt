import { describe, expect, it } from 'vitest';
import { parseArgv } from './argv.ts';

describe('parseArgv', () => {
  it("parses 'webcvt in.mp3 out.mp3' to convert kind", () => {
    const result = parseArgv(['in.mp3', 'out.mp3']);
    expect(result).toEqual({
      kind: 'convert',
      input: 'in.mp3',
      output: 'out.mp3',
      fromHint: undefined,
      toHint: undefined,
      verbose: false,
    });
  });

  it("parses 'webcvt - out.json --to application/json' to stdin source", () => {
    const result = parseArgv(['-', 'out.json', '--to', 'application/json']);
    expect(result).toEqual({
      kind: 'convert',
      input: '-',
      output: 'out.json',
      fromHint: undefined,
      toHint: 'application/json',
      verbose: false,
    });
  });

  it("rejects '-' output without --to", () => {
    const result = parseArgv(['in.json', '-']);
    expect(result.kind).toBe('bad-usage');
    if (result.kind === 'bad-usage') {
      expect(result.reason).toContain('--to');
    }
  });

  it("treats anything after '--' as positional", () => {
    const result = parseArgv(['--', 'in.mp3', 'out.mp3']);
    expect(result).toMatchObject({
      kind: 'convert',
      input: 'in.mp3',
      output: 'out.mp3',
    });
  });

  it('resolves --help even when other flags present', () => {
    const result = parseArgv(['--verbose', '--help', 'in.mp3', 'out.mp3']);
    expect(result.kind).toBe('help');
  });

  it('resolves -h flag to help', () => {
    const result = parseArgv(['-h']);
    expect(result.kind).toBe('help');
  });

  it("rejects unknown long flag '--badness'", () => {
    const result = parseArgv(['--badness', 'in.mp3', 'out.mp3']);
    expect(result.kind).toBe('bad-usage');
    if (result.kind === 'bad-usage') {
      expect(result.reason).toContain('--badness');
    }
  });

  it('reads --from value from next token', () => {
    const result = parseArgv(['--from', 'mp3', 'in', 'out.mp3']);
    expect(result).toMatchObject({ kind: 'convert', fromHint: 'mp3' });
  });

  it('reads --from=mp3 inline syntax', () => {
    const result = parseArgv(['--from=mp3', 'in', 'out.mp3']);
    expect(result).toMatchObject({ kind: 'convert', fromHint: 'mp3' });
  });

  it('reads --to value from next token', () => {
    const result = parseArgv(['in.json', 'out.json', '--to', 'application/json']);
    expect(result).toMatchObject({ kind: 'convert', toHint: 'application/json' });
  });

  it('rejects three positionals', () => {
    const result = parseArgv(['a', 'b', 'c']);
    expect(result.kind).toBe('bad-usage');
    if (result.kind === 'bad-usage') {
      expect(result.reason).toContain('too many');
    }
  });

  it('rejects missing both positionals', () => {
    const result = parseArgv([]);
    expect(result.kind).toBe('bad-usage');
    if (result.kind === 'bad-usage') {
      expect(result.reason).toContain('missing');
    }
  });

  it('rejects missing output positional', () => {
    const result = parseArgv(['in.mp3']);
    expect(result.kind).toBe('bad-usage');
    if (result.kind === 'bad-usage') {
      expect(result.reason).toContain('output');
    }
  });

  it('parses --version flag', () => {
    const result = parseArgv(['--version']);
    expect(result.kind).toBe('version');
  });

  it('parses -V flag', () => {
    const result = parseArgv(['-V']);
    expect(result.kind).toBe('version');
  });

  it('parses --list-formats flag', () => {
    const result = parseArgv(['--list-formats']);
    expect(result.kind).toBe('list-formats');
  });

  it('parses --verbose flag', () => {
    const result = parseArgv(['in.mp3', 'out.mp3', '--verbose']);
    expect(result).toMatchObject({ kind: 'convert', verbose: true });
  });

  it('parses -v flag', () => {
    const result = parseArgv(['in.mp3', 'out.mp3', '-v']);
    expect(result).toMatchObject({ kind: 'convert', verbose: true });
  });

  it('priority: help > version', () => {
    const result = parseArgv(['--version', '--help']);
    expect(result.kind).toBe('help');
  });

  it('priority: version > list-formats', () => {
    const result = parseArgv(['--list-formats', '--version']);
    expect(result.kind).toBe('version');
  });

  it('rejects --from without a value (next token is a flag)', () => {
    const result = parseArgv(['--from', '--verbose', 'in', 'out']);
    expect(result.kind).toBe('bad-usage');
  });

  it('handles stdout output with --to provided', () => {
    const result = parseArgv(['in.json', '-', '--to', 'application/json']);
    expect(result).toMatchObject({
      kind: 'convert',
      input: 'in.json',
      output: '-',
      toHint: 'application/json',
    });
  });

  it('rejects unknown short flag', () => {
    const result = parseArgv(['-x', 'in.mp3', 'out.mp3']);
    expect(result.kind).toBe('bad-usage');
  });

  it("treats bare '-' as stdin positional when used as input", () => {
    const result = parseArgv(['-', 'out.mp3', '--from', 'audio/mpeg', '--to', 'audio/mpeg']);
    expect(result).toMatchObject({ kind: 'convert', input: '-', output: 'out.mp3' });
  });

  it('reads --to=application/json inline value', () => {
    const result = parseArgv(['in.json', 'out.json', '--to=application/json']);
    expect(result).toMatchObject({ kind: 'convert', toHint: 'application/json' });
  });

  it('rejects --help=value (flag that does not take a value)', () => {
    const result = parseArgv(['--help=foo', 'in', 'out']);
    expect(result.kind).toBe('bad-usage');
    if (result.kind === 'bad-usage') {
      expect(result.reason).toContain('does not take a value');
    }
  });

  it('rejects unknown flag with inline value like --bogus=xyz', () => {
    const result = parseArgv(['--bogus=xyz', 'in', 'out']);
    expect(result.kind).toBe('bad-usage');
    if (result.kind === 'bad-usage') {
      expect(result.reason).toContain('--bogus');
    }
  });

  it('rejects multi-char short flag like -verbose (no double dash)', () => {
    // -verbose has length > 2 and starts with '-' but not '--'
    const result = parseArgv(['-verbose', 'in', 'out']);
    expect(result.kind).toBe('bad-usage');
    if (result.kind === 'bad-usage') {
      expect(result.reason).toContain('-verbose');
    }
  });

  it('treats dash-prefixed positional after -- as filename, not flag', () => {
    const result = parseArgv(['--', '-strange-name.mp3', 'out.mp3']);
    expect(result).toMatchObject({
      kind: 'convert',
      input: '-strange-name.mp3',
      output: 'out.mp3',
    });
  });

  it('rejects --from value longer than 255 chars via next-token path', () => {
    const longVal = 'a'.repeat(256);
    const result = parseArgv(['--from', longVal, 'in', 'out']);
    expect(result.kind).toBe('bad-usage');
    if (result.kind === 'bad-usage') {
      expect(result.reason).toContain('--from');
      expect(result.reason).toContain('too long');
    }
  });

  it('rejects --from value longer than 255 chars via inline = path', () => {
    const longVal = 'a'.repeat(256);
    const result = parseArgv([`--from=${longVal}`, 'in', 'out']);
    expect(result.kind).toBe('bad-usage');
    if (result.kind === 'bad-usage') {
      expect(result.reason).toContain('--from');
      expect(result.reason).toContain('too long');
    }
  });

  it('rejects --to value longer than 255 chars', () => {
    const longVal = 'x'.repeat(1000);
    const result = parseArgv(['in', 'out', '--to', longVal]);
    expect(result.kind).toBe('bad-usage');
    if (result.kind === 'bad-usage') {
      expect(result.reason).toContain('--to');
      expect(result.reason).toContain('too long');
    }
  });
});
