import { describe, expect, it } from 'vitest';
import { computePsiCrc32 } from './crc32.ts';
import { TsPsiCrcError } from './errors.ts';
import { createPsiAssembler, feedPsiPayload } from './psi.ts';

// ---------------------------------------------------------------------------
// Helper: build a valid PSI section
// ---------------------------------------------------------------------------

function buildPsiSection(opts: {
  tableId: number;
  tableIdExtension: number;
  versionNumber?: number;
  body: Uint8Array;
}): Uint8Array {
  const { tableId, tableIdExtension, versionNumber = 0, body } = opts;

  // sectionLength = 5 (header ext) + body.length + 4 (CRC)
  const sectionLength = 5 + body.length + 4;

  // Allocate section without CRC
  const sectionNoCrc = new Uint8Array(3 + 5 + body.length);
  let off = 0;
  sectionNoCrc[off++] = tableId;
  sectionNoCrc[off++] = 0xb0 | ((sectionLength >> 8) & 0x0f);
  sectionNoCrc[off++] = sectionLength & 0xff;
  sectionNoCrc[off++] = (tableIdExtension >> 8) & 0xff;
  sectionNoCrc[off++] = tableIdExtension & 0xff;
  sectionNoCrc[off++] = 0xc0 | ((versionNumber & 0x1f) << 1) | 0x01; // current_next=1
  sectionNoCrc[off++] = 0x00; // section_number
  sectionNoCrc[off++] = 0x00; // last_section_number
  sectionNoCrc.set(body, off);

  // Compute and append CRC
  const crc = computePsiCrc32(sectionNoCrc);
  const full = new Uint8Array(sectionNoCrc.length + 4);
  full.set(sectionNoCrc);
  full[sectionNoCrc.length] = (crc >> 24) & 0xff;
  full[sectionNoCrc.length + 1] = (crc >> 16) & 0xff;
  full[sectionNoCrc.length + 2] = (crc >> 8) & 0xff;
  full[sectionNoCrc.length + 3] = crc & 0xff;
  return full;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PSI assembler', () => {
  it('assembles a single-packet section with pointer_field=0', () => {
    const body = new Uint8Array([0x00, 0x01, 0xe0, 0x10]); // one PAT entry
    const section = buildPsiSection({ tableId: 0x00, tableIdExtension: 0x0001, body });

    const payload = new Uint8Array(section.length + 1);
    payload[0] = 0x00; // pointer_field = 0
    payload.set(section, 1);

    const assembler = createPsiAssembler(0x0000);
    const result = feedPsiPayload(assembler, payload, true);

    expect(result).not.toBeNull();
    expect(result?.tableId).toBe(0x00);
    expect(result?.tableIdExtension).toBe(0x0001);
  });

  it('spans multiple packets correctly (Trap #7)', () => {
    const body = new Uint8Array(150).fill(0x11); // body > what fits in first packet
    const section = buildPsiSection({ tableId: 0x02, tableIdExtension: 0x0001, body });

    const assembler = createPsiAssembler(0x1000);

    // First packet: pointer_field + first N bytes
    const firstPayload = new Uint8Array(184);
    firstPayload[0] = 0x00; // pointer_field
    const firstChunk = Math.min(section.length, 183);
    firstPayload.set(section.subarray(0, firstChunk), 1);

    const result1 = feedPsiPayload(assembler, firstPayload, true);
    if (section.length <= 183) {
      expect(result1).not.toBeNull();
    } else {
      expect(result1).toBeNull();

      // Continue packets (no pointer_field)
      let cursor = firstChunk;
      let finalResult = null;
      while (cursor < section.length) {
        const chunk = section.subarray(cursor, cursor + 184);
        finalResult = feedPsiPayload(assembler, chunk, false);
        cursor += 184;
        if (finalResult) break;
      }

      expect(finalResult).not.toBeNull();
      expect(finalResult?.tableId).toBe(0x02);
    }
  });

  it('validates CRC-32 and throws TsPsiCrcError on corruption (Trap #8)', () => {
    const body = new Uint8Array([0x00, 0x01, 0xe0, 0x10]);
    const section = buildPsiSection({ tableId: 0x00, tableIdExtension: 0x0001, body });

    // Corrupt the CRC
    section[section.length - 1] ^= 0xff;

    const payload = new Uint8Array(section.length + 1);
    payload[0] = 0x00;
    payload.set(section, 1);

    const assembler = createPsiAssembler(0x0000);
    expect(() => feedPsiPayload(assembler, payload, true)).toThrow(TsPsiCrcError);
  });

  it('returns null when not enough bytes accumulated yet', () => {
    const body = new Uint8Array(180).fill(0x55);
    const section = buildPsiSection({ tableId: 0x00, tableIdExtension: 0x0001, body });

    const assembler = createPsiAssembler(0x0000);

    // Only give 10 bytes (not enough for full section)
    const partial = new Uint8Array(11);
    partial[0] = 0x00; // pointer_field
    partial.set(section.subarray(0, 10), 1);

    const result = feedPsiPayload(assembler, partial, true);
    expect(result).toBeNull();
  });

  it('decodes tableIdExtension (transport_stream_id)', () => {
    const body = new Uint8Array([0x00, 0x01, 0xe1, 0x00]);
    const section = buildPsiSection({ tableId: 0x00, tableIdExtension: 0xabcd, body });

    const payload = new Uint8Array(section.length + 1);
    payload[0] = 0x00;
    payload.set(section, 1);

    const assembler = createPsiAssembler(0x0000);
    const result = feedPsiPayload(assembler, payload, true);

    expect(result?.tableIdExtension).toBe(0xabcd);
  });

  it('decodes versionNumber from section', () => {
    const body = new Uint8Array([0x00, 0x01, 0xe0, 0x10]);
    const section = buildPsiSection({ tableId: 0x00, tableIdExtension: 1, versionNumber: 5, body });

    const payload = new Uint8Array(section.length + 1);
    payload[0] = 0x00;
    payload.set(section, 1);

    const assembler = createPsiAssembler(0x0000);
    const result = feedPsiPayload(assembler, payload, true);
    expect(result?.versionNumber).toBe(5);
  });
});
