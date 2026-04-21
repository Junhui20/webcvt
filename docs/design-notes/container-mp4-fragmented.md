# container-mp4 — Fragmented MP4 (fMP4) Design Note

**Phase:** 3, sub-pass D
**Status:** Proposed
**Spec:** ISO/IEC 14496-12 §8.8 (Movie Fragments), §8.16 (Segment Index), DASH-IF "ISO BMFF Live Media Profile" v5.0
**Clean-room citation:** ISOBMFF spec + DASH-IF spec only. NOT consulting mp4box.js, mp4-tools (Bento4), shaka-packager, ffmpeg `movenchint.c` / `movenc.c` / `mov.c`, gpac, l-smash, jaad, or any fragmenter project.

## 1. Goal

Add support for fragmented MP4 (fMP4 / ISOBMFF-fragments) so the demuxer can read DASH segments, HLS-CMAF segments, MSE Source Buffer payloads, and Smooth Streaming files — the format used by ~90% of `.mp4` files served by modern CDNs.

## 2. Scope

### IN
- Detection via `moov/mvex` presence
- `mvex/trex` per-track defaults
- `moof/mfhd` sequence number + monotonicity validation
- `moof/traf/tfhd` (all 8 flag bits)
- `moof/traf/tfdt` (v0 32-bit + v1 64-bit)
- `moof/traf/trun` (all 6 flag bits + per-sample optional fields)
- `sidx` parse only (preserve opaque on serialize)
- `mfra/tfra/mfro` parse only (preserve opaque on serialize)
- New `iterateFragmentedAudioSamples` walks all fragments
- Round-trip byte-equivalent for `mvex` + every `moof/mdat`
- Classic-MP4 fallback when `mvex` absent

### OUT
- Multi-track per-moof iteration (sub-pass C)
- Streaming/incremental parse (whole-file only)
- `saiz`/`saio` (sub-pass F)
- `subs` sub-sample info
- Self-initializing segments (no moov)
- Producing fragments on serialize (always emit classic MP4)
- `sidx`/`mfra` serialize (recomputing offsets requires write-side fragmentation)

## 3. fMP4 file structure

### Top-level layout
```
[ftyp]            ← brand may be 'iso5'/'iso6'/'dash'/'cmfc' (now ACCEPTED)
[moov]            ← carries mvhd/trak/mvex; trak.stbl is ZERO-SAMPLE
  [mvhd]
  [trak]          ← exactly one for sub-pass D
    [tkhd]
    [edts]?
    [mdia/.../stbl]   ← stsd populated, but stsz/stco/stts/stsc all entry_count=0
  [mvex]          ← FRAGMENTATION SIGNAL
    [mehd]?
    [trex]+
[sidx]?           ← optional segment index
[moof]            ← repeats N times, interleaved with mdat
  [mfhd]
  [traf]+
    [tfhd]
    [tfdt]?
    [trun]+
[mdat]
[moof] [mdat] ...
[mfra]?           ← random-access table at end of file
  [tfra]+
  [mfro]          ← MUST be the last 16 bytes of the file
```

### `mvex` (§8.8.1) — Box (NOT FullBox)
```
[size:u32][type:'mvex']
  [mehd]? [trex]+
```
Container; add to `CONTAINER_BOX_TYPES`.

### `mehd` (§8.8.2) — FullBox
```
[size:u32][type:'mehd'][version:u8][flags:u24]
  if version == 0: [fragment_duration:u32]
  if version == 1: [fragment_duration:u64]
```

### `trex` (§8.8.3) — FullBox (32 bytes total)
```
[size:u32][type:'trex'][version:u8 = 0][flags:u24]
[track_ID:u32]
[default_sample_description_index:u32]
[default_sample_duration:u32]
[default_sample_size:u32]
[default_sample_flags:u32]
```

### `moof` (§8.8.4) — Box (NOT FullBox)
```
[size:u32][type:'moof']
  [mfhd] [traf]+
```
Container; add to `CONTAINER_BOX_TYPES`.

