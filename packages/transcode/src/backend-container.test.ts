import { parseWav } from '@catlabtech/webcvt-container-wav';
import { parseWebm } from '@catlabtech/webcvt-container-webm';
import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MockAudioData,
  MockEncodedAudioChunk,
  MockEncodedVideoChunk,
  makeAudioDecoderClass,
  makeAudioEncoderClass,
  makeVideoDecoderClass,
  makeVideoEncoderClass,
} from './_test-helpers/webcodecs.ts';
import { TranscodeBackend } from './backend.ts';

const MP4_V: FormatDescriptor = { ext: 'mp4', mime: 'video/mp4', category: 'video' };
const WEBM_V: FormatDescriptor = { ext: 'webm', mime: 'video/webm', category: 'video' };
const MKV_V: FormatDescriptor = { ext: 'mkv', mime: 'video/x-matroska', category: 'video' };
const M4A: FormatDescriptor = { ext: 'm4a', mime: 'audio/mp4', category: 'audio' };
const WAV: FormatDescriptor = { ext: 'wav', mime: 'audio/wav', category: 'audio' };
const OPUS: FormatDescriptor = { ext: 'opus', mime: 'audio/opus', category: 'audio' };
const MP3: FormatDescriptor = { ext: 'mp3', mime: 'audio/mpeg', category: 'audio' };
const PNG: FormatDescriptor = { ext: 'png', mime: 'image/png', category: 'image' };

interface ProbeStubs {
  vdecode?: boolean;
  vencode?: boolean;
  adecode?: boolean;
  aencode?: boolean;
}

function stubProbes(opts: ProbeStubs = {}): void {
  const supported = (ok: boolean | undefined, dflt = true) =>
    vi.fn().mockResolvedValue({ supported: ok ?? dflt, config: {} });
  vi.stubGlobal('VideoDecoder', { isConfigSupported: supported(opts.vdecode) });
  vi.stubGlobal('VideoEncoder', { isConfigSupported: supported(opts.vencode) });
  vi.stubGlobal('AudioDecoder', { isConfigSupported: supported(opts.adecode) });
  vi.stubGlobal('AudioEncoder', { isConfigSupported: supported(opts.aencode) });
}

function blob(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes.buffer as ArrayBuffer], { type });
}

describe('TranscodeBackend.canHandle — container/video matrix', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts the flagship video pairs when decode+encode are supported', async () => {
    stubProbes({ vdecode: true, vencode: true });
    const b = new TranscodeBackend();
    expect(await b.canHandle(MP4_V, WEBM_V)).toBe(true); // mp4 → webm
    expect(await b.canHandle(WEBM_V, MKV_V)).toBe(true); // webm → mkv
    expect(await b.canHandle(MKV_V, WEBM_V)).toBe(true); // mkv → webm
    expect(await b.canHandle(WEBM_V, WEBM_V)).toBe(true); // webm → webm re-encode
  });

  it('rejects a video pair when only the VIDEO DECODER is unsupported (no throw)', async () => {
    stubProbes({ vdecode: false, vencode: true });
    const b = new TranscodeBackend();
    await expect(b.canHandle(MP4_V, WEBM_V)).resolves.toBe(false);
  });

  it('rejects a video pair when neither VP9 nor VP8 encode is supported', async () => {
    stubProbes({ vdecode: true, vencode: false });
    const b = new TranscodeBackend();
    expect(await b.canHandle(MP4_V, WEBM_V)).toBe(false);
  });

  it('returns false (not throws) when WebCodecs video globals are absent', async () => {
    vi.stubGlobal('VideoDecoder', undefined);
    vi.stubGlobal('VideoEncoder', undefined);
    const b = new TranscodeBackend();
    await expect(b.canHandle(MP4_V, WEBM_V)).resolves.toBe(false);
  });

  it('rejects → mp4 video output (no from-scratch mp4 muxer yet)', async () => {
    stubProbes({ vdecode: true, vencode: true });
    const b = new TranscodeBackend();
    expect(await b.canHandle(WEBM_V, MP4_V)).toBe(false);
  });

  it('routes a container audio track into the audio matrix (m4a → wav / opus)', async () => {
    stubProbes({ adecode: true, aencode: true });
    const b = new TranscodeBackend();
    expect(await b.canHandle(M4A, WAV)).toBe(true); // extract AAC → wav (decode only)
    expect(await b.canHandle(M4A, OPUS)).toBe(true); // extract AAC → opus
    expect(await b.canHandle(MP4_V, WAV)).toBe(true); // extract mp4 audio → wav
  });

  it('rejects container audio extraction when the audio decoder is unsupported', async () => {
    stubProbes({ adecode: false, aencode: true });
    const b = new TranscodeBackend();
    expect(await b.canHandle(M4A, WAV)).toBe(false);
  });

  it('rejects non-container / off-matrix pairs', async () => {
    stubProbes({ vdecode: true, vencode: true, adecode: true, aencode: true });
    const b = new TranscodeBackend();
    expect(await b.canHandle(PNG, WEBM_V)).toBe(false);
    expect(await b.canHandle(MP3, WEBM_V)).toBe(false); // audio → video not supported
  });
});

