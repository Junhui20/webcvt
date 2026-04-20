# image-legacy XPM design (sixth pass)

> XPM3 (X PixMap) extension to `@webcvt/image-legacy`. Sixth-pass; read
> image-legacy.md and image-legacy-xbm.md first — XPM is the colour
> successor to XBM and shares the "ASCII C-source fragment" shape.
>
> Clean-room per plan.md §11: XPM3 specification (Arnaud Le Hors, XPM
> Manual, X Consortium, 1996) only. NO porting from libXpm, ImageMagick,
> GIMP, stb_image, netpbm.

## Format overview

XPM3 is a C source fragment declaring a colour pixmap as a `static char*`
array. First string = header, next `ncolors` = colour defs, final
`height` = pixel rows (each exactly `width * cpp` chars).

```
/* XPM */
static char * name_xpm[] = {
"16 16 4 1",            /* width height ncolors chars_per_pixel */
"  c None",             /* char + 'c' + colour spec */
". c #FF0000",
"+ c #00FF00",
"@ c #0000FF",
"  ..  ..  ..   ",     /* pixel row, exactly width*cpp chars */
" .+. .+. .+.   ",
...
};
```

## Scope

### In scope (~400-600 LOC source)

- XPM3 only
- `chars_per_pixel` ∈ {1, 2}
- Colour keys: ASCII printable except `"` (0x22); spaces/commas/special chars valid
- Colour value: `c <spec>` where spec is `#RRGGBB`, `#RRRRGGGGBBBB`,
  `#RGB` shorthand, `None`, or named colour from ~30-entry built-in table
- Visual class `c` only (`m`/`s`/`g`/`g4` siblings skipped, not errored)
- Optional hotspot (5th/6th header tokens) round-tripped
- Emit RGBA always (`channels: 4`, `bitDepth: 8`)
- Serializer auto-picks cpp: 1 for ≤92 colours, 2 for more

### Out of scope (deferred)

- XPM1/XPM2 (pre-1989)
- `m`/`s`/`g`/`g4` visual class output
- Multi-word colour specs
- XPMEXT section
- Full X11 named-colour database (750 entries)
- `cpp > 2`
- Byte-equal round-trip

## File map

New:
- `xpm.ts` (~470 LOC) — tokenizer + parser + serializer + X11 name table
- `_test-helpers/build-xpm.ts` (~90 LOC)

Modified:
- `errors.ts` — 9 new typed errors
- `constants.ts` — XPM_MIME, XPM_DEFAULT_NAME, XPM_MAX_COLORS,
  XPM_MAX_CHARS_PER_PIXEL, XPM_KEY_ALPHABET
- `detect.ts` — `/* XPM */` + `static char` prefix match
- `parser.ts`, `serializer.ts` — dispatch on `'xpm'`
- `backend.ts` — `[XPM_MIME, 'xpm']` + alias `image/x-xpm`
- `index.ts` — re-exports
- `core/formats.ts` — `{ ext: 'xpm', mime: 'image/x-xpixmap', category: 'image', description: 'X PixMap' }`

## Type definitions

```ts
export interface XpmHotspot {
  x: number;
  y: number;
}

export interface XpmFile {
  format: 'xpm';
  width: number;
  height: number;
  channels: 4;
  bitDepth: 8;
  /** C identifier; default 'image' on serialize */
  name: string;
  hotspot: XpmHotspot | null;
  /** Advisory — serializer picks its own based on palette size */
  charsPerPixel: 1 | 2;
  /** RGBA top-down, length = width*height*4 */
  pixelData: Uint8Array;
}

export function parseXpm(input: Uint8Array): XpmFile;
export function serializeXpm(file: XpmFile): Uint8Array;
```

## Typed errors

| Class | Code | Thrown when |
|---|---|---|
| XpmBadHeaderError | XPM_BAD_HEADER | Missing `static char *` array or first string malformed |
| XpmBadValuesError | XPM_BAD_VALUES | Header token count ∉ {4, 6}; out-of-range |
| XpmBadColorDefError | XPM_BAD_COLOR_DEF | Colour def missing `c` class or malformed |
| XpmBadHexColorError | XPM_BAD_HEX_COLOR | `#...` wrong length or non-hex |
| XpmUnknownColorError | XPM_UNKNOWN_COLOR | Named colour not in built-in table |
| XpmDuplicateKeyError | XPM_DUPLICATE_KEY | Two colour defs share same key |
| XpmSizeMismatchError | XPM_SIZE_MISMATCH | Pixel row count ≠ height, or row length ≠ width*cpp |
| XpmUnknownKeyError | XPM_UNKNOWN_KEY | Pixel references undefined key |
| XpmTooManyColorsError | XPM_TOO_MANY_COLORS | Unique colour count > XPM_MAX_COLORS on serialize |

## Trap list