### `mfhd` (§8.8.5) — FullBox (16 bytes)
```
[size:u32][type:'mfhd'][version:u8 = 0][flags:u24]
[sequence_number:u32]
```

### `traf` (§8.8.6) — Box (NOT FullBox)
```
[size:u32][type:'traf']
  [tfhd] [tfdt]? [trun]*
```
Container; add to `CONTAINER_BOX_TYPES`. Empty `traf` (no `trun`) is LEGAL.

### `tfhd` (§8.8.7) — FullBox — flag-driven
```
[size:u32][type:'tfhd'][version:u8 = 0][flags:u24]
[track_ID:u32]                                     ← always
if (flags & 0x000001): [base_data_offset:u64]
if (flags & 0x000002): [sample_description_index:u32]
if (flags & 0x000008): [default_sample_duration:u32]
if (flags & 0x000010): [default_sample_size:u32]
if (flags & 0x000020): [default_sample_flags:u32]
flag 0x010000 = duration_is_empty
flag 0x020000 = default_base_is_moof
```

### `tfdt` (§8.8.12) — FullBox
```
[size:u32][type:'tfdt'][version:u8][flags:u24]
if version == 0: [base_media_decode_time:u32]
if version == 1: [base_media_decode_time:u64]
```

### `trun` (§8.8.8) — FullBox — flag-driven per-sample
```
[size:u32][type:'trun'][version:u8][flags:u24]
[sample_count:u32]
if (flags & 0x000001): [data_offset:i32]                   ← SIGNED!
if (flags & 0x000004): [first_sample_flags:u32]
for i in 0..sample_count:
  if (flags & 0x000100): [sample_duration:u32]
  if (flags & 0x000200): [sample_size:u32]
  if (flags & 0x000400): [sample_flags:u32]                ← omitted for i=0 if first_sample_flags set
  if (flags & 0x000800): [sample_composition_time_offset]  ← u32 if v0, i32 if v1
```

### `sidx` (§8.16) — FullBox
```
[size:u32][type:'sidx'][version:u8][flags:u24]
[reference_ID:u32][timescale:u32]
if version == 0: [earliest_presentation_time:u32][first_offset:u32]
if version == 1: [earliest_presentation_time:u64][first_offset:u64]
[reserved:u16 = 0][reference_count:u16]
for i in 0..reference_count:
  [reference_type:1bit][referenced_size:31bit]
  [subsegment_duration:u32]
  [starts_with_SAP:1bit][SAP_type:3bit][SAP_delta_time:28bit]
```

### `mfra/tfra/mfro` (§8.8.9)
- `mfro` MUST be the last 16 bytes of the file. Read by absolute offset.

## 4. Detection algorithm

```
post-moov-parse:
  mvexBox = findChild(moovBox, 'mvex')
  if mvexBox == null:
    → CLASSIC PATH (sub-pass A logic)
    → set isFragmented=false, trackExtends=[], fragments=[], sidx=null
    → return

  → FRAGMENTED PATH:
    1. Validate trak.stbl is empty (stsz/stsc/stts entry_count == 0)
       — non-empty → Mp4FragmentMixedSampleTablesError
    2. Parse every trex inside mvex; index by trackId
    3. Optional mehd: parse and store
    4. Walk top-level boxes after moov:
       moof  → parseMoof(box, moofOffset)
       sidx  → parseSidx (if first encountered)
       mfra  → preserve opaque
       mdat  → record range
    5. Verify mfhd.sequence_number monotonic
    6. Cap counts; set isFragmented = true
```

## 5. tfhd flag bits + base offset precedence

| Bit | Name | Field |
|---|---|---|
| `0x000001` | base-data-offset-present | `base_data_offset:u64` |
| `0x000002` | sample-description-index-present | `sample_description_index:u32` |
| `0x000008` | default-sample-duration-present | `default_sample_duration:u32` |
| `0x000010` | default-sample-size-present | `default_sample_size:u32` |
| `0x000020` | default-sample-flags-present | `default_sample_flags:u32` |
| `0x010000` | duration-is-empty | (no field) |
| `0x020000` | default-base-is-moof | (no field) |

