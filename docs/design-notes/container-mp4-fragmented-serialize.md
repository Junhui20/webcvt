# Fragmented MP4 Round-Trip Serializer — Sub-Pass D.4

> Completes Phase 3 second-pass Minus. Reference: [container-mp4-fragmented.md](./container-mp4-fragmented.md) §11 and §13.

## 1. Goal

Remove the `Mp4FragmentedSerializeNotSupportedError` gate so `serializeMp4(parseMp4(bytes))` yields byte-identical output for every fragmented MP4 the parser accepts. Unlocks end-to-end transcode for DASH segments, HLS-CMAF, MSE Source Buffer payloads — including multi-track files (C) with typed video sample entries (B) and edit lists (A).

D.4 is the last sub-pass for Phase 3 second-pass Minus. D.3 (typed sidx/mfra) remains nice-to-have; F (DRM) deferred to v0.2.

## 2. Scope IN

- Populate `Mp4File.fragmentedTail` during `parseFragmented` (byte range `[initSegmentEnd, fileBytes.length)`)
- Populate new `Mp4File.originalMoovSize: number | null` during `parseFragmented`
- Expose `Mp4File.mehd: Mp4Mehd | null` (new field)
- Replace the fragmented guard in `serializeMp4` with real code path
- Size-match guard rejects any moov delta with `Mp4FragmentedMoovSizeChangedError`
- Byte-equivalent round-trip for every parsed fragmented fixture (single + multi-track)
- New `buildMoovFragmented`, `buildMvex`, `buildTrex`, `buildMehd` helpers

## 3. Scope OUT

- Mutation support on fragmented files (any change → `Mp4FragmentedMoovSizeChangedError`)
- Write-side fragmentation (non-fragmented → fragmented output)
- Typed `sidx`/`mfra` preservation (they stay in opaque `fragmentedTail`)
- Trimming/cutting/re-timestamping fragments
- Format conversion (classic ↔ fragmented)

## 4. fragmentedTail population

In `parseFragmented` after moof discovery, before constructing final `Mp4File`:

```ts
const ftypEnd = ftypBox.payloadOffset + ftypBox.payloadSize;
const moovEnd = moovBox.payloadOffset + moovBox.payloadSize;
const initSegmentEnd = Math.max(ftypEnd, moovEnd);  // Trap 3

const fragmentedTail = input.subarray(initSegmentEnd, input.length).slice();
const originalMoovSize = moovBox.headerSize + moovBox.payloadSize;
```

Both fields are `readonly` on `Mp4File`. `parseClassic` keeps them `null`.

```ts
readonly fragmentedTail: Uint8Array | null;
readonly originalMoovSize: number | null;
readonly mehd: Mp4Mehd | null;
```

## 5. Serializer algorithm

```ts
export function serializeMp4(file: Mp4File): Uint8Array {
  if (file.isFragmented) return serializeFragmented(file);
  // existing classic path unchanged
}

function serializeFragmented(file: Mp4File): Uint8Array {
  if (file.fragmentedTail === null || file.originalMoovSize === null) {
    throw new Mp4FragmentedTailMissingError();
  }

  const ftypBytes = buildFtypBox(file.ftyp);
  const moovBytes = buildMoovFragmented(file);

  if (moovBytes.length !== file.originalMoovSize) {
    throw new Mp4FragmentedMoovSizeChangedError(file.originalMoovSize, moovBytes.length);
  }

  return concatBytes([ftypBytes, moovBytes, file.fragmentedTail]);
}
```

**Does NOT** rebuild mdat; does NOT compute patched offsets; does NOT iterate stco/co64 promotion. Tail is verbatim; moov is byte-stable by contract.

## 6. buildMoovFragmented

Canonical child order per ISO 14496-12 §8.2.1:
```
moov
  mvhd
  trak (for each track in file order)
    tkhd
    edts/elst (optional, non-trivial only)
    mdia
      mdhd
      hdlr
      minf
        smhd | vmhd
        dinf/dref
        stbl
          stsd            (full codec config)
          stts            (zero-entry)
          stsc            (zero-entry)
          stsz            (zero-entry, sample_size=0)
          stco | co64     (zero-entry; preserve original variant)
  mvex
    mehd               (optional; iff file.mehd !== null)
    trex*              (one per track, in parsed order)
  udta                 (optional; iff non-trivial metadata or opaque)
```

