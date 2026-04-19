// Types
export type { WavFormat, WavFile, ChunkHeader } from './header.ts';

// Errors
export { WavTooLargeError, UnsupportedSubFormatError, WavFormatError } from './errors.ts';

// Core parsing / serialization
export { parseWav } from './parser.ts';
export { serializeWav } from './serializer.ts';

// Low-level chunk primitives
export { readChunkHeader, writeChunkHeader } from './header.ts';

// Constants (useful for consumers building custom parsers)
export {
  WAVE_FORMAT_PCM,
  WAVE_FORMAT_IEEE_FLOAT,
  WAVE_FORMAT_EXTENSIBLE,
  RIFF_ID,
  RF64_ID,
  WAVE_MAGIC,
  FMT_ID,
  DATA_ID,
} from './header.ts';

// Backend
export { WavBackend, WAV_FORMAT } from './backend.ts';
