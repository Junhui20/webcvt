import { decodeOpusHead, parseOgg } from '@catlabtech/webcvt-container-ogg';
import { parseWav } from '@catlabtech/webcvt-container-wav';
import { parseWebm } from '@catlabtech/webcvt-container-webm';
import type { FormatDescriptor, ProgressEvent } from '@catlabtech/webcvt-core';
import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MockAudioData,
  MockEncodedAudioChunk,
  makeAudioDecoderClass,
  makeAudioEncoderClass,
} from './_test-helpers/webcodecs.ts';
import { TranscodeBackend } from './backend.ts';

const WAV: FormatDescriptor = { ext: 'wav', mime: 'audio/wav', category: 'audio' };
const OPUS: FormatDescriptor = { ext: 'opus', mime: 'audio/opus', category: 'audio' };
const WEBM: FormatDescriptor = { ext: 'webm', mime: 'audio/webm', category: 'audio' };
const AAC: FormatDescriptor = { ext: 'aac', mime: 'audio/aac', category: 'audio' };
const FLAC: FormatDescriptor = { ext: 'flac', mime: 'audio/flac', category: 'audio' };

function blob(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes.buffer as ArrayBuffer], { type });
}

function int16Samples(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) out.push(view.getInt16(i, true));
  return out;
}

describe('pipeline: wav → wav (via the decode/interleave PCM path)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips a real WAV fixture to a parseable RIFF/WAVE with same rate/channels', async () => {
    const fixture = await loadFixture('audio/sine-1s-48000-stereo.wav');
    const source = parseWav(fixture);
    const backend = new TranscodeBackend();

    const result = await backend.convert(blob(fixture, 'audio/wav'), WAV, { format: 'wav' });
    expect(result.backend).toBe('webcodecs-transcode');
    expect(result.hardwareAccelerated).toBe(false);

    const outBytes = new Uint8Array(await result.blob.arrayBuffer());
    const out = parseWav(outBytes);
    expect(out.format.channels).toBe(source.format.channels);
    expect(out.format.sampleRate).toBe(source.format.sampleRate);
    expect(out.format.bitsPerSample).toBe(16);
    expect(out.audioData.length).toBeGreaterThan(0);
  });

  it('emits monotone progress across demux/decode/encode/mux then done:100', async () => {
    const fixture = await loadFixture('audio/sine-1s-44100-mono.wav');
    const backend = new TranscodeBackend();
    const events: ProgressEvent[] = [];

    await backend.convert(blob(fixture, 'audio/wav'), WAV, {
      format: 'wav',
      onProgress: (e) => events.push(e),
    });

    const phases = events.map((e) => e.phase);
    expect(phases).toContain('demux');
    expect(phases).toContain('decode');
    expect(phases.at(-1)).toBe('done');
    expect(events.at(-1)?.percent).toBe(100);
    // Monotone non-decreasing percent.
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.percent).toBeGreaterThanOrEqual(events[i - 1]!.percent);
    }
  });
});

describe('pipeline: mp3 → wav (mocked decoder emitting known PCM)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const PLANE_VALUE = 16000 / 32767; // → int16 16000 exactly after round().

  it('decodes to WAV whose PCM matches the emitted samples', async () => {
    const fixture = await loadFixture('audio/sine-1s-44100-mono.mp3');
    let decodeCalls = 0;
    const { DecoderClass, controls } = makeAudioDecoderClass({
      emit: () => {
        decodeCalls++;
        return [new Float32Array([PLANE_VALUE])]; // 1 mono frame per decode
      },
    });
    vi.stubGlobal('AudioDecoder', DecoderClass);
    vi.stubGlobal('EncodedAudioChunk', MockEncodedAudioChunk);

    const backend = new TranscodeBackend();
    const result = await backend.convert(blob(fixture, 'audio/mpeg'), WAV, { format: 'wav' });

    const out = parseWav(new Uint8Array(await result.blob.arrayBuffer()));
    expect(out.format.channels).toBe(1);
    expect(out.format.sampleRate).toBe(44100);

    const samples = int16Samples(out.audioData);
    expect(samples.length).toBe(decodeCalls);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((s) => s === 16000)).toBe(true);

    // Decoder was constructed, configured with codec 'mp3', and closed.
    expect(controls.instances[0]?.config?.codec).toBe('mp3');
    expect(controls.instances[0]?.closed).toBe(true);
  });
});

describe('pipeline: wav → opus-in-ogg (mocked encoder chunks)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('muxes an Ogg stream that re-parses with OpusHead + audio packets', async () => {
    const fixture = await loadFixture('audio/sine-1s-48000-stereo.wav');
    const { EncoderClass, controls } = makeAudioEncoderClass();
    vi.stubGlobal('AudioData', MockAudioData);
    vi.stubGlobal('AudioEncoder', EncoderClass);

    const backend = new TranscodeBackend();
    const result = await backend.convert(blob(fixture, 'audio/wav'), OPUS, {
      format: 'opus',
      quality: 0.7,
    });

    const outBytes = new Uint8Array(await result.blob.arrayBuffer());
    // "OggS" capture pattern.
    expect(Array.from(outBytes.subarray(0, 4))).toEqual([0x4f, 0x67, 0x67, 0x53]);

    const parsed = parseOgg(outBytes);
    expect(parsed.streams).toHaveLength(1);
    const stream = parsed.streams[0]!;
    expect(stream.codec).toBe('opus');

    const head = decodeOpusHead(stream.identification);
    expect(head.channelCount).toBe(2);
    expect(head.preSkip).toBe(3840);
    expect(stream.packets.length).toBeGreaterThan(0);

    // Opus encoder was configured and closed.
    expect(controls.instances[0]?.config?.codec).toBe('opus');
    expect(controls.instances[0]?.config?.bitrate).toBe(128_000); // stereo @ q0.7
    expect(controls.instances[0]?.closed).toBe(true);
  });
});