describe('TranscodeBackend.convert — container dispatch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('m4a (AAC) → wav: extracts + decodes the audio track to PCM', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const { DecoderClass } = makeAudioDecoderClass({
      emit: () => [new Float32Array([0.5])], // one mono frame per chunk
    });
    vi.stubGlobal('AudioDecoder', DecoderClass);
    vi.stubGlobal('EncodedAudioChunk', MockEncodedAudioChunk);

    const b = new TranscodeBackend();
    const result = await b.convert(blob(bytes, 'audio/mp4'), WAV, { format: 'wav' });
    expect(result.backend).toBe('webcodecs-transcode');
    const out = parseWav(new Uint8Array(await result.blob.arrayBuffer()));
    expect(out.format.channels).toBe(1);
    expect(out.format.sampleRate).toBe(44100);
    expect(out.audioData.length).toBeGreaterThan(0);
  });

  it('mp4 (h264 + aac) → webm: full backend dispatch to the video pipeline', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mp4');
    const vDec = makeVideoDecoderClass();
    const vEnc = makeVideoEncoderClass();
    const aDec = makeAudioDecoderClass();
    const aEnc = makeAudioEncoderClass();
    const ok = () => vi.fn().mockResolvedValue({ supported: true, config: {} });
    (vDec.DecoderClass as unknown as { isConfigSupported: unknown }).isConfigSupported = ok();
    (vEnc.EncoderClass as unknown as { isConfigSupported: unknown }).isConfigSupported = ok();
    (aDec.DecoderClass as unknown as { isConfigSupported: unknown }).isConfigSupported = ok();
    (aEnc.EncoderClass as unknown as { isConfigSupported: unknown }).isConfigSupported = ok();
    vi.stubGlobal('VideoDecoder', vDec.DecoderClass);
    vi.stubGlobal('VideoEncoder', vEnc.EncoderClass);
    vi.stubGlobal('AudioDecoder', aDec.DecoderClass);
    vi.stubGlobal('AudioEncoder', aEnc.EncoderClass);
    vi.stubGlobal('EncodedVideoChunk', MockEncodedVideoChunk);
    vi.stubGlobal('EncodedAudioChunk', MockEncodedAudioChunk);
    vi.stubGlobal('AudioData', MockAudioData);

    const b = new TranscodeBackend();
    const result = await b.convert(blob(bytes, 'video/mp4'), WEBM_V, { format: 'webm' });
    expect(result.backend).toBe('webcodecs-transcode');
    const parsed = parseWebm(new Uint8Array(await result.blob.arrayBuffer()));
    expect(parsed.tracks.find((t) => t.trackType === 1)?.codecId).toBe('V_VP9');
    expect(parsed.tracks.find((t) => t.trackType === 2)?.codecId).toBe('A_OPUS');
  });
});
