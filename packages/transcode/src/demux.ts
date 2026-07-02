/**
 * Demux: parse an input container into either raw PCM (wav) or a list of
 * encoded chunks + an `AudioDecoderConfig` for the AudioDecoder.
 *
 * All audio parsers here are eager (they return `frames[]`/`packets[]`), which
 * suits the buffer-all v1. mp3 and aac carry no explicit PTS, so timestamps are
 * derived from samples-per-frame; flac uses `sampleNumber`; opus uses granule.
 *
 * See docs/design-notes/transcode.md §B (demux capability audit).
 */

import { buildAudioSpecificConfig, parseAdts } from '@catlabtech/webcvt-container-aac';
import {
  BLOCK_TYPE_STREAMINFO,
  type FlacStreamInfo,
  STREAMINFO_SIZE,
  encodeBlockHeader,
  encodeStreamInfo,
  parseFlac,
} from '@catlabtech/webcvt-container-flac';
import { parseMp3 } from '@catlabtech/webcvt-container-mp3';
import { parseOgg } from '@catlabtech/webcvt-container-ogg';
import { parseWav } from '@catlabtech/webcvt-container-wav';
import { TranscodeDemuxError } from './errors.ts';
import type { SideCodec } from './matrix.ts';
import { type DecodedAudio, wavToDecoded } from './pcm.ts';

/** One encoded access unit to hand to the AudioDecoder. */
export interface EncodedChunkSpec {
  readonly type: 'key' | 'delta';
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly data: Uint8Array;
}

export type DemuxResult =
  | { readonly kind: 'pcm'; readonly decoded: DecodedAudio }
  | {
      readonly kind: 'encoded';
      readonly config: AudioDecoderConfig;
      readonly chunks: EncodedChunkSpec[];
      readonly sampleRate: number;
      readonly numberOfChannels: number;
    };

const US_PER_SEC = 1_000_000;

/** Demux `bytes` for the given input codec. */
export function demuxAudio(inputCodec: SideCodec, bytes: Uint8Array): DemuxResult {
  try {
    switch (inputCodec) {
      case 'pcm':
        return { kind: 'pcm', decoded: wavToDecoded(parseWav(bytes)) };
      case 'mp3':
        return demuxMp3(bytes);
      case 'aac':
        return demuxAac(bytes);
      case 'flac':
        return demuxFlac(bytes);
      case 'opus':
        return demuxOpus(bytes);
      default:
        throw new TranscodeDemuxError(`no demuxer for input codec "${inputCodec}"`);
    }
  } catch (err) {
    if (err instanceof TranscodeDemuxError) throw err;
    throw new TranscodeDemuxError(err instanceof Error ? err.message : String(err), { cause: err });
  }
}

// ---------------------------------------------------------------------------
// mp3
// ---------------------------------------------------------------------------

function demuxMp3(bytes: Uint8Array): DemuxResult {
  const { frames } = parseMp3(bytes);
  if (frames.length === 0) throw new TranscodeDemuxError('mp3 has no audio frames');
  const first = frames[0]?.header;
  if (!first) throw new TranscodeDemuxError('mp3 has no audio frames');
  const sampleRate = first.sampleRate;
  const numberOfChannels = first.channelMode === 'mono' ? 1 : 2;

  const chunks: EncodedChunkSpec[] = [];
  let sample = 0;
  for (const frame of frames) {
    const spf = frame.header.samplesPerFrame;
    chunks.push({
      type: 'key',
      timestampUs: Math.round((sample / sampleRate) * US_PER_SEC),
      durationUs: Math.round((spf / sampleRate) * US_PER_SEC),
      data: frame.data,
    });
    sample += spf;
  }

  return {
    kind: 'encoded',
    config: { codec: 'mp3', sampleRate, numberOfChannels },
    chunks,
    sampleRate,
    numberOfChannels,
  };
}

// ---------------------------------------------------------------------------
// aac (ADTS)
// ---------------------------------------------------------------------------

const AAC_SAMPLES_PER_FRAME = 1024;

