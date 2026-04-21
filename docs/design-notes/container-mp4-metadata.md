# MP4 Movie Metadata: `udta` / `meta` / `ilst` Sub-Pass E

> Phase 3 second-pass sub-pass E. Adds Apple iTunes-style movie metadata to `@webcvt/container-mp4` so `Title`, `Artist`, `Album`, cover art, and other tags survive parse-and-serialize round-trip.

## 1. Goal

Apple introduced the `moov/udta/meta/ilst` hierarchy with the original iTunes M4A and it has since become the de-facto metadata schema for `.m4a`, `.m4b`, `.mp4`, and `.m4v` files written by iTunes, Apple Music, Final Cut, Logic, Premiere, OBS, ffmpeg, gpac, Mp3tag, MusicBrainz Picard, and most podcast tooling. Sub-pass E lets webcvt read these atoms into a typed model, preserve them across a transcode, and emit them on the way out.

## 2. Scope IN

- Container path: `moov/udta/meta/ilst` only (movie-level metadata).
- `meta` parsed under both interpretations: ISO FullBox v0 AND QuickTime plain Box.
- `hdlr` validated to require `handler_type == 'mdir'`.
- Well-known iTunes 4cc atoms parsed into typed values (string, beInt, trkn/disk binary, cover art, `----` freeform).
- Type indicators: `0` binary, `1` UTF-8, `13` JPEG, `14` PNG, `21` BE int.
- Unknown 4cc keys preserved as `{ kind: 'binary' }` for round-trip integrity.
- Atom ordering preserved.
- Round-trip: parse → serialize byte-identical for `udta` content (subject to `meta` FullBox normalisation note).

## 3. Scope OUT

- Track-level `udta` (i.e. `trak/udta`).
- Chapter atoms (`chpl`).
- iTunes Store DRM atoms (`apID`, `atID`, etc.) — preserved as opaque binary.
- ID3v2 bridge (`id32`).
- QuickTime classic metadata atoms.
- `data` atom `locale != 0`: parsed and discarded; serializer always writes 0.
- Re-encoding cover art (no JPEG/PNG decode).

## 4. Box structure

All multi-byte BE.

### `udta` (§8.10.1) — plain Box container.
```
[size:u32][type:'udta'][child boxes...]
```

### `meta` (§8.11.1) — FullBox in ISO, plain Box in legacy QuickTime.

ISO FullBox layout:
```
[size:u32][type:'meta'][version:u8=0][flags:u24=0][child boxes...]
```

QuickTime plain-Box layout:
```
[size:u32][type:'meta'][child boxes...]
```

### `hdlr` (mdir variant)
```
[size:u32][type:'hdlr']
[version:u8=0][flags:u24=0]
[pre_defined:u32=0]
[handler_type:char[4]='mdir']
[reserved:u32 × 3 = 0,0,0]
[name:cstring]
```

### `ilst`
Plain Box container of atoms keyed by 4cc.

### Per-atom box
```
[size:u32][type:fourcc][data sub-box(es)...]
```

For `covr`: one or more `data` children.
For `----`: `mean`, `name`, one or more `data`, in order.
Other atoms: exactly one `data` child.

### `data` sub-box (load-bearing structure)
```
Offset  Size  Field
  0      4    size                (u32)
  4      4    type='data'         (4cc)
  8      4    type_indicator      (u32; high byte=0; low 3 bytes=well_known_type)
 12      4    locale              (u32)
 16      N    payload
```

### `mean`, `name` (children of `----`)
FullBox with version+flags=0 followed by UTF-8 bytes (no terminator).

## 5. `meta` FullBox-vs-Box detection

Heuristic when entering `udta/meta`:
```
firstWord = u32 BE at meta_payload[0..4]
if firstWord == 0x00000000:
  # FullBox v0 with flags=0 (the iTunes-canonical case)
  treat as FullBox; advance 4 bytes
else:
  # Plain Box (QuickTime-style); the bytes are the size of the first child
  treat as plain Box; advance 0 bytes
```

Why safe: a child box size cannot be 0 (size=0 only legal at top level). So `firstWord==0` reliably indicates FullBox; `firstWord!=0` reliably indicates plain Box.

## 6. Type definitions

New: `packages/container-mp4/src/boxes/udta-meta-ilst.ts`.

