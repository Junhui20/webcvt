/**
 * Chunk iterator: converts parsed TsFile into WebCodecs-ready chunk descriptors.
 *
 * Handles:
 * - AVC: Annex-B → AVCC conversion, SPS/PPS capture, IDR detection,
 *   AVCDecoderConfigurationRecord synthesis, codec string derivation
 * - AAC ADTS: header parse, AudioSpecificConfig synthesis (ADTS → ASC),
 *   codec string derivation (mp4a.40.<aot>)
 *
 * References:
 * - ISO/IEC 14496-15 §5 (AVCC framing for WebCodecs)
 * - ISO/IEC 13818-7 (ADTS framing)
 * - ISO/IEC 14496-3 §1.6.2 (AudioSpecificConfig)
 */

import { STREAM_TYPE_AAC_ADTS, STREAM_TYPE_AVC } from './constants.ts';
import {
  type AvcParamSets,
  annexBToAvcc,
  deriveAvcCodecString,
  synthesiseAvcDecoderConfig,
} from './nal-conversion.ts';
import type { TsFile } from './parser.ts';
import type { TsPesPacket } from './pes.ts';

// ---------------------------------------------------------------------------
// Public types matching WebCodecs EncodedVideoChunkInit / EncodedAudioChunkInit
// ---------------------------------------------------------------------------

export interface EncodedVideoChunkInit {
  type: 'key' | 'delta';
  timestamp: number;
  duration?: number;
  data: Uint8Array;
  /** WebCodecs codec string, e.g. 'avc1.640028'. */
  codec: string;
  /** AVCDecoderConfigurationRecord bytes for VideoDecoder.configure({ description }). */
  description?: Uint8Array;
}

export interface EncodedAudioChunkInit {
  type: 'key';
  timestamp: number;
  data: Uint8Array;
  /** WebCodecs codec string, e.g. 'mp4a.40.2'. */
  codec: string;
  /** AudioSpecificConfig bytes for AudioDecoder.configure({ description }). */
  description?: Uint8Array;
}

// ---------------------------------------------------------------------------
// ADTS inline parser (~30 LOC) — re-implemented per design note instructions.
// Do NOT import from @webcvt/container-aac.
// ---------------------------------------------------------------------------

const ADTS_SAMPLE_RATE_TABLE: readonly number[] = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

interface AdtsInfo {
  /** Audio object type (profile+1): 1=MAIN, 2=LC, 3=SSR, 4=LTP */
  audioObjectType: number;
  sampleRateIndex: number;
  sampleRate: number;
  channelConfig: number;
  /** Total frame byte length (including header). */
  frameBytes: number;
  /** Header size: 7 (no CRC) or 9 (with CRC). */
  headerSize: number;
}

function parseAdtsHeader(buf: Uint8Array, offset: number): AdtsInfo | null {
  if (offset + 7 > buf.length) return null;
  if (buf[offset] !== 0xff || ((buf[offset + 1] as number) & 0xf0) !== 0xf0) return null;

  const b1 = buf[offset + 1] as number;
  const protectionAbsent = b1 & 0x01;
  const headerSize = protectionAbsent === 1 ? 7 : 9;

  if (offset + headerSize > buf.length) return null;

  const b2 = buf[offset + 2] as number;
  const b3 = buf[offset + 3] as number;
  const b4 = buf[offset + 4] as number;
  const b5 = buf[offset + 5] as number;

  // profile_ObjectType (2 bits at b2[7:6]) + 1 = audio_object_type
  const profileRaw = (b2 >> 6) & 0x03;
  const audioObjectType = profileRaw + 1;

  // sampling_frequency_index (4 bits at b2[5:2])
  const sfi = (b2 >> 2) & 0x0f;
  if (sfi >= 13) return null; // reserved

  const sampleRate = ADTS_SAMPLE_RATE_TABLE[sfi] ?? 0;
  const channelHigh = b2 & 0x01;
  const channelLow = (b3 >> 6) & 0x03;
  const channelConfig = (channelHigh << 2) | channelLow;

  // frame length: 13-bit field starting at b3[1:0] | b4[7:0] | b5[7:5]
  const frameLenHigh = b3 & 0x03;
  const frameLenMid = b4;
  const frameLenLow = (b5 >> 5) & 0x07;
  const frameBytes = (frameLenHigh << 11) | (frameLenMid << 3) | frameLenLow;

  return {
    audioObjectType,
    sampleRateIndex: sfi,
    sampleRate,
    channelConfig,
    frameBytes,
    headerSize,
  };
}

/**
 * Synthesise an AudioSpecificConfig (ASC) from ADTS header fields.
 *
 * ASC bit layout (ISO/IEC 14496-3 §1.6.2.1):
 *   bits [4:0]: audio_object_type (5 bits)
 *   bits [3:0]: sampling_frequency_index (4 bits)
 *   bits [3:0]: channel_configuration (4 bits)
 *   bits [0]:   frameLengthFlag (0 = 1024 samples)
 *   bits [0]:   dependsOnCoreCoder (0)
 *   bits [0]:   extensionFlag (0)
 *
 * Total = 13 bits → 2 bytes.
 */
