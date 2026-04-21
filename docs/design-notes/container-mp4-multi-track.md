# container-mp4 — Multi-Track Support (Phase 3 sub-pass C)

> Status: design. Sub-pass follows A (elst), E (udta/meta/ilst), D (fragmented read), B (video stsd).
> Container-mp4 ships 378 tests. Audio M4A round-trip + video MP4 stsd parsing both green.

## 1. Goal

Remove the hard-coded single-track gate from `parseMp4` / `serializeMp4` / sample iterator so that real-world `.mp4` files containing 2+ `trak` boxes (audio + video, plus optional alternate-language audio) can be parsed, iterated per-track, and round-tripped byte-equivalent. Each `Mp4Track` becomes fully independent. Callers select a track through new `findAudioTrack`/`findVideoTrack`/`findTrackById`/`findTracksByKind` helpers and drive the per-track iterators. No new boxes.

## 2. Scope

### IN
- Multi-track classic MP4 parse: walk every `trak` child of `moov` in FILE ORDER
- Multi-track fragmented MP4 parse: multiple `traf` per `moof` dispatched per `trackId`
- Mixed-handler files: `soun+vide`, `soun+soun` (dubs), `vide+vide` (angles)
- Per-track iteration: existing `iterate*Samples(track, …)` already per-track; extend `iterateFragmented*` and `iterateSamplesAuto` to take optional explicit `track`
- Track selection API (§6)
- Serializer emits every track in file order, preserving original `track_ID` values
- `mvhd.next_track_ID` recomputed on serialize (>max existing trackId) unless input already ≥
- Fragmented iterator filters `fragment.trackFragments` by `traf.trackId === track.trackId`
- Typed errors + security caps
- Regression: all single-track tests from A/B/D/E pass unchanged

