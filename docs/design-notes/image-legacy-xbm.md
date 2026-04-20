# image-legacy XBM design (fourth pass)

> Implementation reference for XBM (X11 Bitmap) extension to
> `@webcvt/image-legacy`. Fourth-pass; read image-legacy.md,
> image-legacy-tiff.md, and image-legacy-tga.md first for conventions.
>
> Strictly clean-room per plan.md §11: X Consortium X11 R6
> `XReadBitmapFile(3)` / `XWriteBitmapFile(3)` only. NO porting from
> ImageMagick, GIMP, libXpm, Netpbm, stb_image.

## Format overview

XBM is a fragment of valid C source declaring a 1-bit bitmap as a
`static char` array. Two `#define` lines (width + height), optional
pair of `_x_hot`/`_y_hot` hotspot lines, and `static char ..._bits[]`
array of hex bytes. Each byte packs 8 horizontal pixels **LSB-first**.

Canonical example:
```
#define foo_width 16
#define foo_height 8
static char foo_bits[] = {
   0x00, 0x00, 0x18, 0x18, 0x24, 0x24, 0x42, 0x42,
   0x81, 0x81, 0xbd, 0xbd, 0x00, 0x00, 0x00, 0x00 };
```

## Scope

### In scope (~200-300 LOC source)

- XBM v2 (the only flavour anyone has used since 1989)
- Two required `#define` lines + optional hotspot
- `static [unsigned] char <prefix>_bits[]` array
- Hex byte literals `0x00`..`0xff`, case-insensitive
- Bit packing 8 horizontal pixels/byte LSB-first
- Row stride `ceil(width/8)` bytes; trailing pad bits ignored
- Identifier prefix extraction + consistency check across all defines
- Optional hotspot `{x, y} | null`
- Canonical serialize: 12 bytes/line, lowercase `0x`, no trailing comma

### Out of scope (deferred)

