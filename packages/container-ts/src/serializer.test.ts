import { describe, expect, it } from 'vitest';
import { computePsiCrc32 } from './crc32.ts';
import { parseTs } from './parser.ts';
import type { TsFile } from './parser.ts';
import type { TsPesPacket } from './pes.ts';
import type { TsProgram } from './pmt.ts';
import { serializeTs } from './serializer.ts';

// ---------------------------------------------------------------------------
// Helpers (same as parser.test.ts)
// ---------------------------------------------------------------------------

function buildPatSection(tsId: number, programNumber: number, pmtPid: number): Uint8Array {
  const body = new Uint8Array([
    (programNumber >> 8) & 0xff,
    programNumber & 0xff,
    0xe0 | ((pmtPid >> 8) & 0x1f),
    pmtPid & 0xff,
  ]);
  return buildPsiSection(0x00, tsId, body);
}

function buildPmtSection(
  programNumber: number,
  pcrPid: number,
  streams: Array<{ streamType: number; pid: number }>,
): Uint8Array {
  const esBody = new Uint8Array(streams.length * 5);
  let off = 0;
  for (const s of streams) {
    esBody[off++] = s.streamType;
    esBody[off++] = 0xe0 | ((s.pid >> 8) & 0x1f);
    esBody[off++] = s.pid & 0xff;
    esBody[off++] = 0xf0;
    esBody[off++] = 0x00;
  }
  const body = new Uint8Array(4 + esBody.length);
  body[0] = 0xe0 | ((pcrPid >> 8) & 0x1f);
  body[1] = pcrPid & 0xff;
  body[2] = 0xf0;
  body[3] = 0x00;
  body.set(esBody, 4);
  return buildPsiSection(0x02, programNumber, body);
}

function buildPsiSection(tableId: number, tableIdExt: number, body: Uint8Array): Uint8Array {
  const sectionLength = 5 + body.length + 4;
  const noCrc = new Uint8Array(3 + 5 + body.length);
  let off = 0;
  noCrc[off++] = tableId;
  noCrc[off++] = 0xb0 | ((sectionLength >> 8) & 0x0f);
  noCrc[off++] = sectionLength & 0xff;
  noCrc[off++] = (tableIdExt >> 8) & 0xff;
  noCrc[off++] = tableIdExt & 0xff;
  noCrc[off++] = 0xc1;
  noCrc[off++] = 0x00;
  noCrc[off++] = 0x00;
  noCrc.set(body, off);

  const crc = computePsiCrc32(noCrc);
  const full = new Uint8Array(noCrc.length + 4);
  full.set(noCrc);
  full[noCrc.length] = (crc >> 24) & 0xff;
  full[noCrc.length + 1] = (crc >> 16) & 0xff;
  full[noCrc.length + 2] = (crc >> 8) & 0xff;
  full[noCrc.length + 3] = crc & 0xff;
  return full;
}

