# archive-zip design

> Implementation reference for `@catlabtech/webcvt-archive-zip`. Write the code
> from this note plus the linked official specs. Do not consult competing
> implementations except for debugging spec-ambiguous edge cases.

## Format overview

Three classical archive formats live under one umbrella package because
they share the same browser-side runtime concerns (binary record
walking, optional decompression via the W3C Compression Streams API,
identical security caps). **ZIP** (PKWARE APPNOTE.TXT) is a
random-access archive whose authoritative directory of entries lives at
the END of the file in the End-of-Central-Directory record (EOCD).
Entries can be stored verbatim or Deflate-compressed, with each entry's
metadata duplicated between an inline local file header and the central
directory. **TAR** (POSIX 1003.1 `ustar`) is a stream-oriented archive
of fixed 512-byte ustar header blocks each followed by zero or more
512-byte data blocks; there is no global directory and no built-in
compression. **GZip** (RFC 1952) is a single-stream compression
envelope wrapping arbitrary byte payloads — a `.tar.gz` is a tar stream
fed through one gzip envelope, which is the canonical real-world
combination.

The browser ships a native `DecompressionStream` / `CompressionStream`
API supporting `gzip`, `deflate`, and `deflate-raw` algorithms. ZIP
entries use **raw Deflate** (no zlib header), so we wire them through
`'deflate-raw'`. GZip files wire through `'gzip'`. **bzip2 and xz are
NOT supported by Compression Streams** — the W3C spec lists only the
three above — so the first-pass `archive-zip` package detects the
magic and delegates to `@catlabtech/webcvt-backend-wasm` rather than attempting
native decode.

## Scope statement

**This note covers a FIRST-PASS implementation, not full ZIP/TAR
feature parity with libraries like jszip or node-tar.** The goal is
the smallest record set that can read and write modern, well-formed
single-volume ZIP files (stored or Deflate-compressed), POSIX `ustar`
tar files (regular files + directories only), and gzip-wrapped
streams. Phase 4.5+ will extend to ZIP64, encryption, PAX/GNU tar
extensions, multi-member gzip, and native bz2/xz. See "Out of scope
(DEFERRED)" below for the explicit deferred list.

**In scope (first pass for `archive-zip`, ~1,500 LOC):**

- **ZIP read**: parse the EOCD record (with backward search from
  end-of-file for the `0x06054b50` signature), walk the central
  directory, expose each entry's name + uncompressed size + compressed
  size + CRC-32 + compression method + relative-local-header offset,
  decompress entry data lazily on demand
- **ZIP write**: serialize entries with optional Deflate compression
  via `CompressionStream('deflate-raw')`, emit local file headers
  followed by a central directory and EOCD
- **ZIP compression methods**: only **0 (stored / no compression)** and
  **8 (Deflate)**. All other methods (BZip2 / method 12, LZMA /
  method 14, ZStandard / method 93, XZ / method 95, AES-encrypted
  variants, ...) are rejected with `ZipUnsupportedMethodError`.
- **TAR read**: linear walk of 512-byte ustar header blocks, expose
  regular files (typeflag `'0'` or `'\0'`) and directories
  (typeflag `'5'`); reject all other typeflags in first pass
- **TAR write**: emit `ustar\0` magic-bearing header + padded data
  blocks per entry; write the mandatory final 1024-byte zero-padded
  end-of-archive marker (two empty 512-byte blocks)
- **GZip wrapper** (single-member): wrap
  `DecompressionStream('gzip')` for reading and
  `CompressionStream('gzip')` for writing. Multi-member gzip files
  (concatenated members) deferred to Phase 4.5.
- **bz2 / xz fallback note**: detect the magic and throw
  `ArchiveBz2NotSupportedError` / `ArchiveXzNotSupportedError`. The
  BackendRegistry then routes to `@catlabtech/webcvt-backend-wasm`.
- **Combined `tar.gz` / `.tgz` support**: pipe the input through
  `DecompressionStream('gzip')`, then feed the resulting stream to
  `parseTar`. Most real-world `.tar.gz` is one gzip member wrapping a
  tar stream.
- Round-trip parse → serialize **semantic** equivalence (NOT
  byte-identical — Deflate output is non-deterministic, gzip mtime
  defaults to 0, ZIP central-directory ordering may differ between
  authoring tools, tar timestamps round to whole seconds)
- Public API surfaces: `parseZip`, `serializeZip`, `parseTar`,
  `serializeTar`, plus stream wrappers `decompressGzip`,
  `compressGzip`

**Out of scope (Phase 4.5+, DEFERRED):**

- **ZIP64 extensions** (EOCD64 locator + EOCD64 record, central
  directory entries > 4 GiB, archives > 4 GiB). Reader throws
  `ZipNotZip64SupportedError` if the EOCD64 signature
  (`0x06064b50`) is seen, or if EOCD field values are sentinel
  `0xFFFFFFFF` / `0xFFFF`.
- **ZIP encryption**: traditional PKWARE encryption (general-purpose
  bit flag bit 0 set) and AES-256 (WinZip extension): throw
  `ZipEncryptedNotSupportedError`.
- **Compression methods other than Stored (0) and Deflate (8)**:
  rejected at parse time with `ZipUnsupportedMethodError`.
- **Multi-disk ZIP archives** (`number_of_this_disk != 0` in EOCD,
  spanned `.z01` / `.z02` files): rejected with
  `ZipMultiDiskNotSupportedError`.
- **ZIP archive comments larger than 4 KiB**: capped to bound the EOCD
  backward search.
- **TAR PAX extended headers** (typeflag `'x'` for per-entry, `'g'`
  for global): rejected with `TarPaxNotSupportedError`.
- **TAR GNU extensions** (`'L'` LongLink for long filenames,
  `'K'` LongLink for long link names, sparse files `'S'`): rejected.
- **TAR symlinks** (typeflag `'2'`), **hardlinks** (`'1'`), **char
  device** (`'3'`), **block device** (`'4'`), **FIFO** (`'6'`):
  rejected with `TarUnsupportedTypeflagError`.
- **Pre-POSIX V7 tar** (no `ustar\0` magic): rejected with
  `TarNonUstarNotSupportedError`.
- **Multi-member gzip files** (legitimate per RFC 1952 §2.2 — gzip
  decoder may concatenate output of all members): rejected after the
  first member with `GzipMultiMemberNotSupportedError`.
- **Native bzip2 parsing**: deferred to backend-wasm.
- **Native xz parsing**: deferred to backend-wasm.
- **Streaming append-mode ZIP writes** (mid-file central-directory
  rewrite for `zip -u`-style updates).
