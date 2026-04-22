# container-wav design

> Implementation reference for `@catlabtech/webcvt-container-wav`. Write the code from
> this note plus the linked official spec. Do not consult competing
> implementations except for debugging spec-ambiguous edge cases.

## Format overview

WAV (Waveform Audio File Format) is a Microsoft RIFF (Resource Interchange
File Format) container that carries uncompressed PCM audio (and, less
commonly, compressed payloads via the `WAVE_FORMAT_*` codec tag system).
The structural primitive is a "chunk": a 4-byte ASCII id, a 4-byte
little-endian length, and `length` bytes of data. Files start with a
master `RIFF` chunk whose first 4 bytes after the size are `WAVE`,
followed by sub-chunks (`fmt `, `data`, optional metadata).

## Official references

- Multimedia Programming Interface and Data Specifications 1.0, IBM/Microsoft (1991) — the original RIFF spec
- McGill copy: https://www.mmsp.ece.mcgill.ca/Documents/AudioFormats/WAVE/WAVE.html
- WAVEFORMATEXTENSIBLE: https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/extensible-wave-format-descriptors
- RF64 (for >4 GiB files): EBU Tech 3306

## Top-level layout

```
offset  bytes  field         value / notes
0       4      ChunkID       "RIFF" (0x52 49 46 46)
4       4      ChunkSize     LE uint32, file size minus 8
8       4      Format        "WAVE"
12      4      Subchunk1ID   "fmt " (note trailing space, 0x66 6D 74 20)
16      4      Subchunk1Size LE uint32, typically 16 (PCM) or 18 / 40 (extensible)
20      2      AudioFormat   LE uint16, 1=PCM, 3=IEEE float, 0xFFFE=EXTENSIBLE
22      2      NumChannels   LE uint16
24      4      SampleRate    LE uint32
28      4      ByteRate      LE uint32 = SampleRate * NumChannels * BitsPerSample / 8
32      2      BlockAlign    LE uint16 = NumChannels * BitsPerSample / 8
34      2      BitsPerSample LE uint16
[36+]          (extensible extension if Subchunk1Size > 16)
N       4      Subchunk2ID   "data"
N+4     4      Subchunk2Size LE uint32, byte length of audio samples
N+8     ...    audio samples (interleaved PCM)
```

Other common chunks that may appear before or after `data` and MUST be
skipped if unrecognised: `LIST` (INFO metadata), `JUNK` (padding),
`bext` (Broadcast WAV extension), `id3 ` (ID3v2 inside WAV).

## Key types we will model

```ts
interface WavFormat {
  audioFormat: 1 | 3 | 0xFFFE;     // PCM | IEEE float | extensible
  channels: number;
  sampleRate: number;
  bitsPerSample: 8 | 16 | 24 | 32;
  blockAlign: number;              // derived; we recompute on write
  byteRate: number;                // derived
  // Extensible-only:
  channelMask?: number;
  subFormat?: Uint8Array;          // 16-byte GUID
}

interface WavFile {
  format: WavFormat;
  /** Raw PCM samples — bytes only, caller decides Int16Array vs Float32Array view */
  audioData: Uint8Array;
  /** Optional unrecognised chunks preserved on round-trip */
  extraChunks?: Array<{ id: string; data: Uint8Array }>;
}

export function parseWav(input: Uint8Array): WavFile;
export function serializeWav(file: WavFile): Uint8Array;
```

## Demuxer (read) algorithm

1. Verify bytes 0–3 are "RIFF" and 8–11 are "WAVE", else throw.
2. Position cursor at offset 12.
3. Loop: read chunk id (4 bytes ASCII) + chunk size (4 bytes LE u32).
4. If id is "fmt ": parse `WavFormat` from the next `chunkSize` bytes.
5. If id is "data": record offset+size; copy bytes into `audioData`.
6. Otherwise: stash `{id, data}` in `extraChunks`.
7. Advance cursor by `chunkSize`. **If `chunkSize` is odd, advance one
   more byte (RIFF chunks are 2-byte aligned; the pad byte is not
   counted in size).**
8. Stop when cursor reaches `8 + outerChunkSize` (RIFF total) or EOF.
9. Throw if no `fmt ` or `data` chunk found.

## Muxer (write) algorithm