1. **Header lives on the FIRST string literal inside the array.** Unlike
   XBM where dimensions use `#define` at file scope, XPM packs
   everything in string array. Parser scans to first literal after `{`.

2. **`cpp = 2` means 2-char pixel keys.** Scan pixel rows in fixed
   `cpp`-byte chunks, NEVER split on delimiter.

3. **Colour keys CAN include special chars** (space, comma, `#`, `.`,
   `+`). Only `"` is reserved. Extract key by byte offset (first `cpp`
   bytes VERBATIM from colour def string), never by whitespace split.

4. **Named colours need lookup table; unknowns REJECT.** Ship ~30-entry
   X11 subset; unknown → `XpmUnknownColorError` (no silent black
   fallback).

5. **`#RGB` shorthand expands each nibble.** `#F0A` → `#FF00AA`:
   `r = (h0 << 4) | h0`. `#RRRRGGGGBBBB` narrows to 8-bit via top byte
   of each 16-bit channel. 9-digit `#RRRGGGBBB` NOT legal; reject.

6. **`c None` = transparent (alpha 0).** All others alpha 255.
   Case-insensitive match. XPM3 has no gradient alpha.

7. **Hotspot (5th/6th header tokens) OPTIONAL.** 4 tokens = no hotspot;
   6 = hotspot; 5 or 7+ tokens → `XpmBadValuesError`.

8. **Pixel rows MUST be EXACTLY `width * cpp` chars.** Reject short or
   long with `XpmSizeMismatchError`. Row count MUST equal `height`.

9. **ASCII decode fatal mode.** `TextDecoder('ascii', { fatal: true })`;
   non-ASCII bytes throw → wrap as `XpmBadHeaderError`.

10. **C-style `/* */` comments** may appear anywhere between tokens;
    skip and discard (not preserved on round-trip). `//` line comments
    NOT XPM3 canonical; reject inside array scope.

11. **Visual class `c` only; skip siblings.** Multi-class def like
    `". c #FF0000 m #FFFFFF s red"` — use first `c` pair, skip rest.
    If NO `c` pair present → `XpmBadColorDefError`.

## Security caps

```ts
export const XPM_MIME = 'image/x-xpixmap';
export const XPM_DEFAULT_NAME = 'image';
export const XPM_MAX_COLORS = 1024;
export const XPM_MAX_CHARS_PER_PIXEL = 2;
export const XPM_KEY_ALPHABET =  // 92 printable, excluding "
  ` !#$%&'()*+,-./0123456789:;<=>?@` +
  `ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`` +
  `abcdefghijklmnopqrstuvwxyz{|}~`;
```

Pre-existing `MAX_INPUT_BYTES`, `MAX_PIXELS`, `MAX_PIXEL_BYTES`,
`MAX_DIM` apply unchanged.

**ReDoS defense**: hand-rolled character-walk tokenizer (matches XBM
pattern). Zero regex anywhere in parser. 200 MiB of whitespace-padded
`",...,"` must parse in O(n) time.

**Allocation order**:
1. Validate input size
2. ASCII decode (fatal)
3. Scan to `static char *`; capture `name`
4. Read first string literal; parse header tokens
5. Validate `width/height ≤ MAX_DIM`, `width*height ≤ MAX_PIXELS`,
   `ncolors ≤ XPM_MAX_COLORS`, `cpp ∈ {1,2}`
6. Allocate colour `Map<string, [r,g,b,a]>`
7. Read `ncolors` colour-def strings; populate map
8. ONLY THEN allocate `pixelData = new Uint8Array(width*height*4)`
9. Read `height` pixel strings; chunk by `cpp`; look up; write RGBA

## Parser algorithm

1. Size check + ASCII decode
2. Scan to `static char *<name>[] = {` skipping whitespace + `/* */`
3. `readStringLiteral()` helper: consume ws+comments, expect `"`,
   capture until unescaped `"`, minimal escape handling (only `\\` + `\"`)
