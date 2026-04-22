/**
 * OggBackend tests.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import { OggBackend } from './backend.ts';
import { OggEncodeNotImplementedError, OggInputTooLargeError } from './errors.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(mime: string): FormatDescriptor {
  return { ext: mime.split('/')[1] ?? mime, mime, category: 'audio' };
}

const OGG_FMT = fmt('audio/ogg');
const AAC_FMT = fmt('audio/aac');
const OPUS_FMT = fmt('audio/opus');
const APP_OGG_FMT = fmt('application/ogg');

// ---------------------------------------------------------------------------
// canHandle
// ---------------------------------------------------------------------------

describe('OggBackend.canHandle', () => {
  const backend = new OggBackend();

  // Q-1 regression: cross-MIME relabels must be false (identity-only fix).
  it('returns false for audio/ogg → audio/opus (Q-1 cross-MIME relabel)', async () => {
    expect(await backend.canHandle(OGG_FMT, OPUS_FMT)).toBe(false);
  });

  it('returns false for audio/opus → audio/ogg (Q-1 reverse cross-MIME relabel)', async () => {
    expect(await backend.canHandle(OPUS_FMT, OGG_FMT)).toBe(false);
  });

  // Q-1 regression: the 3 true identity passes must still be true.
  it('returns true for audio/ogg → audio/ogg (identity)', async () => {
    expect(await backend.canHandle(OGG_FMT, OGG_FMT)).toBe(true);
  });

  it('returns true for audio/opus → audio/opus (identity)', async () => {
    expect(await backend.canHandle(OPUS_FMT, OPUS_FMT)).toBe(true);
  });

  // Q-2 regression: application/ogg removed from set — must return false for input.
  it('returns false for application/ogg → application/ogg (Q-2 removed from set)', async () => {
    expect(await backend.canHandle(APP_OGG_FMT, APP_OGG_FMT)).toBe(false);
  });

  it('returns false for audio/aac → audio/ogg', async () => {
    expect(await backend.canHandle(AAC_FMT, OGG_FMT)).toBe(false);
  });

  it('returns false for audio/ogg → audio/aac', async () => {
    expect(await backend.canHandle(OGG_FMT, AAC_FMT)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// convert — identity round-trip
// ---------------------------------------------------------------------------

describe('OggBackend.convert', () => {
  const backend = new OggBackend();

  it('throws OggInputTooLargeError when blob is too large', async () => {
    const bigBlob = {
      size: 201 * 1024 * 1024,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Blob;
    await expect(backend.convert(bigBlob, OGG_FMT, { format: 'ogg' })).rejects.toBeInstanceOf(
      OggInputTooLargeError,
    );
  });

  it('throws OggEncodeNotImplementedError for non-Ogg output on non-Ogg input', async () => {
    // Build a minimal valid Ogg file as bytes.
    const { parseOgg } = await import('./parser.ts');
    const { serializeOgg } = await import('./serializer.ts');

    // We need a valid Ogg file — use the fixture if available.
    // For a self-contained test, build a synthetic stream.
    const { computeCrc32: crc32 } = await import('./crc32.ts');

    function bp(opts: {
      ht?: number;
      sn?: number;
      seq: number;
      segs: number[];
      body: Uint8Array;
      gp?: bigint;
    }): Uint8Array {
      const { ht = 0, sn = 1, seq, segs, body, gp = 0n } = opts;
      const out = new Uint8Array(27 + segs.length + body.length);
      const v = new DataView(out.buffer);
      out[0] = 0x4f;
      out[1] = 0x67;
      out[2] = 0x67;
      out[3] = 0x53;
      out[4] = 0;
      out[5] = ht;
      v.setBigInt64(6, gp, true);
      v.setUint32(14, sn, true);
      v.setUint32(18, seq, true);
      v.setUint32(22, 0, true);
      out[26] = segs.length;
      segs.forEach((s, i) => {
        out[27 + i] = s;
      });
      out.set(body, 27 + segs.length);
      v.setUint32(22, crc32(out), true);
      return out;
    }

    const ident = new Uint8Array(30);
    ident[0] = 0x01;
    ident[1] = 0x76;
    ident[2] = 0x6f;
    ident[3] = 0x72;
    ident[4] = 0x62;
    ident[5] = 0x69;
    ident[6] = 0x73;
    new DataView(ident.buffer).setUint32(12, 44100, true);
    ident[11] = 2;
    ident[28] = 0xb8;
    ident[29] = 0x01;
    new DataView(ident.buffer).setInt32(20, 128000, true);

    const enc = new TextEncoder();
    const vendorB = enc.encode('test');
    const comment = new Uint8Array(1 + 6 + 4 + vendorB.length + 4 + 1);
    comment[0] = 0x03;
    comment[1] = 0x76;
    comment[2] = 0x6f;
    comment[3] = 0x72;
    comment[4] = 0x62;
    comment[5] = 0x69;
    comment[6] = 0x73;
    new DataView(comment.buffer).setUint32(7, vendorB.length, true);
    comment.set(vendorB, 11);
    comment[comment.length - 1] = 0x01;

    const setup = new Uint8Array(10);
    setup[0] = 0x05;
    setup[1] = 0x76;
    setup[2] = 0x6f;
    setup[3] = 0x72;
    setup[4] = 0x62;
    setup[5] = 0x69;
    setup[6] = 0x73;

    const audio = new Uint8Array([0xde, 0xad]);

    const concat = (...parts: Uint8Array[]) => {
      const t = parts.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(t);
      let off = 0;
      for (const p of parts) {
        out.set(p, off);
        off += p.length;
      }
      return out;
    };

    const oggData = concat(
      bp({ ht: 0x02, sn: 1, seq: 0, segs: [ident.length], body: ident }),
      bp({ ht: 0x00, sn: 1, seq: 1, segs: [comment.length], body: comment }),
      bp({ ht: 0x00, sn: 1, seq: 2, segs: [setup.length], body: setup }),
      bp({ ht: 0x04, sn: 1, seq: 3, segs: [audio.length], body: audio, gp: 100n }),
    );

    const blob = new Blob([oggData.buffer as ArrayBuffer], { type: 'audio/ogg' });

    // Identity round-trip should succeed.
    const result = await backend.convert(blob, OGG_FMT, { format: 'ogg' });
    expect(result.backend).toBe('container-ogg');
    expect(result.blob).toBeInstanceOf(Blob);

    // Non-Ogg output should throw OggEncodeNotImplementedError.
    await expect(backend.convert(blob, AAC_FMT, { format: 'aac' })).rejects.toBeInstanceOf(
      OggEncodeNotImplementedError,
    );
  });

  it('has correct name', () => {
    expect(backend.name).toBe('container-ogg');
  });

  it('calls onProgress callbacks during identity convert', async () => {
    // Build a minimal valid Ogg file (Vorbis stream) for convert.
    const { computeCrc32: crc32 } = await import('./crc32.ts');

    function bp(opts: {
      ht?: number;
      sn?: number;
      seq: number;
      segs: number[];
      body: Uint8Array;
      gp?: bigint;
    }): Uint8Array {
      const { ht = 0, sn = 1, seq, segs, body, gp = 0n } = opts;
      const out = new Uint8Array(27 + segs.length + body.length);
      const v = new DataView(out.buffer);
      out[0] = 0x4f;
      out[1] = 0x67;
      out[2] = 0x67;
      out[3] = 0x53;
      out[4] = 0;
      out[5] = ht;
      v.setBigInt64(6, gp, true);
      v.setUint32(14, sn, true);
      v.setUint32(18, seq, true);
      v.setUint32(22, 0, true);
      out[26] = segs.length;
      segs.forEach((s, i) => {
        out[27 + i] = s;
      });
      out.set(body, 27 + segs.length);
      v.setUint32(22, crc32(out), true);
      return out;
    }

    const ident = new Uint8Array(30);
    ident[0] = 0x01;
    ident[1] = 0x76;
    ident[2] = 0x6f;
    ident[3] = 0x72;
    ident[4] = 0x62;
    ident[5] = 0x69;
    ident[6] = 0x73;
    new DataView(ident.buffer).setUint32(12, 44100, true);
    ident[11] = 1;
    ident[28] = 0xb8;
    ident[29] = 0x01;
    new DataView(ident.buffer).setInt32(20, 128000, true);

    const enc = new TextEncoder();
    const vendorB = enc.encode('test');
    const comment = new Uint8Array(1 + 6 + 4 + vendorB.length + 4 + 1);
    comment[0] = 0x03;
    comment[1] = 0x76;
    comment[2] = 0x6f;
    comment[3] = 0x72;
    comment[4] = 0x62;
    comment[5] = 0x69;
    comment[6] = 0x73;
    new DataView(comment.buffer).setUint32(7, vendorB.length, true);
    comment.set(vendorB, 11);
    comment[comment.length - 1] = 0x01;

    const setup = new Uint8Array(10);
    setup[0] = 0x05;
    setup[1] = 0x76;
    setup[2] = 0x6f;
    setup[3] = 0x72;
    setup[4] = 0x62;
    setup[5] = 0x69;
    setup[6] = 0x73;

    const audio = new Uint8Array([0xde, 0xad]);

    const concat = (...parts: Uint8Array[]) => {
      const t = parts.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(t);
      let off = 0;
      for (const p of parts) {
        out.set(p, off);
        off += p.length;
      }
      return out;
    };

    const oggData = concat(
      bp({ ht: 0x02, sn: 1, seq: 0, segs: [ident.length], body: ident }),
      bp({ ht: 0x00, sn: 1, seq: 1, segs: [comment.length], body: comment }),
      bp({ ht: 0x00, sn: 1, seq: 2, segs: [setup.length], body: setup }),
      bp({ ht: 0x04, sn: 1, seq: 3, segs: [audio.length], body: audio, gp: 100n }),
    );

    const blob = new Blob([oggData.buffer as ArrayBuffer], { type: 'audio/ogg' });

    const progressCalls: number[] = [];
    const result = await backend.convert(blob, OGG_FMT, {
      format: 'ogg',
      onProgress: ({ percent }) => {
        progressCalls.push(percent);
      },
    });

    expect(result.backend).toBe('container-ogg');
    // onProgress should have been called with at least 3 values: 5, 50, 100.
    expect(progressCalls).toContain(5);
    expect(progressCalls).toContain(50);
    expect(progressCalls).toContain(100);
  });
});
