/**
 * WAV/RIFF demuxer — parse a Uint8Array into a WavFile.
 *
 * Ref: IBM/Microsoft Multimedia Programming Interface and Data Specifications 1.0 (1991)
 * Ref: WAVEFORMATEXTENSIBLE — https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/extensible-wave-format-descriptors
 */

import { UnsupportedSubFormatError, WavFormatError, WavTooLargeError } from './errors.ts';
import {
  DATA_ID,
  FMT_ID,
  KSDATAFORMAT_GUID_TAIL,
  MIN_WAV_SIZE,
  RF64_ID,
  RIFF_ID,
  WAVE_FORMAT_EXTENSIBLE,
  WAVE_FORMAT_IEEE_FLOAT,
  WAVE_FORMAT_PCM,
  WAVE_MAGIC,
  type WavFile,
  type WavFormat,
  readChunkHeader,
} from './header.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a WAV file from raw bytes.
 *
 * Throws:
 * - `WavTooLargeError` — if the file starts with RF64 (>4 GiB, not supported in Phase 1)
 * - `WavFormatError` — if RIFF/WAVE magic is missing, or required chunks absent
 * - `UnsupportedSubFormatError` — if WAVEFORMATEXTENSIBLE subformat is unknown
 * - `RangeError` — if a chunk references bytes beyond EOF
 */
export function parseWav(input: Uint8Array): WavFile {
  if (input.length < MIN_WAV_SIZE) {
    throw new WavFormatError(
      `File too small to be a valid WAV (${input.length} bytes, minimum ${MIN_WAV_SIZE})`,
    );
  }

  // RF64 detection (Phase 1: throw, do not attempt to parse ds64)
  const outerIdStr = readFourCC(input, 0);
  if (outerIdStr === RF64_ID) {
    throw new WavTooLargeError();
  }

  if (outerIdStr !== RIFF_ID) {
    throw new WavFormatError(
      `Expected RIFF header, got "${outerIdStr}" (bytes: ${hexBytes(input, 0, 4)})`,
    );
  }

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const outerChunkSize = view.getUint32(4, true);

  const waveMagic = readFourCC(input, 8);
  if (waveMagic !== WAVE_MAGIC) {
    throw new WavFormatError(
      `Expected WAVE form type, got "${waveMagic}" (bytes: ${hexBytes(input, 8, 4)})`,
    );
  }

  // Iterate sub-chunks starting at offset 12.
  const limit = Math.min(8 + outerChunkSize, input.length);
  let cursor = 12;

  let format: WavFormat | undefined;
  let audioData: Uint8Array | undefined;
  const extraChunks: Array<{ id: string; data: Uint8Array }> = [];

  while (cursor < limit) {
    if (cursor + 8 > limit) break; // not enough room for another header

    const header = readChunkHeader(input, cursor);
    const bodyStart = header.bodyOffset;
    const bodyEnd = bodyStart + header.size;

    if (bodyEnd > input.length) {
      throw new WavFormatError(
        `Chunk "${header.id}" at offset ${cursor} claims size ${header.size} ` +
          `but only ${input.length - bodyStart} bytes remain`,
      );
    }

    if (header.id === FMT_ID) {
      format = parseFmtChunk(input, bodyStart, header.size);
    } else if (header.id === DATA_ID) {
      audioData = input.slice(bodyStart, bodyEnd);
    } else {
      extraChunks.push({ id: header.id, data: input.slice(bodyStart, bodyEnd) });
    }

    // RIFF pad: chunks are 2-byte aligned; pad byte not counted in size.
    cursor = bodyEnd + (header.size % 2 !== 0 ? 1 : 0);
  }

  if (!format) {
    throw new WavFormatError('WAV file is missing the required "fmt " chunk');
  }
  if (!audioData) {
    throw new WavFormatError('WAV file is missing the required "data" chunk');
  }

  return {
    format,
    audioData,
    extraChunks: extraChunks.length > 0 ? extraChunks : undefined,
  };
}

// ---------------------------------------------------------------------------
// fmt  chunk parser
// ---------------------------------------------------------------------------