**Base offset precedence:**
```
if tfhd.flags & 0x000001:
  base = tfhd.base_data_offset                       # absolute file offset
elif tfhd.flags & 0x020000:
  base = moof.fileOffset                             # start of THIS moof
else:
  → Mp4TfhdLegacyBaseUnsupportedError                # legacy moov-relative — too rare
```

If both `0x000001` AND `0x020000` set, spec says ignore `default_base_is_moof`. We follow.

## 6. trun flag bits + field order

```
sample_count               : u32
[data_offset]              : i32          if 0x000001
[first_sample_flags]       : u32          if 0x000004
for i in 0..sample_count:
  [sample_duration]        : u32          if 0x000100
  [sample_size]            : u32          if 0x000200
  [sample_flags]           : u32          if 0x000400 AND NOT (i==0 AND 0x000004)
  [sample_composition_time_offset]: u32/i32 if 0x000800
```

When `0x000004` AND `0x000400` BOTH set: sample 0 uses `first_sample_flags`; per-sample `sample_flags` field OMITTED for i=0 only.

## 7. Defaulting cascade

```
sample_duration: trun.samples[i].duration  ?? tfhd.default_sample_duration ?? trex.default_sample_duration
sample_size:     trun.samples[i].size      ?? tfhd.default_sample_size     ?? trex.default_sample_size
sample_flags:    if i==0 AND first_sample_flags: first_sample_flags
                 else: trun.samples[i].flags ?? tfhd.default_sample_flags ?? trex.default_sample_flags
composition_time_offset: trun.samples[i].cto ?? 0
```

If duration or size unresolvable → `Mp4DefaultsCascadeError` (validated BEFORE first emit).

## 8. Base offset worked example

```
ftyp: offset 0,    size 24
moov: offset 24,   size 800   (with mvex)
moof: offset 824,  size 120
mdat: offset 944,  size 4108  (header 8 + payload 4100)

tfhd.flags = 0x020000 (default-base-is-moof)
trun.flags = 0x000301 (data-offset + sample-duration + sample-size)

base = moof.fileOffset = 824
trun.data_offset = 128
sample[0].fileOffset = 824 + 128 = 952  (mdat payload start)
sample[1].fileOffset = sample[0].fileOffset + sample[0].size  (cumulative)
```

Trap 12: `default-base-is-moof` is per-`moof`. Second moof's traf computes `base = secondMoof.fileOffset`.

Trap 2: legal negative `data_offset` (mdat before moof). `getInt32` not `getUint32`.

## 9. Sample iteration

```ts
export function* iterateFragmentedAudioSamples(
  file: Mp4File,
  movieTimescale: number = file.movieHeader.timescale,
): Generator<AudioSample>;

export function* iterateAudioSamplesAuto(file: Mp4File): Generator<AudioSample> {
  if (file.isFragmented) yield* iterateFragmentedAudioSamples(file);
  else yield* iterateAudioSamplesWithContext(file.tracks[0], file.fileBytes, file.movieHeader.timescale);
}
```

Iterator validates bounds (`runByteCursor < 0 || runByteCursor + sz > fileBytes.length` → `Mp4CorruptSampleError`) before each `subarray`. `editStartSkipTicks` extension follows sub-pass A pattern.

## 10. Type definitions

