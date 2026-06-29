import { describe, expect, it } from 'vitest';
import { parseAddressList } from './address.ts';

describe('parseAddressList', () => {
  it('parses a bare addr-spec', () => {
    expect(parseAddressList('bob@example.com')).toEqual([{ address: 'bob@example.com' }]);
  });

  it('parses a name + angle-addr', () => {
    expect(parseAddressList('Alice <alice@example.com>')).toEqual([
      { name: 'Alice', address: 'alice@example.com' },
    ]);
  });

  it('unquotes a quoted display name and splits on the top-level comma', () => {
    const list = parseAddressList('"Doe, John" <john@x.com>, jane@y.com');
    expect(list).toEqual([{ name: 'Doe, John', address: 'john@x.com' }, { address: 'jane@y.com' }]);
  });

  it('decodes an RFC 2047 encoded-word in the display name', () => {
    const list = parseAddressList('=?UTF-8?Q?Caf=C3=A9?= <cafe@x.com>');
    expect(list).toEqual([{ name: 'Café', address: 'cafe@x.com' }]);
  });

  it('drops (comments) from the token', () => {
    const list = parseAddressList('bob@example.com (Bob the Builder)');
    expect(list).toEqual([{ address: 'bob@example.com' }]);
  });

  it('ignores empty tokens and a trailing group separator', () => {
    expect(parseAddressList('  , a@x.com ,')).toEqual([{ address: 'a@x.com' }]);
    expect(parseAddressList('Group:;')).toEqual([]);
  });

  it('skips an angle-addr with an empty address', () => {
    expect(parseAddressList('Nobody <>')).toEqual([]);
  });
});
