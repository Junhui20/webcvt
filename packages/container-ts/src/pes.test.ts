import { describe, expect, it } from 'vitest';
import { MAX_PES_BYTES } from './constants.ts';
import { TsCorruptStreamError, TsPesTooLargeError } from './errors.ts';
import { continuePes, createPesAssembler, decodePesHeader, flushPes, startPes } from './pes.ts';

// ---------------------------------------------------------------------------
// PES buffer builder helper
// ---------------------------------------------------------------------------

function buildPesBuffer(opts: {
  streamId?: number;
  pesLen?: number; // 0 = unbounded
  ptsUs?: number;
  dtsUs?: number;
  payloadLen?: number;
}): Uint8Array {
  const streamId = opts.streamId ?? 0xe0;
  const payloadLen = opts.payloadLen ?? 10;
  const hasPts = opts.ptsUs !== undefined;
  const hasDts = opts.dtsUs !== undefined && opts.dtsUs !== opts.ptsUs;
  const optLen = hasPts ? (hasDts ? 10 : 5) : 0;
  const headerSize = 9 + optLen;
  const totalSize = headerSize + payloadLen;

  const buf = new Uint8Array(totalSize);
  buf[0] = 0x00;
  buf[1] = 0x00;
  buf[2] = 0x01;
  buf[3] = streamId;

  const pesLen = opts.pesLen !== undefined ? opts.pesLen : headerSize - 6 + payloadLen;
  buf[4] = (pesLen >> 8) & 0xff;
  buf[5] = pesLen & 0xff;
  buf[6] = 0x80; // '10' marker
  buf[7] = hasPts ? (hasDts ? 0xc0 : 0x80) : 0x00; // PTS_DTS_flags
  buf[8] = optLen & 0xff;

  if (hasPts) {
    encodePtsDts(buf, 9, Math.round(((opts.ptsUs as number) * 9) / 100), hasDts ? 0b0011 : 0b0010);
  }
  if (hasDts) {
    encodePtsDts(buf, 14, Math.round(((opts.dtsUs as number) * 9) / 100), 0b0001);
  }

  // Fill payload with dummy bytes
  buf.fill(0xab, headerSize);
  return buf;
}

function encodePtsDts(buf: Uint8Array, offset: number, val90: number, prefix: number): void {
  const part0 = Math.floor(val90 / 0x40000000) & 0x07;
  const part1 = (val90 >> 15) & 0x7fff;
  const part2 = val90 & 0x7fff;

  buf[offset] = ((prefix & 0x0f) << 4) | ((part0 & 0x07) << 1) | 0x01;
  buf[offset + 1] = (part1 >> 7) & 0xff;
  buf[offset + 2] = ((part1 & 0x7f) << 1) | 0x01;
  buf[offset + 3] = (part2 >> 7) & 0xff;
  buf[offset + 4] = ((part2 & 0x7f) << 1) | 0x01;
}

// ---------------------------------------------------------------------------
// decodePesHeader tests
// ---------------------------------------------------------------------------