```ts
export interface Mp4TrackExtends {
  readonly trackId: number;
  readonly defaultSampleDescriptionIndex: number;
  readonly defaultSampleDuration: number;
  readonly defaultSampleSize: number;
  readonly defaultSampleFlags: number;
}

export interface Mp4MovieFragment {
  readonly sequenceNumber: number;
  readonly trackFragments: readonly Mp4TrackFragment[];
  readonly moofOffset: number;
}

export interface Mp4TrackFragment {
  readonly trackId: number;
  readonly baseDataOffset: number | null;
  readonly sampleDescriptionIndex: number | null;
  readonly defaultSampleDuration: number | null;
  readonly defaultSampleSize: number | null;
  readonly defaultSampleFlags: number | null;
  readonly defaultBaseIsMoof: boolean;
  readonly durationIsEmpty: boolean;
  readonly baseMediaDecodeTime: number | null;
  readonly tfdtVersion: 0 | 1 | null;
  readonly trackRuns: readonly Mp4TrackRun[];
}

export interface Mp4TrackRun {
  readonly dataOffset: number | null;
  readonly firstSampleFlags: number | null;
  readonly version: 0 | 1;
  readonly flags: number;
  readonly samples: readonly Mp4FragmentSample[];
}

export interface Mp4FragmentSample {
  readonly duration: number | null;
  readonly size: number | null;
  readonly flags: number | null;
  readonly compositionTimeOffset: number | null;
}

export interface Mp4Sidx {
  readonly version: 0 | 1;
  readonly referenceId: number;
  readonly timescale: number;
  readonly earliestPresentationTime: number;
  readonly firstOffset: number;
  readonly references: readonly Mp4SidxReference[];
}

export interface Mp4SidxReference {
  readonly referenceType: 0 | 1;
  readonly referencedSize: number;
  readonly subsegmentDuration: number;
  readonly startsWithSap: boolean;
  readonly sapType: number;
  readonly sapDeltaTime: number;
}
```

All `readonly`; plain `number` consistent with sub-pass A; `Number.MAX_SAFE_INTEGER` guards on u64 fields.

## 11. Mp4File extension

```ts
export interface Mp4File {
  // ... existing fields ...
  readonly isFragmented: boolean;
  readonly trackExtends: readonly Mp4TrackExtends[];
  readonly fragments: readonly Mp4MovieFragment[];
  readonly sidx: Mp4Sidx | null;
  /** Bytes from endOf(moov) through endOf(file) for byte-equivalent round-trip. */
  readonly fragmentedTail: Uint8Array | null;
  /** Opaque mfra payload. */
  readonly mfra: Uint8Array | null;
}
```

`fragmentedTail` is the simplest correct round-trip strategy: parser identifies range from endOf(moov) to endOf(file); serializer copies it verbatim after the rebuilt moov. Any moov mutation is rejected with `Mp4FragmentedMoovSizeChangedError` to prevent silent offset corruption.

## 12. Parser changes

Add `'mvex'`, `'moof'`, `'traf'` to `CONTAINER_BOX_TYPES`. Walk `mvex` inside moov; walk top-level boxes after moov for `moof`/`sidx`/`mfra`. Cap fragments and sample counts.

## 13. Serializer changes (sub-pass D contract)

```
serializeMp4(file):
  if !file.isFragmented:
    → existing classic path (unchanged)
    return
  → fragmented round-trip:
    1. Build ftyp
    2. Rebuild moov from typed fields (with empty stbl tables)
    3. Verify rebuilt moov size == original; differ → Mp4FragmentedMoovSizeChangedError
    4. Concatenate: [ftyp, moov, file.fragmentedTail]
```

Sub-pass D contract: callers cannot mutate `metadata` or `editList` and round-trip a fragmented file. This is documented prominently. Sub-pass-D-future will lift the constraint by rewriting all `tfhd.base_data_offset` / `trun.data_offset` deltas.

## 14. Sample iterator wiring

```ts
export {
  iterateAudioSamples,                  // legacy classic
  iterateAudioSamplesWithContext,       // classic + edit list
  iterateFragmentedAudioSamples,        // new: fragmented only
  iterateAudioSamplesAuto,              // new: auto-dispatch
};
```

Legacy `iterateAudioSamples` does not auto-route; calling it on a fragmented file is undefined.

## 15. Traps honoured (16)

