/**
 * Decode driver: turn a {@link DemuxResult} into planar-float {@link DecodedAudio}.
 *
 * PCM inputs (wav) short-circuit — no WebCodecs needed. Encoded inputs feed a
 * `WebCodecsAudioDecoder` chunk-by-chunk, accumulating each emitted `AudioData`
 * and `close()`-ing it promptly. The decoder is always `close()`-d in `finally`
 * (and via an abort listener that unblocks a pending `flush()`), so no codec
 * surface leaks on error or cancellation.
 */

import { WebCodecsAudioDecoder } from '@catlabtech/webcvt-codec-webcodecs';
import { asCodecError, throwIfAborted } from './abort.ts';
import type { DemuxResult } from './demux.ts';
import { type DecodedAudio, PlanarAccumulator, readAudioDataPlanes } from './pcm.ts';

export interface DecodeContext {
  readonly signal?: AbortSignal;
  /** Progress callback: (framesDecoded fraction 0–1). */
  readonly onProgress?: (fraction: number) => void;
}

/** Decode a demuxed source to planar float PCM. */
export async function decodeToPcm(demux: DemuxResult, ctx: DecodeContext): Promise<DecodedAudio> {
  throwIfAborted(ctx.signal);

  if (demux.kind === 'pcm') {
    ctx.onProgress?.(1);
    return demux.decoded;
  }

  const { config, chunks, sampleRate, numberOfChannels } = demux;
  const acc = new PlanarAccumulator();

  const decoder = new WebCodecsAudioDecoder({ config }, (data) => {
    acc.add(readAudioDataPlanes(data), data.sampleRate);
    data.close();
  });

  const onAbort = (): void => decoder.close();
  ctx.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const total = chunks.length || 1;
    for (let i = 0; i < chunks.length; i++) {
      throwIfAborted(ctx.signal);
      const spec = chunks[i];
      if (!spec) continue;
      decoder.decode(
        new EncodedAudioChunk({
          type: spec.type,
          timestamp: spec.timestampUs,
          duration: spec.durationUs,
          data: spec.data,
        }),
      );
      ctx.onProgress?.((i + 1) / total);
    }
    await decoder.flush();
    throwIfAborted(ctx.signal);
  } catch (err) {
    throw asCodecError(err, 'decode');
  } finally {
    ctx.signal?.removeEventListener('abort', onAbort);
    decoder.close();
  }

  return acc.finish(sampleRate, numberOfChannels);
}