```ts
export type MetadataValue =
  | { readonly kind: 'utf8';        readonly value: string }
  | { readonly kind: 'jpeg';        readonly bytes: Uint8Array }
  | { readonly kind: 'png';         readonly bytes: Uint8Array }
  | { readonly kind: 'beInt';       readonly value: number }
  | { readonly kind: 'trackNumber'; readonly track: number; readonly total: number }
  | { readonly kind: 'discNumber';  readonly disc:  number; readonly total: number }
  | { readonly kind: 'binary';      readonly bytes: Uint8Array }
  | { readonly kind: 'freeform';    readonly mean: string; readonly name: string; readonly bytes: Uint8Array };

export interface MetadataAtom {
  /** 4cc key including the 0xA9 prefix where applicable (e.g. '©nam'). */
  readonly key: string;
  readonly value: MetadataValue;
}

export type MetadataAtoms = readonly MetadataAtom[];
```

`Mp4File` gains:
```ts
metadata: MetadataAtoms;
udtaOpaque: Uint8Array | null;
```

Key encoding: 4cc decoded as Latin-1 so `0xA9 → '©'`. NEVER decoded as UTF-8 (Trap 1).

## 7. Parser

New module `boxes/udta-meta-ilst.ts` exports:
```ts
export function parseUdta(udtaBox: Mp4Box): { metadata: MetadataAtoms; opaque: Uint8Array | null };
```

Algorithm:
1. Find `meta` child. Absent → return `{ metadata: [], opaque: udtaBox.payload }`.
2. Apply §5 detection; walk inner boxes.
3. Find `hdlr`; missing → `Mp4MissingBoxError`. handler_type != `mdir` → `Mp4MetaBadHandlerError`.
4. Find `ilst`; missing → preserve verbatim.
5. Walk `ilst` children; enforce `MAX_METADATA_ATOMS`.
6. For `----` atoms: strict child order `mean`, `name`, single `data`. For `covr`: 1+ `data`. Others: exactly 1 `data`.
7. For each `data`:
   - Header ≥16 bytes; high byte of `type_indicator` must be 0.
   - Apply per-atom payload caps (`MAX_COVER_ART_BYTES` for `covr`, else `MAX_METADATA_PAYLOAD_BYTES`).
   - Dispatch by type indicator; for `trkn`/`disk` with type 0, enforce 8-byte length and parse `[u16 0][u16 cur][u16 total][u16 0]`.
   - `gnre` preserved as `beInt` (no ID3v1 lookup).
   - Multi-`data` `covr` → one `MetadataAtom` per `data` child.

Parser surface:
```ts
const udtaBox = findChild(moovBox, 'udta');
let metadata: MetadataAtoms = [];
let udtaOpaque: Uint8Array | null = null;
if (udtaBox) {
  const result = parseUdta(udtaBox);
  metadata = result.metadata;
  udtaOpaque = result.opaque;
}
```

## 8. Serializer

