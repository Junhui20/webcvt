# container-mp4 — Video Sample Entries (Phase 3 sub-pass B)

> Status: design. Sub-pass follows A (elst), E (udta/meta/ilst), D.1+D.2 (fragmented read).
> Container-mp4 ships 300 tests; full M4A round-trip + fMP4 read.

## 1. Goal

Extend `stsd` parser/serializer to understand video `SampleEntry` boxes — `avc1`, `avc3`, `hev1`, `hvc1`, `vp09`, `av01` — so consumers can read video tracks, extract codec config, derive WebCodecs codec strings, and feed both to `VideoDecoder.configure({codec, description})`. Sub-pass B does not decode samples or iterate NAL units; it provides the metadata. Multi-track (audio+video) is sub-pass C. Deliverable: byte-equivalent round-trip of any single-track video MP4 using one of the six supported 4ccs.

## 2. Scope

### IN
- VisualSampleEntry common fields (78-byte header)
- Six 4cc dispatches: `avc1`, `avc3`, `hev1`, `hvc1`, `vp09`, `av01`
- Full parsing of `avcC`, `hvcC`, `vpcC`, `av1C` (incl. `avcC` High-profile trailing extension)
- Codec-string derivation per WebCodecs Codec Registry
- Preservation of codec config bytes verbatim
- Trailing child boxes (`btrt`, `pasp`, `colr`, `clap`, `ccst`, `fiel`, `sgpd`, …) preserved as opaque `extraBoxes`
- `Mp4Track.sampleEntry` becomes a discriminated union `{kind:'audio'|'video'}` (BREAKING)
- `iterateVideoSamples`, `iterateSamples` (auto-dispatch); `iterateAudioSamples` retained for back-compat (throws on video track)
- `parseStss` + `Mp4Sample.isKeyframe` for video iteration

