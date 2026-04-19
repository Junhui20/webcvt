import { describe, expect, it } from 'vitest';
import {
  TsInvalidAdaptationLengthError,
  TsNoSyncByteError,
  TsReservedAdaptationControlError,
  TsScrambledNotSupportedError,
} from './errors.ts';
import { acquireSync, decodePacket } from './packet.ts';

// ---------------------------------------------------------------------------
// Helper: build a minimal 188-byte TS packet
// ---------------------------------------------------------------------------

function makePacket(opts: {
  pid?: number;
  pusi?: boolean;
  afc?: number;
  cc?: number;
  scrambling?: number;
  payload?: Uint8Array;
  adaptLen?: number;
}): Uint8Array {
  const pkt = new Uint8Array(188).fill(0xff);
  const pid = opts.pid ?? 0x0100;
  const pusi = opts.pusi ?? false;
  const afc = opts.afc ?? 0b01;
  const cc = opts.cc ?? 0;
  const scrambling = opts.scrambling ?? 0;

  pkt[0] = 0x47;
  pkt[1] = ((pusi ? 0x40 : 0x00) | ((pid >> 8) & 0x1f)) & 0xff;
  pkt[2] = pid & 0xff;
  pkt[3] = (((scrambling & 0x03) << 6) | ((afc & 0x03) << 4) | (cc & 0x0f)) & 0xff;

  if (afc === 0b10 || afc === 0b11) {
    const adaptLen = opts.adaptLen ?? (afc === 0b10 ? 183 : 1);
    pkt[4] = adaptLen & 0xff;
    if (adaptLen >= 1) pkt[5] = 0x00; // flags
  }

  if (opts.payload) {
    const payloadStart = afc === 0b11 ? 4 + 1 + (opts.adaptLen ?? 1) : 4;
    const actualStart = afc === 0b10 ? 188 : payloadStart; // adaptation-only: no payload
    if (actualStart < 188 && opts.payload) {
      pkt.set(
        opts.payload.subarray(0, Math.min(opts.payload.length, 188 - actualStart)),
        actualStart,
      );
    }
  }

  return pkt;
}

// ---------------------------------------------------------------------------
// acquireSync tests
// ---------------------------------------------------------------------------