1. `tfhd` `0x000001` OVERRIDES `0x020000` when both set
2. `trun.data_offset` is SIGNED int32; negative offsets legal — `getInt32` + range-check
3. Defaulting cascade order: per-sample > tfhd > trex; unresolved → `Mp4DefaultsCascadeError`
4. `tfdt` v0 vs v1 handling
5. `composition_time_offset` is SIGNED in trun v1, UNSIGNED in v0
6. `mfhd.sequence_number` must be monotonic
7. `trex` defaults are per-track; lookup by trackId
8. Empty `traf` (no `trun`) is LEGAL — 0 samples
9. Per-trun `sample_count` cap: `MAX_SAMPLES_PER_TRUN = 1M`
10. Total fragment cap: `MAX_FRAGMENTS = 100K`
11. fMP4 files can be GIGABYTES — `MAX_INPUT_BYTES` (200 MiB) caveat documented
12. `default_base_is_moof` is per-CURRENT-moof, not first
13. `sidx` nested depth bound: `MAX_SIDX_DEPTH = 8`
14. `mfro` at LAST 16 bytes of file; do NOT scan
15. `tfhd.base_data_offset` u64 clamp via `MAX_SAFE_INTEGER`
16. trun sample 0 flag-suppression when `0x000004 & 0x000400` both set

## 16. Typed errors (20)

| Class | Code |
|---|---|
| `Mp4MoofMissingMfhdError` | `MP4_MOOF_MISSING_MFHD` |
| `Mp4MoofSequenceOutOfOrderError` | `MP4_MOOF_SEQUENCE_OUT_OF_ORDER` |
| `Mp4TfhdInvalidFlagsError` | `MP4_TFHD_INVALID_FLAGS` |
| `Mp4TfhdUnknownTrackError` | `MP4_TFHD_UNKNOWN_TRACK` |
| `Mp4TfhdValueOutOfRangeError` | `MP4_TFHD_VALUE_OUT_OF_RANGE` |
| `Mp4TfhdLegacyBaseUnsupportedError` | `MP4_TFHD_LEGACY_BASE_UNSUPPORTED` |
| `Mp4TfdtVersionError` | `MP4_TFDT_VERSION_ERROR` |
| `Mp4TfdtValueOutOfRangeError` | `MP4_TFDT_VALUE_OUT_OF_RANGE` |
| `Mp4TrunInvalidFlagsError` | `MP4_TRUN_INVALID_FLAGS` |
| `Mp4TrunSampleCountTooLargeError` | `MP4_TRUN_SAMPLE_COUNT_TOO_LARGE` |
| `Mp4TrunSizeMismatchError` | `MP4_TRUN_SIZE_MISMATCH` |
| `Mp4FragmentCountTooLargeError` | `MP4_FRAGMENT_COUNT_TOO_LARGE` |
| `Mp4TrafCountTooLargeError` | `MP4_TRAF_COUNT_TOO_LARGE` |
| `Mp4DefaultsCascadeError` | `MP4_DEFAULTS_CASCADE` |
| `Mp4SidxBadVersionError` | `MP4_SIDX_BAD_VERSION` |
| `Mp4SidxNestedDepthExceededError` | `MP4_SIDX_NESTED_DEPTH_EXCEEDED` |
| `Mp4SidxReferenceCountTooLargeError` | `MP4_SIDX_REFERENCE_COUNT_TOO_LARGE` |
| `Mp4MfraOutOfBoundsError` | `MP4_MFRA_OUT_OF_BOUNDS` |
| `Mp4FragmentMixedSampleTablesError` | `MP4_FRAGMENT_MIXED_SAMPLE_TABLES` |
| `Mp4FragmentedMoovSizeChangedError` | `MP4_FRAGMENTED_MOOV_SIZE_CHANGED` |
| `Mp4CorruptSampleError` | `MP4_CORRUPT_SAMPLE` |

## 17. Security caps

