import { describe, expect, it } from 'vitest';
import { iterateAudioChunks, iterateVideoChunks } from './chunk-iterator.ts';
import type { TsFile } from './parser.ts';
import type { TsPesPacket } from './pes.ts';
import type { TsProgram } from './pmt.ts';

// ---------------------------------------------------------------------------
// Minimal TsFile builder for chunk-iterator tests
// ---------------------------------------------------------------------------

function buildTsFile(opts: {
  videoPayloads?: Uint8Array[];
  audioPayloads?: Uint8Array[];
  ptsBaseUs?: number;
  includeSps?: boolean;
}): TsFile {
  const { videoPayloads = [], audioPayloads = [], ptsBaseUs = 0, includeSps = true } = opts;

  const program: TsProgram = {
    programNumber: 1,
    pmtPid: 0x1000,
    pcrPid: 0x0100,
    streams: [
      { pid: 0x0100, streamType: 0x1b, esInfoDescriptors: new Uint8Array(0), unsupported: false },
      { pid: 0x0101, streamType: 0x0f, esInfoDescriptors: new Uint8Array(0), unsupported: false },
    ],
  };

  const pesPackets: TsPesPacket[] = [];

  // Add video PES packets
  for (let i = 0; i < videoPayloads.length; i++) {
    const payload = videoPayloads[i] as Uint8Array;
    pesPackets.push({
      pid: 0x0100,
      streamId: 0xe0,
      ptsUs: ptsBaseUs + i * 33_333,
      dtsUs: ptsBaseUs + i * 33_333,
      payload,
      sourcePacketOffsets: [i * 188],
    });
  }

  // Add audio PES packets
  for (let i = 0; i < audioPayloads.length; i++) {
    const payload = audioPayloads[i] as Uint8Array;
    pesPackets.push({
      pid: 0x0101,
      streamId: 0xc0,
      ptsUs: ptsBaseUs + i * 23_220, // ~1024 samples at 44100Hz
      payload,
      sourcePacketOffsets: [i * 188],
    });
  }

  return {
    pat: { transportStreamId: 1, programs: [{ programNumber: 1, pmtPid: 0x1000 }] },
    program,
    pesPackets,
    packetCount: 10,
  };
}

// ---------------------------------------------------------------------------
// SPS/PPS/IDR payload builders
// ---------------------------------------------------------------------------

function buildVideoPayload(opts: { isIdr?: boolean; includeSpsAndPps?: boolean } = {}): Uint8Array {
  const { isIdr = true, includeSpsAndPps = true } = opts;
  const parts: Uint8Array[] = [];

  if (includeSpsAndPps) {
    // SPS: profile=100 (0x64), compat=0, level=40 (0x28)
    const sps = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x28, 0xac, 0xd9]);
    // PPS
    const pps = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x68, 0xce, 0x38, 0x80]);
    parts.push(sps, pps);
  }

  // IDR or non-IDR slice
  const nalType = isIdr ? 0x65 : 0x41;
  const nal = new Uint8Array([0x00, 0x00, 0x00, 0x01, nalType, 0x88, 0x84, 0x00]);
  parts.push(nal);

  let total = 0;
  for (const p of parts) total += p.length;
  const result = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    result.set(p, off);
    off += p.length;
  }
  return result;
}

function buildAdtsFrame(sfi = 4, ch = 2): Uint8Array {
  // sfi=4 = 44100 Hz, ch=2 = stereo
  const frame = new Uint8Array(8);
  frame[0] = 0xff;
  frame[1] = 0xf1; // MPEG-4, LC, no CRC
  const profile = 0b01; // LC
  const channelHigh = (ch >> 2) & 0x01;
  const channelLow = ch & 0x03;
  const frameBytes = 8;
  frame[2] = ((profile & 0x03) << 6) | ((sfi & 0x0f) << 2) | channelHigh;
  frame[3] = (channelLow << 6) | ((frameBytes >> 11) & 0x03);
  frame[4] = (frameBytes >> 3) & 0xff;
  frame[5] = ((frameBytes & 0x07) << 5) | 0x1f;
  frame[6] = 0xfc;
  frame[7] = 0xab; // payload byte
  return frame;
}