describe('acquireSync', () => {
  it('acquires sync at offset 0 when stream starts with 0x47 cleanly', () => {
    const buf = new Uint8Array(3 * 188);
    buf[0] = 0x47;
    buf[188] = 0x47;
    buf[376] = 0x47;
    expect(acquireSync(buf, 0)).toBe(0);
  });

  it('recovers sync when stream has 11-byte garbage prefix before first 0x47', () => {
    const buf = new Uint8Array(11 + 3 * 188);
    // Garbage prefix with no 0x47 at valid positions
    buf.fill(0x00, 0, 11);
    buf[11] = 0x47;
    buf[11 + 188] = 0x47;
    buf[11 + 376] = 0x47;
    expect(acquireSync(buf, 0)).toBe(11);
  });

  it('does NOT mistake 0x47 inside payload for a packet boundary (Trap #1)', () => {
    // Build stream: first packet starts at 0, contains 0x47 at offset 50 inside
    // But only the positions 0, 188, 376 should be confirmed as sync
    const buf = new Uint8Array(3 * 188);
    buf[0] = 0x47; // correct sync
    buf[50] = 0x47; // 0x47 inside payload — NOT a sync
    buf[188] = 0x47; // second packet sync
    buf[376] = 0x47; // third packet sync

    // acquireSync should find offset 0, not 50
    expect(acquireSync(buf, 0)).toBe(0);
  });

  it('throws TsNoSyncByteError when no sync found within cap', () => {
    // All zeros — no 0x47 anywhere
    const buf = new Uint8Array(1024 * 1024 + 100);
    expect(() => acquireSync(buf, 0)).toThrow(TsNoSyncByteError);
  });

  it('handles stream shorter than 3 packets gracefully', () => {
    const buf = new Uint8Array(200);
    buf[0] = 0x47;
    buf[188] = 0x47;
    // Only 2 packets — triple-anchor partial match is OK since past-end treated as match
    const result = acquireSync(buf, 0);
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// decodePacket tests
// ---------------------------------------------------------------------------

describe('decodePacket', () => {
  it('decodes PID correctly (Trap #18)', () => {
    const pkt = makePacket({ pid: 0x1234 & 0x1fff });
    const decoded = decodePacket(pkt, 0);
    expect(decoded.header.pid).toBe(0x1234 & 0x1fff);
  });

  it('decodes payloadUnitStart flag', () => {
    const withPusi = makePacket({ pusi: true });
    const withoutPusi = makePacket({ pusi: false });
    expect(decodePacket(withPusi, 0).header.payloadUnitStart).toBe(true);
    expect(decodePacket(withoutPusi, 0).header.payloadUnitStart).toBe(false);
  });

  it('decodes continuity counter', () => {
    for (let cc = 0; cc < 16; cc++) {
      const pkt = makePacket({ cc });
      expect(decodePacket(pkt, 0).header.continuityCounter).toBe(cc);
    }
  });

  it('throws TsScrambledNotSupportedError on scrambled packet (Trap #13)', () => {
    const pkt = makePacket({ scrambling: 1 });
    expect(() => decodePacket(pkt, 0)).toThrow(TsScrambledNotSupportedError);
  });

  it('throws TsReservedAdaptationControlError for AFC=0b00 (Trap #3)', () => {
    const pkt = new Uint8Array(188).fill(0xff);
    pkt[0] = 0x47;
    pkt[1] = 0x00;
    pkt[2] = 0x01;
    pkt[3] = 0x00; // AFC=0b00 — reserved/illegal
    expect(() => decodePacket(pkt, 0)).toThrow(TsReservedAdaptationControlError);
  });

  it('decodes adaptation-only packet (AFC=10) with 183-byte stuffing', () => {
    const pkt = makePacket({ afc: 0b10, adaptLen: 183 });
    const decoded = decodePacket(pkt, 0);
    expect(decoded.header.adaptationFieldControl).toBe(2);
    expect(decoded.adaptation).toBeDefined();
    expect(decoded.adaptation?.totalLength).toBe(184); // 1 length byte + 183 field bytes
    expect(decoded.payload.length).toBe(0);
  });

  it('decodes adaptation+payload packet (AFC=11)', () => {
    const pkt = makePacket({ afc: 0b11, adaptLen: 1 });
    const decoded = decodePacket(pkt, 0);
    expect(decoded.header.adaptationFieldControl).toBe(3);
    expect(decoded.adaptation).toBeDefined();
    expect(decoded.payload.length).toBeGreaterThan(0);
  });

  it('adaptation_field_length does not include itself (Trap #4)', () => {
    // AFC=11, adaptLen=1: means 1 byte of flags field, then payload
    const pkt = makePacket({ afc: 0b11, adaptLen: 1 });
    const decoded = decodePacket(pkt, 0);
    // totalLength = 1 (length byte) + 1 (flags byte) = 2
    expect(decoded.adaptation?.totalLength).toBe(2);
    // payload starts at 4 (header) + 2 (adaptation total) = offset 6
    expect(decoded.payload.length).toBe(188 - 4 - 2);
  });

  it('marks transport_error_indicator correctly', () => {
    const pkt = new Uint8Array(188).fill(0xff);
    pkt[0] = 0x47;
    pkt[1] = 0x80; // TEI=1, PID high = 0
    pkt[2] = 0x01; // PID low = 1
    pkt[3] = 0x10; // AFC=01, CC=0
    const decoded = decodePacket(pkt, 0);
    expect(decoded.header.transportError).toBe(true);
  });

  it('stores fileOffset correctly', () => {
    const buf = new Uint8Array(400);
    buf[188] = 0x47;
    buf[188 + 1] = 0x01;
    buf[188 + 2] = 0x00;
    buf[188 + 3] = 0x10;
    const decoded = decodePacket(buf, 188);
    expect(decoded.fileOffset).toBe(188);
  });

  it('payload is empty for adaptation-only packets', () => {
    const pkt = makePacket({ afc: 0b10 });
    const decoded = decodePacket(pkt, 0);
    expect(decoded.payload.length).toBe(0);
  });

  // Sec-H-2 regression: adaptation_field_length > 183 must throw, not clamp
  it('throws TsInvalidAdaptationLengthError for adaptation_field_length=255 (Sec-H-2)', () => {
    // Build a raw 188-byte packet with AFC=0b11 (adaptation+payload) and byte 4 = 0xFF
    const pkt = new Uint8Array(188).fill(0xff);
    pkt[0] = 0x47; // sync byte
    pkt[1] = 0x00; // TEI=0, PUSI=0, PID high = 0
    pkt[2] = 0x01; // PID low = 1
    pkt[3] = 0x30; // scrambling=0, AFC=0b11, CC=0
    pkt[4] = 0xff; // adaptation_field_length = 255 — illegal
    expect(() => decodePacket(pkt, 0)).toThrow(TsInvalidAdaptationLengthError);
  });

  it('throws TsInvalidAdaptationLengthError for adaptation_field_length=184 (boundary, Sec-H-2)', () => {
    const pkt = new Uint8Array(188).fill(0x00);
    pkt[0] = 0x47;
    pkt[1] = 0x00;
    pkt[2] = 0x01;
    pkt[3] = 0x30; // AFC=0b11
    pkt[4] = 184; // one over the maximum of 183
    expect(() => decodePacket(pkt, 0)).toThrow(TsInvalidAdaptationLengthError);
  });

  it('accepts adaptation_field_length=183 (maximum legal value, Sec-H-2)', () => {
    const pkt = makePacket({ afc: 0b10, adaptLen: 183 });
    expect(() => decodePacket(pkt, 0)).not.toThrow();
  });
});
