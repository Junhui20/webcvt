/**
 * WAV/RIFF muxer — serialize a WavFile into a Uint8Array.
 *
 * Ref: IBM/Microsoft Multimedia Programming Interface and Data Specifications 1.0 (1991)
 */

import { WavFormatError } from './errors.ts';
import {
  DATA_ID,
  EXTENSIBLE_CB_SIZE,
  FMT_CHUNK_SIZE_EXTENSIBLE,
  FMT_CHUNK_SIZE_PCM,
  FMT_ID,
  RIFF_ID,
  WAVE_FORMAT_EXTENSIBLE,
  WAVE_MAGIC,
  type WavFile,
  type WavFormat,
  writeChunkHeader,
} from './header.ts';

// ---------------------------------------------------------------------------
// Internal concat helper (avoids importing test-utils in production code)
// ---------------------------------------------------------------------------

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize a WavFile to a canonical RIFF/WAV byte stream.
 *
 * Notes:
 * - `blockAlign` and `byteRate` are recomputed from format fields.
 * - Odd-length data chunks are padded with one zero byte (not counted in size).
 * - Extra chunks from `extraChunks` are written between `fmt ` and `data`.
 *
 * Throws:
 * - `WavFormatError` — if format fields are invalid (channels < 1, sampleRate ≤ 0, etc.)
 */
export function serializeWav(file: WavFile): Uint8Array {
  validateFormat(file.format);

  const fmtData = serializeFmt(file.format);
  const audioData = file.audioData;
  const dataPad = audioData.length % 2 !== 0 ? new Uint8Array(1) : new Uint8Array(0);

  const fmtHeader = writeChunkHeader(FMT_ID, fmtData.length);
  const dataHeader = writeChunkHeader(DATA_ID, audioData.length);

  // Build extra chunk bytes.
  const extraParts: Uint8Array[] = [];
  for (const chunk of file.extraChunks ?? []) {
    const pad = chunk.data.length % 2 !== 0 ? new Uint8Array(1) : new Uint8Array(0);
    extraParts.push(writeChunkHeader(chunk.id, chunk.data.length), chunk.data, pad);
  }
  const extraBytes = extraParts.length > 0 ? concat(...extraParts) : new Uint8Array(0);

  // RIFF body = WAVE(4) + fmt (8+fmtSize) + extras + data(8+dataSize+pad)
  const riffBodySize =
    4 + // "WAVE"
    8 +
    fmtData.length +
    extraBytes.length +
    8 +
    audioData.length +
    dataPad.length;

  const riffHeader = writeChunkHeader(RIFF_ID, riffBodySize);
  const waveMagic = encodeAscii(WAVE_MAGIC);

  return concat(
    riffHeader,
    waveMagic,
    fmtHeader,
    fmtData,
    extraBytes,
    dataHeader,
    audioData,
    dataPad,
  );
}

// ---------------------------------------------------------------------------
// fmt  chunk serializer
// ---------------------------------------------------------------------------

function serializeFmt(format: WavFormat): Uint8Array {
  const isExtensible = format.audioFormat === WAVE_FORMAT_EXTENSIBLE;
  const chunkSize = isExtensible ? FMT_CHUNK_SIZE_EXTENSIBLE : FMT_CHUNK_SIZE_PCM;
  const buf = new Uint8Array(chunkSize);
  const view = new DataView(buf.buffer);

  const blockAlign = (format.channels * format.bitsPerSample) / 8;
  const byteRate = format.sampleRate * blockAlign;

  view.setUint16(0, format.audioFormat, true);
  view.setUint16(2, format.channels, true);
  view.setUint32(4, format.sampleRate, true);
  view.setUint32(8, byteRate, true);
  view.setUint16(12, blockAlign, true);
  view.setUint16(14, format.bitsPerSample, true);

  if (isExtensible) {
    // cbSize = 22 (size of the extension after the base 18-byte WAVEFORMAT header)
    view.setUint16(16, EXTENSIBLE_CB_SIZE, true);
    // wValidBitsPerSample — same as bitsPerSample for uncompressed
    view.setUint16(18, format.bitsPerSample, true);
    // dwChannelMask
    view.setUint32(20, format.channelMask ?? 0, true);
    // SubFormat GUID (16 bytes at offset 24)
    if (format.subFormat) {
      buf.set(format.subFormat.subarray(0, 16), 24);
    }
  }

  return buf;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateFormat(fmt: WavFormat): void {
  if (fmt.channels < 1) {
    throw new WavFormatError(`Invalid channels: ${fmt.channels} (must be ≥ 1)`);
  }
  if (fmt.sampleRate <= 0) {
    throw new WavFormatError(`Invalid sampleRate: ${fmt.sampleRate} (must be > 0)`);
  }
  const validBps = [8, 16, 24, 32];
  if (!validBps.includes(fmt.bitsPerSample)) {
    throw new WavFormatError(
      `Invalid bitsPerSample: ${fmt.bitsPerSample} (must be 8, 16, 24, or 32)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeAscii(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}