function synthesiseAscFromAdts(info: AdtsInfo): Uint8Array {
  const aot = info.audioObjectType & 0x1f;
  const sfi = info.sampleRateIndex & 0x0f;
  const ch = info.channelConfig & 0x0f;

  // Pack: [aot(5)] [sfi(4)] [ch(4)] [frameLengthFlag(1)] [dependsOnCoreCoder(1)] [extensionFlag(1)]
  // byte0 = aot[4:0] | sfi[3]  (top 5 bits of aot + top 1 bit of sfi)
  // byte1 = sfi[2:0] | ch[3:0] | 0 | 0 | 0
  const byte0 = ((aot << 3) | (sfi >> 1)) & 0xff;
  const byte1 = (((sfi & 0x01) << 7) | ((ch & 0x0f) << 3)) & 0xff;

  return new Uint8Array([byte0, byte1]);
}

function deriveAacCodecString(audioObjectType: number): string {
  return `mp4a.40.${audioObjectType}`;
}

// ---------------------------------------------------------------------------
// Video chunk iterator
// ---------------------------------------------------------------------------

/**
 * Iterate over PES packets for the video (AVC) stream and yield
 * EncodedVideoChunkInit descriptors suitable for WebCodecs VideoDecoder.
 */
export function* iterateVideoChunks(file: TsFile): Generator<EncodedVideoChunkInit> {
  const videoStream = file.program.streams.find((s) => s.streamType === STREAM_TYPE_AVC);
  if (!videoStream) return;

  const videoPid = videoStream.pid;
  const videoPes = file.pesPackets.filter((p): p is TsPesPacket => p.pid === videoPid);

  if (videoPes.length === 0) return;

  const paramSets: AvcParamSets = { sps: null, pps: null };
  let codecString: string | null = null;
  let description: Uint8Array | null = null;

  // Collect DTS values for duration computation
  const dtsList = videoPes.map((p) => p.dtsUs ?? p.ptsUs ?? 0);
  const defaultDuration = 1_000_000 / 30; // 30fps fallback

  for (let i = 0; i < videoPes.length; i++) {
    const pes = videoPes[i] as TsPesPacket;
    const { avcc, hasIdr } = annexBToAvcc(pes.payload, paramSets);

    // Update codec string and description after SPS/PPS are captured
    if (paramSets.sps && !codecString) {
      codecString = deriveAvcCodecString(paramSets.sps);
    }
    if (paramSets.sps && paramSets.pps) {
      description = synthesiseAvcDecoderConfig(paramSets);
    }

    if (avcc.length === 0) continue;

    const timestamp = pes.ptsUs ?? 0;
    const nextDts = dtsList[i + 1];
    const currentDts = dtsList[i] ?? timestamp;
    const duration = nextDts !== undefined ? Math.abs(nextDts - currentDts) : defaultDuration;

    yield {
      type: hasIdr ? 'key' : 'delta',
      timestamp,
      duration,
      data: avcc,
      codec: codecString ?? 'avc1.640028',
      description: description ?? undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// Audio chunk iterator
// ---------------------------------------------------------------------------

/**
 * Iterate over PES packets for the audio (AAC ADTS) stream and yield
 * EncodedAudioChunkInit descriptors suitable for WebCodecs AudioDecoder.
 *
 * Multiple ADTS frames within a single PES share the base PTS; per-frame
 * offsets are derived from cumulative sample count and sample rate.
 */
export function* iterateAudioChunks(file: TsFile): Generator<EncodedAudioChunkInit> {
  const audioStream = file.program.streams.find((s) => s.streamType === STREAM_TYPE_AAC_ADTS);
  if (!audioStream) return;

  const audioPid = audioStream.pid;
  const audioPes = file.pesPackets.filter((p): p is TsPesPacket => p.pid === audioPid);

  if (audioPes.length === 0) return;

  let asc: Uint8Array | null = null;
  let codecString: string | null = null;
  let sampleRate = 0;

  for (const pes of audioPes) {
    const basePtsUs = pes.ptsUs ?? 0;
    const payload = pes.payload;
    let cursor = 0;
    let cumulativeSamples = 0;

    while (cursor < payload.length) {
      const info = parseAdtsHeader(payload, cursor);
      if (!info) break;

      if (info.frameBytes < info.headerSize || cursor + info.frameBytes > payload.length) break;

      // Derive ASC on first valid ADTS frame
      if (!asc) {
        asc = synthesiseAscFromAdts(info);
        sampleRate = info.sampleRate;
        codecString = deriveAacCodecString(info.audioObjectType);
      }

      // Payload = raw_data_block (ADTS header stripped)
      const rawData = payload.subarray(cursor + info.headerSize, cursor + info.frameBytes);

      // Per-frame PTS offset: cumulative samples / sample rate
      const frameOffsetUs =
        sampleRate > 0 ? Math.round((cumulativeSamples * 1_000_000) / sampleRate) : 0;
      const timestamp = basePtsUs + frameOffsetUs;

      yield {
        type: 'key',
        timestamp,
        data: rawData,
        codec: codecString ?? 'mp4a.40.2',
        description: asc ?? undefined,
      };

      // AAC-LC: 1024 samples per frame
      cumulativeSamples += 1024;
      cursor += info.frameBytes;
    }
  }
}
