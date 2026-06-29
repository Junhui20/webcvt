/**
 * Tests for boxes/sinf.ts — track encryption (CENC) signalling parsers.
 *
 * All fixtures are built programmatically; no binary files are committed.
 * Spec: ISO/IEC 23001-7:2016 §4, §8 + ISO/IEC 14496-12 (sinf/frma/schm/schi).
 */

import { describe, expect, it } from 'vitest';
import { MAX_SINF_CHILD_BOXES } from '../constants.ts';
import { Mp4ProtectionInvalidError } from '../errors.ts';
import { bytesToHex } from './pssh.ts';
import {
  findSinfPayload,
  parseSinf,
  parseStsdTrackProtection,
  sampleEntryChildStart,
} from './sinf.ts';

// ---------------------------------------------------------------------------
// Raw box builders
// ---------------------------------------------------------------------------

function fourCC(buf: Uint8Array, offset: number, s: string): void {
  for (let i = 0; i < 4; i++) {
    buf[offset + i] = (s.charCodeAt(i) ?? 0x20) & 0xff;
  }
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Wrap payloads in a full box (size(4) + type(4) + payload). */
function box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const total = payloads.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(8 + total);
  new DataView(out.buffer).setUint32(0, out.length, false);
  fourCC(out, 4, type);
  let off = 8;
  for (const p of payloads) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const DEFAULT_KID = new Uint8Array([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
]);
const DEFAULT_KID_HEX = bytesToHex(DEFAULT_KID);

function buildFrma(format = 'mp4a'): Uint8Array {
  const payload = new Uint8Array(4);
  fourCC(payload, 0, format);
  return box('frma', payload);
}

function buildSchm(schemeType = 'cenc', schemeVersion = 0x00010000): Uint8Array {
  const payload = new Uint8Array(12);
  fourCC(payload, 4, schemeType);
  new DataView(payload.buffer).setUint32(8, schemeVersion, false);
  return box('schm', payload);
}

interface TencOpts {
  version?: 0 | 1;
  isProtected?: boolean;
  ivSize?: number;
  kid?: Uint8Array;
  cryptByteBlock?: number;
  skipByteBlock?: number;
}

function buildTenc(opts: TencOpts = {}): Uint8Array {
  const version = opts.version ?? 0;
  // version+flags(4) + reserved(1) + reserved/pattern(1) + isProtected(1) + ivSize(1) + KID(16).
  const payload = new Uint8Array(24);
  payload[0] = version;
  if (version >= 1) {
    payload[5] = (((opts.cryptByteBlock ?? 0) & 0x0f) << 4) | ((opts.skipByteBlock ?? 0) & 0x0f);
  }
  payload[6] = opts.isProtected === false ? 0 : 1;
  payload[7] = opts.ivSize ?? 8;
  payload.set(opts.kid ?? DEFAULT_KID, 8);
  return box('tenc', payload);
}

interface SinfOpts {
  frma?: string;
  schemeType?: string;
  schemeVersion?: number;
  includeSchm?: boolean;
  includeSchi?: boolean;
  tenc?: TencOpts;
}

/** Build the `sinf` CONTENT bytes (after the 8-byte sinf header). */
function buildSinfContent(opts: SinfOpts = {}): Uint8Array {
  const parts: Uint8Array[] = [buildFrma(opts.frma ?? 'mp4a')];
  if (opts.includeSchm !== false) {
    parts.push(buildSchm(opts.schemeType ?? 'cenc', opts.schemeVersion ?? 0x00010000));
  }
  if (opts.includeSchi !== false) {
    parts.push(box('schi', buildTenc(opts.tenc ?? {})));
  }
  return concat(...parts);
}

/** Build a full stsd PAYLOAD (after the 8-byte stsd header) with one enca/encv entry. */
function buildProtectedStsd(opts: {
  entryType: 'enca' | 'encv';
  headerSize: number;
  sinf: SinfOpts;
  includeSinf?: boolean;
  /** A dummy leading child box (e.g. esds/avcC) before the sinf, to test skipping. */
  leadingChild?: Uint8Array;
}): Uint8Array {
  const header = new Uint8Array(opts.headerSize);
  header[7] = 1; // data_reference_index
  const children: Uint8Array[] = [];
  if (opts.leadingChild) children.push(opts.leadingChild);
  if (opts.includeSinf !== false) {
    children.push(box('sinf', buildSinfContent(opts.sinf)));
  }
  const entryPayload = concat(header, ...children);
  const entryBox = box(opts.entryType, entryPayload);
  const stsd = new Uint8Array(8 + entryBox.length);
  new DataView(stsd.buffer).setUint32(4, 1, false); // entry_count = 1
  stsd.set(entryBox, 8);
  return stsd;
}

// ---------------------------------------------------------------------------
// sampleEntryChildStart
// ---------------------------------------------------------------------------

describe('sampleEntryChildStart', () => {
  it('returns 78 for encv (VisualSampleEntry) and 28 for enca (AudioSampleEntry)', () => {
    expect(sampleEntryChildStart('encv')).toBe(78);
    expect(sampleEntryChildStart('enca')).toBe(28);
  });
});

// ---------------------------------------------------------------------------
// parseSinf
// ---------------------------------------------------------------------------

describe('parseSinf', () => {
  it('parses frma + schm + schi/tenc (v0)', () => {
    const scheme = parseSinf(buildSinfContent({ frma: 'mp4a', schemeType: 'cenc' }));
    expect(scheme.originalFormat).toBe('mp4a');
    expect(scheme.schemeType).toBe('cenc');
    expect(scheme.schemeVersion).toBe(0x00010000);
    expect(scheme.tenc).not.toBeNull();
    expect(scheme.tenc?.isProtected).toBe(true);
    expect(scheme.tenc?.perSampleIvSize).toBe(8);
    expect(scheme.tenc?.defaultKid).toBe(DEFAULT_KID_HEX);
    expect(scheme.tenc?.cryptByteBlock).toBe(0);
    expect(scheme.tenc?.skipByteBlock).toBe(0);
  });

  it('decodes the v1 tenc pattern (crypt/skip byte blocks)', () => {
    const scheme = parseSinf(
      buildSinfContent({
        schemeType: 'cbcs',
        tenc: { version: 1, cryptByteBlock: 1, skipByteBlock: 9, ivSize: 0 },
      }),
    );
    expect(scheme.schemeType).toBe('cbcs');
    expect(scheme.tenc?.cryptByteBlock).toBe(1);
    expect(scheme.tenc?.skipByteBlock).toBe(9);
    expect(scheme.tenc?.perSampleIvSize).toBe(0);
  });

  it('parses a sinf with frma only (no schm, no schi)', () => {
    const scheme = parseSinf(buildSinfContent({ includeSchm: false, includeSchi: false }));
    expect(scheme.originalFormat).toBe('mp4a');
    expect(scheme.schemeType).toBe('');
    expect(scheme.schemeVersion).toBe(0);
    expect(scheme.tenc).toBeNull();
  });

  it('treats a schi without tenc as no track-encryption defaults', () => {
    const sinf = concat(buildFrma('mp4a'), buildSchm('cenc'), box('schi'));
    const scheme = parseSinf(sinf);
    expect(scheme.tenc).toBeNull();
  });

  it('throws when frma (OriginalFormat) is missing', () => {
    const sinf = concat(buildSchm('cenc'), box('schi', buildTenc()));
    expect(() => parseSinf(sinf)).toThrow(Mp4ProtectionInvalidError);
  });

  it('throws when frma is too short', () => {
    const sinf = concat(box('frma', new Uint8Array(2)), buildSchm());
    expect(() => parseSinf(sinf)).toThrow(Mp4ProtectionInvalidError);
  });

  it('throws when schm is too short', () => {
    const sinf = concat(buildFrma('mp4a'), box('schm', new Uint8Array(4)));
    expect(() => parseSinf(sinf)).toThrow(Mp4ProtectionInvalidError);
  });

  it('throws when tenc is too short', () => {
    const sinf = concat(
      buildFrma('mp4a'),
      buildSchm(),
      box('schi', box('tenc', new Uint8Array(10))),
    );
    expect(() => parseSinf(sinf)).toThrow(Mp4ProtectionInvalidError);
  });

  it('throws when the subtree has too many child boxes', () => {
    const many: Uint8Array[] = [buildFrma('mp4a')];
    for (let i = 0; i <= MAX_SINF_CHILD_BOXES; i++) {
      many.push(box('free', new Uint8Array(0)));
    }
    expect(() => parseSinf(concat(...many))).toThrow(Mp4ProtectionInvalidError);
  });
});

// ---------------------------------------------------------------------------
// findSinfPayload
// ---------------------------------------------------------------------------

describe('findSinfPayload', () => {
  it('finds a sinf among enca children, skipping a leading box', () => {
    const header = new Uint8Array(28);
    const entryPayload = concat(
      header,
      box('esds', new Uint8Array(4)),
      box('sinf', buildSinfContent()),
    );
    const sinf = findSinfPayload('enca', entryPayload);
    expect(sinf).not.toBeNull();
  });

  it('returns null when there is no sinf', () => {
    const entryPayload = concat(new Uint8Array(28), box('esds', new Uint8Array(4)));
    expect(findSinfPayload('enca', entryPayload)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseStsdTrackProtection
// ---------------------------------------------------------------------------

describe('parseStsdTrackProtection', () => {
  it('returns a summary for an enca (audio) protected entry', () => {
    const stsd = buildProtectedStsd({
      entryType: 'enca',
      headerSize: 28,
      leadingChild: box('esds', new Uint8Array(4)),
      sinf: { frma: 'mp4a', schemeType: 'cenc', tenc: { ivSize: 16 } },
    });
    const prot = parseStsdTrackProtection(stsd, 7);
    expect(prot).not.toBeNull();
    expect(prot?.trackId).toBe(7);
    expect(prot?.schemeType).toBe('cenc');
    expect(prot?.originalFormat).toBe('mp4a');
    expect(prot?.isProtected).toBe(true);
    expect(prot?.perSampleIvSize).toBe(16);
    expect(prot?.defaultKid).toBe(DEFAULT_KID_HEX);
  });

  it('returns a summary for an encv (video) protected entry', () => {
    const stsd = buildProtectedStsd({
      entryType: 'encv',
      headerSize: 78,
      leadingChild: box('avcC', new Uint8Array(4)),
      sinf: { frma: 'avc1', schemeType: 'cbcs' },
    });
    const prot = parseStsdTrackProtection(stsd, 1);
    expect(prot?.schemeType).toBe('cbcs');
    expect(prot?.originalFormat).toBe('avc1');
    expect(prot?.isProtected).toBe(true);
  });

  it('returns null for an unencrypted (mp4a) sample entry', () => {
    const mp4aBox = box('mp4a', new Uint8Array(28));
    const stsd = new Uint8Array(8 + mp4aBox.length);
    new DataView(stsd.buffer).setUint32(4, 1, false);
    stsd.set(mp4aBox, 8);
    expect(parseStsdTrackProtection(stsd, 1)).toBeNull();
  });

  it('returns null for a too-short stsd payload', () => {
    expect(parseStsdTrackProtection(new Uint8Array(10), 1)).toBeNull();
  });

  it('omits defaultKid when the entry has no tenc box', () => {
    const stsd = buildProtectedStsd({
      entryType: 'enca',
      headerSize: 28,
      sinf: { includeSchi: false },
    });
    const prot = parseStsdTrackProtection(stsd, 3);
    expect(prot?.isProtected).toBe(false);
    expect(prot?.perSampleIvSize).toBe(0);
    expect(prot?.defaultKid).toBeUndefined();
  });

  it('throws when an enca/encv entry has no sinf box', () => {
    const stsd = buildProtectedStsd({
      entryType: 'enca',
      headerSize: 28,
      includeSinf: false,
      sinf: {},
    });
    expect(() => parseStsdTrackProtection(stsd, 1)).toThrow(Mp4ProtectionInvalidError);
  });

  it('throws when the enca entry size overruns the stsd payload', () => {
    const stsd = buildProtectedStsd({ entryType: 'enca', headerSize: 28, sinf: {} });
    // Inflate the entry size field so 8 + entrySize > stsd length.
    new DataView(stsd.buffer).setUint32(8, stsd.length, false);
    expect(() => parseStsdTrackProtection(stsd, 1)).toThrow(Mp4ProtectionInvalidError);
  });
});
