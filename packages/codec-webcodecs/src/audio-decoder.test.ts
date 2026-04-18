import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebCodecsNotSupportedError, CodecOperationError } from './errors.ts';
import { WebCodecsAudioDecoder } from './audio-decoder.ts';

// ---------------------------------------------------------------------------
// Mock AudioDecoder global
// ---------------------------------------------------------------------------

function makeChunk(): EncodedAudioChunk {
  return {} as EncodedAudioChunk;
}

function makeMockAudioDecoder() {
  const instance = {
    configure: vi.fn(),
    decode: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    decodeQueueSize: 0,
    state: 'configured' as CodecState,
    _outputCb: null as ((data: AudioData) => void) | null,
    _errorCb: null as ((err: Error) => void) | null,
  };

  const AudioDecoderMock = vi.fn().mockImplementation(
    (init: AudioDecoderInit) => {
      instance._outputCb = init.output;
      instance._errorCb = init.error;
      return instance;
    },
  );

  return { AudioDecoderMock, instance };
}

const baseConfig: AudioDecoderConfig = {
  codec: 'opus',
  sampleRate: 48_000,
  numberOfChannels: 2,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebCodecsAudioDecoder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('throws WebCodecsNotSupportedError when AudioDecoder global is absent', () => {
      vi.stubGlobal('AudioDecoder', undefined);

      expect(
        () => new WebCodecsAudioDecoder({ config: baseConfig }, vi.fn()),
      ).toThrow(WebCodecsNotSupportedError);
    });

    it('calls configure with the provided config', () => {
      const { AudioDecoderMock, instance } = makeMockAudioDecoder();
      vi.stubGlobal('AudioDecoder', AudioDecoderMock);

      new WebCodecsAudioDecoder({ config: baseConfig }, vi.fn());

      expect(instance.configure).toHaveBeenCalledWith(baseConfig);
    });
  });

  describe('decode', () => {
    it('delegates to the underlying decoder', () => {
      const { AudioDecoderMock, instance } = makeMockAudioDecoder();
      vi.stubGlobal('AudioDecoder', AudioDecoderMock);

      const dec = new WebCodecsAudioDecoder({ config: baseConfig }, vi.fn());
      const chunk = makeChunk();
      dec.decode(chunk);

      expect(instance.decode).toHaveBeenCalledWith(chunk);
    });

    it('throws after close', () => {
      const { AudioDecoderMock } = makeMockAudioDecoder();
      vi.stubGlobal('AudioDecoder', AudioDecoderMock);

      const dec = new WebCodecsAudioDecoder({ config: baseConfig }, vi.fn());
      dec.close();

      expect(() => dec.decode(makeChunk())).toThrow(CodecOperationError);
    });
  });

  describe('flush', () => {
    it('resolves after the underlying decoder flushes', async () => {
      const { AudioDecoderMock, instance } = makeMockAudioDecoder();
      vi.stubGlobal('AudioDecoder', AudioDecoderMock);

      const dec = new WebCodecsAudioDecoder({ config: baseConfig }, vi.fn());
      await dec.flush();

      expect(instance.flush).toHaveBeenCalledOnce();
    });

    it('throws after close', async () => {
      const { AudioDecoderMock } = makeMockAudioDecoder();
      vi.stubGlobal('AudioDecoder', AudioDecoderMock);

      const dec = new WebCodecsAudioDecoder({ config: baseConfig }, vi.fn());
      dec.close();

      await expect(dec.flush()).rejects.toThrow(CodecOperationError);
    });
  });

  describe('close', () => {
    it('is idempotent', () => {
      const { AudioDecoderMock, instance } = makeMockAudioDecoder();
      vi.stubGlobal('AudioDecoder', AudioDecoderMock);

      const dec = new WebCodecsAudioDecoder({ config: baseConfig }, vi.fn());
      dec.close();
      dec.close();

      expect(instance.close).toHaveBeenCalledOnce();
    });
  });

  describe('onData callback', () => {
    it('forwards decoded AudioData to the callback', () => {
      const { AudioDecoderMock, instance } = makeMockAudioDecoder();
      vi.stubGlobal('AudioDecoder', AudioDecoderMock);

      const onData = vi.fn();
      new WebCodecsAudioDecoder({ config: baseConfig }, onData);

      const fakeData = {} as AudioData;
      instance._outputCb!(fakeData);

      expect(onData).toHaveBeenCalledWith(fakeData);
    });
  });

  describe('error propagation', () => {
    it('surfaces errors on next decode call', () => {
      const { AudioDecoderMock, instance } = makeMockAudioDecoder();
      vi.stubGlobal('AudioDecoder', AudioDecoderMock);

      const dec = new WebCodecsAudioDecoder({ config: baseConfig }, vi.fn());
      instance._errorCb!(new Error('Corrupt frame'));

      expect(() => dec.decode(makeChunk())).toThrow(CodecOperationError);
    });

    it('surfaces errors on flush', async () => {
      const { AudioDecoderMock, instance } = makeMockAudioDecoder();
      vi.stubGlobal('AudioDecoder', AudioDecoderMock);

      const dec = new WebCodecsAudioDecoder({ config: baseConfig }, vi.fn());
      instance._errorCb!(new Error('Decoder reset'));

      await expect(dec.flush()).rejects.toThrow(CodecOperationError);
    });
  });

  describe('accessors', () => {
    it('exposes decodeQueueSize', () => {
      const { AudioDecoderMock, instance } = makeMockAudioDecoder();
      vi.stubGlobal('AudioDecoder', AudioDecoderMock);

      const dec = new WebCodecsAudioDecoder({ config: baseConfig }, vi.fn());
      instance.decodeQueueSize = 4;
      expect(dec.decodeQueueSize).toBe(4);
    });

    it('exposes state', () => {
      const { AudioDecoderMock } = makeMockAudioDecoder();
      vi.stubGlobal('AudioDecoder', AudioDecoderMock);

      const dec = new WebCodecsAudioDecoder({ config: baseConfig }, vi.fn());
      expect(dec.state).toBe('configured');
    });
  });
});