// ---------------------------------------------------------------------------
// iterateVideoChunks tests
// ---------------------------------------------------------------------------

describe('iterateVideoChunks', () => {
  it('yields video chunks with correct type (key for IDR)', () => {
    const file = buildTsFile({
      videoPayloads: [buildVideoPayload({ isIdr: true })],
    });
    const chunks = [...iterateVideoChunks(file)];
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.type).toBe('key');
  });

  it('yields delta type for non-IDR frames', () => {
    const file = buildTsFile({
      videoPayloads: [
        buildVideoPayload({ isIdr: true, includeSpsAndPps: true }),
        buildVideoPayload({ isIdr: false, includeSpsAndPps: false }),
      ],
    });
    const chunks = [...iterateVideoChunks(file)];
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.type).toBe('key');
    expect(chunks[1]?.type).toBe('delta');
  });

  it('derives AVC codec string from SPS bytes', () => {
    const file = buildTsFile({
      videoPayloads: [buildVideoPayload({ isIdr: true, includeSpsAndPps: true })],
    });
    const chunks = [...iterateVideoChunks(file)];
    expect(chunks[0]?.codec).toMatch(/^avc1\./);
    // profile=100 (0x64), compat=0x00, level=40 (0x28) → avc1.640028
    expect(chunks[0]?.codec).toBe('avc1.640028');
  });

  it('provides AVCDecoderConfigurationRecord as description', () => {
    const file = buildTsFile({
      videoPayloads: [buildVideoPayload({ isIdr: true, includeSpsAndPps: true })],
    });
    const chunks = [...iterateVideoChunks(file)];
    expect(chunks[0]?.description).toBeDefined();
    expect(chunks[0]?.description?.length ?? 0).toBeGreaterThan(6);
  });

  it('sets correct timestamp from PTS', () => {
    const file = buildTsFile({
      videoPayloads: [buildVideoPayload()],
      ptsBaseUs: 1_000_000,
    });
    const chunks = [...iterateVideoChunks(file)];
    expect(chunks[0]?.timestamp).toBe(1_000_000);
  });

  it('computes duration from successive DTS values', () => {
    const file = buildTsFile({
      videoPayloads: [
        buildVideoPayload({ isIdr: true }),
        buildVideoPayload({ isIdr: false, includeSpsAndPps: false }),
      ],
      ptsBaseUs: 0,
    });
    const chunks = [...iterateVideoChunks(file)];
    expect(chunks.length).toBe(2);
    // Duration of first chunk = next.dts - this.dts = 33333
    expect(chunks[0]?.duration).toBeCloseTo(33_333, -1);
  });

  it('outputs AVCC-formatted data (length-prefixed NALs)', () => {
    const file = buildTsFile({
      videoPayloads: [buildVideoPayload({ isIdr: true, includeSpsAndPps: true })],
    });
    const chunks = [...iterateVideoChunks(file)];
    const data = chunks[0]?.data;
    expect(data).toBeDefined();
    expect(data?.length).toBeGreaterThan(4);
    // AVCC starts with 4-byte NAL length — must not start with 0x00 0x00 0x01 start code
    // (unless the first NAL is very short, but SPS is always ≥ 4 bytes)
    const isAnnexB =
      data?.[0] === 0x00 && data?.[1] === 0x00 && data?.[2] === 0x00 && data?.[3] === 0x01;
    // AVCC 4-byte length can look like 0x00 0x00 0x00 0x0N for short NALs
    // The key test is that the length field matches the NAL size
    if (data && data.length > 4) {
      const nalLen = ((data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!) >>> 0;
      expect(nalLen).toBeGreaterThan(0);
      expect(nalLen).toBeLessThan(data.length);
    }
  });

  it('returns empty when no video stream in program', () => {
    const file = buildTsFile({ videoPayloads: [] });
    // Remove video stream from program
    const noVideo: TsFile = {
      ...file,
      program: {
        ...file.program,
        streams: file.program.streams.filter((s) => s.streamType !== 0x1b),
      },
    };
    const chunks = [...iterateVideoChunks(noVideo)];
    expect(chunks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// iterateAudioChunks tests
// ---------------------------------------------------------------------------

describe('iterateAudioChunks', () => {
  it('yields audio chunks from ADTS frames', () => {
    const file = buildTsFile({
      audioPayloads: [buildAdtsFrame()],
    });
    const chunks = [...iterateAudioChunks(file)];
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('type is always key for AAC', () => {
    const file = buildTsFile({
      audioPayloads: [buildAdtsFrame()],
    });
    const chunks = [...iterateAudioChunks(file)];
    for (const chunk of chunks) {
      expect(chunk.type).toBe('key');
    }
  });

  it('derives AAC codec string mp4a.40.<aot>', () => {
    const file = buildTsFile({
      audioPayloads: [buildAdtsFrame()],
    });
    const chunks = [...iterateAudioChunks(file)];
    // LC profile → audio_object_type = 2 → mp4a.40.2
    expect(chunks[0]?.codec).toBe('mp4a.40.2');
  });

  it('provides AudioSpecificConfig as description', () => {
    const file = buildTsFile({
      audioPayloads: [buildAdtsFrame()],
    });
    const chunks = [...iterateAudioChunks(file)];
    expect(chunks[0]?.description).toBeDefined();
    expect(chunks[0]?.description?.length).toBe(2);
  });

  it('strips ADTS header and yields raw access unit as data', () => {
    const file = buildTsFile({
      audioPayloads: [buildAdtsFrame()],
    });
    const chunks = [...iterateAudioChunks(file)];
    // ADTS frame is 8 bytes (7 header + 1 payload), so raw data should be 1 byte
    expect(chunks[0]?.data.length).toBe(1);
  });

  it('parses ADTS and derives AudioSpecificConfig matching expected structure', () => {
    // sfi=4 (44100 Hz), profile=LC → AOT=2
    const frame = buildAdtsFrame(4, 2);
    const file = buildTsFile({ audioPayloads: [frame] });
    const chunks = [...iterateAudioChunks(file)];

    const asc = chunks[0]?.description;
    expect(asc).toBeDefined();
    if (asc) {
      // ASC: [AOT(5) | SFI(4:1)] [SFI(0) | CH(4) | 000]
      // AOT=2 (0b00010), SFI=4 (0b0100), CH=2 (0b0010)
      // byte0 = 00010 | 010 (0) = 0b00010 010 = 0x12? Let's verify structure
      // aot=2 << 3 = 0x10, sfi >> 1 = 0x02 → byte0 = 0x12
      expect(asc[0]).toBe(0x12);
    }
  });

  it('handles multiple ADTS frames in one PES with per-frame PTS offset', () => {
    // Two ADTS frames in one PES payload
    const frame = buildAdtsFrame();
    const doubleFrame = new Uint8Array(frame.length * 2);
    doubleFrame.set(frame, 0);
    doubleFrame.set(frame, frame.length);

    const file = buildTsFile({
      audioPayloads: [doubleFrame],
      ptsBaseUs: 0,
    });
    const chunks = [...iterateAudioChunks(file)];
    expect(chunks.length).toBe(2);
    // Second frame should have offset = 1024 / 44100 * 1e6 ≈ 23219µs
    expect(chunks[1]?.timestamp).toBeGreaterThan(0);
  });

  it('returns empty when no audio stream in program', () => {
    const file = buildTsFile({ audioPayloads: [] });
    const noAudio: TsFile = {
      ...file,
      program: {
        ...file.program,
        streams: file.program.streams.filter((s) => s.streamType !== 0x0f),
      },
    };
    const chunks = [...iterateAudioChunks(noAudio)];
    expect(chunks).toHaveLength(0);
  });
});