4. Parse header string: 4 or 6 decimal tokens; assign dimensions
5. Parse `ncolors` colour definitions:
   - First `cpp` bytes VERBATIM as key (Trap #3)
   - Byte at offset `cpp` must be whitespace
   - Tokenize remainder; find first `c <value>` pair; skip siblings
   - Parse value via `parseColorValue(raw)` → RGBA
   - Insert into map; duplicate → error
6. Allocate pixelData
7. Parse `height` pixel strings:
   - Validate length === width*cpp
   - Chunk into cpp-byte keys; look up; write RGBA
8. Consume `}` + `;`; trailing bytes tolerated
9. Return XpmFile

## Colour value parsing

```ts
function parseColorValue(raw: string): [number, number, number, number] {
  const lower = raw.toLowerCase();
  if (lower === 'none' || lower === 'transparent') return [0, 0, 0, 0];
  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    if (hex.length === 3) {
      // #RGB → each nibble doubled
      const r = parseHexNibble(hex[0]); const g = parseHexNibble(hex[1]); const b = parseHexNibble(hex[2]);
      return [(r<<4)|r, (g<<4)|g, (b<<4)|b, 255];
    }
    if (hex.length === 6) return [parseByte(hex,0), parseByte(hex,2), parseByte(hex,4), 255];
    if (hex.length === 12) return [parseByte(hex,0), parseByte(hex,4), parseByte(hex,8), 255];  // narrow to top byte
    throw new XpmBadHexColorError(raw);
  }
  const named = X11_NAMED_COLORS[lower];
  if (named === undefined) throw new XpmUnknownColorError(raw);
  return [...named, 255];
}
```

X11 named colour table (30-entry subset): `black, white, red, green`
(X11 #008000), `lime` (#00FF00), `blue, yellow, cyan/aqua,
magenta/fuchsia, gray/grey, darkgray/darkgrey, lightgray/lightgrey,
silver, orange, purple, pink, brown, navy, teal, olive, maroon, gold,
transparent`. Follows X11 `rgb.txt` mapping (not CSS).

## Serializer algorithm

1. Validate: dimensions, name is C identifier
2. Build unique-colour Map keyed by packed RGBA uint32
3. Reject if > XPM_MAX_COLORS
4. Pick `cpp`: 1 if ≤92 unique, else 2
5. Assign keys from `XPM_KEY_ALPHABET` in first-encountered order
   (deterministic for stable round-trip snapshots)
6. Emit canonical form:
   ```
   /* XPM */
   static char * <name>_xpm[] = {
   "<W> <H> <N> <cpp>[ <xh> <yh>]",
   "<k0> c <#RRGGBB|None>",
   ...
   "<pixel row 0>",
   ...
   "<pixel row H-1>"
   };
   ```
7. Always 6-digit `#RRGGBB` hex (no shorthand); `None` for alpha=0.
   Mixed-alpha-between-0-and-255 rejected at validate time.
8. Encode via TextEncoder; return Uint8Array

## Detection

`detect.ts`: after existing magic-byte checks, skip leading ws + one
`/* */` comment, then:
1. If bytes match `/* XPM */` → return 'xpm'
2. Else look-ahead ~1024 bytes for `static` keyword; if shape
   `static [const] char * <ident>[] = {` → return 'xpm'
3. Else `#define` → defer to XBM detector
4. Else null

## Test plan (18-24 cases)

1. Decodes canonical 16×16 4-colour spec fixture
2. cpp=2 chunks pixel rows in 2-byte keys (Trap #2)
3. Space/comma/# colour keys extracted by byte offset (Trap #3)
4. #RGB shorthand #F0A → RGBA(255, 0, 170, 255) (Trap #5)
5. #RRRRGGGGBBBB narrowed to 8-bit via high byte of each 16-bit channel
6. Named 'red' resolves to RGBA(255, 0, 0, 255)
7. Unknown 'cornflowerblue' → XpmUnknownColorError (Trap #4)
8. `c None` → alpha=0; others alpha=255 (Trap #6)
9. 6-token header → hotspot extracted; 4-token → null
10. 5-token header → XpmBadValuesError (Trap #7)
11. Pixel row length ≠ width*cpp → XpmSizeMismatchError (Trap #8)
12. Pixel key not in map → XpmUnknownKeyError
13. Duplicate colour key → XpmDuplicateKeyError
14. `/* */` comments between string literals skipped (Trap #10)
15. Non-ASCII byte → XpmBadHeaderError (Trap #9)
16. Sibling m/s/g classes ignored; missing c → error (Trap #11)
17. width*height > MAX_PIXELS → ImagePixelCapError (cap BEFORE allocation)
18. Canonical serialize: `/* XPM */`, 6-digit hex, None for alpha=0
19. Auto-cpp=1 for ≤92 colours; cpp=2 for more
20. > XPM_MAX_COLORS → XpmTooManyColorsError
21. Round-trip RGBA preserves pixel data for 8×8 RGBA with transparent
22. detectImageFormat returns 'xpm' for `/* XPM */\nstatic char *...`
23. parseImage/serializeImage round-trip preserves union
24. ReDoS regression: 50 MiB whitespace+comment padding parses in <2s

## Dependencies

- `TextDecoder('ascii', { fatal: true })` + `TextEncoder` — browser-native
- NO regex, NO npm dependencies
- X11 named-colour table inline (30 entries)

## LOC budget

| File | LOC |
|---|---|
| xpm.ts | 470 |
| _test-helpers/build-xpm.ts | 90 |
| errors.ts additions (9 classes) | 80 |
| constants.ts additions | 18 |
| detect.ts additions | 40 |
| parser/serializer/backend/index/core/formats | 30 |
| **Source total** | **~540** |
| xpm.test.ts | 260 |
| **Total addition** | **~800** |
