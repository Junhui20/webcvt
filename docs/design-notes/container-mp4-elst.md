# container-mp4 — Edit Lists (`elst`) Design Note

**Phase:** 3, sub-pass A
**Status:** Proposed
**Spec:** ISO/IEC 14496-12 §8.6.5 (`edts`), §8.6.6 (`elst`)
**Clean-room citation:** ISOBMFF spec only. NOT consulting mp4box.js, mp4-tools, l-smash, or ffmpeg sources.

## 1. Goal

Add support for the `edts/elst` (Edit List) box so the MP4 demuxer can correctly honour the presentation timeline declared by real-world muxers — most importantly, the AAC priming silence offset that iTunes / afconvert / FFmpeg-libfdk-aac always prepend to encoded M4A files. Without `elst`, every transcode that round-trips through container-mp4 silently includes ~23 ms of priming garbage at the start of the audio. With it, we get sample-accurate trim, plus the foundation for movie-maker-style multi-edit timelines later.

## 2. Scope

### IN
- Parse `edts/elst` (FullBox v0 32-bit and v1 64-bit).
- Attach a typed `EditListEntry[]` to `Mp4Track`.
- Serialize `elst` back inside `edts` inside `trak` when non-trivial.
- Sample-iterator integration:
  - Skip / honour leading **empty edit** (`media_time = -1`) by adding to the presentation timestamp baseline.
  - Skip leading samples for a **normal edit** with `media_time = X > 0`.
  - Truncate trailing samples when an edit's `segment_duration` is shorter than the remaining media.
- Round-trip: parse → serialize is byte-identical for `elst` payload.

### OUT
- **Dwell edits** (`media_rate_integer = 0` and `media_time != -1`): rejected.
- **Fractional / non-1 `media_rate`** (slow-mo, fast-forward, reverse): rejected.
- v1 64-bit `segment_duration` or `media_time` values that exceed `Number.MAX_SAFE_INTEGER`: rejected.
- Multi-track A/V sync (Phase 3.5+ when video lands).
- Edit lists on non-`soun` handler tracks.

## 3. Box structure (wire format)

### 3.1 `edts` container (§8.6.5)

Plain Box. Holds exactly one `elst` child. Already in `CONTAINER_BOX_TYPES`.

### 3.2 `elst` (§8.6.6) — FullBox

```
[size:u32][type:'elst'][version:u8][flags:u24][entry_count:u32]
  for each entry:
    if version == 0:
      [segment_duration:u32][media_time:i32]            # signed!
      [media_rate_integer:i16][media_rate_fraction:i16]
    if version == 1:
      [segment_duration:u64][media_time:i64]            # signed!
      [media_rate_integer:i16][media_rate_fraction:i16]
```

- v0 entry size = 12 bytes; v1 entry size = 20 bytes.
- `media_time = -1` is the **empty-edit sentinel**.
- `media_rate` is fixed-point 16.16. Normal playback = `1.0` = (1, 0).
- `segment_duration` is in **movie timescale** (`mvhd.timescale`).
- `media_time` is in **media timescale** (`mdhd.timescale`).

## 4. Parser changes

In `parseTrak`, after `tkhd` parse and before `mdia`:
```
const edtsBox = findChild(trakBox, 'edts');
const editList = edtsBox ? parseElst(requireChild(edtsBox, 'elst').payload) : [];
```

If `edts` present but `elst` missing → `Mp4MissingBoxError('elst', 'edts')`.
If `entry_count == 0` → return empty array (legal; serializer drops `edts`).
Each entry: validate `media_rate_integer == 1`, `media_rate_fraction == 0`, decode `media_time` as SIGNED.

`Mp4Track` gains: `editList: readonly EditListEntry[]`.

## 5. Serializer changes

`buildTrakBox` extended with `buildEdtsBoxIfNeeded`. Returns null when **trivial**:
- `editList.length === 0`, OR
- `editList.length === 1` AND first entry is identity (mediaTime=0, segmentDuration=movieDuration, rate=1)

Otherwise emits `edts` containing `elst`. Uses **v1 only when required** — any field exceeds `0x7FFFFFFF` (signed). Mirrors the existing stco→co64 promotion pattern.

## 6. Sample-iterator changes

1. **Pre-roll empty edits.** Sum consecutive leading empty edits' `segment_duration` (movie ticks → microseconds via `mvhd.timescale`) → `presentationOffsetUs`.
2. **Find active normal edit.** First non-empty: `mediaStartTicks = mediaTime`, `mediaDurationTicks = segmentDuration * mdhd.timescale / mvhd.timescale`.
3. **Skip leading samples** until `cumulativeTicks >= mediaStartTicks`.
4. **Emit with offset:** `timestampUs = presentationOffsetUs + ((cumulativeTicks - mediaStartTicks) * 1e6 / mdhd.timescale)`.
5. **Truncate end** once `cumulativeTicks - mediaStartTicks >= mediaDurationTicks`.
6. **Multi-edit:** sub-pass A honours only the first non-empty edit; multiple non-empty edits → `Mp4ElstMultiSegmentNotSupportedError` from iterator (parser still preserves all for round-trip).

`AudioSample` gains optional `editStartSkipTicks?: number` for sub-sample priming offsets.

## 7. Type definitions

