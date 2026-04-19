import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebCodecsAudioEncoder } from './audio-encoder.ts';
import { CodecOperationError, WebCodecsNotSupportedError } from './errors.ts';

// ---------------------------------------------------------------------------
// Mock AudioEncoder global
// ---------------------------------------------------------------------------

function makeAudioData(): AudioData {
  return {} as AudioData;
}

function makeMockAudioEncoder() {
  const instance = {
    configure: vi.fn(),
    encode: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    encodeQueueSize: 0,
    state: 'configured' as CodecState,
    _outputCb: null as ((chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata) => void) | null,
    _errorCb: null as ((err: Error) => void) | null,
  };

  const AudioEncoderMock = vi.fn().mockImplementation((init: AudioEncoderInit) => {
    instance._outputCb = init.output;
    instance._errorCb = init.error;
    return instance;
  });
  (AudioEncoderMock as unknown as { isConfigSupported: () => void }).isConfigSupported = vi.fn();

  return { AudioEncoderMock, instance };
}

const baseConfig: AudioEncoderConfig = {
  codec: 'opus',
  sampleRate: 48_000,
  numberOfChannels: 2,
  bitrate: 128_000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebCodecsAudioEncoder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('throws WebCodecsNotSupportedError when AudioEncoder global is absent', () => {
      vi.stubGlobal('AudioEncoder', undefined);

      expect(() => new WebCodecsAudioEncoder({ config: baseConfig }, vi.fn())).toThrow(
        WebCodecsNotSupportedError,
      );
    });

    it('calls configure with the provided config', () => {
      const { AudioEncoderMock, instance } = makeMockAudioEncoder();
      vi.stubGlobal('AudioEncoder', AudioEncoderMock);

      new WebCodecsAudioEncoder({ config: baseConfig }, vi.fn());

      expect(instance.configure).toHaveBeenCalledWith(baseConfig);
    });
  });

  describe('encode', () => {
    it('delegates to the underlying encoder', () => {
      const { AudioEncoderMock, instance } = makeMockAudioEncoder();
      vi.stubGlobal('AudioEncoder', AudioEncoderMock);

      const enc = new WebCodecsAudioEncoder({ config: baseConfig }, vi.fn());
      const data = makeAudioData();
      enc.encode(data);

      expect(instance.encode).toHaveBeenCalledWith(data);
    });

    it('throws after close', () => {
      const { AudioEncoderMock } = makeMockAudioEncoder();
      vi.stubGlobal('AudioEncoder', AudioEncoderMock);

      const enc = new WebCodecsAudioEncoder({ config: baseConfig }, vi.fn());
      enc.close();

      expect(() => enc.encode(makeAudioData())).toThrow(CodecOperationError);
    });
  });

  describe('flush', () => {
    it('resolves after the underlying encoder flushes', async () => {
      const { AudioEncoderMock, instance } = makeMockAudioEncoder();
      vi.stubGlobal('AudioEncoder', AudioEncoderMock);

      const enc = new WebCodecsAudioEncoder({ config: baseConfig }, vi.fn());
      await enc.flush();

      expect(instance.flush).toHaveBeenCalledOnce();
    });

    it('throws after close', async () => {
      const { AudioEncoderMock } = makeMockAudioEncoder();
      vi.stubGlobal('AudioEncoder', AudioEncoderMock);

      const enc = new WebCodecsAudioEncoder({ config: baseConfig }, vi.fn());
      enc.close();

      await expect(enc.flush()).rejects.toThrow(CodecOperationError);
    });
  });

  describe('close', () => {
    it('is idempotent', () => {
      const { AudioEncoderMock, instance } = makeMockAudioEncoder();
      vi.stubGlobal('AudioEncoder', AudioEncoderMock);

      const enc = new WebCodecsAudioEncoder({ config: baseConfig }, vi.fn());
      enc.close();
      enc.close();

      expect(instance.close).toHaveBeenCalledOnce();
    });
  });

  describe('onChunk callback', () => {
    it('forwards encoded chunks to the callback', () => {
      const { AudioEncoderMock, instance } = makeMockAudioEncoder();
      vi.stubGlobal('AudioEncoder', AudioEncoderMock);

      const onChunk = vi.fn();
      new WebCodecsAudioEncoder({ config: baseConfig }, onChunk);

      const fakeChunk = {} as EncodedAudioChunk;
      const fakeMeta = {} as EncodedAudioChunkMetadata;
      instance._outputCb?.(fakeChunk, fakeMeta);

      expect(onChunk).toHaveBeenCalledWith(fakeChunk, fakeMeta);
    });

    it('provides empty metadata when browser passes undefined', () => {
      const { AudioEncoderMock, instance } = makeMockAudioEncoder();
      vi.stubGlobal('AudioEncoder', AudioEncoderMock);

      const onChunk = vi.fn();
      new WebCodecsAudioEncoder({ config: baseConfig }, onChunk);

      const fakeChunk = {} as EncodedAudioChunk;
      instance._outputCb?.(fakeChunk, undefined as unknown as EncodedAudioChunkMetadata);

      expect(onChunk).toHaveBeenCalledWith(fakeChunk, {});
    });
  });

  describe('error propagation', () => {
    it('surfaces errors on next encode call', () => {
      const { AudioEncoderMock, instance } = makeMockAudioEncoder();
      vi.stubGlobal('AudioEncoder', AudioEncoderMock);

      const enc = new WebCodecsAudioEncoder({ config: baseConfig }, vi.fn());
      instance._errorCb?.(new Error('Audio pipeline error'));

      expect(() => enc.encode(makeAudioData())).toThrow(CodecOperationError);
    });

    it('surfaces errors on flush', async () => {
      const { AudioEncoderMock, instance } = makeMockAudioEncoder();
      vi.stubGlobal('AudioEncoder', AudioEncoderMock);

      const enc = new WebCodecsAudioEncoder({ config: baseConfig }, vi.fn());
      instance._errorCb?.(new Error('Codec crash'));

      await expect(enc.flush()).rejects.toThrow(CodecOperationError);
    });
  });

  describe('accessors', () => {
    it('exposes encodeQueueSize', () => {
      const { AudioEncoderMock, instance } = makeMockAudioEncoder();
      vi.stubGlobal('AudioEncoder', AudioEncoderMock);

      const enc = new WebCodecsAudioEncoder({ config: baseConfig }, vi.fn());
      instance.encodeQueueSize = 7;
      expect(enc.encodeQueueSize).toBe(7);
    });

    it('exposes state', () => {
      const { AudioEncoderMock } = makeMockAudioEncoder();
      vi.stubGlobal('AudioEncoder', AudioEncoderMock);

      const enc = new WebCodecsAudioEncoder({ config: baseConfig }, vi.fn());
      expect(enc.state).toBe('configured');
    });
  });
});