function parseFmtChunk(buf: Uint8Array, offset: number, size: number): WavFormat {
  if (size < 16) {
    throw new WavFormatError(`fmt  chunk too small: ${size} bytes (minimum 16)`);
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const audioFormatRaw = view.getUint16(offset, true);
  const channels = view.getUint16(offset + 2, true);
  const sampleRate = view.getUint32(offset + 4, true);
  const byteRate = view.getUint32(offset + 8, true);
  const blockAlign = view.getUint16(offset + 12, true);
  const bitsPerSampleRaw = view.getUint16(offset + 14, true);

  validateBitsPerSample(bitsPerSampleRaw);
  const bitsPerSample = bitsPerSampleRaw as 8 | 16 | 24 | 32;

  validateAudioFormat(audioFormatRaw);
  const audioFormat = audioFormatRaw as 1 | 3 | 0xfffe;

  const base: WavFormat = {
    audioFormat,
    channels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
  };

  if (audioFormat === WAVE_FORMAT_EXTENSIBLE) {
    return parseExtensible(buf, offset, size, base);
  }

  if (audioFormat !== WAVE_FORMAT_PCM && audioFormat !== WAVE_FORMAT_IEEE_FLOAT) {
    throw new WavFormatError(`Unsupported audioFormat: 0x${audioFormatRaw.toString(16)}`);
  }

  return base;
}

function parseExtensible(
  buf: Uint8Array,
  offset: number,
  size: number,
  base: WavFormat,
): WavFormat {
  // Extensible fmt  is at least 40 bytes:
  //   16 base + 2 cbSize + 2 validBitsPerSample + 4 channelMask + 16 subFormat GUID
  if (size < 40) {
    throw new WavFormatError(`WAVEFORMATEXTENSIBLE fmt  chunk is ${size} bytes, expected ≥40`);
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // offset+16 = cbSize (2 bytes) — we accept it but don't validate the value
  const channelMask = view.getUint32(offset + 20, true);

  // SubFormat GUID starts at offset+24, 16 bytes total.
  const subFormat = buf.slice(offset + 24, offset + 40);

  // Identify the sub-type from the first 2 bytes of the GUID (little-endian format tag).
  const subTag = view.getUint16(offset + 24, true);

  // Validate that the trailing 12 bytes match the standard KSDATAFORMAT_SUBTYPE tail.
  if (!guidTailMatches(subFormat)) {
    throw new UnsupportedSubFormatError(formatGuid(subFormat));
  }

  if (subTag !== WAVE_FORMAT_PCM && subTag !== WAVE_FORMAT_IEEE_FLOAT) {
    throw new UnsupportedSubFormatError(formatGuid(subFormat));
  }

  return {
    ...base,
    channelMask,
    subFormat,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateBitsPerSample(value: number): void {
  if (value !== 8 && value !== 16 && value !== 24 && value !== 32) {
    throw new WavFormatError(
      `Unsupported bitsPerSample: ${value}. Only 8, 16, 24, 32 are supported.`,
    );
  }
}

function validateAudioFormat(value: number): void {
  if (
    value !== WAVE_FORMAT_PCM &&
    value !== WAVE_FORMAT_IEEE_FLOAT &&
    value !== WAVE_FORMAT_EXTENSIBLE
  ) {
    throw new WavFormatError(
      `Unsupported audioFormat: 0x${value.toString(16)}. Only PCM (1), IEEE float (3), and EXTENSIBLE (0xFFFE) are supported.`,
    );
  }
}

function guidTailMatches(guid: Uint8Array): boolean {
  for (let i = 0; i < KSDATAFORMAT_GUID_TAIL.length; i++) {
    if (guid[4 + i] !== KSDATAFORMAT_GUID_TAIL[i]) return false;
  }
  return true;
}

function formatGuid(guid: Uint8Array): string {
  const hex = (n: number | undefined): string => (n ?? 0).toString(16).padStart(2, '0');
  const g = guid;
  return (
    `{${hex(g[3])}${hex(g[2])}${hex(g[1])}${hex(g[0])}-` +
    `${hex(g[5])}${hex(g[4])}-` +
    `${hex(g[7])}${hex(g[6])}-` +
    `${hex(g[8])}${hex(g[9])}-` +
    `${hex(g[10])}${hex(g[11])}${hex(g[12])}${hex(g[13])}${hex(g[14])}${hex(g[15])}}`
  );
}

function readFourCC(buf: Uint8Array, offset: number): string {
  return String.fromCharCode(
    buf[offset] ?? 0,
    buf[offset + 1] ?? 0,
    buf[offset + 2] ?? 0,
    buf[offset + 3] ?? 0,
  );
}

function hexBytes(buf: Uint8Array, offset: number, count: number): string {
  return Array.from(buf.subarray(offset, offset + count))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}