- **PKWARE Strong Encryption Specification** and **digital signature
  verification** (central directory digital signature record
  `0x05054b50`).
- **Self-extracting ZIP** (executable prefix before the first local
  file header — the EOCD backward search would find the EOCD anyway,
  but offset arithmetic into the prefix is deferred).

## Official references

- PKWARE **APPNOTE.TXT** — `.ZIP File Format Specification`, version
  6.3.10 (current as of writing). Substantive spec for local file
  headers, central directory, EOCD, ZIP64, compression method codes,
  general-purpose bit flag, encryption:
  https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
- IEEE **Std 1003.1-2017** (POSIX.1-2017) §pax — defines the `ustar`
  tar format inherited as the baseline by all modern tar tools:
  https://pubs.opengroup.org/onlinepubs/9699919799/utilities/pax.html
- IETF **RFC 1950** — ZLIB Compressed Data Format Specification
  (referenced for the wrapper that `'deflate'` expects but `'deflate-raw'`
  does NOT — see Trap #10): https://www.rfc-editor.org/rfc/rfc1950
- IETF **RFC 1951** — DEFLATE Compressed Data Format Specification
  (the substantive compression algorithm used by ZIP method 8 and as
  the inner payload of gzip): https://www.rfc-editor.org/rfc/rfc1951
- IETF **RFC 1952** — GZIP file format specification (member header,
  flags, optional FNAME/FCOMMENT/FEXTRA/FHCRC fields, trailing
  CRC-32 + ISIZE): https://www.rfc-editor.org/rfc/rfc1952
- **bzip2 file format** (informal but authoritative — Julian Seward's
  notes; referenced solely for magic-byte detection):
  https://sourceware.org/bzip2/manual/manual.html
- **XZ File Format** specification (XZ Utils project; referenced for
  magic-byte detection and the deferred-to-WASM rationale):
  https://tukaani.org/xz/xz-file-format.txt
- W3C **Compression Streams** specification — defines
  `CompressionStream` and `DecompressionStream` and enumerates the
  three supported algorithms (`'gzip'`, `'deflate'`, `'deflate-raw'`):
  https://wicg.github.io/compression/

## ZIP format primer

A ZIP file is a sequence of **local file records** (one per entry,
each = local file header + optional extra fields + file data + optional
data descriptor) followed by a **central directory** (one central
directory header per entry, recapitulating the metadata) followed by
exactly one **End-of-Central-Directory record** (EOCD). The EOCD
points back at the start of the central directory, and each central
directory entry points back at its corresponding local file header.

```
+--------------------------+
| local file header   #1   |
| [extra fields]      #1   |
| file data           #1   |
| [data descriptor]   #1   |
+--------------------------+
| local file header   #2   |
| ...                      |
+--------------------------+
| central directory   #1   |
| central directory   #2   |
| ...                 #N   |
+--------------------------+
| End-of-Central-Directory |
| (+ optional comment)     |
+--------------------------+
```

The reader normally enters from the END (EOCD backward search), reads
the central directory, then visits each local file header lazily.
ZIP64 (deferred) extends every file-position and size field via an
extra-field block when the value would otherwise overflow u32.

## TAR format primer

A `ustar` tar file is a contiguous stream of 512-byte blocks. Every
entry occupies one **header block** (whose layout below) plus
`ceil(size / 512)` **data blocks**. The end of the archive is marked
by **two consecutive zero-filled 512-byte blocks** (1024 bytes of
zero). Some tar tools further pad to a "blocking factor" multiple
(typically 20 blocks = 10240 bytes) by appending more zero blocks
after the EOA marker — readers must tolerate this trailing zero
padding.

There is no central directory, no random access, and no per-archive
header. To find an entry by name, the reader walks linearly. To list
contents, the reader walks linearly. To extract one entry, the reader
walks linearly. This stream-oriented design is what makes
`gzip-then-tar` (`.tar.gz`) the dominant Unix archive form: gzip is a
streaming compressor, and tar's linear walk consumes the gzip output
incrementally.

## Compression-stream wrappers

The browser provides:

- `new CompressionStream(format)` and `new DecompressionStream(format)`
  with `format` ∈ `{'gzip', 'deflate', 'deflate-raw'}`.
- Both are TransformStreams; pipe a `ReadableStream<Uint8Array>` in,
  read a `ReadableStream<Uint8Array>` out.

We use the three formats as follows in this package:

- **`'deflate-raw'`** — for ZIP entries with method 8. Raw Deflate, no
  zlib wrapper. (Trap #10: this is **the** common bug source.)
- **`'gzip'`** — for `.gz` files and as the outer envelope of `.tar.gz`.
- **`'deflate'`** — NOT used by this package. (zlib-wrapped Deflate
  appears in PNG / HTTP / WebSocket but not in ZIP, gzip, or tar.)

For **bzip2** and **xz** the package detects the file magic and
returns a typed error so the BackendRegistry can route to
`@catlabtech/webcvt-backend-wasm`. The WASM backend already includes ffmpeg's
libbz2 and liblzma builds.

## Required structures for first pass

### ZIP — Local File Header (signature `0x04034b50`, fixed 30 bytes + variable)

```
offset  bytes  field
 0       4    local file header signature        0x04034b50 (LE: 50 4b 03 04)
 4       2    version needed to extract          u16 LE; 20 = no encryption + no ZIP64
 6       2    general purpose bit flag           u16 LE; bit 0 = encrypted (rejected),
                                                  bit 3 = data descriptor follows file data,
                                                  bit 11 = filename is UTF-8
 8       2    compression method                 u16 LE; 0 = Stored, 8 = Deflate
10       2    last mod file time (MS-DOS)        u16 LE; bits 15-11 hour, 10-5 minute, 4-0 second/2
12       2    last mod file date (MS-DOS)        u16 LE; bits 15-9 (year - 1980), 8-5 month, 4-0 day
14       4    CRC-32 of uncompressed data        u32 LE; zlib variant (poly 0xEDB88320 reflected)
18       4    compressed size                    u32 LE; 0 if data descriptor used (Trap #9)
22       4    uncompressed size                  u32 LE; 0 if data descriptor used (Trap #9)
26       2    file name length n                 u16 LE; capped at 4096
28       2    extra field length m               u16 LE; capped at 4096
30       n    file name                          UTF-8 (Trap #7)
30+n     m    extra field                        TLV blocks; ZIP64 extra-id 0x0001 rejected
```

The compressed file data follows immediately. If general-purpose bit 3
is set, a 12-byte (or 16-byte with optional `0x08074b50` signature)
data descriptor follows the file data carrying the real CRC and sizes.
**The reader never trusts these local-header sizes** — see Trap #9.

### ZIP — Central Directory Header (signature `0x02014b50`, fixed 46 bytes + variable)

```
offset  bytes  field
 0       4    central directory signature        0x02014b50
 4       2    version made by                    u16 LE
 6       2    version needed to extract          u16 LE; 20 expected
 8       2    general purpose bit flag           u16 LE
10       2    compression method                 u16 LE
12       2    last mod file time                 u16 LE
14       2    last mod file date                 u16 LE
16       4    CRC-32                             u32 LE
20       4    compressed size                    u32 LE
24       4    uncompressed size                  u32 LE
28       2    file name length n                 u16 LE
30       2    extra field length m               u16 LE
32       2    file comment length k              u16 LE
34       2    disk number start                  u16 LE; must be 0 (Trap #15)
36       2    internal file attributes           u16 LE
38       4    external file attributes           u32 LE; high 16 bits = Unix mode
42       4    relative offset of local header    u32 LE; from start of disk
46       n    file name
46+n     m    extra field
46+n+m   k    file comment
```

Sizes here are authoritative (unlike the local-header copies — Trap #9).

### ZIP — End of Central Directory Record (signature `0x06054b50`, fixed 22 bytes + variable comment)

```
offset  bytes  field
 0       4    EOCD signature                     0x06054b50 (LE: 50 4b 05 06)
 4       2    number of this disk                u16 LE; must be 0 (Trap #15)
 6       2    disk where central directory starts u16 LE; must be 0
 8       2    number of central dir records on this disk  u16 LE
10       2    total number of central dir records         u16 LE; must equal previous
12       4    size of central directory          u32 LE; bytes
16       4    offset of central directory        u32 LE; from start of file
20       2    .ZIP file comment length           u16 LE; capped at 4096
22       L    .ZIP file comment                  bytes; we ignore the content
```

EOCD is at the END of the file, with a variable-length comment
(0..65535 bytes per spec; capped at 4 KiB by us — Trap #3).

### TAR — `ustar` Header Block (POSIX 1003.1, fixed 512 bytes)

```
offset  bytes  field           type / encoding
  0     100    name            NUL-terminated ASCII; entries with `..` rejected
100       8    mode            ASCII octal, NUL- or space-terminated
108       8    uid             ASCII octal
116       8    gid             ASCII octal
124      12    size            ASCII octal; up to 11 digits = 8 GiB max
136      12    mtime           ASCII octal; seconds since Unix epoch
148       8    chksum          ASCII octal; sum of all 512 header bytes
                                with chksum field treated as 8 spaces (Trap #5)
156       1    typeflag        '0' or '\0' = regular, '5' = directory;
                                others rejected (Trap: see deferred list)
157     100    linkname        for typeflag '1'/'2'; we reject those typeflags
257       6    magic           "ustar\0" — required (Trap #11)
263       2    version         "00"
265      32    uname           ASCII NUL-terminated; informational
297      32    gname           ASCII NUL-terminated; informational
329       8    devmajor        ASCII octal; we reject device-file typeflags
337       8    devminor        ASCII octal
345     155    prefix          ASCII NUL-terminated; if present, full name = prefix + '/' + name
500      12    pad             zero
```

If `prefix` is non-empty, the effective entry name is
`prefix + '/' + name`. The 100-byte `name` + 155-byte `prefix` allows
filenames up to 256 chars (with one separator). Anything longer
requires PAX or GNU extensions (deferred).

### GZip — Member Header (RFC 1952, fixed 10 bytes + optional)

```
offset  bytes  field
 0       2    magic                            0x1F 0x8B (Trap: byte order matters)
 2       1    CM (compression method)          0x08 = Deflate; reject others
 3       1    FLG (flags)                      bit 0 FTEXT (informational),
                                                bit 1 FHCRC (16-bit header CRC follows),
                                                bit 2 FEXTRA (variable extra field follows),
                                                bit 3 FNAME (zero-terminated original filename),
                                                bit 4 FCOMMENT (zero-terminated comment)
 4       4    MTIME                            u32 LE; modification time, 0 = unknown
 8       1    XFL (extra flags)                informational
 9       1    OS                               OS source, informational
10       *    optional FEXTRA / FNAME / FCOMMENT / FHCRC (per FLG)
 *       *    compressed Deflate data          (raw DEFLATE; same algorithm as ZIP method 8)
end-8    4    CRC-32 of uncompressed data      u32 LE; zlib variant
end-4    4    ISIZE                            u32 LE; uncompressed size mod 2^32
```

The native browser `DecompressionStream('gzip')` handles all of this
internally — we only parse the header in `parseGzip` to extract the
optional FNAME for surface in the API.

## Key types we will model

```ts
interface ZipEntry {
  /** UTF-8 decoded entry name; '/'-separated forward slashes only. */
  name: string;
  /** Compression method code; first pass: 0 (stored) or 8 (deflate). */
  method: 0 | 8;
  /** CRC-32 (zlib variant) of uncompressed data. */
  crc32: number;
  /** Bytes on disk for the compressed stream (== uncompressed when method 0). */
  compressedSize: number;
  /** Bytes after decompression. Validated against caps before allocation. */
  uncompressedSize: number;
  /** MS-DOS encoded last modification (time, date) as a JS Date in UTC. */
  modified: Date;
  /** True if this entry is a directory (name ends in '/' AND size === 0). */
  isDirectory: boolean;
  /** Absolute file offset of the corresponding local file header. */
  localHeaderOffset: number;
  /** Lazy decompressed-bytes accessor. Caps enforced inside. */
  data(): Promise<Uint8Array>;
  /** Lazy stream accessor for huge entries. */
  stream(): ReadableStream<Uint8Array>;
}

interface ZipFile {
  entries: ZipEntry[];
  /** ZIP file comment bytes (UTF-8 attempted). */
  comment: string;
}

interface TarEntry {
  /** Effective name (prefix + '/' + name when prefix non-empty). */
  name: string;
  /** Regular file or directory; first pass rejects all other typeflags. */
  type: 'file' | 'directory';
  /** Uncompressed size in bytes; 0 for directories. */
  size: number;
  /** Unix mode bits (octal) parsed from `mode` field. */
  mode: number;
  /** Modification time as JS Date in UTC. */
  modified: Date;
  /** Owner / group user names (informational). */
  uname: string;
  gname: string;
  /** Lazy data accessor returning the entry's bytes. */
  data(): Promise<Uint8Array>;
}

interface TarFile {
  entries: TarEntry[];
}

/** Discriminated union returned by the top-level `parseArchive` dispatcher. */
type ArchiveFile =
  | { kind: 'zip'; file: ZipFile }
  | { kind: 'tar'; file: TarFile }
  | { kind: 'gzip'; payload: Uint8Array; originalName?: string }
  | { kind: 'tar.gz'; file: TarFile };

export function parseZip(input: Uint8Array): ZipFile;
export function serializeZip(file: ZipFile, opts?: { method?: 0 | 8 }): Promise<Uint8Array>;

export function parseTar(input: Uint8Array): TarFile;
export function serializeTar(file: TarFile): Uint8Array;

export function decompressGzip(input: Uint8Array): Promise<Uint8Array>;
export function compressGzip(input: Uint8Array): Promise<Uint8Array>;

export function parseArchive(input: Uint8Array): Promise<ArchiveFile>;
```

## Demuxer (read) algorithm — ZIP

1. **Validate input length**: must be `>= 22` (minimum EOCD size); else
   throw `ZipTooShortError`. Cap `<= MAX_INPUT_BYTES` (200 MiB).
2. **EOCD backward search**: starting at `offset = input.length - 22`,
   scan backward checking the 4 bytes at `offset` against the EOCD
   signature `0x06054b50` (little-endian: bytes `50 4b 05 06`).
   Continue backward until either a match is found OR the search has
   moved more than `MAX_ZIP_COMMENT_BYTES = 4096` bytes from the
   minimum position. If no match, throw `ZipNoEocdError`. (Trap #3.)
3. **Decode EOCD**:
   - Reject if `numberOfThisDisk != 0` or `diskWhereCdStarts != 0` →
     `ZipMultiDiskNotSupportedError`. (Trap #15.)
   - Reject if any field equals `0xFFFF` / `0xFFFFFFFF` (sentinel
     for ZIP64) → `ZipNotZip64SupportedError`.
   - Validate `centralDirectoryOffset + centralDirectorySize <=
     EOCD position`.
   - Validate `numberOfRecords <= MAX_ZIP_ENTRIES = 65536` (Trap
     #12).
4. **Walk the central directory**: starting at
   `centralDirectoryOffset`, for `i = 0` to `numberOfRecords - 1`:
   a. Read 46-byte fixed central directory header. Verify signature
      `0x02014b50`. Else throw `ZipBadCentralDirectoryError`.
   b. Reject `disk number start != 0`.
   c. Reject if general-purpose bit 0 (encryption) is set →
      `ZipEncryptedNotSupportedError`.
   d. If general-purpose bit 11 is set, decode name as UTF-8;
      otherwise (per Trap #7) decode as UTF-8 leniently and emit a
      one-time warning. Validate `nameLength <= MAX_ZIP_NAME_BYTES =
      4096`.
   e. **Validate path**: pass `name` through `path-validator.ts`.
      Reject `..` segments, absolute paths (leading `/`, drive letter
      `C:`), and NUL bytes → `ArchiveInvalidEntryNameError`. (Trap
      #2.)
   f. Reject `compressionMethod ∉ {0, 8}` → `ZipUnsupportedMethodError`.
   g. Reject `uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES = 256
      MiB` → `ArchiveEntrySizeCapError`.
   h. Track running cumulative-size total; reject if cumulative
      exceeds `MAX_TOTAL_UNCOMPRESSED_BYTES = 512 MiB`.
   i. Apply compression-ratio cap per entry: reject if
      `uncompressedSize > compressedSize * MAX_COMPRESSION_RATIO`
      AND `compressedSize > 0` (an entry that decompresses 1000:1 is
      bomb-shaped — Trap #1, #12).
   j. Decode MS-DOS time/date to a `Date`.
   k. Construct a `ZipEntry` whose `data()` and `stream()` lazily
      seek back to the local-header offset, skip the local header
      (re-read the local-header `nameLength` and `extraLength` from
      bytes 26-29 — they may differ from the central directory's
      copies in pathological inputs, so re-read), and pipe through
      `DecompressionStream('deflate-raw')` when method == 8.
5. Return `ZipFile { entries, comment }`.

The lazy `data()` implementation:
1. Seek to `localHeaderOffset`. Read 30 bytes; verify
   `0x04034b50`. Read local-header `fileNameLength` and
   `extraFieldLength` (bytes 26-29). Compute payload offset =
   `localHeaderOffset + 30 + fileNameLength + extraFieldLength`.
2. Slice `compressedData = input.slice(payloadOffset, payloadOffset
   + compressedSize)` (sizes from central directory — Trap #9).
3. If method == 0: validate `crc32(compressedData) === entry.crc32`;
   return `compressedData`.
4. If method == 8: pipe `compressedData` through
   `DecompressionStream('deflate-raw')`, accumulating output bytes
   while enforcing `MAX_ENTRY_UNCOMPRESSED_BYTES` and the cumulative
   cap as a streaming-abort condition. Validate `crc32(decoded) ===
   entry.crc32` and `decoded.length === entry.uncompressedSize`. On
   mismatch throw `ZipChecksumError`.

## Demuxer (read) algorithm — TAR

1. **Validate input length**: must be a multiple of 512 (else throw
   `TarMisalignedInputError`) AND `>= 1024` (must contain at least
   the EOA marker). Cap `<= MAX_INPUT_BYTES`.
2. **Block walk**: starting at `offset = 0`, while `offset + 512 <=
   input.length`:
   a. Read the 512-byte header block.
   b. **EOA check**: if all 512 bytes are zero, peek at the next 512
      bytes. If those are also all zero, this is the end-of-archive
      marker — break the loop. (Tolerate any remaining trailing zero
      blocks past the 1024-byte EOA; Trap #6.)
   c. **`ustar` magic check**: bytes [257..263) must equal
      `"ustar\0"`. Otherwise throw
      `TarNonUstarNotSupportedError`. (Trap #11.)
   d. **Decode octal fields**: parse `mode`, `uid`, `gid`, `size`,
      `mtime` via `parseOctal(field)` — find first NUL or space, treat
      preceding ASCII digits as base-8. (Trap #4.)
   e. **Validate checksum**: compute `sumOf(headerBytes)` treating
      bytes [148..156) as eight `0x20` (ASCII space) bytes; compare
      to the `chksum` field's parsed octal value. Throw
      `TarChecksumError` on mismatch. (Trap #5.)
   f. **Decode typeflag** (1 byte at offset 156). Allowed: `'0'` and
      `'\0'` → `'file'`; `'5'` → `'directory'`. Otherwise throw
      `TarUnsupportedTypeflagError`.
   g. **Decode name + prefix**: NUL-trim both, join as
      `prefix ? prefix + '/' + name : name`. Length cap: 256 bytes
      total (`MAX_TAR_NAME_BYTES = 255` plus separator).
   h. **Validate path**: pass through `path-validator.ts` (same
      rejection rules as ZIP — Trap #2).
   i. **Size + cap**: `size` capped at
      `MAX_ENTRY_UNCOMPRESSED_BYTES`. Track cumulative.
   j. Construct `TarEntry`. For files, `data()` returns
      `input.slice(offset + 512, offset + 512 + size)`.
   k. Advance `offset += 512 + ceilToBlock(size, 512)` (size 0 for
      directories advances by just 512).
   l. Cap entry count at `MAX_TAR_ENTRIES = 65536`.
3. Return `TarFile { entries }`.

## Muxer (write) algorithm — ZIP

1. Accept a `ZipFile` whose entries provide `data()` (or pre-resolved
   bytes). Reject if entries.length > `MAX_ZIP_ENTRIES`.
2. **Per-entry write loop**: for each entry in order:
   a. Resolve the entry's uncompressed bytes (await `data()`).
   b. Compute CRC-32 (zlib variant) of the uncompressed bytes.
   c. If `opts.method === 8` (default for entries > 64 bytes), pipe
      through `CompressionStream('deflate-raw')` and collect output
      bytes. Otherwise method == 0 and compressed bytes ===
      uncompressed.
   d. **Record `localHeaderOffset = currentOutputLength`**.
   e. Encode local file header (30 bytes), filename (UTF-8, set
      general-purpose bit 11), zero-length extra field. Set
      `version_needed = 20`. Set times from
      `entry.modified`. Set sizes + CRC from computed values (we
      do NOT use the data-descriptor / bit-3 mode — Trap #9 talks
      about reading it, but writing the canonical inline form is
      simpler and equally valid).
   f. Append local header + filename + compressed data to output.
3. **Central directory**: record `centralDirectoryOffset =
   currentOutputLength`. For each entry, emit a 46-byte central
   directory header followed by filename. Sizes match the local
   header copies. `disk_number_start = 0`. External file attributes
   for directories: high 16 bits = `0o040755 << 16`; for files:
   `0o100644 << 16`. Internal attrs = 0.
4. **EOCD**: 22-byte EOCD. `numberOfThisDisk = 0`,
   `diskWhereCdStarts = 0`, `numberOfRecordsOnThisDisk =
   numberOfRecords = entries.length`,
   `centralDirectorySize = currentOutputLength -
   centralDirectoryOffset`, `centralDirectoryOffset` as recorded.
   Empty comment (length 0).
5. Concatenate and return.

We do **not** attempt byte-identical round-trip. Deflate output is
non-deterministic across browser engines (V8 vs JavaScriptCore vs
SpiderMonkey wrap zlib differently); central directory ordering may
vary per source tool; the data-descriptor encoding choice (inline
sizes vs trailing descriptor) differs. Round-trip semantic
equivalence is the contract: the same set of `(name, uncompressedBytes,
crc32, modified)` tuples is preserved.

## Muxer (write) algorithm — TAR

1. Accept a `TarFile`. Reject `entries.length > MAX_TAR_ENTRIES`.
2. **Per-entry write loop**: for each entry:
   a. Resolve the entry's uncompressed bytes (await `data()`,
      directories have `size == 0`).
   b. Build a 512-byte zero-filled header. Validate `name.length
      <= 100` (no `prefix` split in first-pass writer; throw
      `TarLongNameNotSupportedError` for names 101-255 bytes —
      defer the prefix-split heuristic to Phase 4.5).
   c. Write fields: name (NUL-padded), mode (octal in 7 chars + NUL),
      uid/gid (default 0), size (octal in 11 chars + NUL),
      mtime (octal in 11 chars + NUL), typeflag (`'0'` for files,
      `'5'` for directories), magic `"ustar\0"`, version `"00"`,
      uname/gname (NUL-padded).
   d. **Write 8 spaces into the chksum field** (offset 148, 8
      bytes). Compute checksum = sum of all 512 header bytes (now
      including the spaces). Overwrite chksum field with the octal
      representation: 6 octal digits + NUL + space (per POSIX
      `%06o\0 `). (Trap #5.)
   e. Append header. For files, append `data` followed by zero-pad
      bytes to bring the data length to a multiple of 512.
3. **End-of-archive marker**: append exactly 1024 zero bytes (two
   empty 512-byte blocks). Do NOT add further padding to a
   blocking-factor multiple — that is optional and we skip it.
4. Return concatenated bytes.

## Browser integration

**Compression pipelines (read):**

```
ZIP entry (method 8):
  Uint8Array(compressed)
    ─► Blob ─► .stream() ─► DecompressionStream('deflate-raw')
    ─► size-cap ReadableStream wrapper ─► accumulator Uint8Array

GZip member:
  Uint8Array(compressed)
    ─► Blob ─► .stream() ─► DecompressionStream('gzip')
    ─► size-cap wrapper ─► accumulator Uint8Array

`.tar.gz`:
  Uint8Array(compressed)
    ─► .stream() ─► DecompressionStream('gzip')
    ─► size-cap wrapper ─► async-collect to single Uint8Array
    ─► parseTar()
```

**Compression pipelines (write):**

```
ZIP entry (method 8):
  Uint8Array(uncompressed)
    ─► Blob ─► .stream() ─► CompressionStream('deflate-raw')
    ─► accumulator

GZip member:
  Uint8Array(uncompressed)
    ─► Blob ─► .stream() ─► CompressionStream('gzip')
    ─► accumulator
```

**Size-cap streaming wrapper (`compression.ts`):** pipes a source
stream through `DecompressionStream` while a `TransformStream`
counts bytes. When the running total exceeds the per-entry cap or
the cumulative cap, the stream is aborted via `controller.error(new
ArchiveEntrySizeCapError(...))`. This stops decompression early
rather than DOSing memory after the bomb is decoded — Trap #1.

**bz2 / xz routing:** detect magic in `parser.ts`, throw
typed error, BackendRegistry tries the next backend. The error
implements `webcvt-core`'s `BackendDelegationError` interface so the
registry can transparently pass to `@catlabtech/webcvt-backend-wasm` rather than
surfacing the error to the caller.

## Fixture strategy

Unlike Phase 2/3 packages where fixtures came from `ffmpeg-static`
LGPL-2.1 samples (FFmpeg does not produce ZIP / TAR archives),
**this package uses an all-synthetic in-test fixture strategy**: every
test constructs minimal valid ZIP and TAR bytes inline as
`Uint8Array` literals or via small synthesis helpers in
`tests/helpers/`. No binary fixtures are committed. This keeps the
`packages/archive-zip/tests/` directory free of binary blobs, makes
the tests self-documenting (the bytes literally match the spec rows
in §"Required structures"), and avoids the licensing / provenance
question for hand-crafted archive samples.

The pattern matches `container-flac`'s synthetic CRC tests. Helpers
to add:

- `tests/helpers/build-zip.ts` — given `(name, bytes)` pairs, emit a
  valid stored-method ZIP for use as parser input. ~60 LOC.
- `tests/helpers/build-tar.ts` — given `(name, bytes)` pairs, emit a
  valid ustar archive. ~50 LOC.
- `tests/helpers/build-gzip.ts` — wrap bytes in a single gzip member
  with no optional fields. ~30 LOC.

Tests for round-trip correctness use `serializeZip` / `serializeTar`
output as input to `parseZip` / `parseTar` and assert structural
equality.

## Test plan

- `parses a 1-entry stored-method ZIP and recovers entry name + bytes`
- `parses a 3-entry deflate-method ZIP via CompressionStream wrapper`
- `EOCD backward search finds signature past a 1024-byte ZIP comment`
- `rejects ZIP file with EOCD64 signature (ZipNotZip64SupportedError)`
- `rejects ZIP entry with general-purpose bit 0 set (ZipEncryptedNotSupportedError)`
- `rejects ZIP entry with compression method 12 (ZipUnsupportedMethodError)`
- `rejects ZIP entry with name '../etc/passwd' (ArchiveInvalidEntryNameError)`
- `rejects ZIP entry with absolute path '/etc/passwd' (ArchiveInvalidEntryNameError)`
- `rejects ZIP entry with NUL byte in name`
- `enforces MAX_ZIP_ENTRIES cap (65536)`
- `enforces MAX_ENTRY_UNCOMPRESSED_BYTES cap (256 MiB) per entry`
- `enforces MAX_TOTAL_UNCOMPRESSED_BYTES cap (512 MiB) cumulative`
- `enforces MAX_COMPRESSION_RATIO (1000:1) per entry`
- `parses a 2-file ustar tar archive and recovers names + bytes + sizes`
- `verifies and rejects TAR header with wrong checksum (TarChecksumError)`
- `tolerates trailing zero padding past the 1024-byte EOA marker`
- `rejects pre-POSIX V7 tar (no ustar magic) with TarNonUstarNotSupportedError`
- `rejects TAR symlink typeflag '2' with TarUnsupportedTypeflagError`
- `decompresses single-member gzip via DecompressionStream wrapper`
- `rejects multi-member gzip with GzipMultiMemberNotSupportedError`
- `routes bzip2 magic to backend (ArchiveBz2NotSupportedError)`
- `routes xz magic to backend (ArchiveXzNotSupportedError)`
- `tar.gz round-trip: gunzip then parseTar yields same entries as direct tar`
- `round-trip: serializeZip → parseZip preserves all entry tuples`
- `round-trip: serializeTar → parseTar preserves all entry tuples`
- `validates CRC-32 mismatch in ZIP entry data (ZipChecksumError)`

## Known traps

1. **Zip bomb defense**: the canonical `42.zip` is 42 KB on disk and
   decompresses to 4.5 PB through nested archives. We are not a
   recursive extractor (one-level only) but a single-level entry can
   still target 16 MiB of compressed bytes that decompress to 256 MiB
   easily. We MUST cap **per-entry** uncompressed size at 256 MiB AND
   **cumulative** uncompressed size at 512 MiB, AND we MUST enforce
   these caps **incrementally during the DecompressionStream pipe** —
   not after the fact. Use a `TransformStream` that counts bytes and
   calls `controller.error(...)` to abort the source. Passing a 256
   MiB `Uint8Array` through `await response.bytes()` and THEN
   measuring is the wrong shape — the allocation has already
   happened.
2. **Path traversal in TAR + ZIP entry names**: an entry named
   `../../../etc/passwd` could overwrite arbitrary files if a
   downstream tool naively `mkdir + write` to `targetDir +
   entry.name`. We do NOT write to disk in first pass (browser
   context = no disk), but we MUST normalize and reject path-traversal
   entry names in the parsed `name` field so downstream consumers can
   trust them. Reject: any entry whose name (after normalization)
   contains a `..` path segment; any entry whose name starts with
   `/` or `\\` or matches a Windows drive-letter pattern (`/^[A-Za-z]:/`);
   any entry whose name contains a NUL byte. Throw
   `ArchiveInvalidEntryNameError` at parse time, before constructing
   the entry. Forward-slash separators only — convert `\\` to `/`
   before validation, since some Windows-authored ZIPs use backslash
   despite the spec mandating forward slashes.
3. **EOCD backward search bound**: the EOCD comment is variable-length
   (0..65535 bytes per spec) so a strict reader would search backward
   `length - 22` to `length - 22 - 65535`. We cap the backward search
   at 4 KiB (`MAX_ZIP_COMMENT_BYTES`) — most ZIPs have no comment,
   and a 64 KiB comment is suspicious in a security-conscious
   parser. Comments larger than 4 KiB are rejected with
   `ZipCommentTooLargeError`. Document this restriction in the
   README.
4. **TAR octal-string parsing**: numeric fields in TAR are ASCII
   octal strings, NUL- or space-terminated, fixed-width (e.g. the
   12-byte `size` field holds up to 11 octal digits = 8 GiB max).
   Easy errors: parsing as decimal (`parseInt(field, 10)`); not
   stripping trailing NULs (`parseInt('100\0\0\0', 8)` is fine but
   `Number('100\0\0\0')` is `NaN`); misreading the field width.
   Implement once in `parseOctal(field: Uint8Array): number`.
   Validate the parsed value `<= MAX_OCTAL_FIELD_VALUE` per field
   role.
5. **TAR checksum (`chksum` field)**: 8 bytes at offset 148. Computed
   as the sum of all 512 header bytes treating the 8 chksum bytes
   themselves as eight ASCII space characters (`0x20`). Verify on
   read (mismatch = throw); emit on write. The serialized form is
   POSIX-conventional `%06o\0 ` — six octal digits, NUL, space — so
   that even a broken reader that just unpacks 6 digits works.
6. **TAR ends with two empty 512-byte blocks** (1024 bytes of zero).
   Writers MUST emit them; readers MUST tolerate trailing data after
   them — some tar tools pad to a 10240-byte blocking factor, leaving
   up to ~9 KiB of zero bytes after the EOA marker. Detection rule:
   first all-zero block triggers a peek at the next block; two
   consecutive all-zero blocks = EOA, break the walk and stop reading
   regardless of remaining trailing bytes.
7. **ZIP file name encoding**: per APPNOTE general-purpose bit 11 = 1
   means "filename is UTF-8". When unset, the spec says "use IBM Code
   Page 437" (DOS encoding). First pass: decode all names as UTF-8
   regardless. Modern ZIPs (anything authored after ~2007) almost
   always set bit 11; CP437 fallback for legacy Windows ZIPs is
   deferred to Phase 4.5. Document this lenience and emit a warning
   when bit 11 is unset and the filename contains bytes > 0x7F.
8. **ZIP CRC-32**: standard CRC-32 (poly `0xEDB88320` reflected, init
   `0xFFFFFFFF`, output XOR with `0xFFFFFFFF`) — same as zlib's
   CRC-32, same as gzip's trailing CRC-32. **DIFFERENT from MPEG-TS
   PSI CRC-32** (poly `0x04C11DB7` non-reflected init
   `0xFFFFFFFF`) AND **different from Ogg's CRC-32** (poly
   `0x04C11DB7` non-reflected init `0`). Three CRC-32 variants now
   live in this codebase. Add a comment in `crc32.ts` clarifying
   which variant this file implements; cross-reference to the
   container-ts and container-ogg `crc32.ts` files.
9. **Local file header `compressed_size` and `uncompressed_size` may
   be 0 in the local header** when general-purpose bit 3 ("data
   descriptor") is set. The actual sizes appear AFTER the file data
   in a 12-byte (or 16-byte with optional `0x08074b50` signature)
   data descriptor. The central directory ALWAYS has the correct
   sizes. **The reader should ALWAYS use the central directory
   entry's sizes**, not the local file header's. The writer can
   sidestep this entirely by always writing inline sizes (we do).
10. **DecompressionStream Deflate variant**: ZIP method 8 uses **raw
    Deflate** (no zlib header / no gzip envelope) — RFC 1951 only,
    not RFC 1950. The browser API for this is `new
    DecompressionStream('deflate-raw')`. Using `'deflate'` would
    expect the 2-byte zlib header (`0x78 ...`) and produce garbage
    or `TypeError: invalid input` on raw Deflate streams. **This is
    the most common implementation mistake.** Add a code comment
    and a unit test that explicitly verifies a raw-Deflate ZIP
    entry parses correctly with `'deflate-raw'` and fails
    catastrophically with `'deflate'`. Note: `'deflate-raw'` was
    added to Compression Streams in Chrome 113 / Safari 16.4 /
    Firefox 113 — earlier browsers need a small JS Deflate fallback
    OR will hit the `backend-wasm` fallback chain.
11. **TAR ustar magic field**: 6 bytes at offset 257 = `"ustar\0"`
    (literal `u-s-t-a-r-NUL`) followed by a 2-byte version
    `"00"`. Pre-POSIX V7 tar lacks the magic entirely (zero bytes
    at offset 257). GNU tar uses `"ustar  \0"` (two spaces, NUL —
    the `gnu` variant). First pass: REQUIRE exactly `"ustar\0"`
    and version `"00"`. Throw `TarNonUstarNotSupportedError` for
    V7 and `TarGnuVariantNotSupportedError` for the GNU variant.
12. **Compression-ratio extreme bomb**: even with the per-entry size
    cap, a single 16 MiB Deflate-compressed entry that decompresses
    to 256 MiB triggers the per-entry cap correctly, but 100 such
    entries inside a ZIP central directory exhaust the cumulative
    cap (512 MiB) quickly, AND the central directory itself walks
    100 entries before any decompression. Cap entry COUNT at 65536
    (`MAX_ZIP_ENTRIES`) — legitimate archives have a few hundred
    entries max; tens of thousands suggests adversarial input. ALSO
    enforce per-entry `MAX_COMPRESSION_RATIO = 1000` BEFORE
    starting decompression: if `uncompressedSize >
    compressedSize * 1000` and `compressedSize > 0`, throw
    immediately.
13. **MS-DOS time/date packing**: the ZIP `last_mod_file_time` and
    `last_mod_file_date` use the legacy DOS encoding: time =
    `(hour << 11) | (minute << 5) | (second / 2)` (note: 2-second
    resolution, second is divided by 2), date =
    `((year - 1980) << 9) | (month << 5) | day` (note: year offset
    from 1980, NOT 1970). Year cannot represent < 1980 or
    > 2107. Decoding bug: forgetting the `/2` on seconds gives
    timestamps off by up to 30 seconds; forgetting the `-1980`
    offset gives dates near year 0. Default to a fixed
    `1980-01-01T00:00:00Z` when fields are zero.
14. **GZip multi-member files**: RFC 1952 §2.2 explicitly allows
    concatenating multiple gzip members in one file; the decoder
    "shall produce a single concatenation of the uncompressed
    output of all the members". Native `DecompressionStream('gzip')`
    handles this transparently. We deliberately reject after the
    first member (detect by checking remaining bytes after the
    member's CRC + ISIZE trailer) so that callers know they got a
    `.gz` and not a `.tar.gz` masquerading as `.gz`. Cross-check
    against a `0x1F 0x8B` re-occurrence in the trailing bytes.
15. **ZIP multi-disk fields**: the EOCD has TWO disk-number fields
    (`number_of_this_disk`, `disk_where_central_directory_starts`),
    each `u16`. Both must be zero for a single-volume archive.
    Spanned ZIP archives split the central directory across the
    last `.zip` and put earlier `.z01`, `.z02`, ... files
    elsewhere. We reject any non-zero disk number with
    `ZipMultiDiskNotSupportedError` at the EOCD decode step, before
    walking the central directory.
16. **TAR size field octal vs base-256**: GNU tar extends the
    12-byte `size` field for files > 8 GiB by setting the high bit
    of the first byte (`0x80`) and treating the remaining 11 bytes
    as a big-endian binary integer. Strict POSIX readers do not
    handle this — they see a "non-octal" byte and either silently
    misparse or throw. First pass: reject any field whose first
    byte has the high bit set with `TarBase256SizeNotSupportedError`.
    Document the restriction.
17. **ZIP entry data offset depends on local header's name + extra
    lengths, NOT the central directory's**: although both copies
    "should" match per spec, real-world tools have shipped ZIPs
    where the local header's extra-field length differs from the
    central directory's (e.g. an "Info-ZIP Unicode Path Extra Field"
    in the local header but stripped from the central directory).
    The reader MUST re-read bytes 26-29 of the local file header to
    determine the data start offset; using the central directory's
    name+extra lengths skips the wrong number of bytes.
18. **Endianness mismatch with other containers**: ZIP and gzip are
    **little-endian** (PKWARE / DOS heritage). MP4, TS, FLAC
    multi-byte fields are **big-endian** (network byte order /
    Apple heritage). TAR has no endianness because all numeric
    fields are ASCII octal strings. Easy slip after working on
    container packages: writing `view.getUint32(offset)` (big-endian
    default) instead of `view.getUint32(offset, true)` (little-endian)
    for ZIP fields silently produces nonsense values that may
    coincidentally pass some validity checks (e.g. a small
    little-endian value reads as a huge big-endian value, which
    correctly fails the "claimed length <= remaining bytes" check —
    but a huge little-endian value reads as a small big-endian
    value, which silently passes and underreads).

## Security caps

- **200 MiB input cap** in parser entry (`MAX_INPUT_BYTES`).
- **ZIP entry count cap**: 65,536 (`MAX_ZIP_ENTRIES`) — checked at
  EOCD decode before walking the central directory.
- **TAR entry count cap**: 65,536 (`MAX_TAR_ENTRIES`) — checked
  incrementally during the block walk.
- **Per-entry uncompressed size cap**: 256 MiB
  (`MAX_ENTRY_UNCOMPRESSED_BYTES`) — checked against the central
  directory's `uncompressedSize` BEFORE allocation, AND enforced
  incrementally during the `DecompressionStream` pipe.
- **Cumulative uncompressed size cap**: 512 MiB across all entries
  in the archive (`MAX_TOTAL_UNCOMPRESSED_BYTES`) — checked
  incrementally during decompression so a partial extraction can
  abort before exhausting memory.
- **Compression-ratio cap**: 1000:1 (`MAX_COMPRESSION_RATIO`) —
  checked PER ENTRY at central-directory walk time; reject if
  `uncompressedSize > compressedSize * 1000 && compressedSize > 0`.
- **ZIP comment length cap**: 4 KiB (`MAX_ZIP_COMMENT_BYTES`) —
  bounds the EOCD backward search. Comments larger than this throw
  `ZipCommentTooLargeError`.
- **ZIP entry name length cap**: 4 KiB (`MAX_ZIP_NAME_BYTES`).
- **TAR entry name length cap**: 255 bytes (POSIX limit; longer
  requires PAX which is deferred).
- **Path-traversal rejection**: entries with `..` segments, absolute
  paths (leading `/`, `\\`, or drive letter), or NUL bytes throw
  `ArchiveInvalidEntryNameError` at parse time.
- **All multi-byte length fields validated** against `claimed <=
  remaining_bytes` BEFORE any allocation.
- **ZIP64 EOCD signature** (`0x06064b50`) explicitly rejected with
  `ZipNotZip64SupportedError`.
- **ZIP encryption flag** (general-purpose bit 0) explicitly
  rejected with `ZipEncryptedNotSupportedError`.
- **ZIP compression methods** other than 0 and 8 explicitly
  rejected with `ZipUnsupportedMethodError`.
- **TAR base-256 size encoding** rejected with
  `TarBase256SizeNotSupportedError` — files > 8 GiB inside a tar
  are out of first-pass scope.
- **GZip multi-member** rejected with
  `GzipMultiMemberNotSupportedError` after the first member.
- **bz2 / xz native parsing** rejected with
  `ArchiveBz2NotSupportedError` / `ArchiveXzNotSupportedError`,
  triggering BackendRegistry fallback.

## LOC budget breakdown

| File | LOC est. |
|---|---|
| `zip-headers.ts` (local file / central directory / EOCD layout decode + encode, MS-DOS time conversion) | 200 |
| `zip-parser.ts` (EOCD backward search, central directory walk, lazy entry construction) | 180 |
| `zip-serializer.ts` (entry emission with optional Deflate, central directory + EOCD construction) | 180 |
| `tar-parser.ts` (ustar header parse, octal-string decode, checksum verify, block walk, EOA detection) | 150 |
| `tar-serializer.ts` (ustar header emit, octal encode, checksum compute, padding + EOA blocks) | 130 |
| `path-validator.ts` (path-traversal rejection: `..`, absolute, NUL bytes, backslash normalisation) | 50 |
| `crc32.ts` (zlib CRC-32 variant: poly 0xEDB88320 reflected, init 0xFFFFFFFF, lookup table) | 60 |
| `compression.ts` (DecompressionStream / CompressionStream wrappers for `gzip` and `deflate-raw`; size-cap streaming via TransformStream) | 150 |
| `parser.ts` (top-level: format detection by magic, dispatch to zip/tar/gzip/tar.gz parsers) | 100 |
| `serializer.ts` (top-level: format selection by output type) | 80 |
| `entry-iterator.ts` (lazy iteration over entries with on-demand decompression + cap enforcement) | 80 |
| `backend.ts` (ArchiveBackend; identity-only canHandle for first pass; bz2/xz delegation hook) | 100 |
| `errors.ts` (typed errors) | 80 |
| `constants.ts` (caps + magic numbers) | 50 |
| `index.ts` (re-exports) | 50 |
| **total** | **~1640** |
| tests | ~700 |

Headline plan.md budget for first-pass `archive-zip`: ~1,500 LOC.
Realistic: ~1,640 with the EOCD backward search, the size-cap
streaming wrapper, the lazy entry constructor, and a generous typed-error
surface. Acceptable overrun; everything beyond first-pass scope is
deferred to Phase 4.5.

## Implementation references (for the published README)

This package is implemented from PKWARE's `.ZIP File Format
Specification` (APPNOTE.TXT, version 6.3.10), IEEE Std 1003.1-2017
(POSIX `pax`/`ustar` tar format), IETF RFC 1950 (ZLIB — referenced for
the wrapper format that `'deflate-raw'` deliberately omits), IETF RFC
1951 (DEFLATE — the substantive compression algorithm used by both ZIP
method 8 and gzip), IETF RFC 1952 (GZIP file format), the bzip2 and XZ
file format documentation (referenced solely for magic-byte detection;
native parsing deferred to `@catlabtech/webcvt-backend-wasm`), and the W3C
Compression Streams specification (which defines the
`'gzip'` / `'deflate'` / `'deflate-raw'` formats consumed by this
package's stream wrappers). No code was copied from yauzl, jszip,
zip.js, tar, node-tar, fflate, pako, ya-tar, archiver, or FFmpeg's
libavformat. The CRC-32 implementation uses the zlib variant
(polynomial `0xEDB88320` reflected, init `0xFFFFFFFF`); two other
CRC-32 variants exist in the codebase (`container-ts`'s MPEG-2 CRC-32
and `container-ogg`'s zero-init CRC-32) and are deliberately separate
files. No binary fixtures are committed; every test constructs minimal
valid ZIP / TAR / GZip bytes inline via helpers in
`tests/helpers/build-zip.ts`, `build-tar.ts`, and `build-gzip.ts`.