`buildUdtaBox(file)` returns:
- `null` when both `metadata.length === 0` AND `udtaOpaque === null` (Trap 11).
- Verbatim opaque bytes wrapped in fresh `udta` header when `metadata.length === 0` AND `udtaOpaque !== null`.
- Freshly built `udta/meta(FullBox v0)/hdlr/ilst` when `metadata.length > 0`. Always FullBox v0 (per Apple's spec).

`buildIlst`: one parent atom per `MetadataAtom` (multi-key emits separate atoms, even for repeated `covr`).

`buildDataBox`: type_indicator from kind; locale always 0; beInt always emitted as 4-byte BE signed.

Inserted into `moov` after `trak` (canonical ffmpeg/mp4box order).

Idempotency: `serializeMp4(parseMp4(bytes))` byte-identical for `udta` content; `meta` header normalised to FullBox v0 if input was QuickTime plain-Box.

## 9. Traps honoured (13)

1. `©nam` 4cc starts with byte `0xA9` (MacRoman ©), NOT UTF-8 `c2 a9` — decode 4cc as Latin-1
2. `meta` FullBox-vs-Box ambiguity — §5 heuristic
3. Wrong `data.type_indicator` dispatch ⇒ wrong decode — strict switch; unknown indicator → `binary`
4. `trkn`/`disk` are 8-byte BINARY — special-cased; non-8 length → `Mp4MetaBadTrackNumberError`
5. `covr` may have MULTIPLE `data` children — emit one `MetadataAtom` per data child
6. `----` requires three children in order — `Mp4MetaFreeformIncompleteError` on violation
7. `hdlr.handler_type` must be `'mdir'` — non-mdir → `Mp4MetaBadHandlerError`; udta preserved opaquely
8. Cover art arbitrarily large — `MAX_COVER_ART_BYTES = 16 MiB` cap
9. `locale != 0` rare but valid — parsed and discarded; serializer writes 0
10. Cover art bytes NOT decoded — opaque `Uint8Array` only
11. Empty udta dropped on serialize
12. Inner `data` payload claiming more bytes than parent → `Mp4InvalidBoxError`
13. Non-ASCII 4cc with no `0xA9` prefix accepted — only mdir semantic dispatch cares about specific keys

## 10. Typed errors (7)

| Class | Code |
|---|---|
| `Mp4MetaBadHandlerError` | `MP4_META_BAD_HANDLER` |
| `Mp4MetaBadDataTypeError` | `MP4_META_BAD_DATA_TYPE` |
| `Mp4MetaTooManyAtomsError` | `MP4_META_TOO_MANY_ATOMS` |
| `Mp4MetaCoverArtTooLargeError` | `MP4_META_COVER_ART_TOO_LARGE` |
| `Mp4MetaFreeformIncompleteError` | `MP4_META_FREEFORM_INCOMPLETE` |
| `Mp4MetaBadTrackNumberError` | `MP4_META_BAD_TRACK_NUMBER` |
| `Mp4MetaPayloadTooLargeError` | `MP4_META_PAYLOAD_TOO_LARGE` |

## 11. Security caps

```ts
export const MAX_METADATA_ATOMS = 1024;                   // real files have ≤30
export const MAX_METADATA_PAYLOAD_BYTES = 4 * 1024 * 1024; // 4 MiB per non-cover atom
export const MAX_COVER_ART_BYTES = 16 * 1024 * 1024;       // 16 MiB per cover image
```

## 12. Test plan (25 tests)

Parse — well-known atom kinds (10):
1. `©nam` UTF-8 → `kind: 'utf8'`
2. `©ART` multi-byte UTF-8 ("Sigur Rós")
3. `©alb` empty string
4. `©day` "2024" stays as utf8 (NOT integer)
5. `trkn` → `{ track: 3, total: 12 }`
6. `disk` → `{ disc: 1, total: 2 }`
7. `tmpo` 2-byte BE int → `{ kind: 'beInt', value: 128 }`
8. `cpil` 1-byte BE int → `{ kind: 'beInt', value: 1 }`
9. `gnre` preserved as `beInt` (NOT translated)
10. Unknown 4cc with type_indicator=0 → `binary`

Cover art (3):
11. Single JPEG `covr` (type 13)
12. Single PNG `covr` (type 14)
13. Multi-image `covr` → two atoms, both key='covr', in order

Freeform (2):
14. `----` with `com.apple.iTunes`/`iTunNORM`
15. `----` missing `mean` → `Mp4MetaFreeformIncompleteError`

`meta` shape detection (2):
16. ISO FullBox v0 `meta`
17. QuickTime plain-Box `meta`

Round-trip (2):
18. Mixed atoms (`©nam`, `©ART`, `©alb`, `trkn`, `covr` JPEG): byte-identical `ilst`
19. Plain-Box `meta` round-trip: `ilst` byte-identical, `meta` header normalised to FullBox v0

Rejection (3):
20. `> MAX_METADATA_ATOMS` children → `Mp4MetaTooManyAtomsError`
21. Cover art > cap → `Mp4MetaCoverArtTooLargeError`
22. `handler_type='dhlr'` → `Mp4MetaBadHandlerError`; udta preserved via `udtaOpaque`

Edge (3):
23. Empty `udta` → serializer drops box
24. udta with only non-meta children → `metadata=[]`, `udtaOpaque=<bytes>`; round-trip verbatim
25. `locale != 0` parse OK, serialize emits locale=0

## 13. LOC budget

| File | New LOC |
|---|---|
| `boxes/udta-meta-ilst.ts` (new) | ~340 |
| `parser.ts` | +25 |
| `serializer.ts` | +160 |
| `errors.ts` | +95 |
| `constants.ts` | +20 |
| `index.ts` | +12 |
| `boxes/udta-meta-ilst.test.ts` (new) | ~520 |
| **Total** | **~1,170** |

## 14. Clean-room citation

- Apple QuickTime File Format Specification (Metadata chapter)
- ISO/IEC 14496-12 §8.10.1 (`udta`), §8.11.1 (`meta`), §8.4.3 (`hdlr`)

NOT consulted: AtomicParsley, mp4metadata, mp4box.js, gpac, Bento4, ffmpeg `mov.c`/`movenc.c`, mutagen-mp4, faad2, taglib.
