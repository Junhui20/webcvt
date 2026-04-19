import { describe, expect, it } from 'vitest';
import { TsCorruptStreamError, TsMultiProgramNotSupportedError } from './errors.ts';
import { decodePat } from './pat.ts';
import type { TsPsiSection } from './psi.ts';

function makePsiSection(overrides: Partial<TsPsiSection>): TsPsiSection {
  return {
    tableId: 0x00,
    tableIdExtension: 0x0001,
    versionNumber: 0,
    currentNextIndicator: true,
    sectionNumber: 0,
    lastSectionNumber: 0,
    body: new Uint8Array(0),
    ...overrides,
  };
}

describe('decodePat', () => {
  it('parses PAT at PID 0x0000 with single program', () => {
    // Body: program_number(2) + reserved(3)+pmtPid(13) = 4 bytes per entry
    const body = new Uint8Array([0x00, 0x01, 0xe1, 0x00]); // program 1, PMT PID 0x100
    const section = makePsiSection({ tableId: 0x00, tableIdExtension: 0x1234, body });

    const pat = decodePat(section);
    expect(pat.transportStreamId).toBe(0x1234);
    expect(pat.entries).toHaveLength(1);
    expect(pat.entries[0]?.programNumber).toBe(1);
    expect(pat.entries[0]?.pid).toBe(0x100);
  });

  it('skips program_number=0 (NIT pointer)', () => {
    // NIT (program_number=0) followed by one real program
    const body = new Uint8Array([
      0x00,
      0x00,
      0xe0,
      0x10, // program 0 (NIT) pointing to PID 0x10
      0x00,
      0x01,
      0xe1,
      0x00, // program 1, PMT PID 0x100
    ]);
    const section = makePsiSection({ body });

    const pat = decodePat(section);
    expect(pat.entries).toHaveLength(1);
    expect(pat.entries[0]?.programNumber).toBe(1);
  });

  it('rejects PAT with two non-zero programs (TsMultiProgramNotSupportedError)', () => {
    const body = new Uint8Array([
      0x00,
      0x01,
      0xe1,
      0x00, // program 1
      0x00,
      0x02,
      0xe2,
      0x00, // program 2
    ]);
    const section = makePsiSection({ body });

    expect(() => decodePat(section)).toThrow(TsMultiProgramNotSupportedError);
  });

  it('throws TsCorruptStreamError if table_id is not 0x00', () => {
    const section = makePsiSection({ tableId: 0x02, body: new Uint8Array(4) });
    expect(() => decodePat(section)).toThrow(TsCorruptStreamError);
  });

  it('handles empty body (zero programs) gracefully', () => {
    const section = makePsiSection({ body: new Uint8Array(0) });
    const pat = decodePat(section);
    expect(pat.entries).toHaveLength(0);
  });

  it('extracts versionNumber from section', () => {
    const body = new Uint8Array([0x00, 0x01, 0xe1, 0x00]);
    const section = makePsiSection({ body, versionNumber: 3 });
    const pat = decodePat(section);
    expect(pat.versionNumber).toBe(3);
  });
});
