import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebCodecsNotSupportedError, CodecOperationError } from './errors.ts';
import { WebCodecsVideoEncoder } from './video-encoder.ts';

// ---------------------------------------------------------------------------
// Mock VideoEncoder global
// ---------------------------------------------------------------------------

function makeFrame(): VideoFrame {
  return {} as VideoFrame;
}

function makeMockEncoder() {
  const instance = {
    configure: vi.fn(),
    encode: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    encodeQueueSize: 0,
    state: 'configured' as CodecState,
    // Internal callback references set by constructor
    _outputCb: null as ((chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata) => void) | null,
    _errorCb: null as ((err: Error) => void) | null,
  };

  const VideoEncoderMock = vi.fn().mockImplementation(
    (init: VideoEncoderInit) => {
      instance._outputCb = init.output;
      instance._errorCb = init.error;
      return instance;
    },
  );
  (VideoEncoderMock as unknown as { isConfigSupported: () => void }).isConfigSupported = vi.fn();

  return { VideoEncoderMock, instance };
}

const baseConfig: VideoEncoderConfig = {
  codec: 'avc1.42001E',
  width: 1280,
  height: 720,
  bitrate: 2_000_000,
  framerate: 30,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebCodecsVideoEncoder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('throws WebCodecsNotSupportedError when VideoEncoder global is absent', () => {
      vi.stubGlobal('VideoEncoder', undefined);

      expect(
        () => new WebCodecsVideoEncoder({ config: baseConfig }, vi.fn()),
      ).toThrow(WebCodecsNotSupportedError);
    });

    it('calls configure with the provided config', () => {
      const { VideoEncoderMock, instance } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      new WebCodecsVideoEncoder({ config: baseConfig }, vi.fn());

      expect(instance.configure).toHaveBeenCalledWith(baseConfig);
    });
  });

  describe('encode', () => {
    beforeEach(() => {
      const { VideoEncoderMock } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);
    });

    it('delegates to the underlying encoder', () => {
      const { VideoEncoderMock, instance } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      const enc = new WebCodecsVideoEncoder({ config: baseConfig }, vi.fn());
      const frame = makeFrame();
      enc.encode(frame);

      expect(instance.encode).toHaveBeenCalledWith(frame, undefined);
    });

    it('passes encode options through', () => {
      const { VideoEncoderMock, instance } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      const enc = new WebCodecsVideoEncoder({ config: baseConfig }, vi.fn());
      enc.encode(makeFrame(), { keyFrame: true });

      expect(instance.encode).toHaveBeenCalledWith(expect.anything(), { keyFrame: true });
    });

    it('throws after close', () => {
      const { VideoEncoderMock } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      const enc = new WebCodecsVideoEncoder({ config: baseConfig }, vi.fn());
      enc.close();

      expect(() => enc.encode(makeFrame())).toThrow(CodecOperationError);
    });
  });

  describe('flush', () => {
    it('resolves after the underlying encoder flushes', async () => {
      const { VideoEncoderMock, instance } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      const enc = new WebCodecsVideoEncoder({ config: baseConfig }, vi.fn());
      await enc.flush();

      expect(instance.flush).toHaveBeenCalledOnce();
    });

    it('throws after close', async () => {
      const { VideoEncoderMock } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      const enc = new WebCodecsVideoEncoder({ config: baseConfig }, vi.fn());
      enc.close();

      await expect(enc.flush()).rejects.toThrow(CodecOperationError);
    });
  });

  describe('close', () => {
    it('closes the underlying encoder', () => {
      const { VideoEncoderMock, instance } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      const enc = new WebCodecsVideoEncoder({ config: baseConfig }, vi.fn());
      enc.close();

      expect(instance.close).toHaveBeenCalledOnce();
    });

    it('is idempotent — safe to call multiple times', () => {
      const { VideoEncoderMock, instance } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      const enc = new WebCodecsVideoEncoder({ config: baseConfig }, vi.fn());
      enc.close();
      enc.close();
      enc.close();

      expect(instance.close).toHaveBeenCalledOnce();
    });
  });

  describe('onChunk callback', () => {
    it('forwards encoded chunks to the callback', () => {
      const { VideoEncoderMock, instance } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      const onChunk = vi.fn();
      new WebCodecsVideoEncoder({ config: baseConfig }, onChunk);

      const fakeChunk = {} as EncodedVideoChunk;
      const fakeMeta = {} as EncodedVideoChunkMetadata;
      instance._outputCb!(fakeChunk, fakeMeta);

      expect(onChunk).toHaveBeenCalledWith(fakeChunk, fakeMeta);
    });

    it('provides empty metadata object when browser passes null/undefined', () => {
      const { VideoEncoderMock, instance } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      const onChunk = vi.fn();
      new WebCodecsVideoEncoder({ config: baseConfig }, onChunk);

      const fakeChunk = {} as EncodedVideoChunk;
      // Simulate browser passing undefined metadata
      instance._outputCb!(fakeChunk, undefined as unknown as EncodedVideoChunkMetadata);

      expect(onChunk).toHaveBeenCalledWith(fakeChunk, {});
    });
  });

  describe('error propagation', () => {
    it('surfaces encoder errors on next encode call', () => {
      const { VideoEncoderMock, instance } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      const enc = new WebCodecsVideoEncoder({ config: baseConfig }, vi.fn());

      // Simulate async encoder error
      instance._errorCb!(new Error('GPU hang'));

      expect(() => enc.encode(makeFrame())).toThrow(CodecOperationError);
    });

    it('surfaces encoder errors on flush', async () => {
      const { VideoEncoderMock, instance } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      const enc = new WebCodecsVideoEncoder({ config: baseConfig }, vi.fn());
      instance._errorCb!(new Error('Driver crash'));

      await expect(enc.flush()).rejects.toThrow(CodecOperationError);
    });
  });

  describe('state and queueSize accessors', () => {
    it('exposes encodeQueueSize from underlying encoder', () => {
      const { VideoEncoderMock, instance } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      const enc = new WebCodecsVideoEncoder({ config: baseConfig }, vi.fn());

      // Reflect changes on the mock instance
      instance.encodeQueueSize = 3;
      expect(enc.encodeQueueSize).toBe(3);
    });

    it('exposes state from underlying encoder', () => {
      const { VideoEncoderMock, instance } = makeMockEncoder();
      vi.stubGlobal('VideoEncoder', VideoEncoderMock);

      const enc = new WebCodecsVideoEncoder({ config: baseConfig }, vi.fn());
      expect(enc.state).toBe('configured');

      instance.state = 'closed';
      expect(enc.state).toBe('closed');
    });
  });
});