function buildPesPacket(
  streamId: number,
  ptsUs: number,
  dtsUs: number | undefined,
  payload: Uint8Array,
): Uint8Array {
  const hasDts = dtsUs !== undefined && dtsUs !== ptsUs;
  const optLen = hasDts ? 10 : 5;
  const headerSize = 9 + optLen;
  const isVideo = (streamId & 0xf0) === 0xe0;
  const pesLen = isVideo ? 0 : headerSize - 6 + payload.length;
  const buf = new Uint8Array(headerSize + payload.length);

  buf[0] = 0x00;
  buf[1] = 0x00;
  buf[2] = 0x01;
  buf[3] = streamId;
  buf[4] = (pesLen >> 8) & 0xff;
  buf[5] = pesLen & 0xff;
  buf[6] = 0x80;
  buf[7] = hasDts ? 0xc0 : 0x80;
  buf[8] = optLen;
  encodePtsDts(buf, 9, Math.round((ptsUs * 9) / 100), hasDts ? 0b0011 : 0b0010);
  if (hasDts) encodePtsDts(buf, 14, Math.round(((dtsUs as number) * 9) / 100), 0b0001);
  buf.set(payload, headerSize);
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

function wrapInTsPackets(pid: number, sectionPayload: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  const pkt = new Uint8Array(188).fill(0xff);
  pkt[0] = 0x47;
  pkt[1] = 0x40 | ((pid >> 8) & 0x1f);
  pkt[2] = pid & 0xff;
  pkt[3] = 0x10;
  pkt[4] = 0x00; // pointer_field
  const take = Math.min(sectionPayload.length, 183);
  pkt.set(sectionPayload.subarray(0, take), 5);
  packets.push(pkt);

  let cursor = take;
  let cc = 1;
  while (cursor < sectionPayload.length) {
    const cpkt = new Uint8Array(188).fill(0xff);
    cpkt[0] = 0x47;
    cpkt[1] = (pid >> 8) & 0x1f;
    cpkt[2] = pid & 0xff;
    cpkt[3] = 0x10 | (cc & 0x0f);
    const chunk = sectionPayload.subarray(cursor, cursor + 184);
    cpkt.set(chunk, 4);
    packets.push(cpkt);
    cursor += 184;
    cc = (cc + 1) & 0x0f;
  }
  return packets;
}

function wrapPesInTsPackets(pid: number, pesBuf: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  let cursor = 0;
  let first = true;
  let cc = 0;
  while (cursor < pesBuf.length) {
    const pkt = new Uint8Array(188).fill(0xff);
    pkt[0] = 0x47;
    pkt[1] = ((first ? 0x40 : 0x00) | ((pid >> 8) & 0x1f)) & 0xff;
    pkt[2] = pid & 0xff;
    pkt[3] = (0x10 | (cc & 0x0f)) & 0xff;
    const take = Math.min(pesBuf.length - cursor, 184);
    pkt.set(pesBuf.subarray(cursor, cursor + take), 4);
    packets.push(pkt);
    cursor += take;
    first = false;
    cc = (cc + 1) & 0x0f;
  }
  return packets;
}

function concatPackets(packets: Uint8Array[]): Uint8Array {
  const total = packets.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of packets) {
    buf.set(p, off);
    off += p.length;
  }
  return buf;
}

function buildAdtsFrame(): Uint8Array {
  const frame = new Uint8Array(8);
  frame[0] = 0xff;
  frame[1] = 0xf1;
  const sfi = 4;
  const profile = 0b01;
  const ch = 2;
  const channelHigh = (ch >> 2) & 0x01;
  const channelLow = ch & 0x03;
  const frameBytes = 8;
  frame[2] = ((profile & 0x03) << 6) | ((sfi & 0x0f) << 2) | channelHigh;
  const fhigh2 = (frameBytes >> 11) & 0x03;
  const fmid8 = (frameBytes >> 3) & 0xff;
  const flow3 = frameBytes & 0x07;
  frame[3] = (channelLow << 6) | fhigh2;
  frame[4] = fmid8;
  frame[5] = (flow3 << 5) | 0x1f;
  frame[6] = 0xfc;
  frame[7] = 0xab;
  return frame;
}

function buildMinimalTs(): Uint8Array {
  const packets: Uint8Array[] = [];

  const patSection = buildPatSection(0x0001, 1, 0x1000);
  packets.push(...wrapInTsPackets(0x0000, patSection));

  const pmtSection = buildPmtSection(1, 0x0100, [
    { streamType: 0x1b, pid: 0x0100 },
    { streamType: 0x0f, pid: 0x0101 },
  ]);
  packets.push(...wrapInTsPackets(0x1000, pmtSection));

  const videoPayload = new Uint8Array([
    0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x28, 0xac, 0xd9, 0x00, 0x00, 0x00, 0x01, 0x68, 0xce,
    0x38, 0x80, 0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00,
  ]);
  const videoPes = buildPesPacket(0xe0, 1_000_000, undefined, videoPayload);
  packets.push(...wrapPesInTsPackets(0x0100, videoPes));

  const audioPes = buildPesPacket(0xc0, 1_000_000, undefined, buildAdtsFrame());
  packets.push(...wrapPesInTsPackets(0x0101, audioPes));

  return concatPackets(packets);
}

