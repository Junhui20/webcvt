/**
 * ID3v1 tag parse and serialize.
 *
 * Layout: exactly 128 bytes at end of file.
 *   0-2:   "TAG" magic
 *   3-32:  title (30 bytes, null-padded ASCII)
 *   33-62: artist (30 bytes)
 *   63-92: album (30 bytes)
 *   93-96: year (4 bytes)
 *   97-126: comment (30 bytes; if byte 28 == 0 and byte 29 != 0, byte 29 = track)
 *   127:   genre (index into Winamp genre list)
 *
 * Ref: https://id3.org/ID3v1
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Id3v1Tag {
  title: string;
  artist: string;
  album: string;
  year: string;
  comment: string;
  track?: number;
  genre: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TAG_SIZE = 128;
const TAG_MAGIC = [0x54, 0x41, 0x47]; // "TAG"

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Try to parse an ID3v1 tag from the last 128 bytes of `bytes`.
 *
 * Returns `null` if the file is too short or the last 128 bytes do not start
 * with the "TAG" magic.
 */
export function parseId3v1(bytes: Uint8Array): Id3v1Tag | null {
  if (bytes.length < TAG_SIZE) return null;

  const start = bytes.length - TAG_SIZE;
  if (
    bytes[start] !== TAG_MAGIC[0] ||
    bytes[start + 1] !== TAG_MAGIC[1] ||
    bytes[start + 2] !== TAG_MAGIC[2]
  ) {
    return null;
  }

  const tag = bytes.subarray(start, start + TAG_SIZE);

  const title = decodeLatin1Fixed(tag, 3, 30);
  const artist = decodeLatin1Fixed(tag, 33, 30);
  const album = decodeLatin1Fixed(tag, 63, 30);
  const year = decodeLatin1Fixed(tag, 93, 4);
  const genre = tag[127] ?? 0;

  // ID3v1.1: if comment[28] == 0 and comment[29] != 0, byte 29 is track number.
  const commentByte28 = tag[97 + 28] ?? 0;
  const commentByte29 = tag[97 + 29] ?? 0;
  let track: number | undefined;
  let comment: string;

  if (commentByte28 === 0 && commentByte29 !== 0) {
    // ID3v1.1 — track number in last byte
    comment = decodeLatin1Fixed(tag, 97, 28);
    track = commentByte29;
  } else {
    comment = decodeLatin1Fixed(tag, 97, 30);
  }

  return { title, artist, album, year, comment, track, genre };
}

/**
 * Serialize an ID3v1 tag to exactly 128 bytes.
 */
export function serializeId3v1(tag: Id3v1Tag): Uint8Array {
  const out = new Uint8Array(TAG_SIZE);

  out[0] = 0x54; // T
  out[1] = 0x41; // A
  out[2] = 0x47; // G

  encodeLatin1Fixed(out, 3, tag.title, 30);
  encodeLatin1Fixed(out, 33, tag.artist, 30);
  encodeLatin1Fixed(out, 63, tag.album, 30);
  encodeLatin1Fixed(out, 93, tag.year, 4);

  if (tag.track !== undefined) {
    // ID3v1.1: write comment in 28 bytes, null, track byte
    encodeLatin1Fixed(out, 97, tag.comment, 28);
    out[97 + 28] = 0;
    out[97 + 29] = tag.track & 0xff;
  } else {
    encodeLatin1Fixed(out, 97, tag.comment, 30);
  }

  out[127] = tag.genre & 0xff;

  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodeLatin1Fixed(buf: Uint8Array, offset: number, length: number): string {
  let end = offset + length;
  // Trim trailing null bytes and spaces.
  while (end > offset && (buf[end - 1] === 0 || buf[end - 1] === 0x20)) {
    end--;
  }
  let result = '';
  for (let i = offset; i < end; i++) {
    result += String.fromCharCode(buf[i] ?? 0);
  }
  return result;
}

function encodeLatin1Fixed(out: Uint8Array, offset: number, str: string, length: number): void {
  // Zero-fill the field first (null padding).
  out.fill(0, offset, offset + length);
  const limit = Math.min(str.length, length);
  for (let i = 0; i < limit; i++) {
    out[offset + i] = str.charCodeAt(i) & 0xff;
  }
}