- XBM v1 (pre-1989, no `#define`) — vanishingly rare
- Comment pragmas (tolerate but don't preserve)
- Multiple bitmaps per file
- Non-ASCII identifiers
- Cursor masks (`_mask_bits[]` companion array)

## File map

New:
- `xbm.ts` (~240 LOC) — tokenizer + parser + serializer
- `_test-helpers/build-xbm.ts` (~80 LOC)

Modified:
- `errors.ts` — 6 new typed errors
- `constants.ts` — `XBM_MIME`, `XBM_DEFAULT_PREFIX`, `XBM_BYTES_PER_LINE`, `XBM_MAX_IDENTIFIER_LENGTH`
- `detect.ts` — extend union; add `#define` prefix match
- `parser.ts`, `serializer.ts` — dispatch
- `backend.ts` — `[XBM_MIME, 'xbm']` + alias `image/x-xbm`
- `index.ts` — re-exports

## Type definitions

```ts
export interface XbmHotspot {
  x: number;
  y: number;
}

export interface XbmFile {
  format: 'xbm';
  width: number;
  height: number;
  channels: 1;
  bitDepth: 1;
  /** Identifier prefix; default on serialize: 'image'. */
  prefix: string;
  hotspot: XbmHotspot | null;
  /** One byte per pixel (0 or 1), row-major top-down,
   *  length = width * height. */
  pixelData: Uint8Array;
}

export function parseXbm(input: Uint8Array): XbmFile;
export function serializeXbm(file: XbmFile): Uint8Array;
```

## Typed errors

| Class | Code | Thrown when |
|---|---|---|
| `XbmBadHeaderError` | `XBM_BAD_HEADER` | First non-whitespace tokens are not `#define <prefix>_width` |
| `XbmMissingDefineError` | `XBM_MISSING_DEFINE` | Required `_width`/`_height` define absent or out of order |
| `XbmPrefixMismatchError` | `XBM_PREFIX_MISMATCH` | Identifier prefix differs across defines/array |
| `XbmBadHexByteError` | `XBM_BAD_HEX_BYTE` | Token in `{...}` not `0x[0-9a-fA-F]{1,2}`; value > 0xFF |
| `XbmSizeMismatchError` | `XBM_SIZE_MISMATCH` | Hex-byte count ≠ `height * ceil(width/8)` |
| `XbmBadIdentifierError` | `XBM_BAD_IDENTIFIER` | Prefix invalid or exceeds `XBM_MAX_IDENTIFIER_LENGTH` |

## Trap list

1. **Bit packing LSB-first within each byte.** Bit 0 = leftmost pixel
   of the 8-pixel run. This is OPPOSITE of PBM P4 (MSB-first).
   Sharing the PBM bit-packer without flipping the loop produces
   horizontally mirrored runs — use ASYMMETRIC test fixtures (L-shape
   arrow, not checkerboard).

2. **Row stride = ceil(width/8) bytes.** Trailing pad bits UNDEFINED
   on read — ignore; writers SHOULD emit zero. Parser unpacks only
   first `width` bits per row; serializer emits zero in unused bits.

3. **Identifier prefix is variable but MUST be consistent.** Parser
   extracts prefix from `_width` define, validates `_height`,
   `_bits`, `_x_hot`, `_y_hot` use SAME prefix. Mismatch → typed
   error. Round-trip preserves prefix exactly.

4. **Hex tokens may have varying whitespace/linebreaks between them.**
   Canonical output uses 12/line but real files use 6-16. Use
   character-by-character walk, NOT regex (ReDoS defense).

5. **Trailing comma before `}` is valid C99.** `bitmap(1)` emits it.
   Parser MUST accept; serializer omits for canonical form.

6. **Detection via leading-token string match, not magic bytes.**
   `detectImageFormat` looks for ASCII `#define` after skipping
   leading whitespace and optional `/* ... */` comment. Unambiguous
   vs PBM/PGM/PPM/PFM/QOI/TIFF/TGA (none start with `#`). Validate
   further that `#define` is followed by `<ident>_width <decimal>`
   to avoid claiming arbitrary `.h` files.

7. **`_x_hot` and `_y_hot` defines are OPTIONAL.** Plain bitmaps omit;
   cursors include. Accept both present (either order) OR both
   absent. Exactly one → `XbmMissingDefineError`. Serializer emits
   only when `hotspot !== null`.

8. **Hex digit case mixes freely.** `0xAB`, `0xab`, `0XaB`, `0xA`
   all valid. Parser accepts via case-insensitive table; serializer
   emits lowercase, 2 digits always (`0x07` not `0x7`).

9. **`unsigned` qualifier is optional.** Both `static char foo_bits[]`
   and `static unsigned char foo_bits[]` exist. Parser accepts both;
   serializer emits `static char` (X11 canonical).

10. **`_bits[]` may carry explicit length** (`static char foo_bits[64]`).
    Parser tolerates decimal, validates equals actual count;
    serializer emits empty brackets.

## Security caps

```ts
export const XBM_MIME = 'image/x-xbitmap';
export const XBM_DEFAULT_PREFIX = 'image';
export const XBM_BYTES_PER_LINE = 12;
export const XBM_MAX_IDENTIFIER_LENGTH = 256;
```

Pre-existing `MAX_INPUT_BYTES`, `MAX_PIXELS`, `MAX_PIXEL_BYTES`,
`MAX_DIM` apply unchanged.

**ReDoS defense**: tokenizer is a hand-rolled character walk, NOT a
regex. The XBM dialect is small (~80 LOC state machine); any regex
over `\s*` followed by tokens applied repeatedly is quadratic vs
pathological whitespace runs. 200 MiB of `0x00,\n` with whitespace
padding is plausible adversarial input.

**Allocation order**:
1. Validate input size
2. ASCII decode via `TextDecoder('ascii', { fatal: true })`
3. Tokenize headers, extract width/height/prefix/hotspot
4. Validate dimensions + pixel caps
5. ONLY THEN allocate `pixelData = new Uint8Array(width * height)`

## Parser algorithm

1. Validate `input.length <= MAX_INPUT_BYTES`.
2. Decode to ASCII; fatal mode rejects non-ASCII bytes.
3. Initialize tokenizer: `skipWs()` (whitespace + `/* */` comments),
   `consume(literal)`.
4. Parse `#define <prefix>_width <decimal>` → extract prefix, width.
5. Parse `#define <prefix>_height <decimal>` → validate prefix match, height.
6. Optional hotspot block (Trap #7): accept both defines in either order;
   XOR → `XbmMissingDefineError`.
7. Parse `static [unsigned] char <prefix>_bits[<optional-decimal>] = {`.
8. Validate dimensions against caps.
9. Allocate `pixelData` and `packed = new Uint8Array(height * stride)`.
10. Read hex bytes into `packed`; validate count; consume closing `};`.
11. Unpack packed bits LSB-first into `pixelData`.
12. Return XbmFile.

## Serializer algorithm

1. Resolve prefix (`file.prefix` or `XBM_DEFAULT_PREFIX`).
2. Validate dimensions.
3. Pack `pixelData` LSB-first into `packed`.
4. Build canonical source:
   ```
   #define <prefix>_width <N>
   #define <prefix>_height <N>
   [#define <prefix>_x_hot <N>        // if hotspot
    #define <prefix>_y_hot <N>]
   static char <prefix>_bits[] = {
      <12 bytes per line, lowercase 0x, comma-separated>,
      ... 0xNN };
   ```
5. Encode via `TextEncoder`.

## Detection

`detect.ts`: after existing magic-byte checks, skip leading whitespace
+ `/* */` comment; if starts with `#define`, look-ahead-validate
`<ident>_width <decimal>`; return `'xbm'` if valid, else `null`.
Look-ahead bounded to ~512 bytes.

## Test plan (28+ cases)

1. Decodes 16×8 X11 spec example
2. Decodes 12×2 with non-multiple-of-8 width; padding ignored (Trap #2)
3. LSB-first verified via asymmetric L-shape (Trap #1)
4. Prefix extraction from `foo_width`
5. Prefix mismatch → typed error (Trap #3)
6. Trailing comma accepted (Trap #5)
7. `unsigned char` variant accepted (Trap #9)
8. Mixed-case hex digits accepted (Trap #8)
9. Varying bytes/line + extra whitespace (Trap #4)
10. Hotspot present with both defines (Trap #7)
11. Hotspot null when both absent
12. XOR hotspot → typed error (Trap #7)
13. Byte count ≠ `height * stride` → `XbmSizeMismatchError`
14. Non-hex token `255` → `XbmBadHexByteError`
15. Non-ASCII byte → `XbmBadHeaderError`
16. width × height > MAX_PIXELS → `ImagePixelCapError`
17. Canonical 12/line output with lowercase hex, no trailing comma
18. Default prefix 'image' when empty
19. Hotspot defines emitted when non-null
20. LSB-first pack matches unpack — semantic round-trip
21. Zero-fill trailing pad bits on non-mult-8 (Trap #2)
22. Round-trip structural equality
23. `detectImageFormat` returns 'xbm' for valid XBM
24. Returns null for `#define FOO 1` (no `_width` suffix)
25. Returns null for plain C source
26. `parseImage/serializeImage` round-trip preserves union
27. `canHandle` identity for `image/x-xbitmap`
28. ReDoS regression: 200 MiB pathological whitespace parse is linear-time

## Dependencies

- `TextDecoder('ascii', { fatal: true })` — browser-native
- `TextEncoder` — browser-native
- No regex, no NPM dependency

## LOC budget

| File | LOC |
|---|---|
| xbm.ts | 240 |
| _test-helpers/build-xbm.ts | 80 |
| Additions to errors.ts (6 classes) | 60 |
| Additions to constants.ts | 12 |
| Additions to detect.ts | 30 |
| Additions to parser/serializer/backend/index | 25 |
| **Source subtotal** | **~290** |
| xbm.test.ts (28+ tests) | 250 |
| **Tests subtotal** | **~250** |
| **Total addition** | **~540** |
