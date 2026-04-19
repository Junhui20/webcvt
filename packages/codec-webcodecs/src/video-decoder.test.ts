import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodecOperationError, WebCodecsNotSupportedError } from './errors.ts';
import { WebCodecsVideoDecoder } from './video-decoder.ts';

// ---------------------------------------------------------------------------
// Mock VideoDecoder global
// ---------------------------------------------------------------------------

function makeChunk(): EncodedVideoChunk {
  return {} as EncodedVideoChunk;
}

function makeMockDecoder() {
  const instance = {
    configure: vi.fn(),
    decode: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    decodeQueueSize: 0,
    state: 'configured' as CodecState,
    _outputCb: null as ((frame: VideoFrame) => void) | null,
    _errorCb: null as ((err: Error) => void) | null,
  };

  const VideoDecoderMock = vi.fn().mockImplementation((init: VideoDecoderInit) => {
    instance._outputCb = init.output;
    instance._errorCb = init.error;
    return instance;
  });

  return { VideoDecoderMock, instance };
}

const baseConfig: VideoDecoderConfig = {
  codec: 'avc1.42001E',
  codedWidth: 1280,
  codedHeight: 720,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebCodecsVideoDecoder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('throws WebCodecsNotSupportedError when VideoDecoder global is absent', () => {
      vi.stubGlobal('VideoDecoder', undefined);

      expect(() => new WebCodecsVideoDecoder({ config: baseConfig }, vi.fn())).toThrow(
        WebCodecsNotSupportedError,
      );
    });

    it('calls configure with the provided config', () => {
      const { VideoDecoderMock, instance } = makeMockDecoder();
      vi.stubGlobal('VideoDecoder', VideoDecoderMock);

      new WebCodecsVideoDecoder({ config: baseConfig }, vi.fn());

      expect(instance.configure).toHaveBeenCalledWith(baseConfig);
    });
  });

  describe('decode', () => {
    it('delegates to the underlying decoder', () => {
      const { VideoDecoderMock, instance } = makeMockDecoder();
      vi.stubGlobal('VideoDecoder', VideoDecoderMock);

      const dec = new WebCodecsVideoDecoder({ config: baseConfig }, vi.fn());
      const chunk = makeChunk();
      dec.decode(chunk);

      expect(instance.decode).toHaveBeenCalledWith(chunk);
    });

    it('throws after close', () => {
      const { VideoDecoderMock } = makeMockDecoder();
      vi.stubGlobal('VideoDecoder', VideoDecoderMock);

      const dec = new WebCodecsVideoDecoder({ config: baseConfig }, vi.fn());
      dec.close();

      expect(() => dec.decode(makeChunk())).toThrow(CodecOperationError);
    });
  });

  describe('flush', () => {
    it('resolves after the underlying decoder flushes', async () => {
      const { VideoDecoderMock, instance } = makeMockDecoder();
      vi.stubGlobal('VideoDecoder', VideoDecoderMock);

      const dec = new WebCodecsVideoDecoder({ config: baseConfig }, vi.fn());
      await dec.flush();

      expect(instance.flush).toHaveBeenCalledOnce();
    });

    it('throws after close', async () => {
      const { VideoDecoderMock } = makeMockDecoder();
      vi.stubGlobal('VideoDecoder', VideoDecoderMock);

      const dec = new WebCodecsVideoDecoder({ config: baseConfig }, vi.fn());
      dec.close();

      await expect(dec.flush()).rejects.toThrow(CodecOperationError);
    });
  });

  describe('close', () => {
    it('closes the underlying decoder', () => {
      const { VideoDecoderMock, instance } = makeMockDecoder();
      vi.stubGlobal('VideoDecoder', VideoDecoderMock);

      const dec = new WebCodecsVideoDecoder({ config: baseConfig }, vi.fn());
      dec.close();

      expect(instance.close).toHaveBeenCalledOnce();
    });

    it('is idempotent — safe to call multiple times', () => {
      const { VideoDecoderMock, instance } = makeMockDecoder();
      vi.stubGlobal('VideoDecoder', VideoDecoderMock);

      const dec = new WebCodecsVideoDecoder({ config: baseConfig }, vi.fn());
      dec.close();
      dec.close();

      expect(instance.close).toHaveBeenCalledOnce();
    });
  });

  describe('onFrame callback', () => {
    it('forwards decoded frames to the callback', () => {
      const { VideoDecoderMock, instance } = makeMockDecoder();
      vi.stubGlobal('VideoDecoder', VideoDecoderMock);

      const onFrame = vi.fn();
      new WebCodecsVideoDecoder({ config: baseConfig }, onFrame);

      const fakeFrame = {} as VideoFrame;
      instance._outputCb?.(fakeFrame);

      expect(onFrame).toHaveBeenCalledWith(fakeFrame);
    });
  });

  describe('error propagation', () => {
    it('surfaces decoder errors on next decode call', () => {
      const { VideoDecoderMock, instance } = makeMockDecoder();
      vi.stubGlobal('VideoDecoder', VideoDecoderMock);

      const dec = new WebCodecsVideoDecoder({ config: baseConfig }, vi.fn());
      instance._errorCb?.(new Error('Corrupt NAL unit'));

      expect(() => dec.decode(makeChunk())).toThrow(CodecOperationError);
    });

    it('surfaces decoder errors on flush', async () => {
      const { VideoDecoderMock, instance } = makeMockDecoder();
      vi.stubGlobal('VideoDecoder', VideoDecoderMock);

      const dec = new WebCodecsVideoDecoder({ config: baseConfig }, vi.fn());
      instance._errorCb?.(new Error('Driver error'));

      await expect(dec.flush()).rejects.toThrow(CodecOperationError);
    });
  });

  describe('accessors', () => {
    it('exposes decodeQueueSize from underlying decoder', () => {
      const { VideoDecoderMock, instance } = makeMockDecoder();
      vi.stubGlobal('VideoDecoder', VideoDecoderMock);

      const dec = new WebCodecsVideoDecoder({ config: baseConfig }, vi.fn());
      instance.decodeQueueSize = 5;

      expect(dec.decodeQueueSize).toBe(5);
    });

    it('exposes state from underlying decoder', () => {
      const { VideoDecoderMock, instance } = makeMockDecoder();
      vi.stubGlobal('VideoDecoder', VideoDecoderMock);

      const dec = new WebCodecsVideoDecoder({ config: baseConfig }, vi.fn());
      expect(dec.state).toBe('configured');
    });
  });
});
