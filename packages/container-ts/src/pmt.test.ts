import { describe, expect, it } from 'vitest';
import { TsCorruptStreamError } from './errors.ts';
import { decodePmt } from './pmt.ts';
import type { TsPsiSection } from './psi.ts';

function makePsiSection(overrides: Partial<TsPsiSection>): TsPsiSection {
  return {
    tableId: 0x02,
    tableIdExtension: 0x0001,
    versionNumber: 0,
    currentNextIndicator: true,
    sectionNumber: 0,
    lastSectionNumber: 0,
    body: new Uint8Array(0),
    ...overrides,
  };
}

function buildPmtBody(opts: {
  pcrPid: number;
  streams: Array<{ streamType: number; pid: number }>;
}): Uint8Array {
  const { pcrPid, streams } = opts;
  // PMT body: PCR_PID(2) + program_info_length(2) + ES entries
  const size = 4 + streams.length * 5;
  const body = new Uint8Array(size);
  let off = 0;

  // PCR_PID
  body[off++] = 0xe0 | ((pcrPid >> 8) & 0x1f);
  body[off++] = pcrPid & 0xff;

  // program_info_length = 0
  body[off++] = 0xf0;
  body[off++] = 0x00;

  for (const stream of streams) {
    body[off++] = stream.streamType & 0xff;
    body[off++] = 0xe0 | ((stream.pid >> 8) & 0x1f);
    body[off++] = stream.pid & 0xff;
    // ES_info_length = 0
    body[off++] = 0xf0;
    body[off++] = 0x00;
  }

  return body;
}

describe('decodePmt', () => {
  it('parses PMT and extracts video PID + audio PID with stream types 0x1B and 0x0F', () => {
    const body = buildPmtBody({
      pcrPid: 0x0100,
      streams: [
        { streamType: 0x1b, pid: 0x0100 },
        { streamType: 0x0f, pid: 0x0101 },
      ],
    });

    const section = makePsiSection({ body, tableIdExtension: 1 });
    const program = decodePmt(section, 0x1000);

    expect(program.pcrPid).toBe(0x0100);
    expect(program.streams).toHaveLength(2);

    const video = program.streams.find((s) => s.pid === 0x0100);
    const audio = program.streams.find((s) => s.pid === 0x0101);

    expect(video?.streamType).toBe(0x1b);
    expect(video?.unsupported).toBe(false);
    expect(audio?.streamType).toBe(0x0f);
    expect(audio?.unsupported).toBe(false);
  });

  it('marks unsupported stream types (e.g. 0x81 AC-3) as unsupported=true without throwing', () => {
    const body = buildPmtBody({
      pcrPid: 0x0100,
      streams: [
        { streamType: 0x1b, pid: 0x0100 },
        { streamType: 0x81, pid: 0x0102 }, // AC-3 — deferred
      ],
    });

    const section = makePsiSection({ body });
    const program = decodePmt(section, 0x1000);

    const ac3 = program.streams.find((s) => s.streamType === 0x81);
    expect(ac3).toBeDefined();
    expect(ac3?.unsupported).toBe(true);
  });

  it('marks HEVC (0x24), MPEG-2 video (0x02), private PES (0x06) as unsupported', () => {
    const body = buildPmtBody({
      pcrPid: 0x0100,
      streams: [
        { streamType: 0x24, pid: 0x0100 },
        { streamType: 0x02, pid: 0x0101 },
        { streamType: 0x06, pid: 0x0102 },
      ],
    });

    const section = makePsiSection({ body });
    const program = decodePmt(section, 0x1000);

    for (const stream of program.streams) {
      expect(stream.unsupported).toBe(true);
    }
  });

  it('throws TsCorruptStreamError if table_id is not 0x02', () => {
    const body = buildPmtBody({ pcrPid: 0x100, streams: [] });
    const section = makePsiSection({ tableId: 0x00, body });
    expect(() => decodePmt(section, 0x1000)).toThrow(TsCorruptStreamError);
  });

  it('throws TsCorruptStreamError when body is too short', () => {
    const section = makePsiSection({ body: new Uint8Array(2) });
    expect(() => decodePmt(section, 0x1000)).toThrow(TsCorruptStreamError);
  });

  it('masks reserved bits from program_info_length (Trap #14)', () => {
    const body = buildPmtBody({
      pcrPid: 0x0100,
      streams: [{ streamType: 0x1b, pid: 0x0100 }],
    });
    // Set reserved upper bits in program_info_length (should be masked with 0x0FFF)
    body[2] = 0xff; // reserved bits set, program_info_length high nibble = 0xf → masked to 0x0
    body[3] = 0x00; // program_info_length = 0
    const section = makePsiSection({ body });
    // Should not throw — reserved bits masked off
    expect(() => decodePmt(section, 0x1000)).not.toThrow();
  });

  it('masks reserved bits from ES_info_length (Trap #14)', () => {
    const body = buildPmtBody({
      pcrPid: 0x0100,
      streams: [{ streamType: 0x1b, pid: 0x0100 }],
    });
    // Set reserved bits in ES_info_length (offset 4+3 and 4+4)
    body[4 + 3] = 0xf0; // reserved=0b1111, ES_info_length high = 0
    body[4 + 4] = 0x00; // ES_info_length = 0
    const section = makePsiSection({ body });
    expect(() => decodePmt(section, 0x1000)).not.toThrow();
    const prog = decodePmt(section, 0x1000);
    expect(prog.streams).toHaveLength(1);
  });

  it('stores pmtPid from parameter', () => {
    const body = buildPmtBody({ pcrPid: 0x0100, streams: [] });
    const section = makePsiSection({ body });
    const program = decodePmt(section, 0x1000);
    expect(program.pmtPid).toBe(0x1000);
  });

  // Q-M-2 regression: program_info_length clamp when value exceeds remaining body bytes (Trap §14)
  it('clamps program_info_length when it exceeds remaining body bytes (Q-M-2)', () => {
    // Build a body where the raw (masked) program_info_length field is set to 0x3FF (1023 bytes)
    // but the body is only 4 + 5 bytes (minimal with one stream entry).
    // The clamp at Math.min(programInfoLength, body.length - 4) must fire.
    const body = buildPmtBody({
      pcrPid: 0x0100,
      streams: [{ streamType: 0x1b, pid: 0x0100 }],
    });

    // Override bytes [2..3]: reserved upper nibble set, program_info_length = 0x3FF
    // Mask in decodePmt: 0x0FFF → 0x03FF = 1023, which exceeds body.length - 4 = 5
    body[2] = 0xf3; // reserved nibble 0xF | high bits of 0x3FF = 0x3 → byte = 0xF3
    body[3] = 0xff; // low byte of 0x3FF = 0xFF

    const section = makePsiSection({ body });
    // Should not throw — clamp fires and esLoopStart is clamped to body.length
    const program = decodePmt(section, 0x1000);
    // With clamp, esLoopStart = 4 + (body.length - 4) = body.length, so no ES streams parsed
    expect(program.streams).toHaveLength(0);
    expect(program.pcrPid).toBe(0x0100);
  });
});