function demuxAac(bytes: Uint8Array): DemuxResult {
  const { frames } = parseAdts(bytes);
  if (frames.length === 0) throw new TranscodeDemuxError('aac has no ADTS frames');
  const header = frames[0]?.header;
  if (!header) throw new TranscodeDemuxError('aac has no ADTS frames');
  const sampleRate = header.sampleRate;
  const numberOfChannels = Math.max(1, header.channelConfiguration);
  const description = buildAudioSpecificConfig(header);

  const chunks: EncodedChunkSpec[] = [];
  let sample = 0;
  for (const frame of frames) {
    const headerSize = frame.header.hasCrc ? 9 : 7;
    chunks.push({
      type: 'key',
      timestampUs: Math.round((sample / sampleRate) * US_PER_SEC),
      durationUs: Math.round((AAC_SAMPLES_PER_FRAME / sampleRate) * US_PER_SEC),
      data: frame.data.subarray(headerSize), // raw AU (strip ADTS header)
    });
    sample += AAC_SAMPLES_PER_FRAME;
  }

  return {
    kind: 'encoded',
    config: { codec: 'mp4a.40.2', sampleRate, numberOfChannels, description },
    chunks,
    sampleRate,
    numberOfChannels,
  };
}

// ---------------------------------------------------------------------------
// flac
// ---------------------------------------------------------------------------

function demuxFlac(bytes: Uint8Array): DemuxResult {
  const { streamInfo, frames } = parseFlac(bytes);
  if (frames.length === 0) throw new TranscodeDemuxError('flac has no frames');
  const sampleRate = streamInfo.sampleRate;
  const numberOfChannels = streamInfo.channels;
  const description = buildFlacDescription(streamInfo);

  const chunks: EncodedChunkSpec[] = [];
  for (const frame of frames) {
    chunks.push({
      type: 'key',
      timestampUs: Math.round((frame.sampleNumber / sampleRate) * US_PER_SEC),
      durationUs: Math.round((frame.blockSize / sampleRate) * US_PER_SEC),
      data: frame.data,
    });
  }

  return {
    kind: 'encoded',
    config: { codec: 'flac', sampleRate, numberOfChannels, description },
    chunks,
    sampleRate,
    numberOfChannels,
  };
}

/**
 * WebCodecs FLAC decoder `description`: the `fLaC` signature followed by the
 * STREAMINFO metadata block (header + 34-byte body). Reuses container-flac's
 * own STREAMINFO encoder so the bytes match the parser exactly.
 */
function buildFlacDescription(info: FlacStreamInfo): Uint8Array {
  const magic = new Uint8Array([0x66, 0x4c, 0x61, 0x43]); // "fLaC"
  const header = encodeBlockHeader(true, BLOCK_TYPE_STREAMINFO, STREAMINFO_SIZE);
  const body = encodeStreamInfo(info);
  const out = new Uint8Array(magic.length + header.length + body.length);
  out.set(magic, 0);
  out.set(header, magic.length);
  out.set(body, magic.length + header.length);
  return out;
}

// ---------------------------------------------------------------------------
// opus-in-ogg
// ---------------------------------------------------------------------------

const OPUS_RATE = 48_000;
const OPUS_NOMINAL_FRAME = 960; // 20 ms @ 48 kHz — fallback when granule is absent.

function demuxOpus(bytes: Uint8Array): DemuxResult {
  const { streams } = parseOgg(bytes);
  const stream = streams[0];
  if (!stream) throw new TranscodeDemuxError('ogg has no logical stream');
  if (stream.codec !== 'opus') {
    throw new TranscodeDemuxError(
      `ogg stream codec "${stream.codec}" is not decodable here (only opus-in-ogg is supported)`,
    );
  }
  const numberOfChannels = Math.max(1, stream.channels);

  const chunks: EncodedChunkSpec[] = [];
  let sample = 0;
  for (const pkt of stream.packets) {
    // Prefer granule (48 kHz samples at packet end) to derive duration; else
    // fall back to a nominal 20 ms frame.
    let end = sample + OPUS_NOMINAL_FRAME;
    if (pkt.granulePosition >= 0n) {
      const g = Number(pkt.granulePosition);
      if (g > sample) end = g;
    }
    const durationSamples = Math.max(1, end - sample);
    chunks.push({
      type: 'key',
      timestampUs: Math.round((sample / OPUS_RATE) * US_PER_SEC),
      durationUs: Math.round((durationSamples / OPUS_RATE) * US_PER_SEC),
      data: pkt.data,
    });
    sample = end;
  }

  return {
    kind: 'encoded',
    config: {
      codec: 'opus',
      sampleRate: OPUS_RATE,
      numberOfChannels,
      description: stream.identification,
    },
    chunks,
    sampleRate: OPUS_RATE,
    numberOfChannels,
  };
}