describe('decodePesHeader', () => {
  it('validates start code prefix (0x00 0x00 0x01)', () => {
    const buf = new Uint8Array(9);
    buf[0] = 0x00;
    buf[1] = 0x00;
    buf[2] = 0x01;
    buf[3] = 0xe0;
    buf[8] = 0x00; // header_data_length = 0
    const header = decodePesHeader(buf);
    expect(header.streamId).toBe(0xe0);
  });

  it('throws TsCorruptStreamError for invalid start code', () => {
    const buf = new Uint8Array(9);
    buf[0] = 0x00;
    buf[1] = 0x00;
    buf[2] = 0x00; // wrong
    expect(() => decodePesHeader(buf)).toThrow(TsCorruptStreamError);
  });

  it('decodes PTS-only PES (PTS_DTS_flags = 0b10)', () => {
    const ptsUs = 1_000_000; // 1 second
    const buf = buildPesBuffer({ ptsUs });
    const header = decodePesHeader(buf);
    // Allow small rounding error (±1 microsecond due to 90kHz quantization)
    expect(header.ptsUs).toBeDefined();
    expect(Math.abs((header.ptsUs as number) - ptsUs)).toBeLessThan(10);
    expect(header.dtsUs).toBeUndefined();
  });

  it('decodes PTS+DTS PES (PTS_DTS_flags = 0b11) with PTS != DTS', () => {
    const ptsUs = 2_000_000;
    const dtsUs = 1_900_000;
    const buf = buildPesBuffer({ ptsUs, dtsUs });
    const header = decodePesHeader(buf);
    expect(Math.abs((header.ptsUs as number) - ptsUs)).toBeLessThan(10);
    expect(Math.abs((header.dtsUs as number) - dtsUs)).toBeLessThan(10);
  });

  it('decodes 33-bit PTS at the high-bit boundary (~26.5h) without precision loss', () => {
    // 33-bit PTS max = 2^33 - 1 = 8589934591 ticks at 90kHz
    // ≈ 95443.7 seconds ≈ 26.5 hours
    const pts90 = 8589934591; // Max 33-bit value
    const ptsUs = Math.round((pts90 * 100) / 9);

    const buf = buildPesBuffer({ ptsUs, payloadLen: 10 });
    const header = decodePesHeader(buf);
    // Allow ≤ 100µs rounding error for extreme values
    expect(Math.abs((header.ptsUs as number) - ptsUs)).toBeLessThan(100);
  });

  it('handles PES_packet_length = 0 (unbounded video — Trap #5)', () => {
    const buf = buildPesBuffer({ pesLen: 0, payloadLen: 10 });
    const header = decodePesHeader(buf);
    expect(header.pesPacketLength).toBe(0);
  });

  it('throws for buffer shorter than 9 bytes', () => {
    expect(() => decodePesHeader(new Uint8Array(8))).toThrow(TsCorruptStreamError);
  });
});

// ---------------------------------------------------------------------------
// PES assembler tests
// ---------------------------------------------------------------------------

describe('PES assembler', () => {
  it('reassembles PES across 4 TS packets correctly (Trap #5 unbounded video)', () => {
    // Build a PES buffer with pesLen=0 (unbounded)
    const ptsUs = 500_000;
    const totalPayload = new Uint8Array(4 * 184 - 30); // spans ~4 packets
    const pesBuf = buildPesBuffer({ ptsUs, pesLen: 0, payloadLen: totalPayload.length });

    // Split into chunks simulating TS packets
    const chunkSize = 184;
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < pesBuf.length; i += chunkSize) {
      chunks.push(pesBuf.subarray(i, Math.min(i + chunkSize, pesBuf.length)));
    }

    const state = createPesAssembler();
    const pid = 0x0100;

    // First chunk: PUSI=1
    const firstFlushed = startPes(state, pid, chunks[0] as Uint8Array, 0);
    expect(firstFlushed).toBeNull(); // nothing to flush initially

    // Middle chunks: PUSI=0
    for (let i = 1; i < chunks.length; i++) {
      const flushed = continuePes(state, pid, chunks[i] as Uint8Array, i * 188);
      expect(flushed).toBeNull(); // not yet complete (unbounded)
    }

    // End with another PUSI=1 to flush the accumulated PES
    const nextPesBuf = buildPesBuffer({ ptsUs: ptsUs + 33333, pesLen: 0, payloadLen: 5 });
    const flushed = startPes(state, pid, nextPesBuf.subarray(0, 184), chunks.length * 188);
    expect(flushed).not.toBeNull();
    expect(Math.abs((flushed?.ptsUs ?? 0) - ptsUs)).toBeLessThan(10);
    expect(flushed?.pid).toBe(pid);
  });

  it('completes bounded PES when PES_packet_length is non-zero', () => {
    const ptsUs = 100_000;
    const payloadLen = 20;
    const pesBuf = buildPesBuffer({ ptsUs, payloadLen });

    const state = createPesAssembler();
    const pid = 0x0101;

    // All in one chunk
    const flushed = startPes(state, pid, pesBuf, 0);
    // Nothing was in flight before
    expect(flushed).toBeNull();

    // completePes via flushPes since pesLen is non-zero and we accumulated enough
    const completed = flushPes(state, pid);
    expect(completed).not.toBeNull();
    expect(Math.abs((completed?.ptsUs ?? 0) - ptsUs)).toBeLessThan(10);
  });

  it('accumulates DTS correctly', () => {
    const ptsUs = 200_000;
    const dtsUs = 190_000;
    const pesBuf = buildPesBuffer({ ptsUs, dtsUs, payloadLen: 10 });

    const state = createPesAssembler();
    startPes(state, 0x0100, pesBuf, 0);
    const completed = flushPes(state, 0x0100);
    expect(completed?.dtsUs).toBeDefined();
    expect(Math.abs((completed?.dtsUs ?? 0) - dtsUs)).toBeLessThan(10);
  });

  it('returns null when flushing empty assembler', () => {
    const state = createPesAssembler();
    expect(flushPes(state, 0x0100)).toBeNull();
  });

  it('tracks sourcePacketOffsets', () => {
    const pesBuf = buildPesBuffer({ ptsUs: 0, payloadLen: 10 });
    const state = createPesAssembler();
    startPes(state, 0x0100, pesBuf.subarray(0, 100), 188);
    continuePes(state, 0x0100, pesBuf.subarray(100), 376);
    const flushed = flushPes(state, 0x0100);
    expect(flushed?.sourcePacketOffsets).toContain(188);
    expect(flushed?.sourcePacketOffsets).toContain(376);
  });

  // Sec-H-1 regression: PES size cap enforcement
  it('throws TsPesTooLargeError when accumulated bytes exceed MAX_PES_BYTES (Sec-H-1)', () => {
    // Start a PES with a small initial chunk (simulates PUSI=1 packet)
    const initialPayload = buildPesBuffer({ pesLen: 0, payloadLen: 100 });
    const state = createPesAssembler();
    startPes(state, 0x0100, initialPayload, 0);

    // Feed large chunks until we exceed MAX_PES_BYTES
    // Each chunk is 1 MiB; after 17 iterations we are over the 16 MiB cap
    const chunkSize = 1 * 1024 * 1024;
    const bigChunk = new Uint8Array(chunkSize).fill(0xab);

    expect(() => {
      for (let i = 0; i < 18; i++) {
        continuePes(state, 0x0100, bigChunk, (i + 1) * 188);
      }
    }).toThrow(TsPesTooLargeError);
  });
});