```ts
export interface EditListEntry {
  segmentDuration: number;     // movie-timescale units
  mediaTime: number;           // media-timescale units; -1 = empty edit
  mediaRate: 1;                // narrowed literal (non-1 rejected)
  sourceVersion: 0 | 1;        // preserved for round-trip
}
```

`number` over `bigint` for consistency with existing mvhd/tkhd/mdhd. Parser-side guard: any v1 hi-word > `0x001FFFFF` → `Mp4ElstValueOutOfRangeError`.

## 8. Traps honoured

1. **`media_time` is SIGNED.** v0 = `int32`, v1 = `int64`. Use `getInt32` not `getUint32`. For v1, recognise `(hi == 0xFFFFFFFF && lo == 0xFFFFFFFF)` as `-1` sentinel BEFORE range checks.
2. **`-1` empty-edit sentinel** checked BEFORE any `mediaTime + offset` arithmetic. A bug here turns 23 ms silence into a UINT32_MAX-tick skip.
3. **v1 64-bit fields.** `version == 1` → entry size 20 not 12. `entry_count * entry_size + 8 == payload.length` exact match required.
4. **`entry_count == 0` is LEGAL.** Pre-2010 iTunes writes empty `elst`. No-op; round-trip drops empty `edts`.
5. **Mixed timescale units.** `segment_duration` in movie timescale; `media_time` in media timescale. AAC files: `mvhd=1000`, `mdhd=44100`. Convert before comparing.
6. **Serializer must NOT emit `elst` when trivial.** Avoids ~32-byte bloat and tool-compat issues.
7. **`media_rate_fraction != 0`** out of scope. Reject explicitly.
8. **`edts` without `elst` child** → `Mp4MissingBoxError`.

## 9. Typed errors

| Class | Code | Trigger |
|---|---|---|
| `Mp4ElstBadEntryCountError` | `MP4_ELST_BAD_ENTRY_COUNT` | `entry_count * entry_size + 8 != payload.length` |
| `Mp4ElstTooManyEntriesError` | `MP4_ELST_TOO_MANY_ENTRIES` | `entry_count > MAX_ELST_ENTRIES` |
| `Mp4ElstUnsupportedRateError` | `MP4_ELST_UNSUPPORTED_RATE` | `media_rate_integer != 1` OR `media_rate_fraction != 0` |
| `Mp4ElstSignBitError` | `MP4_ELST_SIGN_BIT_ERROR` | `media_time < -1` |
| `Mp4ElstValueOutOfRangeError` | `MP4_ELST_VALUE_OUT_OF_RANGE` | v1 value exceeds `Number.MAX_SAFE_INTEGER` |
| `Mp4ElstMultiSegmentNotSupportedError` | `MP4_ELST_MULTI_SEGMENT_NOT_SUPPORTED` | iterator: more than one non-empty edit |

## 10. Security caps

```ts
export const MAX_ELST_ENTRIES = 4096;
```

Real files have ≤4 entries. 4096 keeps worst-case allocation under 100 KB.

## 11. Test plan (20 tests)

### Round-trip
1. No `edts` → output has no `edts`
2. Single normal identity edit → output drops trivial `edts`
3. Single normal edit `mediaTime > 0` → preserved
4. Empty + normal (AAC priming) → preserved
5. Multi-edit (3 entries) → all preserved verbatim
6. v1 64-bit elst with `segmentDuration > 2^32` → preserved as v1
7. v0 negative `mediaTime != -1` (corrupt fixture) → `Mp4ElstSignBitError`

### Sample-iterator
8. Empty edit of 23ms shifts first sample `timestampUs` by +23000
9. Normal edit `mediaTime=44100` skips ~43 samples; subsequent emit with `timestampUs=0`
10. `segmentDuration` shorter than media truncates iteration
11. No `edts` → identical to pre-elst baseline (regression guard)
12. First sample after non-aligned `mediaTime` has `editStartSkipTicks` set

### Rejection
13. Dwell edit (`rate_integer=0, mediaTime=42`) → `Mp4ElstUnsupportedRateError`
14. Fractional rate (`rate_fraction=0x8000`) → `Mp4ElstUnsupportedRateError`
15. `entry_count = MAX+1` → `Mp4ElstTooManyEntriesError`
16. Truncated entry → `Mp4ElstBadEntryCountError`
17. v1 hi-word `0x80000000` (not -1 sentinel) → `Mp4ElstValueOutOfRangeError`

### Edge
18. `entry_count = 0` → `editList=[]`, serializer drops `edts`
19. Single empty edit only (silence track) → iterator yields 0 samples with `presentationOffsetUs` accounted
20. `edts` present but `elst` missing → `Mp4MissingBoxError('elst', 'edts')`

## 12. LOC budget

| File | Net LOC |
|---|---|
| `src/boxes/elst.ts` (new) | ~180 |
| `src/parser.ts` | +25 |
| `src/serializer.ts` | +60 |
| `src/sample-iterator.ts` | +90 |
| `src/errors.ts` | +50 |
| `src/constants.ts` | +6 |
| `test/elst.test.ts` (new) | ~480 |
| **Total** | **~890** |

## 13. Clean-room citation

ISO/IEC 14496-12:2022 §8.6.5 + §8.6.6 only. NOT consulted: mp4box.js, mp4-tools (Bento4), l-smash, ffmpeg movenc.c / mov.c.