### OUT
- Subtitle tracks (`subt`/`text`/`sbtl`) — file-level reject per handler type
- Metadata tracks, timed-text, auxiliary video (`auxv`)
- Track references (`tref`)
- Alternate-group semantics (`tkhd.alternate_group` preserved, no logic)
- Simultaneous multi-track decode (caller iterates each track separately)
- A/V sync offset computation (caller's job using edit lists)
- New encode flows — identity round-trip only

## 3. Track discovery

`parseMoov` (classic + fragmented) currently rejects `trakBoxes.length !== 1`. Replace with:

```
trakBoxes = findChildren(moovBox, 'trak')
if (trakBoxes.length === 0) throw new Mp4NoTracksError()
if (trakBoxes.length > MAX_TRACKS_PER_FILE) throw new Mp4TooManyTracksError(...)

tracks = []
seenTrackIds = new Set<number>()
for (const trakBox of trakBoxes) {
  const track = parseTrak(trakBox, input, boxCount)  // or parseTrakFragmented
  if (track.trackId === 0) throw new Mp4TrackIdZeroError()
  if (seenTrackIds.has(track.trackId)) throw new Mp4DuplicateTrackIdError(track.trackId)
  seenTrackIds.add(track.trackId)
  tracks.push(track)
}
```

**File order preserved** — do NOT sort by trackId. QuickTime/iMovie write video first, iTunes M4A writes audio first. Byte-equivalent round-trip requires identical trak ordering.

## 4. Per-track independence audit

No cross-track shared state. `parseTrak` must be pure `(trakBox, fileData, boxCount) → Mp4Track`. Audit:
- `parseStsd` does not memoise
- `parseEsdsPayload` does not cache slices
- `parseElst`/`parseMdhd`/`parseTkhd` return fresh objects
- `buildSampleTable` does not reuse buffers

`boxCount` (shared mutable counter) is intentional — global box count cap applies across all tracks.

## 5. Track selection API

New file `src/track-selectors.ts` (~50 LOC):

```ts
export function findAudioTrack(file: Mp4File): Mp4Track | null;   // first 'soun' in file order
export function findVideoTrack(file: Mp4File): Mp4Track | null;   // first 'vide' in file order
export function findTrackById(file: Mp4File, trackId: number): Mp4Track | null;
export function findTracksByKind(file: Mp4File, kind: 'audio' | 'video'): readonly Mp4Track[];
```

Picks by `handlerType` (`'soun'`/`'vide'`), not by `sampleEntry.kind`.

## 6. Parser changes

- `parser.ts`: remove single-track gate in both classic + fragmented paths
- `errors.ts`: 7 new classes (see §9)
- `constants.ts`: `MAX_TRACKS_PER_FILE = 64`
- `index.ts`: export new errors/selectors; keep `Mp4MultiTrackNotSupportedError` class but @deprecated

## 7. Serializer changes

Current `serializeMp4` grabs `tracks[0]` and emits one trak. Sub-pass C:
1. `mdatPayloadSize = sum over tracks of sum(sampleSizes)`
2. Interleaving: each track's samples contiguously (flat layout, track 0 first). Offsets patched per-track so decoder can random-access.
3. `buildMoovBox(file, chunkOffsetsPerTrack, useCo64PerTrack)` loops over tracks
4. `useCo64` computed per-track; any track → `stco → co64` promotes globally in that track only
5. Two-pass fixed-point iteration over the union of tracks
6. `mvhd.next_track_ID = max(trackId) + 1` unless input already has larger value (preserve for byte-equiv)
7. Fragmented round-trip stays gated behind `Mp4FragmentedSerializeNotSupportedError` (sub-pass D.4)

## 8. Sample iterator changes

**Design decision: Option A + back-compat** — existing `iterate*(file)` functions accept optional `track` argument; omit + single-track = same as before; omit + multi-track = throws `Mp4AmbiguousTrackError`.

```ts
export function* iterateFragmentedAudioSamples(file: Mp4File, track?: Mp4Track): Generator<AudioSample>;
export function* iterateFragmentedVideoSamples(file: Mp4File, track?: Mp4Track): Generator<Mp4Sample>;
export function* iterateAudioSamplesAuto(file: Mp4File, track?: Mp4Track): Generator<AudioSample>;
export function* iterateSamples(file: Mp4File, track?: Mp4Track): Generator<Mp4Sample>;
```

Behavior:
- Omitted + single-track → back-compat (picks the one track)
- Omitted + multi-track → `Mp4AmbiguousTrackError`
- Provided → validate `file.tracks.includes(track)` (reference equality); else `Mp4TrackNotFoundError`

Fragmented path: filter `fragment.trackFragments` by `traf.trackId === track.trackId`.

Each track uses its own `track.mediaHeader.timescale` for per-sample timestamps. Movie timescale used only for edit-list segment_duration conversion.

## 9. Fragmented multi-track

- `mfhd.sequence_number` is one value per moof covering all trafs (§8.8.5)
- Each `traf` resolves its own `resolvedBase` via `parseTfhd` independently
- Multi-track fragmented layouts (audio + video interleaved, appended, or in separate mdats) all work with no base-resolution change
- `parseMoof` already produces `trackFragments: readonly Mp4TrackFragment[]` — sub-pass C adds the per-track filter to iterators

## 10. Backend changes

`Mp4Backend.canHandle` stays identity-only (`audio/mp4 → audio/mp4`). `Mp4Backend.convert` must NOT crash on multi-track input.

Changes:
1. Parse → `Mp4File` (may contain video)
2. If `output.mime === 'audio/mp4'`:
   - `audioTrack = findAudioTrack(file)`; null → `Mp4NoAudioTrackError`
   - Serialize NEW `Mp4File` containing only audio track via helper `projectToSingleTrack(file, track)` that rebuilds `moov` with just one `trak`, drops unrelated `mvex.trex`, filters `fragments[*].trackFragments`
3. `output.mime !== input.mime` → unchanged (`Mp4EncodeNotImplementedError`)

Projection is LOSSY — video track dropped. Document in JSDoc. Direct `parseMp4 + serializeMp4` API preserves everything.

No `video/mp4` MIME in backend for v0.1 (video via WebCodecs is Phase 6+).

## 11. Traps honoured (12)

1. **`mvhd.next_track_ID` vs actual `track_ID`** — spec says must exceed max. Don't validate on parse (encoders disagree); recompute on serialize
2. **Duplicate `track_ID`** — parser-differential risk; reject with `Mp4DuplicateTrackIdError`
3. **Unsupported handler type** — file-level REJECT (not skip). Per-track `Mp4UnsupportedTrackTypeError` propagates to whole file. Rationale: silently dropping a `subt` track would hide data from caller. Future: add `parseMp4({ skipUnsupportedTracks: true })` option
4. **`mfhd.sequence_number` covers all trafs** — already validated at moof level; no per-traf change
5. **Per-track timescales** — audio 44100, video 30000 typical. Each track uses own `mdhd.timescale`
6. **`track_ID = 0` invalid** (§8.3.2) — reject
7. **Track order in moov is file order** — do NOT sort
8. **`mvhd.timescale` vs `mdhd.timescale`** — movie timescale for edit lists only; media timescale for stts/tfdt
9. **Track count cap** `MAX_TRACKS_PER_FILE = 64`
10. **`trex` presence for every trak** — legal to have trak with no trex (no fragments contributed); don't throw at moov parse
11. **Handler-type case sensitivity** — exact 4-byte ASCII `'soun'`/`'vide'`
12. **Empty moov (zero trak)** — `Mp4NoTracksError` (not reused `Mp4MissingBoxError`)

## 12. Typed errors (7)

| Class | Code |
|---|---|
| `Mp4DuplicateTrackIdError` | `MP4_DUPLICATE_TRACK_ID` |
| `Mp4TrackIdZeroError` | `MP4_TRACK_ID_ZERO` |
| `Mp4NoTracksError` | `MP4_NO_TRACKS` |
| `Mp4TooManyTracksError` | `MP4_TOO_MANY_TRACKS` |
| `Mp4TrackNotFoundError` | `MP4_TRACK_NOT_FOUND` |
| `Mp4AmbiguousTrackError` | `MP4_AMBIGUOUS_TRACK` |
| `Mp4NoAudioTrackError` | `MP4_NO_AUDIO_TRACK` |

`Mp4MultiTrackNotSupportedError` kept but @deprecated; parser never throws.

## 13. Security caps

```ts
export const MAX_TRACKS_PER_FILE = 64;
```

Reuse existing: `MAX_BOXES_PER_FILE`, `MAX_DEPTH`, `MAX_TABLE_ENTRIES`.

## 14. Test plan (22 tests)

1. Parse 2-track (audio+video) — order preserved
2. Parse 3-track (audio+video+audio dub) — distinct trackIds
3. Parse multi-audio-only
4. Parse multi-video-only
5. Parse fragmented multi-track (moof with 2 traf)
6. `findAudioTrack` returns first soun
7. `findVideoTrack` returns first vide
8. `findTrackById` positive + negative
9. `findTracksByKind` 2-dub returns length 2
10. Round-trip 2-track byte-identical
11. Reject duplicate track_ID
12. Reject track_ID = 0
13. Reject empty moov (0 trak)
14. Reject track count > 64
15. Reject unsupported handler ('subt')
16. `Mp4AmbiguousTrackError` on multi-track iterator without selector
17. Iterator with explicit audio track yields audio only
18. Iterator with explicit video track yields video only, correct `isKeyframe`
19. Per-track timescales respected (audio@44100, video@30000)
20. Regression: single-track M4A fixtures still pass
21. Backend audio/mp4 → audio/mp4 on 2-track input drops video
22. Backend throws `Mp4NoAudioTrackError` when no audio track

## 15. LOC budget

| File | Net LOC |
|---|---|
| `src/parser.ts` | +60 / −20 |
| `src/serializer.ts` | +120 / −15 |
| `src/sample-iterator.ts` | +90 / −10 |
| `src/backend.ts` | +40 / −5 |
| `src/track-selectors.ts` (new) | +50 |
| `src/errors.ts` | +90 (7 classes) |
| `src/constants.ts` | +6 |
| `src/index.ts` | +15 |
| `test/multi-track.test.ts` (new) | ~400 |
| **Total** | **~1,250 added, 50 removed** |

Net production LOC: ~500.

## 16. Clean-room citation

ISO/IEC 14496-12:2022 §8.3 (Track Box), §8.4 (Media Box), §8.8 (Movie Fragments), §8.3.2 (track_ID reservation), §8.6.6 (Edit List).

NOT consulted: ffmpeg, gpac, Bento4, mp4parser, mp4box.js.

## 17. Implementation phasing

- **C.1** Parser multi-track discovery + selectors — tests 1-9, 11-15, 19, 20
- **C.2** Serializer multi-track emit — test 10
- **C.3** Iterator explicit-track API — tests 5, 16, 17, 18
- **C.4** Backend projection — tests 21, 22

Ship as one commit (like B).

## 18. Risks

- **Single-track round-trip regresses** on multi-track serializer — mitigation: run existing A/B/D/E fixtures unchanged
- **`findAudioTrack` picks wrong track** (commentary before primary) — document "first in file order"; caller uses `findTracksByKind` + `tkhd.alternate_group` for primary selection
- **`Mp4AmbiguousTrackError` surprises callers** — previous API rejected multi-track entirely, so no callers existed in the multi-track path
- **Backend lossy projection** — JSDoc warning; direct API preserves all tracks

## 19. Success criteria

- [ ] `parseMp4(twoTrackBytes)` returns `tracks.length === 2`
- [ ] All 4 selectors behave per §5
- [ ] `serializeMp4(parseMp4(bytes))` byte-identical for canonical 2-track fixtures
- [ ] Existing single-track fixtures unchanged
- [ ] Per-track iterators yield correct samples only
- [ ] All 7 new error classes exported + tested
- [ ] `MAX_TRACKS_PER_FILE = 64` enforced
- [ ] Backend audio/mp4 → audio/mp4 on 2-track input produces valid M4A
- [ ] Container-mp4 test count ≥ 394 (target ≥400)
- [ ] 80%+ branch coverage on touched files
- [ ] 0 CRITICAL/HIGH in code review