**Zero-entry stbl**: each serializer (`serializeStts`/`serializeStsc`/`serializeStsz`/`serializeStco`) must produce deterministic zero-entry bytes. `stsz` with `sample_count === 0` AND `sample_size === 0` — verify no shortcut branches diverge.

**Box order caveat**: non-canonical moov child order in input → rebuilt bytes may not match byte-for-byte. Size guard catches content-diff-same-size cases (unlikely). Document as limitation.

## 7. buildMvex / buildTrex / buildMehd

New file `packages/container-mp4/src/boxes/mvex-serialize.ts`:

```ts
// mvex: plain container Box (8-byte header + children)
function buildMvexBox(mehd: Mp4Mehd | null, trackExtends: readonly Mp4TrackExtends[]): Uint8Array;

// mehd: FullBox
//   v0: 4 (version+flags) + 4 (u32 fragment_duration) = 8-byte payload, total 16 bytes
//   v1: 4 (version+flags) + 8 (u64 fragment_duration) = 12-byte payload, total 20 bytes
function buildMehdBox(mehd: Mp4Mehd): Uint8Array;

// trex: FullBox, fixed 24-byte payload, total 32 bytes
//   version+flags(4) + track_ID + default_sample_description_index
//   + default_sample_duration + default_sample_size + default_sample_flags
function buildTrexBox(trex: Mp4TrackExtends): Uint8Array;
```

**trex ordering**: emit in `file.trackExtends` order (which is `parseMvex` order from walkBoxes). Do NOT reorder to match `file.tracks` order — spec does not require trex order to mirror trak order.

**mehd v1 preservation**: do NOT downgrade to v0 even if value fits in 32 bits. Downgrade changes box size 20 → 16 and fails size guard (Trap 6).

## 8. Edge cases

1. Fragmented file with edit list → preserved via existing `buildEdtsBoxIfNeeded`
2. Fragmented file with udta metadata → preserved via existing `buildUdtaBox` (sub-pass E byte-identical contract)
3. ftyp brand preservation — `serializeFtyp` already round-trips brands; iso5/dash/cmfc/mp42 all work
4. Zero-entry stbl serializers — must produce deterministic bytes; verify no special-case on `sample_count === 0`
5. Non-canonical moov child order — documented limitation; not worth recording original order for v0.1
6. mvex without mehd — most fMP4 encoders omit; `file.mehd === null`
7. mehd with `fragment_duration === 0` — legal per spec (unknown duration); round-trip the zero value
8. Empty trex list — rejected earlier by `Mp4NoTracksError`; cannot occur in valid input
9. Tail contains styp/sidx/mfra/prft/emsg — all opaque, preserved verbatim
10. Zero-fragment fMP4 (init segment only) — `fragmentedTail` has zero length; serializer outputs `[ftyp, moov]`
11. `mdatRanges` becomes informational only for fragmented files (not used by serializer)

## 9. Typed errors

**`Mp4FragmentedMoovSizeChangedError(expected, actual)`** — already declared in errors.ts. Thrown by `serializeFragmented` when moov delta detected.

**`Mp4FragmentedTailMissingError`** — NEW. Defensive:
```ts
export class Mp4FragmentedTailMissingError extends WebcvtError {
  constructor() {
    super(
      'MP4_FRAGMENTED_TAIL_MISSING',
      'Mp4File.isFragmented is true but fragmentedTail or originalMoovSize is null.'
    );
    this.name = 'Mp4FragmentedTailMissingError';
  }
}
```

**`Mp4FragmentedSerializeNotSupportedError`** — RETIRE. Mark `@deprecated`; keep class for source compat; never throw.

## 10. Traps honoured (7)

1. **Tail contents are opaque** — every byte from `initSegmentEnd` to EOF preserved verbatim. No parsing, no reordering. moof reordering bugs in parser don't propagate to output.
2. **moov size delta = silent offset corruption** — every `tfhd.base_data_offset` / `trun.data_offset` in tail was computed against original layout. 1-byte delta silently shifts every sample offset. Size-match guard catches this.
3. **ftyp may precede or follow moov** — use `max(ftypEnd, moovEnd)` as initSegmentEnd.
4. **udta round-trip fragility** — sub-pass E guarantees byte-identical udta; size-guard catches any exotic variants that diverge.
5. **mvex/trex order preservation** — emit in `trackExtends` parsed order (walkBoxes order), not trak order.
6. **v1 mehd with 64-bit fragment_duration** — emit version byte 0x01 even if value fits in 32 bits. Downgrade → size mismatch → error.
7. **Zero-sample stbl stability** — four zero-entry serializers must produce deterministic bytes for the zero case.