// ---------------------------------------------------------------------------
// Sec-M-1 regression: PTS/DTS marker bit validation
// ---------------------------------------------------------------------------

describe('decodePtsDts marker bit validation (Sec-M-1)', () => {
  it('throws TsCorruptStreamError when PTS byte 0 marker bit is 0', () => {
    const buf = buildPesBuffer({ ptsUs: 1_000_000, payloadLen: 10 });
    // PTS occupies bytes 9..13. Byte 9 (b0): clear bit 0 to corrupt marker
    buf[9] = buf[9] & ~0x01; // clear marker bit
    expect(() => decodePesHeader(buf)).toThrow(TsCorruptStreamError);
  });

  it('throws TsCorruptStreamError when PTS byte 2 marker bit is 0', () => {
    const buf = buildPesBuffer({ ptsUs: 1_000_000, payloadLen: 10 });
    // PTS byte 2 is buf[11]: clear bit 0
    buf[11] = buf[11] & ~0x01;
    expect(() => decodePesHeader(buf)).toThrow(TsCorruptStreamError);
  });

  it('throws TsCorruptStreamError when PTS byte 4 marker bit is 0', () => {
    const buf = buildPesBuffer({ ptsUs: 1_000_000, payloadLen: 10 });
    // PTS byte 4 is buf[13]: clear bit 0
    buf[13] = buf[13] & ~0x01;
    expect(() => decodePesHeader(buf)).toThrow(TsCorruptStreamError);
  });

  it('accepts PTS when all marker bits are correctly set to 1', () => {
    const ptsUs = 1_000_000;
    const buf = buildPesBuffer({ ptsUs, payloadLen: 10 });
    // Confirm buildPesBuffer already sets correct marker bits
    expect(() => decodePesHeader(buf)).not.toThrow();
    const header = decodePesHeader(buf);
    expect(Math.abs((header.ptsUs as number) - ptsUs)).toBeLessThan(10);
  });
});
