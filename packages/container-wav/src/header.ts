/**
 * RIFF/WAV chunk header primitives.
 *
 * All multi-byte integers in RIFF/WAV are LITTLE-ENDIAN.
 * Ref: IBM/Microsoft Multimedia Programming Interface and Data Specifications 1.0 (1991)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const RIFF_ID = 'RIFF';
export const RF64_ID = 'RF64';
export const WAVE_MAGIC = 'WAVE';
export const FMT_ID = 'fmt ';
export const DATA_ID = 'data';

/** Minimum file size: RIFF(4) + size(4) + WAVE(4) + fmt (8+16) + data(8) = 44 */
export const MIN_WAV_SIZE = 44;

/** Size of a standard PCM fmt chunk (no extension). */
export const FMT_CHUNK_SIZE_PCM = 16;

/** Size of a WAVEFORMATEXTENSIBLE fmt chunk. */
export const FMT_CHUNK_SIZE_EXTENSIBLE = 40;

/** WAVEFORMATEXTENSIBLE extension size field value (22 bytes of extension). */
export const EXTENSIBLE_CB_SIZE = 22;

// ---------------------------------------------------------------------------
// AudioFormat codes
// ---------------------------------------------------------------------------

export const WAVE_FORMAT_PCM = 1 as const;
export const WAVE_FORMAT_IEEE_FLOAT = 3 as const;
export const WAVE_FORMAT_EXTENSIBLE = 0xfffe as const;

// ---------------------------------------------------------------------------
// GUID constants for WAVEFORMATEXTENSIBLE subformat
// These are the trailing 14 bytes common to both PCM and IEEE Float sub-GUIDs:
//   {xxxxxxxx-0000-0010-8000-00AA00389B71}
// ---------------------------------------------------------------------------

/**
 * Bytes 4–15 (inclusive) that are common to both KSDATAFORMAT_SUBTYPE_PCM
 * and KSDATAFORMAT_SUBTYPE_IEEE_FLOAT GUIDs.
 *
 * GUID {xxxxxxxx-0000-0010-8000-00AA00389B71} stored in Windows byte order:
 *   Data1 (4B LE) | Data2 (2B LE) | Data3 (2B LE) | Data4[0..7] (8B BE)
 * Bytes 4-5  = Data2 LE = 00 00
 * Bytes 6-7  = Data3 LE = 10 00
 * Bytes 8-15 = Data4 BE = 80 00 00 AA 00 38 9B 71
 */
export const KSDATAFORMAT_GUID_TAIL = new Uint8Array([
  0x00,
  0x00, // Data2 LE: 0x0000
  0x10,
  0x00, // Data3 LE: 0x0010
  0x80,
  0x00,
  0x00,
  0xaa,
  0x00,
  0x38,
  0x9b,
  0x71, // Data4 BE
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parsed WAV format descriptor (from the fmt  chunk).
 *
 * `blockAlign` and `byteRate` are recomputed on write; stored here for
 * informational purposes and for round-trip fidelity.
 */
export interface WavFormat {
  /** 1 = PCM, 3 = IEEE float, 0xFFFE = WAVEFORMATEXTENSIBLE */
  audioFormat: 1 | 3 | 0xfffe;
  channels: number;
  sampleRate: number;
  bitsPerSample: 8 | 16 | 24 | 32;
  /** Derived: NumChannels * BitsPerSample / 8 */
  blockAlign: number;
  /** Derived: SampleRate * NumChannels * BitsPerSample / 8 */
  byteRate: number;
  // Extensible-only fields:
  /** Channel speaker layout bitmask (SPEAKER_* flags). Extensible only. */
  channelMask?: number;
  /** 16-byte subformat GUID. Extensible only. */
  subFormat?: Uint8Array;
}

/**
 * Parsed WAV file representation.
 */
export interface WavFile {
  format: WavFormat;
  /** Raw interleaved PCM bytes. Caller views as Int16Array / Float32Array etc. */
  audioData: Uint8Array;
  /** Unknown chunks preserved verbatim for round-trip fidelity. */
  extraChunks?: Array<{ id: string; data: Uint8Array }>;
}

/** Parsed chunk header with the cursor position after the header. */
export interface ChunkHeader {
  id: string;
  size: number;
  /** Byte offset immediately after the 8-byte header (start of chunk body). */
  bodyOffset: number;
}

// ---------------------------------------------------------------------------
// Chunk reader
// ---------------------------------------------------------------------------

/**
 * Read a 4-byte chunk ID + 4-byte LE uint32 size from `buf` at `offset`.
 *
 * Throws `RangeError` if there are fewer than 8 bytes remaining.
 */
export function readChunkHeader(buf: Uint8Array, offset: number): ChunkHeader {
  if (offset + 8 > buf.length) {
    throw new RangeError(
      `Cannot read chunk header at offset ${offset}: only ${buf.length - offset} bytes remain`,
    );
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const id = readFourCC(buf, offset);
  const size = view.getUint32(offset + 4, true /* little-endian */);
  return { id, size, bodyOffset: offset + 8 };
}

// ---------------------------------------------------------------------------
// Chunk writer
// ---------------------------------------------------------------------------

/**
 * Write an 8-byte chunk header (4-byte ASCII id + 4-byte LE uint32 size)
 * into a new Uint8Array.
 */
export function writeChunkHeader(id: string, size: number): Uint8Array {
  const buf = new Uint8Array(8);
  writeFourCC(buf, 0, id);
  const view = new DataView(buf.buffer);
  view.setUint32(4, size, true /* little-endian */);
  return buf;
}

// ---------------------------------------------------------------------------
// FourCC helpers
// ---------------------------------------------------------------------------

function readFourCC(buf: Uint8Array, offset: number): string {
  return String.fromCharCode(
    buf[offset] ?? 0,
    buf[offset + 1] ?? 0,
    buf[offset + 2] ?? 0,
    buf[offset + 3] ?? 0,
  );
}

function writeFourCC(buf: Uint8Array, offset: number, id: string): void {
  for (let i = 0; i < 4; i++) {
    buf[offset + i] = id.charCodeAt(i) & 0xff;
  }
}
