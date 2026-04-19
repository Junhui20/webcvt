import { describe, expect, it } from 'vitest';
import { parseId3v1, serializeId3v1 } from './id3v1.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeId3v1Tag({
  title = '',
  artist = '',
  album = '',
  year = '',
  comment = '',
  track,
  genre = 0,
}: Partial<{
  title: string;
  artist: string;
  album: string;
  year: string;
  comment: string;
  track: number;
  genre: number;
}> = {}): Uint8Array {
  const buf = new Uint8Array(128);
  buf[0] = 0x54; // T
  buf[1] = 0x41; // A
  buf[2] = 0x47; // G

  const enc = (str: string, offset: number, len: number): void => {
    buf.fill(0, offset, offset + len);
    for (let i = 0; i < Math.min(str.length, len); i++) {
      buf[offset + i] = str.charCodeAt(i) & 0xff;
    }
  };

  enc(title, 3, 30);
  enc(artist, 33, 30);
  enc(album, 63, 30);
  enc(year, 93, 4);

  if (track !== undefined) {
    enc(comment, 97, 28);
    buf[97 + 28] = 0;
    buf[97 + 29] = track & 0xff;
  } else {
    enc(comment, 97, 30);
  }

  buf[127] = genre & 0xff;
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseId3v1', () => {
  it('returns null when file is too small', () => {
    expect(parseId3v1(new Uint8Array(64))).toBeNull();
  });

  it('returns null when last 128 bytes do not have TAG magic', () => {
    const bytes = new Uint8Array(256);
    expect(parseId3v1(bytes)).toBeNull();
  });

  it('parses a minimal ID3v1 tag', () => {
    const tag = makeId3v1Tag({ title: 'Hello', artist: 'World', genre: 5 });
    // Embed at end of a 256-byte buffer.
    const buf = new Uint8Array(256);
    buf.set(tag, 128);
    const result = parseId3v1(buf);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Hello');
    expect(result!.artist).toBe('World');
    expect(result!.genre).toBe(5);
  });

  it('parses ID3v1.1 track number', () => {
    const tag = makeId3v1Tag({ comment: 'Notes', track: 7 });
    const buf = new Uint8Array(256);
    buf.set(tag, 128);
    const result = parseId3v1(buf);
    expect(result!.track).toBe(7);
    expect(result!.comment).toBe('Notes');
  });

  it('trims trailing null bytes from string fields', () => {
    const tag = makeId3v1Tag({ title: 'Test' });
    const buf = new Uint8Array(256);
    buf.set(tag, 128);
    const result = parseId3v1(buf);
    expect(result!.title).toBe('Test');
  });

  it('parses when comment byte 28 is 0 but byte 29 is 0 (no track)', () => {
    // Both bytes 28 and 29 of comment are 0 → not ID3v1.1 track
    const tag = makeId3v1Tag({ comment: '' });
    const buf = new Uint8Array(256);
    buf.set(tag, 128);
    const result = parseId3v1(buf);
    expect(result!.track).toBeUndefined();
  });

  it('parses exactly 128-byte file', () => {
    const tag = makeId3v1Tag({ title: 'A' });
    const result = parseId3v1(tag);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('A');
  });
});

describe('serializeId3v1', () => {
  it('serializes to exactly 128 bytes', () => {
    const tag = serializeId3v1({
      title: 'Hi',
      artist: '',
      album: '',
      year: '',
      comment: '',
      genre: 0,
    });
    expect(tag.length).toBe(128);
  });

  it('starts with TAG magic', () => {
    const tag = serializeId3v1({
      title: '',
      artist: '',
      album: '',
      year: '',
      comment: '',
      genre: 0,
    });
    expect(tag[0]).toBe(0x54);
    expect(tag[1]).toBe(0x41);
    expect(tag[2]).toBe(0x47);
  });

  it('round-trips through parse', () => {
    const original = {
      title: 'Song',
      artist: 'Band',
      album: 'Record',
      year: '2024',
      comment: 'hello',
      track: 3,
      genre: 17,
    };
    const serialized = serializeId3v1(original);
    const buf = new Uint8Array(256);
    buf.set(serialized, 128);
    const parsed = parseId3v1(buf);
    expect(parsed!.title).toBe(original.title);
    expect(parsed!.artist).toBe(original.artist);
    expect(parsed!.album).toBe(original.album);
    expect(parsed!.year).toBe(original.year);
    expect(parsed!.comment).toBe(original.comment);
    expect(parsed!.track).toBe(original.track);
    expect(parsed!.genre).toBe(original.genre);
  });

  it('writes genre to byte 127', () => {
    const tag = serializeId3v1({
      title: '',
      artist: '',
      album: '',
      year: '',
      comment: '',
      genre: 42,
    });
    expect(tag[127]).toBe(42);
  });

  it('writes track in ID3v1.1 format', () => {
    const tag = serializeId3v1({
      title: '',
      artist: '',
      album: '',
      year: '',
      comment: '',
      track: 5,
      genre: 0,
    });
    expect(tag[97 + 28]).toBe(0);
    expect(tag[97 + 29]).toBe(5);
  });
});