1. Validate `format` (channels ≥ 1, sampleRate > 0, bitsPerSample ∈ {8,16,24,32}).
2. Recompute `blockAlign` and `byteRate` from format fields (don't trust caller).
3. Compute total file size = 4 (WAVE) + 8 + fmtSize + 8 + dataSize + sum(extraChunks: 8+padded).
4. Write RIFF header, WAVE marker, `fmt ` chunk (16 bytes for PCM, 40 for extensible).
5. Write extra chunks (preserved from parse, or none).
6. Write `data` chunk header + audioData (pad with 0 byte if odd length).
7. Return assembled Uint8Array.

## WebCodecs integration

For the audio backend (`@catlabtech/webcvt-container-wav` exporting a `Backend`):
- **Decode**: parse → for each PCM sample frame, hand to `WebCodecsAudioDecoder`
  with config `{ codec: 'pcm-s16', sampleRate, numberOfChannels }` (or
  `pcm-f32`, `pcm-s24`, `pcm-u8` per `bitsPerSample`/`audioFormat`).
- **Encode**: take WebCodecs `AudioData` outputs, copy into a Uint8Array
  per `bitsPerSample`, build `WavFile`, serialize.
- Note: WebCodecs does not have an "encoder" for PCM since PCM is the
  unencoded form. The container layer just reads `AudioData` chunks
  directly and writes them into the `data` chunk.

## Test plan

- `parses 16-bit PCM mono 44100 from fixture sine-1s-44100-mono.wav`
- `parses 16-bit PCM stereo 48000 from fixture sine-1s-48000-stereo.wav`
- `serializes mono Int16 PCM to byte-exact match against fixture` (we control all bytes since our writer is canonical)
- `round-trips: parse then serialize then parse — equal format and audioData`
- `skips and preserves unknown LIST/JUNK chunks across round-trip`
- `pads odd data chunk size with one zero byte on write`
- `throws on missing RIFF/WAVE magic`
- `throws on missing fmt chunk`
- `throws on missing data chunk`
- `throws on data chunk extending past file end`
- `parses 24-bit and 32-bit PCM`
- `parses IEEE float PCM (audioFormat = 3)`
- `parses WAVEFORMATEXTENSIBLE (audioFormat = 0xFFFE) and reads channelMask`

## Known traps

1. **Trailing space in "fmt "** (4-char id padded). It is `0x66 0x6D 0x74 0x20`, not `"fmt"`.
2. **Pad byte for odd chunk size** — chunks are 2-byte aligned. Read AND write must add a zero byte after odd-length data, NOT counted in `chunkSize`. Spec §3.
3. **Unknown chunks must be skipped, not error**. RIFF is forward-compatible.
4. **WAVEFORMATEXTENSIBLE**: when `audioFormat == 0xFFFE`, the actual format is in the 16-byte `SubFormat` GUID at offset 24 of the extension (offset 44 in the file). The first 2 bytes of that GUID match a `WAVE_FORMAT_*` tag; the rest are KSDATAFORMAT_SUBTYPE_PCM (`00000001-0000-0010-8000-00aa00389b71`) or _IEEE_FLOAT.
5. **RF64 for >4 GiB**: outer id is `RF64` not `RIFF`, and the size field is `0xFFFFFFFF`; real size lives in a `ds64` chunk. Phase 1 scope: throw `WavTooLargeError` instead of supporting it. Document for Phase 2 follow-up.
6. **Endianness**: ALL multi-byte integers are LITTLE-ENDIAN. Do not use `DataView.getUint32(offset)` without `true` second argument.

## LOC budget breakdown

| File | LOC est. |
|---|---|
| `header.ts` (chunk reader/writer + format types) | 60 |
| `parser.ts` (parseWav + chunk loop) | 60 |
| `serializer.ts` (serializeWav + canonical output) | 50 |
| `backend.ts` (Backend impl, integrates with codec-webcodecs) | 60 |
| `index.ts` | 10 |
| **total** | **~240** |
| tests | 300+ |

Slightly over the plan.md ~150 LOC headline budget — that estimate
assumed PCM-only, no extensible support. Including extensible + chunk
preservation pushes it to ~240. Acceptable.

## Implementation references (for the published README)

This package is implemented from the IBM/Microsoft Multimedia Programming
Interface and Data Specifications 1.0 (1991) and the WAVEFORMATEXTENSIBLE
documentation from Microsoft. No code was copied from other
implementations. Test fixtures derived from FFmpeg samples (LGPL-2.1)
live under `tests/fixtures/audio/` and are not redistributed in npm.