```ts
export const MAX_FRAGMENTS = 100_000;
export const MAX_SAMPLES_PER_TRUN = 1_000_000;
export const MAX_TRAFS_PER_MOOF = 64;
export const MAX_SIDX_REFERENCES = 65_536;
export const MAX_SIDX_DEPTH = 8;
```

`MAX_INPUT_BYTES` stays 200 MiB; streaming is sub-pass G.

`ACCEPTED_BRANDS` adds: `iso5`, `iso6`, `dash`, `cmfc`, `cmf2`, `iso9`.

## 18. Test plan (36 tests)

**Parse (positive, 14):**
1. Minimal fMP4 (1 moof+mdat, 10 samples)
2. Multi-fragment (10 moofs, monotonic sequence)
3-9. tfhd flag combinations (each in isolation)
10. tfhd default-base-is-moof only
11. tfhd base-data-offset-present only
12. tfdt v0 (32-bit)
13. tfdt v1 (64-bit)
14. trun all 6 flag bits

**Iterator (5):**
15. Walk 3 fragments, verify cumulative timestamps
16. Defaulting cascade: trun, tfhd, trex
17. byteOffset with default-base-is-moof across 3 fragments
18. byteOffset with explicit base_data_offset
19. Edit list applied to fragmented file

**Round-trip (4):**
20. Minimal fMP4 byte-identical
21. Multi-fragment with sidx preserved opaquely
22. mfra preserved opaquely
23. Mutation rejection

**Reject (9):**
24. Missing mfhd
25. Out-of-order sequence
26. tfhd unknown trackId
27. trun sample_count > MAX
28. Total fragments > MAX
29. trafs per moof > MAX
30. Defaulting cascade unresolvable
31. tfdt version != 0/1
32. fMP4 with mvex AND non-empty stsz

**Edge (4):**
33. Empty traf (no trun)
34. Empty trun (sample_count=0)
35. Classic MP4 (no mvex) regression
36. trun first-sample-flags suppresses i=0 sample_flags field

## 19. LOC budget (≈2,100 LOC)

| File | LOC |
|---|---|
| `src/boxes/mvex.ts` | 150 |
| `src/boxes/moof.ts` | 280 |
| `src/boxes/trun.ts` | 240 |
| `src/boxes/sidx.ts` | 130 |
| `src/boxes/mfra.ts` | 110 |
| `src/parser.ts` | +120 |
| `src/serializer.ts` | +80 |
| `src/sample-iterator.ts` | +180 |
| `src/errors.ts` | +150 |
| `src/constants.ts` | +25 |
| `src/box-tree.ts` | +5 |
| `src/index.ts` | +30 |
| `tests/fragmented-parse.test.ts` | 280 |
| `tests/fragmented-iterator.test.ts` | 180 |
| `tests/fragmented-roundtrip.test.ts` | 140 |
| **Total** | **≈2,100** |

## 20. Implementation slices

| Slice | Deliverable | LOC | Tests |
|---|---|---|---|
| **D.1** | Detection + `mvex/trex` parse; iterator throws "fragmented not yet supported" | 350 | 4 |
| **D.2** | `moof/mfhd/traf/tfhd/tfdt/trun` parse; iterator yields samples; classic regression intact | 800 | 18 |
| **D.3** | `sidx/mfra/tfra/mfro` parse + opaque preserve | 350 | 6 |
| **D.4** | Round-trip serializer + mutation-detection guard | 600 | 8 |

D.1+D.2 ship together as the first commit (1,150 LOC, 22 tests — fragmented MP4 reading works end-to-end). D.3 and D.4 follow as separate commits.

## 21. Clean-room citation

ISO/IEC 14496-12:2022 §8.8 + §8.16 + DASH-IF "ISO BMFF Live Media Profile" v5.0 only. NOT consulted: mp4box.js, mp4-tools (Bento4), shaka-packager, gpac, l-smash, ffmpeg `mov.c`/`movenc.c`/`movenchint.c`, jaad, mutagen-mp4, AtomicParsley.