## 11. Test plan (≥10)

1. Round-trip minimal fMP4 (1 moof + 1 mdat + 10-sample trun) byte-identical
2. Round-trip multi-fragment fMP4 (10 moof+mdat pairs) byte-identical
3. Round-trip fMP4 with sidx in tail byte-identical
4. Round-trip fMP4 with mfra at EOF byte-identical
5. Round-trip fMP4 with udta metadata byte-identical
6. Round-trip fMP4 with edit list on track byte-identical
7. Round-trip multi-track fMP4 (2 tracks) byte-identical
8. Round-trip fMP4 with v1 mehd (version byte = 0x01, box size = 20)
9. Reject: mutate metadata → `Mp4FragmentedMoovSizeChangedError(expected, actual)`
10. Reject: `fragmentedTail = null` + `isFragmented = true` → `Mp4FragmentedTailMissingError`
11. Bonus: ftyp-before-moov and moov-before-ftyp (legacy QT) both round-trip
12. Bonus: degenerate fMP4 (init segment only, zero fragments) round-trip
13. Bonus: fragmented file with co64 in zero-sample stbl preserves co64 variant

## 12. LOC budget (~600 LOC total)

| File | LOC |
|---|---|
| `src/parser.ts` (+tail + originalMoovSize + mehd) | ~40 |
| `src/serializer.ts` (+serializeFragmented + helpers) | ~120 |
| `src/boxes/mvex-serialize.ts` (new) | ~120 |
| `src/errors.ts` (+Mp4FragmentedTailMissingError, @deprecated) | ~15 |
| `test/serializer-fragmented.test.ts` (new) | ~280 |
| **Total** | **~575** |

Production code: ~295 LOC; rest is tests.

## 13. Clean-room

ISO/IEC 14496-12:2022 only:
- §8.2.1 moov child ordering
- §8.8.1 mvex container
- §8.8.2 mehd FullBox (v0/v1)
- §8.8.3 trex FullBox
- §8.8.4 moof container
- §8.8.7 tfhd data_offset semantics (motivates size-match guard)

NOT consulted: ffmpeg, MP4Box (GPAC), Bento4, mp4parser.

## 14. Known limitations (v0.1)

### sec M2 — smhd/vmhd flags hardcoded to 0

The `smhd` (Sound Media Header) and `vmhd` (Video Media Header) boxes are serialized with
`flags = 0x000000` (all zero). ISO 14496-12 §12.1.2 specifies `vmhd.flags = 0x000001`
for legacy reasons, but all modern encoders and decoders accept `0x000000`.

**Impact**: a fragmented file encoded with `vmhd.flags = 0x000001` would be accepted by the
parser, serialized with `vmhd.flags = 0x000000` (same box size), and be byte-non-identical
in the vmhd flags field. In practice this does not affect playback.

**Scope**: content-diff-same-size bypass; size guard still passes. Deferred to v0.2.

### sec M3 — dref url  flags hardcoded to 0x000001

The `dref url ` entry is always serialized with `flags = 0x000001` (self-contained). If a
future caller presents a fragmented file whose `dref url ` flags differ (e.g., `0x000000` +
explicit URL), the serializer will emit the wrong flags (same 12-byte entry size, different
content). The parser already rejects external data refs (`Mp4ExternalDataRefError`), so this
scenario cannot arise from current parser input.

**Scope**: theoretical content-diff-same-size bypass; cannot occur with parser-produced input.
Deferred to v0.2.

## 15. Follow-ups

- Non-canonical moov child order round-trip → future sub-pass could record original order
- Mutation support (D.5) → requires walking tail, recomputing all `tfhd.base_data_offset`/`trun.data_offset`, re-emitting moofs (~400 LOC); defer unless concrete consumer need
- Typed sidx/mfra (D.3) → independent; nice-to-have for DASH introspection