describe('pipeline: wav → opus-in-webm (mocked encoder chunks)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('muxes a WebM whose A_OPUS track carries OpusHead as CodecPrivate', async () => {
    const fixture = await loadFixture('audio/sine-1s-48000-stereo.wav');
    const { EncoderClass } = makeAudioEncoderClass();
    vi.stubGlobal('AudioData', MockAudioData);
    vi.stubGlobal('AudioEncoder', EncoderClass);

    const backend = new TranscodeBackend();
    const result = await backend.convert(blob(fixture, 'audio/wav'), WEBM, { format: 'webm' });

    const outBytes = new Uint8Array(await result.blob.arrayBuffer());
    // EBML magic.
    expect(outBytes[0]).toBe(0x1a);

    const parsed = parseWebm(outBytes);
    const audioTrack = parsed.tracks.find((t) => t.trackType === 2);
    expect(audioTrack?.codecId).toBe('A_OPUS');
    const head = decodeOpusHead((audioTrack as { codecPrivate: Uint8Array }).codecPrivate);
    expect(head.channelCount).toBe(2);
    expect(parsed.clusters.length).toBeGreaterThan(0);
  });
});

describe('pipeline: wav → aac (encoder-native ADTS concat)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('configures the encoder for ADTS output and concatenates the frames', async () => {
    const fixture = await loadFixture('audio/sine-1s-44100-mono.wav');
    const { EncoderClass, controls } = makeAudioEncoderClass({
      onEncode: (audioData, i) => ({
        data: new Uint8Array([0xff, 0xf1, i & 0xff, 0x00]), // ADTS-ish 4-byte frame
        timestamp: audioData.timestamp,
        duration: audioData.duration,
      }),
    });
    vi.stubGlobal('AudioData', MockAudioData);
    vi.stubGlobal('AudioEncoder', EncoderClass);

    const backend = new TranscodeBackend();
    const result = await backend.convert(blob(fixture, 'audio/wav'), AAC, { format: 'aac' });
    const outBytes = new Uint8Array(await result.blob.arrayBuffer());

    const cfg = controls.instances[0]?.config as
      | (AudioEncoderConfig & { aac?: { format?: string } })
      | undefined;
    expect(cfg?.codec).toBe('mp4a.40.2');
    expect(cfg?.aac?.format).toBe('adts');
    expect(outBytes.length).toBe(4 * (controls.instances[0]?.encodeCount ?? 0));
    expect(outBytes.length).toBeGreaterThan(0);
  });
});

describe('pipeline: wav → flac (probe-gated, header from encoder description)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('prepends the encoder-supplied fLaC stream header to the frames', async () => {
    const fixture = await loadFixture('audio/sine-1s-44100-mono.wav');
    const flacHeader = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00, 0x11, 0x22]); // fLaC + stub
    const { EncoderClass, controls } = makeAudioEncoderClass({
      onEncode: (audioData, i) => ({
        data: new Uint8Array([i & 0xff, 0x42]),
        timestamp: audioData.timestamp,
        duration: audioData.duration,
        description: i === 0 ? flacHeader : undefined,
      }),
    });
    vi.stubGlobal('AudioData', MockAudioData);
    vi.stubGlobal('AudioEncoder', EncoderClass);

    const backend = new TranscodeBackend();
    const result = await backend.convert(blob(fixture, 'audio/wav'), FLAC, { format: 'flac' });
    const outBytes = new Uint8Array(await result.blob.arrayBuffer());

    expect(controls.instances[0]?.config?.codec).toBe('flac');
    expect(Array.from(outBytes.subarray(0, flacHeader.length))).toEqual(Array.from(flacHeader));
    expect(outBytes.length).toBeGreaterThan(flacHeader.length);
  });
});

describe('pipeline: abort', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('aborting mid-decode rejects with AbortError and closes the decoder', async () => {
    const fixture = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const controller = new AbortController();
    const { DecoderClass, controls } = makeAudioDecoderClass({
      onDecode: (i) => {
        if (i === 0) controller.abort(); // abort after the first chunk is fed
      },
      emit: () => [new Float32Array([0])],
    });
    vi.stubGlobal('AudioDecoder', DecoderClass);
    vi.stubGlobal('EncodedAudioChunk', MockEncodedAudioChunk);

    const backend = new TranscodeBackend();
    await expect(
      backend.convert(blob(fixture, 'audio/mpeg'), WAV, {
        format: 'wav',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(controls.instances[0]?.closed).toBe(true);
  });
});