// ---------------------------------------------------------------------------
// serializeTs tests
// ---------------------------------------------------------------------------

describe('serializeTs', () => {
  it('outputs only 188-byte aligned packets', () => {
    const ts = buildMinimalTs();
    const file = parseTs(ts);
    const output = serializeTs(file);
    expect(output.length % 188).toBe(0);
  });

  it('all output packets start with sync byte 0x47', () => {
    const ts = buildMinimalTs();
    const file = parseTs(ts);
    const output = serializeTs(file);
    for (let i = 0; i < output.length; i += 188) {
      expect(output[i]).toBe(0x47);
    }
  });

  it('round-trip semantic equivalence: parse → serialize → parse yields same PES count', () => {
    const ts = buildMinimalTs();
    const file1 = parseTs(ts);
    const serialized = serializeTs(file1);
    const file2 = parseTs(serialized);

    // Same number of PES packets
    expect(file2.pesPackets.length).toBe(file1.pesPackets.length);
  });

  it('round-trip preserves PTS values within rounding tolerance', () => {
    const ts = buildMinimalTs();
    const file1 = parseTs(ts);
    const serialized = serializeTs(file1);
    const file2 = parseTs(serialized);

    for (let i = 0; i < Math.min(file1.pesPackets.length, file2.pesPackets.length); i++) {
      const p1 = file1.pesPackets[i] as TsPesPacket;
      const p2 = file2.pesPackets[i] as TsPesPacket;
      if (p1.ptsUs !== undefined && p2.ptsUs !== undefined) {
        expect(Math.abs(p1.ptsUs - p2.ptsUs)).toBeLessThan(100);
      }
    }
  });

  it('round-trip preserves stream types in PMT', () => {
    const ts = buildMinimalTs();
    const file1 = parseTs(ts);
    const serialized = serializeTs(file1);
    const file2 = parseTs(serialized);

    const st1 = file1.program.streams.map((s) => s.streamType).sort();
    const st2 = file2.program.streams.map((s) => s.streamType).sort();
    expect(st2).toEqual(st1);
  });

  it('output PAT section has valid CRC-32', () => {
    const ts = buildMinimalTs();
    const file = parseTs(ts);
    const output = serializeTs(file);

    // Find the PAT packet (PID 0x0000)
    let patPayload: Uint8Array | null = null;
    for (let i = 0; i < output.length; i += 188) {
      const b1 = output[i + 1] as number;
      const b2 = output[i + 2] as number;
      const pid = ((b1 & 0x1f) << 8) | b2;
      if (pid === 0x0000) {
        const pusi = (b1 & 0x40) !== 0;
        if (pusi) {
          const pointer = output[i + 4] as number;
          patPayload = output.subarray(i + 5 + pointer, i + 188);
          break;
        }
      }
    }

    expect(patPayload).not.toBeNull();
    if (patPayload) {
      const sectionLen = (((patPayload[1] as number) & 0x0f) << 8) | (patPayload[2] as number);
      const totalLen = 3 + sectionLen;
      const section = patPayload.subarray(0, totalLen);
      const crcCheck = computePsiCrc32(section);
      expect(crcCheck).toBe(0); // CRC over complete section (including stored CRC) = 0
    }
  });

  it('does not mutate the input TsFile', () => {
    const ts = buildMinimalTs();
    const file = parseTs(ts);
    const originalPesCount = file.pesPackets.length;
    const originalStreamCount = file.program.streams.length;

    serializeTs(file);

    expect(file.pesPackets.length).toBe(originalPesCount);
    expect(file.program.streams.length).toBe(originalStreamCount);
  });
});