### OUT
- Sample-level NAL extraction (caller's job)
- Dolby Vision (`dvh1`/`dvhe`/`dva1`/`dvav`)
- Encrypted entries (`encv`/`sinf`/`frma`) — sub-pass F
- Layered extensions (`lhvC`, `vvcC`, AVC SVC/MVC)
- Interpretation of `pasp`/`colr`/`clap`/`fiel`/`ccst` (parsed-as-opaque, round-tripped)
- AVC SPS-Ext synthesis (round-trip only)
- Audio+video multi-track (sub-pass C)

## 3. Box structure

### 3.1 VisualSampleEntry common fields — 78 bytes
```
offset  size  field
  0      4    size:u32
  4      4    type:char[4]            'avc1' | 'avc3' | 'hev1' | ...
  8      6    reserved:u8[6] = 0
 14      2    data_reference_index:u16
 16      2    pre_defined:u16 = 0
 18      2    reserved:u16 = 0
 20     12    pre_defined:u32[3] = 0
 32      2    width:u16
 34      2    height:u16
 36      4    horizresolution:u32     Q16.16 default 0x00480000
 40      4    vertresolution:u32      Q16.16 default 0x00480000
 44      4    reserved:u32 = 0
 48      2    frame_count:u16 = 1
 50     32    compressorname[32]      Pascal: u8 length + 31 chars
 82      2    depth:u16 = 0x0018      24bpp
 84      2    pre_defined:i16 = -1    0xFFFF
 86      …    child boxes (avcC|hvcC|vpcC|av1C + extras)
```

### 3.2 avcC (ISO/IEC 14496-15 §5.2.4.1)
```
[configurationVersion:u8 = 1]
[AVCProfileIndication:u8]
[profile_compatibility:u8]
[AVCLevelIndication:u8]
[111111:6][lengthSizeMinusOne:2]
[111:3][numOfSequenceParameterSets:5]
  for each SPS: [u16 length][SPS bytes]
[numOfPictureParameterSets:u8]
  for each PPS: [u16 length][PPS bytes]
// Optional High-profile trailing extension when cursor < payload.length:
[111111:6][chroma_format:2]
[11111:5][bit_depth_luma_minus8:3]
[11111:5][bit_depth_chroma_minus8:3]
[numOfSequenceParameterSetExt:u8]
  for each SPS-Ext: [u16 length][SPS-Ext bytes]
```

`lengthSizeMinusOne` valid values: 0, 1, 3 → NAL length size 1, 2, 4 bytes. Value 2 reserved → reject.

### 3.3 hvcC (ISO/IEC 14496-15 §8.3.3.1)
Min fixed header 23 bytes + variable array-of-arrays.
```
[configurationVersion:u8 = 1]
[general_profile_space:2][general_tier_flag:1][general_profile_idc:5]
[general_profile_compatibility_flags:u32]
[general_constraint_indicator_flags:u8[6]]
[general_level_idc:u8]
[1111:4][min_spatial_segmentation_idc:12]
[111111:6][parallelismType:2]
[111111:6][chromaFormat:2]
[11111:5][bitDepthLumaMinus8:3]
[11111:5][bitDepthChromaMinus8:3]
[avgFrameRate:u16]
[constantFrameRate:2][numTemporalLayers:3][temporalIdNested:1][lengthSizeMinusOne:2]
[numOfArrays:u8]
for i in 0..numOfArrays:
  [array_completeness:1][0:1][NAL_unit_type:6]
  [numNalus:u16]
  for j: [u16 nalUnitLength][NAL bytes]
```

### 3.4 vpcC (VP-Codec-ISOBMFF §2.2) — FullBox
```
[version:u8 = 1][flags:u24 = 0]
[profile:u8][level:u8]
[bitDepth:4][chromaSubsampling:3][videoFullRangeFlag:1]
[colourPrimaries:u8]
[transferCharacteristics:u8]
[matrixCoefficients:u8]
[codecInitializationDataSize:u16]
[codecInitializationData:bytes]   // typically 0
```

### 3.5 av1C (AV1-ISOBMFF §2.3)
```
[marker:1 = 1][version:7 = 1]
[seq_profile:3][seq_level_idx_0:5]
[seq_tier_0:1][high_bitdepth:1][twelve_bit:1][monochrome:1]
 [chroma_subsampling_x:1][chroma_subsampling_y:1][chroma_sample_position:2]
[000:3][initial_presentation_delay_present:1]
 [initial_presentation_delay_minus_one_or_reserved:4]
[configOBUs:bytes]
```

## 4. Type definitions

New file `boxes/visual-sample-entry.ts`:

```ts
export type Mp4VideoFormat = 'avc1'|'avc3'|'hev1'|'hvc1'|'vp09'|'av01';

export interface Mp4VideoSampleEntry {
  readonly format: Mp4VideoFormat;
  readonly dataReferenceIndex: number;
  readonly width: number;
  readonly height: number;
  readonly horizResolution: number;   // Q16.16 raw u32
  readonly vertResolution: number;
  readonly frameCount: number;
  readonly compressorName: string;
  readonly depth: number;
  readonly codecConfig: Mp4VideoCodecConfig;
  readonly codecString: string;       // WebCodecs-ready
  readonly extraBoxes: Uint8Array;    // opaque; round-trip
}

export type Mp4VideoCodecConfig = Mp4AvcConfig | Mp4HvcConfig | Mp4VpcConfig | Mp4Av1Config;

export interface Mp4AvcConfig {
  readonly kind: 'avcC';
  readonly bytes: Uint8Array;          // verbatim avcC payload
  readonly profile: number;
  readonly profileCompatibility: number;
  readonly level: number;
  readonly nalUnitLengthSize: 1|2|4;
  readonly sps: readonly Uint8Array[];
  readonly pps: readonly Uint8Array[];
  readonly spsExt: readonly Uint8Array[] | null;
  readonly chromaFormat: number | null;
  readonly bitDepthLumaMinus8: number | null;
  readonly bitDepthChromaMinus8: number | null;
}

export interface Mp4HvcArray {
  readonly arrayCompleteness: 0|1;
  readonly nalUnitType: number;
  readonly nalus: readonly Uint8Array[];
}

export interface Mp4HvcConfig {
  readonly kind: 'hvcC';
  readonly bytes: Uint8Array;
  readonly generalProfileSpace: number;
  readonly generalTierFlag: 0|1;
  readonly generalProfileIdc: number;
  readonly generalProfileCompatibilityFlags: number;
  readonly generalConstraintIndicatorFlags: Uint8Array;
  readonly generalLevelIdc: number;
  readonly minSpatialSegmentationIdc: number;
  readonly parallelismType: number;
  readonly chromaFormat: number;
  readonly bitDepthLumaMinus8: number;
  readonly bitDepthChromaMinus8: number;
  readonly avgFrameRate: number;
  readonly constantFrameRate: number;
  readonly numTemporalLayers: number;
  readonly temporalIdNested: 0|1;
  readonly nalUnitLengthSize: 1|2|4;
  readonly arrays: readonly Mp4HvcArray[];
}

export interface Mp4VpcConfig {
  readonly kind: 'vpcC';
  readonly bytes: Uint8Array;
  readonly profile: number;
  readonly level: number;
  readonly bitDepth: number;
  readonly chromaSubsampling: number;
  readonly videoFullRangeFlag: 0|1;
  readonly colourPrimaries: number;
  readonly transferCharacteristics: number;
  readonly matrixCoefficients: number;
  readonly codecInitializationData: Uint8Array;
}

export interface Mp4Av1Config {
  readonly kind: 'av1C';
  readonly bytes: Uint8Array;
  readonly seqProfile: number;
  readonly seqLevelIdx0: number;
  readonly seqTier0: 0|1;
  readonly highBitdepth: 0|1;
  readonly twelveBit: 0|1;
  readonly monochrome: 0|1;
  readonly chromaSubsamplingX: 0|1;
  readonly chromaSubsamplingY: 0|1;
  readonly chromaSamplePosition: number;
  readonly initialPresentationDelayPresent: 0|1;
  readonly initialPresentationDelayMinusOne: number;
  readonly configObus: Uint8Array;
}
```

## 5. Mp4Track shape change (BREAKING)

Before:
```ts
interface Mp4Track {
  audioSampleEntry: Mp4Mp4aSampleEntry;
}
```

After:
```ts
export type Mp4SampleEntry =
  | { readonly kind: 'audio'; readonly entry: Mp4Mp4aSampleEntry }
  | { readonly kind: 'video'; readonly entry: Mp4VideoSampleEntry };

export interface Mp4Track {
  readonly trackId: number;
  readonly handlerType: 'soun' | 'vide';
  readonly sampleEntry: Mp4SampleEntry;  // replaces audioSampleEntry
  // ... unchanged: mediaHeader, trackHeader, sampleTable, etc.
}
```

Migration: `track.audioSampleEntry.X` → `if (track.sampleEntry.kind === 'audio') track.sampleEntry.entry.X`.

`hdlr` widens accepted types: `'soun'` and `'vide'`; everything else still throws `Mp4UnsupportedTrackTypeError`.

Internal callers needing updates: `parser.ts`, `serializer.ts`, `sample-iterator.ts`, `backend.ts`.

## 6. Parser changes

`parseStsd` becomes dispatcher:
```
case 'mp4a': delegate to parseMp4aPayload (unchanged)
case 'avc1' | 'avc3' | 'hev1' | 'hvc1' | 'vp09' | 'av01':
  return { kind: 'video', entry: parseVisualSampleEntry(...) }
default:
  throw Mp4UnsupportedSampleEntryError(fourCC)
```

`parseVisualSampleEntry` steps:
1. `payload.length >= 78` → else `Mp4VisualSampleEntryTooSmallError`
2. Read 78-byte header (BE, Q16.16 preserved as raw u32)
3. Decode `compressorname` Pascal string (Latin-1)
4. Validate `width, height ∈ [1, MAX_VIDEO_DIMENSION]`
5. Walk trailing child boxes via `walkBoxes` from offset 78; share `boxCount`
6. Find required codec-config child by 4cc; absent → `Mp4{Avc|Hvc|Vpc|Av1}CMissingError`
7. Parse config payload into appropriate variant (§7)
8. Concatenate ALL OTHER trailing boxes into `extraBoxes: Uint8Array`
9. `extraBoxes.length` capped at `MAX_VIDEO_EXTRA_BOXES_BYTES`
10. Compute `codecString` via deriver (§8)

Fragmented `parseTrakFragmented` updates symmetrically.

## 7. Codec-config parsers (key bit-packing)

### 7.1 avcC (`parseAvcC(payload)`)
- `payload.length >= 7`
- `configurationVersion === 1` else `Mp4AvcCBadVersionError`
- `lengthSizeMinusOne = payload[4] & 0x03`; value 2 reserved → `Mp4AvcCBadLengthSizeError`
- `numSps = payload[5] & 0x1F`; cap at `MAX_VIDEO_NAL_UNITS_PER_ARRAY`
- For each SPS/PPS: u16 length-prefix, bounds-check, zero-copy subarray
- Trailing extension only if `cursor < payload.length` after PPS array
- `bytes`: `payload.slice()` (defensive copy)

### 7.2 hvcC (`parseHvcC(payload)`)
- `payload.length >= 23`
- `configurationVersion === 1` else `Mp4HvcCBadVersionError`
- 13-byte bit-packed header with explicit shift/mask formulas
- `generalConstraintIndicatorFlags`: 6 raw bytes
- `numOfArrays:u8` capped at `MAX_HVC_ARRAYS`
- Each array: 1-byte type flags, u16 count, length-prefixed NALUs

### 7.3 vpcC (`parseVpcC(payload)`)
- FullBox: first 4 bytes are version+flags; version === 1 else throw
- profile, level, then bit-packed byte
- colour fields, then `codecInitializationDataSize:u16` and payload

### 7.4 av1C (`parseAv1C(payload)`)
- `payload.length >= 4`
- Byte 0: high bit must be 1 (marker); low 7 bits must be 1 (version) — else `Mp4Av1CBadMarkerError`
- Bytes 1-3: bit-packed fields
- Bytes 4..end: `configObus` zero-copy

## 8. Codec-string derivation

`boxes/codec-string.ts`:

### 8.1 AVC — `avc1.PPCCLL`
Always `avc1.` prefix (even for `avc3` source 4cc). Lowercase, zero-padded 2-digit hex.

### 8.2 HEVC — `hvc1.A.B.C.DD…` or `hev1.…`
Per WebCodecs Codec Registry. Profile-space prefix (''/A/B/C), profile_idc, reversed compat flags hex, tier+level, 6-byte constraint indicators with trailing zeros stripped.

### 8.3 VP9 — `vp09.PP.LL.BD.CS.CP.TC.MC.RF`
Always emit long form (deterministic). Zero-padded 2-digit decimals.

### 8.4 AV1 — `av01.P.LLT.BD`
Short form: profile + level + tier (M/H) + bit depth (08/10/12).

## 9. Serializer changes

- New `serializeVisualSampleEntry(entry)`: emits size+type + 78-byte header + codec-config box (verbatim from `bytes`) + `extraBoxes` verbatim
- `serializeStsd` extended to dispatch on `Mp4SampleEntry.kind`
- **NEVER** rebuild codec-config from parsed fields — always emit `bytes` verbatim

## 10. Sample iterator changes

```ts
export interface Mp4Sample {
  readonly kind: 'audio' | 'video';
  readonly index: number;
  readonly presentationTimeUs: number;
  readonly durationUs: number;
  readonly isKeyframe: boolean;  // derived from stss for video
  readonly data: Uint8Array;
}
export type AudioSample = Mp4Sample;  // back-compat
```

New: `iterateVideoSamples`, `iterateFragmentedVideoSamples`, `iterateSamples` (auto-dispatch on `sampleEntry.kind`).

`iterateAudioSamples` on video track → `Mp4IterateWrongKindError`.

`parseStss` added in `stbl.ts`; absent stss → all samples keyframes.

## 11. Traps honoured (16)

1. avcC trailing extension is OPTIONAL — detect by `cursor < payload.length` after PPS array
2. avcC `lengthSizeMinusOne == 2` is reserved — reject
3. hvcC bit-packing unforgiving — every shift/mask documented inline
4. vpcC `chromaSubsampling` 3 bits; values 0-3 spec-defined (4-7 reserved); accept any to round-trip
5. av1C marker bit = 1, version = 1; other → reject
6. compressorname is Pascal string (length byte + 31 max)
7. width/height are ENCODED dimensions (display dims via tkhd + pasp)
8. Codec strings MUST match WebCodecs Codec Registry exactly (case, padding)
9. avcC SPS/PPS arrays u16 length-prefixed; emulation prevention bytes preserved
10. hev1 vs hvc1 — codec-string prefix differs accordingly
11. Emulation prevention bytes (0x000003) NOT stripped at config level
12. Every length-prefixed read bounds-checked
13. extraBoxes preserved opaquely, capped at `MAX_VIDEO_EXTRA_BOXES_BYTES`
14. avc1 vs avc3 — codec string always `avc1.*` prefix per Codec Registry
15. Preserve original codec-config bytes verbatim (proprietary trailing extensions)
16. Box count shared with global `MAX_BOXES_PER_FILE` cap

## 12. Typed errors (15)

| Class | Code |
|---|---|
| `Mp4VisualSampleEntryTooSmallError` | `MP4_VISUAL_SAMPLE_ENTRY_TOO_SMALL` |
| `Mp4VisualDimensionOutOfRangeError` | `MP4_VISUAL_DIMENSION_OUT_OF_RANGE` |
| `Mp4AvcCMissingError` | `MP4_AVCC_MISSING` |
| `Mp4AvcCBadVersionError` | `MP4_AVCC_BAD_VERSION` |
| `Mp4AvcCBadLengthSizeError` | `MP4_AVCC_BAD_LENGTH_SIZE` |
| `Mp4AvcCNalLengthError` | `MP4_AVCC_NAL_LENGTH` |
| `Mp4HvcCMissingError` | `MP4_HVCC_MISSING` |
| `Mp4HvcCBadVersionError` | `MP4_HVCC_BAD_VERSION` |
| `Mp4HvcCBadLengthSizeError` | `MP4_HVCC_BAD_LENGTH_SIZE` |
| `Mp4VpcCMissingError` | `MP4_VPCC_MISSING` |
| `Mp4VpcCBadVersionError` | `MP4_VPCC_BAD_VERSION` |
| `Mp4Av1CMissingError` | `MP4_AV1C_MISSING` |
| `Mp4Av1CBadMarkerError` | `MP4_AV1C_BAD_MARKER` |
| `Mp4UnsupportedVideoCodecError` | `MP4_UNSUPPORTED_VIDEO_CODEC` |
| `Mp4IterateWrongKindError` | `MP4_ITERATE_WRONG_KIND` |

## 13. Security caps

```ts
export const MAX_VIDEO_NAL_UNITS_PER_ARRAY = 256;
export const MAX_VIDEO_NAL_UNIT_BYTES = 65535;
export const MAX_HVC_ARRAYS = 16;
export const MAX_VIDEO_EXTRA_BOXES_BYTES = 16 * 1024;
export const MAX_VIDEO_DIMENSION = 16384;
export const MAX_VIDEO_CODEC_CONFIG_BYTES = 1024 * 1024;
```

## 14. Test plan (≥24 tests)

1. avc1 baseline (66) — SPS+PPS extracted
2. avc1 main (77)
3. avc1 high (100) WITH trailing extension
4. avc3 — codec string `avc1.*` prefix; format `avc3`
5. hev1 with VPS+SPS+PPS arrays
6. hvc1 — codec string `hvc1.*` prefix
7. vp09 with zero codecInitializationData
8. vp09 with non-zero codecInitializationData
9. av01 with small configOBUs
10. extraBoxes preserved (synthetic btrt+pasp+colr)
11. Round-trip each codec → byte-identical (table-driven, 6)
12. Codec string `avc1.42e01e` (baseline level 30)
13. Codec string `hvc1.1.6.L93.B0`
14. Codec string `vp09.00.10.08.01.01.01.01.00`
15. Codec string `av01.0.04M.08`
16. Reject avcC version=2
17. Reject avcC lengthSizeMinusOne=2
18. Reject avcC NAL length overrun
19. Reject vpcC version=0
20. Reject av1C marker=0
21. Reject width=20000
22. Reject `dvh1` 4cc → `Mp4UnsupportedVideoCodecError`
23. Reject visual entry without codec config
24. M4A regression
25. `iterateAudioSamples` on video track → `Mp4IterateWrongKindError`
26. `iterateVideoSamples` returns correct `isKeyframe` from stss

## 15. LOC budget

| File | LOC |
|---|---|
| `boxes/visual-sample-entry.ts` | 180 |
| `boxes/avcC.ts` | 150 |
| `boxes/hvcC.ts` | 220 |
| `boxes/vpcC.ts` | 90 |
| `boxes/av1C.ts` | 110 |
| `boxes/codec-string.ts` | 180 |
| `boxes/hdlr-stsd-mp4a.ts` | +40 |
| `boxes/stbl.ts` | +50 (parseStss) |
| `parser.ts` | +60 |
| `serializer.ts` | +80 |
| `sample-iterator.ts` | +120 |
| `errors.ts` | +90 |
| `constants.ts` | +20 |
| `index.ts` | +25 |
| Test files (six) | ~600 |
| **Total** | **~2,015** |

## 16. Clean-room citation

- ISO/IEC 14496-12 §8.5, §8.6, §12.1
- ISO/IEC 14496-15 §5 (AVC), §8 (HEVC), §A (Codec strings)
- VP-Codec-ISOBMFF v1.0
- AV1-ISOBMFF v1.2.0
- W3C WebCodecs Codec Registry (HEVC/AVC/VP9/AV1 sections)

NOT consulted: mp4box.js, Bento4, shaka-packager, GPAC, FFmpeg, libav.

## 17. Implementation phasing (within sub-pass B)

1. **B.1** — `avc1`/`avc3` only. ~450 LOC + 10 tests. Unlocks ~90% of inbound MP4s.
2. **B.2** — `hev1`/`hvc1`. ~280 LOC + 6 tests.
3. **B.3** — `vp09` + `av01`. ~250 LOC + 8 tests.
4. **B.4** — `parseStss` + keyframe wiring + extraBoxes hardening. ~140 LOC + regression tests.

Each independently mergeable. B.1 alone unblocks Phase 5 playground.

## 18. Success criteria

- All six 4ccs parsed
- Round-trips byte-identical
- WebCodecs `VideoDecoder.isConfigSupported({codec, description})` returns true (smoke test)
- All 26+ new tests pass; existing 300-test suite still passes
- No M4A regression
- `Mp4Track.sampleEntry` discriminated union narrows without casts
- All new error classes exported
- No security cap overshoot
