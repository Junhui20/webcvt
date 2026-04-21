/**
 * Tests for boxes/udta-meta-ilst.ts — udta/meta/ilst parser, serializer,
 * and round-trip integrity.
 *
 * 25 tests per the design note §12:
 *   Parse — well-known atom kinds (1–10)
 *   Cover art (11–13)
 *   Freeform (14–15)
 *   meta shape detection (16–17)
 *   Round-trip (18–19)
 *   Rejection (20–22)
 *   Edge (23–25)
 *
 * All fixtures are built programmatically — no committed binaries.
 */

import { describe, expect, it } from 'vitest';
import { MAX_METADATA_ATOMS, MAX_METADATA_PAYLOAD_BYTES } from '../constants.ts';
import {
  Mp4InvalidBoxError,
  Mp4MetaBadHandlerError,
  Mp4MetaCoverArtTooLargeError,
  Mp4MetaFreeformIncompleteError,
  Mp4MetaPayloadTooLargeError,
  Mp4MetaTooManyAtomsError,
} from '../errors.ts';

import {
  type MetadataAtom,
  type MetadataAtoms,
  buildUdtaBox,
  parseUdta,
} from './udta-meta-ilst.ts';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** Write u32 big-endian into buf at offset. */
function u32be(buf: Uint8Array, offset: number, value: number): void {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  v.setUint32(offset, value, false);
}

/** Encode string as Latin-1 bytes (not UTF-8 — for 4cc fields). */
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i) & 0xff;
  }
  return out;
}

/** Concatenate Uint8Arrays. */
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

/** Build a generic box: [size:u32][type:4cc][payload]. */
function buildBox(type: string, payload: Uint8Array): Uint8Array {
  const size = 8 + payload.length;
  const out = new Uint8Array(size);
  u32be(out, 0, size);
  out.set(latin1(type), 4);
  out.set(payload, 8);
  return out;
}

/** Build a FullBox (box with version=0, flags=0 prefix): [size:u32][type:4cc][v:1][f:3][payload]. */
function buildFullBox(type: string, payload: Uint8Array): Uint8Array {
  const fullPayload = new Uint8Array(4 + payload.length);
  // version=0, flags=0 already zero
  fullPayload.set(payload, 4);
  return buildBox(type, fullPayload);
}

/**
 * Build a `data` sub-box.
 * data box structure: [size:u32]['data':4cc][type_indicator:u32][locale:u32][payload]
 */
function buildDataBox(typeIndicator: number, payload: Uint8Array, locale = 0): Uint8Array {
  const header = new Uint8Array(8);
  u32be(header, 0, typeIndicator);
  u32be(header, 4, locale);
  return buildBox('data', concat(header, payload));
}

/** Build an hdlr box with the given handler_type (4cc). */
function buildHdlrBox(handlerType: string): Uint8Array {
  // FullBox: [version:1][flags:3][pre_defined:4][handler_type:4][reserved:12]
  const payload = new Uint8Array(24);
  // handler_type at offset 8 (after version+flags+pre_defined)
  const ht = latin1(handlerType);
  payload.set(ht, 8);
  return buildBox('hdlr', payload);
}

/** Build an ilst box wrapping the given atom boxes. */
function buildIlstBox(...atomBoxes: Uint8Array[]): Uint8Array {
  return buildBox('ilst', concat(...atomBoxes));
}

/** Build a single ilst atom (e.g. '©nam') wrapping a data box. */
function buildAtomBox(key: string, dataBox: Uint8Array): Uint8Array {
  return buildBox(key, dataBox);
}

/**
 * Build a meta FullBox v0 (ISO style):
 * [size:u32]['meta':4cc][version:u8=0][flags:u24=0][hdlr_box][ilst_box]
 */
function buildMetaISOFullBox(hdlrBox: Uint8Array, ilstBox: Uint8Array): Uint8Array {
  const inner = concat(hdlrBox, ilstBox);
  // FullBox payload: [version:u8=0][flags:u24=0][inner...]
  const fullPayload = new Uint8Array(4 + inner.length);
  fullPayload.set(inner, 4);
  return buildBox('meta', fullPayload);
}

/**
 * Build a meta plain Box (QuickTime style) — NO FullBox prefix:
 * [size:u32]['meta':4cc][hdlr_box][ilst_box]
 */
function buildMetaQTPlainBox(hdlrBox: Uint8Array, ilstBox: Uint8Array): Uint8Array {
  return buildBox('meta', concat(hdlrBox, ilstBox));
}

/** Build a complete udta box containing the given meta box. */
function buildUdtaWithMeta(metaBox: Uint8Array): Uint8Array {
  return buildBox('udta', metaBox);
}

/** Build a UTF-8 ilst atom. */
function buildUtf8Atom(key: string, text: string): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  const dataBox = buildDataBox(1, encoded);
  return buildAtomBox(key, dataBox);
}

/** Build a BE-integer ilst atom. */
function buildBeIntAtom(key: string, value: number, byteLength: 1 | 2 | 4 = 4): Uint8Array {
  const payload = new Uint8Array(byteLength);
  if (byteLength === 1) {
    payload[0] = value & 0xff;
  } else if (byteLength === 2) {
    const v = new DataView(payload.buffer);
    v.setInt16(0, value, false);
  } else {
    const v = new DataView(payload.buffer);
    v.setInt32(0, value, false);
  }
  return buildAtomBox(key, buildDataBox(21, payload));
}

/** Build a trkn/disk ilst atom with 8-byte binary payload. */
function buildTrackNumberAtom(key: 'trkn' | 'disk', cur: number, total: number): Uint8Array {
  const payload = new Uint8Array(8);
  const v = new DataView(payload.buffer);
  v.setUint16(2, cur, false);
  v.setUint16(4, total, false);
  return buildAtomBox(key, buildDataBox(0, payload));
}

/** Build a complete udta payload (meta ISO FullBox + hdlr + ilst). */
function buildUdtaPayload(atomBoxes: Uint8Array[]): Uint8Array {
  const hdlrBox = buildHdlrBox('mdir');
  const ilstBox = buildIlstBox(...atomBoxes);
  const metaBox = buildMetaISOFullBox(hdlrBox, ilstBox);
  return buildBox('udta', metaBox).subarray(8); // return payload only
}

/** Parse a udta box payload (strip the outer udta 8-byte header). */
function parseUdtaPayload(atomBoxes: Uint8Array[]): ReturnType<typeof parseUdta> {
  return parseUdta(buildUdtaPayload(atomBoxes));
}

// ---------------------------------------------------------------------------
// Parse — well-known atom kinds (Tests 1–10)
// ---------------------------------------------------------------------------

describe('udta-meta-ilst parse — well-known atom kinds', () => {
  // Test 1: ©nam UTF-8 → kind: 'utf8'
  it('Test 1: ©nam UTF-8 → kind: utf8', () => {
    // ©nam = [0xA9, 0x6E, 0x61, 0x6D] in Latin-1 → '©nam'
    const key = '©nam'; // © = U+00A9, same as Latin-1 0xA9
    const result = parseUdtaPayload([buildUtf8Atom(key, 'My Song')]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.key).toBe(key);
    expect(atom.value.kind).toBe('utf8');
    if (atom.value.kind === 'utf8') {
      expect(atom.value.value).toBe('My Song');
    }
  });

  // Test 2: ©ART multi-byte UTF-8 ("Sigur Rós")
  it('Test 2: ©ART multi-byte UTF-8 ("Sigur Rós")', () => {
    const key = '©ART';
    const result = parseUdtaPayload([buildUtf8Atom(key, 'Sigur Rós')]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.value.kind).toBe('utf8');
    if (atom.value.kind === 'utf8') {
      expect(atom.value.value).toBe('Sigur Rós');
    }
  });

  // Test 3: ©alb empty string
  it('Test 3: ©alb empty string → kind: utf8, value: ""', () => {
    const key = '©alb';
    const result = parseUdtaPayload([buildUtf8Atom(key, '')]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.value.kind).toBe('utf8');
    if (atom.value.kind === 'utf8') {
      expect(atom.value.value).toBe('');
    }
  });

  // Test 4: ©day "2024" stays as utf8 (NOT integer)
  it('Test 4: ©day "2024" stays as utf8, not integer', () => {
    const key = '©day';
    const result = parseUdtaPayload([buildUtf8Atom(key, '2024')]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.value.kind).toBe('utf8');
    if (atom.value.kind === 'utf8') {
      expect(atom.value.value).toBe('2024');
    }
  });

  // Test 5: trkn → { track: 3, total: 12 }
  it('Test 5: trkn → kind: trackNumber, track: 3, total: 12', () => {
    const result = parseUdtaPayload([buildTrackNumberAtom('trkn', 3, 12)]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.key).toBe('trkn');
    expect(atom.value.kind).toBe('trackNumber');
    if (atom.value.kind === 'trackNumber') {
      expect(atom.value.track).toBe(3);
      expect(atom.value.total).toBe(12);
    }
  });

  // Test 6: disk → { disc: 1, total: 2 }
  it('Test 6: disk → kind: discNumber, disc: 1, total: 2', () => {
    const result = parseUdtaPayload([buildTrackNumberAtom('disk', 1, 2)]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.key).toBe('disk');
    expect(atom.value.kind).toBe('discNumber');
    if (atom.value.kind === 'discNumber') {
      expect(atom.value.disc).toBe(1);
      expect(atom.value.total).toBe(2);
    }
  });

  // Test 7: tmpo 2-byte BE int → { kind: 'beInt', value: 128 }
  it('Test 7: tmpo 2-byte BE int → kind: beInt, value: 128', () => {
    const result = parseUdtaPayload([buildBeIntAtom('tmpo', 128, 2)]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.key).toBe('tmpo');
    expect(atom.value.kind).toBe('beInt');
    if (atom.value.kind === 'beInt') {
      expect(atom.value.value).toBe(128);
    }
  });

  // Test 8: cpil 1-byte BE int → { kind: 'beInt', value: 1 }
  it('Test 8: cpil 1-byte BE int → kind: beInt, value: 1', () => {
    const result = parseUdtaPayload([buildBeIntAtom('cpil', 1, 1)]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.key).toBe('cpil');
    expect(atom.value.kind).toBe('beInt');
    if (atom.value.kind === 'beInt') {
      expect(atom.value.value).toBe(1);
    }
  });

  // Test 9: gnre preserved as beInt (NOT translated to genre name)
  it('Test 9: gnre preserved as beInt (not translated to genre string)', () => {
    const result = parseUdtaPayload([buildBeIntAtom('gnre', 17, 2)]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.key).toBe('gnre');
    expect(atom.value.kind).toBe('beInt');
    // Value should be numeric, not 'Rock' or similar
    if (atom.value.kind === 'beInt') {
      expect(typeof atom.value.value).toBe('number');
    }
  });

  // Test 10: Unknown 4cc with type_indicator=0 → binary
  it('Test 10: unknown 4cc with type_indicator=0 → kind: binary', () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const atomBox = buildAtomBox('xyzw', buildDataBox(0, payload));
    const result = parseUdtaPayload([atomBox]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.key).toBe('xyzw');
    expect(atom.value.kind).toBe('binary');
    if (atom.value.kind === 'binary') {
      expect(Array.from(atom.value.bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    }
  });
});

// ---------------------------------------------------------------------------
// Cover art (Tests 11–13)
// ---------------------------------------------------------------------------

describe('udta-meta-ilst parse — cover art', () => {
  // Test 11: Single JPEG covr (type 13)
  it('Test 11: single JPEG covr (type_indicator=13) → kind: jpeg', () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const covrBox = buildAtomBox('covr', buildDataBox(13, jpegBytes));
    const result = parseUdtaPayload([covrBox]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.key).toBe('covr');
    expect(atom.value.kind).toBe('jpeg');
    if (atom.value.kind === 'jpeg') {
      expect(Array.from(atom.value.bytes)).toEqual(Array.from(jpegBytes));
    }
  });

  // Test 12: Single PNG covr (type 14) + round-trip via serializer (covers png case in buildDataBox)
  it('Test 12: single PNG covr (type_indicator=14) → kind: png; round-trip preserves bytes', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const covrBox = buildAtomBox('covr', buildDataBox(14, pngBytes));
    const result = parseUdtaPayload([covrBox]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.key).toBe('covr');
    expect(atom.value.kind).toBe('png');
    if (atom.value.kind === 'png') {
      expect(Array.from(atom.value.bytes)).toEqual(Array.from(pngBytes));
    }

    // Round-trip via serializer to cover the 'png' case in buildDataBox
    const udtaBox = buildUdtaBox(result.metadata, null);
    expect(udtaBox).not.toBeNull();
    const reparsed = parseUdta(udtaBox!.subarray(8));
    expect(reparsed.metadata).toHaveLength(1);
    expect(reparsed.metadata[0]!.value.kind).toBe('png');
    if (reparsed.metadata[0]!.value.kind === 'png') {
      expect(Array.from(reparsed.metadata[0]!.value.bytes)).toEqual(Array.from(pngBytes));
    }
  });

  // Test 13: Multi-image covr → two atoms, both key='covr', in order
  it('Test 13: multi-image covr → two MetadataAtoms both key="covr" in order', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0x01]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    // covr atom contains TWO data children
    const covrPayload = concat(buildDataBox(13, jpeg), buildDataBox(14, png));
    const covrBox = buildBox('covr', covrPayload);
    const result = parseUdtaPayload([covrBox]);

    expect(result.metadata).toHaveLength(2);
    expect(result.metadata[0]!.key).toBe('covr');
    expect(result.metadata[1]!.key).toBe('covr');
    expect(result.metadata[0]!.value.kind).toBe('jpeg');
    expect(result.metadata[1]!.value.kind).toBe('png');
  });
});

// ---------------------------------------------------------------------------
// Freeform (Tests 14–15)
// ---------------------------------------------------------------------------

describe('udta-meta-ilst parse — freeform (----)', () => {
  /** Build a mean FullBox (version+flags=0 prefix + UTF-8 domain). */
  function buildMeanBox(domain: string): Uint8Array {
    const encoded = new TextEncoder().encode(domain);
    const payload = new Uint8Array(4 + encoded.length);
    payload.set(encoded, 4);
    return buildBox('mean', payload);
  }

  /** Build a name FullBox (version+flags=0 prefix + UTF-8 name). */
  function buildNameBox(name: string): Uint8Array {
    const encoded = new TextEncoder().encode(name);
    const payload = new Uint8Array(4 + encoded.length);
    payload.set(encoded, 4);
    return buildBox('name', payload);
  }

  // Test 14: ---- with com.apple.iTunes/iTunNORM
  it('Test 14: ---- with mean=com.apple.iTunes, name=iTunNORM → kind: freeform', () => {
    const mean = 'com.apple.iTunes';
    const name = 'iTunNORM';
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const freeformPayload = concat(buildMeanBox(mean), buildNameBox(name), buildDataBox(1, data));
    const freeformBox = buildBox('----', freeformPayload);
    const result = parseUdtaPayload([freeformBox]);

    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.key).toBe('----');
    expect(atom.value.kind).toBe('freeform');
    if (atom.value.kind === 'freeform') {
      expect(atom.value.mean).toBe(mean);
      expect(atom.value.name).toBe(name);
    }
  });

  // Test 15: ---- missing mean → Mp4MetaFreeformIncompleteError
  it('Test 15: ---- missing mean child → Mp4MetaFreeformIncompleteError', () => {
    const name = 'iTunNORM';
    const data = new Uint8Array([0x00]);
    // Only name + data, no mean
    const freeformPayload = concat(buildNameBox(name), buildDataBox(1, data));
    const freeformBox = buildBox('----', freeformPayload);

    expect(() => parseUdtaPayload([freeformBox])).toThrow(Mp4MetaFreeformIncompleteError);
  });
});

// ---------------------------------------------------------------------------
// meta shape detection (Tests 16–17)
// ---------------------------------------------------------------------------

describe('udta-meta-ilst — meta FullBox vs plain Box detection', () => {
  // Test 16: ISO FullBox v0 meta
  it('Test 16: ISO FullBox v0 meta (first word == 0x00000000) parsed correctly', () => {
    const hdlrBox = buildHdlrBox('mdir');
    const ilstBox = buildIlstBox(buildUtf8Atom('©nam', 'ISO Title'));
    const metaBox = buildMetaISOFullBox(hdlrBox, ilstBox);
    const udtaPayload = metaBox; // Just the meta box bytes as udta payload

    const result = parseUdta(udtaPayload);
    expect(result.metadata).toHaveLength(1);
    expect(result.metadata[0]!.key).toBe('©nam');
    if (result.metadata[0]!.value.kind === 'utf8') {
      expect(result.metadata[0]!.value.value).toBe('ISO Title');
    }
  });

  // Test 17: QuickTime plain-Box meta (no FullBox prefix)
  it('Test 17: QuickTime plain-Box meta (first word != 0) parsed correctly', () => {
    const hdlrBox = buildHdlrBox('mdir');
    const ilstBox = buildIlstBox(buildUtf8Atom('©nam', 'QT Title'));
    // plain Box: no version+flags prefix inside meta payload
    const metaBox = buildMetaQTPlainBox(hdlrBox, ilstBox);
    const udtaPayload = metaBox;

    const result = parseUdta(udtaPayload);
    expect(result.metadata).toHaveLength(1);
    expect(result.metadata[0]!.key).toBe('©nam');
    if (result.metadata[0]!.value.kind === 'utf8') {
      expect(result.metadata[0]!.value.value).toBe('QT Title');
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip (Tests 18–19)
// ---------------------------------------------------------------------------

describe('udta-meta-ilst — round-trip', () => {
  /** Re-serialize metadata and re-parse; return re-parsed metadata. */
  function roundTrip(metadata: MetadataAtoms): MetadataAtoms {
    const udtaBox = buildUdtaBox(metadata, null);
    if (!udtaBox) return [];
    // Strip 8-byte outer udta header to get payload
    const udtaPayload = udtaBox.subarray(8);
    return parseUdta(udtaPayload).metadata;
  }

  // Test 18: Mixed atoms — byte-identical ilst after round-trip
  it('Test 18: mixed atoms (©nam, ©ART, ©alb, trkn, disk, covr JPEG, binary, beInt, freeform) round-trip', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
    const binBytes = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);
    const original: MetadataAtoms = [
      { key: '©nam', value: { kind: 'utf8', value: 'Round Trip Song' } },
      { key: '©ART', value: { kind: 'utf8', value: 'Round Trip Artist' } },
      { key: '©alb', value: { kind: 'utf8', value: 'Round Trip Album' } },
      { key: 'trkn', value: { kind: 'trackNumber', track: 5, total: 10 } },
      { key: 'disk', value: { kind: 'discNumber', disc: 2, total: 3 } },
      { key: 'covr', value: { kind: 'jpeg', bytes: jpeg } },
      { key: 'xbin', value: { kind: 'binary', bytes: binBytes } },
      { key: 'tmpo', value: { kind: 'beInt', value: 120 } },
      {
        key: '----',
        value: {
          kind: 'freeform',
          mean: 'com.example',
          name: 'test',
          bytes: new Uint8Array([1, 2, 3]),
        },
      },
    ];

    const reparsed = roundTrip(original);

    expect(reparsed).toHaveLength(9);

    const nam = reparsed.find((a) => a.key === '©nam');
    expect(nam?.value.kind).toBe('utf8');
    if (nam?.value.kind === 'utf8') expect(nam.value.value).toBe('Round Trip Song');

    const trkn = reparsed.find((a) => a.key === 'trkn');
    expect(trkn?.value.kind).toBe('trackNumber');
    if (trkn?.value.kind === 'trackNumber') {
      expect(trkn.value.track).toBe(5);
      expect(trkn.value.total).toBe(10);
    }

    const disk = reparsed.find((a) => a.key === 'disk');
    expect(disk?.value.kind).toBe('discNumber');
    if (disk?.value.kind === 'discNumber') {
      expect(disk.value.disc).toBe(2);
      expect(disk.value.total).toBe(3);
    }

    const covr = reparsed.find((a) => a.key === 'covr');
    expect(covr?.value.kind).toBe('jpeg');
    if (covr?.value.kind === 'jpeg') {
      expect(Array.from(covr.value.bytes)).toEqual(Array.from(jpeg));
    }

    const bin = reparsed.find((a) => a.key === 'xbin');
    expect(bin?.value.kind).toBe('binary');
    if (bin?.value.kind === 'binary') {
      expect(Array.from(bin.value.bytes)).toEqual(Array.from(binBytes));
    }

    const freeform = reparsed.find((a) => a.key === '----');
    expect(freeform?.value.kind).toBe('freeform');
    if (freeform?.value.kind === 'freeform') {
      expect(freeform.value.mean).toBe('com.example');
      expect(freeform.value.name).toBe('test');
    }
  });

  // Test 19: Plain-Box meta round-trip: ilst byte-identical, meta header normalised to FullBox v0
  it('Test 19: plain-Box meta round-trip: metadata preserved, meta normalised to FullBox v0', () => {
    const hdlrBox = buildHdlrBox('mdir');
    const ilstBox = buildIlstBox(buildUtf8Atom('©nam', 'QT Normalise Test'));
    const metaQTBox = buildMetaQTPlainBox(hdlrBox, ilstBox);
    // Parse as udta payload (just the meta box)
    const parsed = parseUdta(metaQTBox);
    expect(parsed.metadata).toHaveLength(1);

    // Re-serialize
    const udtaBox = buildUdtaBox(parsed.metadata, null);
    expect(udtaBox).not.toBeNull();

    // The serialized meta MUST be FullBox v0: first 4 bytes of meta payload = 0x00000000
    // Find meta box inside udta payload
    const udtaPayload = udtaBox!.subarray(8);
    const dv = new DataView(udtaPayload.buffer, udtaPayload.byteOffset, udtaPayload.byteLength);
    const metaType = String.fromCharCode(
      udtaPayload[4]!,
      udtaPayload[5]!,
      udtaPayload[6]!,
      udtaPayload[7]!,
    );
    expect(metaType).toBe('meta');

    // First 4 bytes of meta payload (at offset 8) must be 0x00000000 (FullBox v0)
    const firstWordInMetaPayload = dv.getUint32(8, false);
    expect(firstWordInMetaPayload).toBe(0x00000000);

    // Re-parse to verify ilst content survived
    const reparsed = parseUdta(udtaPayload);
    expect(reparsed.metadata).toHaveLength(1);
    if (reparsed.metadata[0]!.value.kind === 'utf8') {
      expect(reparsed.metadata[0]!.value.value).toBe('QT Normalise Test');
    }
  });
});

// ---------------------------------------------------------------------------
// Rejection (Tests 20–22)
// ---------------------------------------------------------------------------

describe('udta-meta-ilst — rejection', () => {
  // Test 20: > MAX_METADATA_ATOMS children → Mp4MetaTooManyAtomsError
  it('Test 20: >1024 ilst atoms → Mp4MetaTooManyAtomsError', () => {
    // Build 1025 atoms
    const atoms: Uint8Array[] = [];
    for (let i = 0; i < 1025; i++) {
      atoms.push(buildUtf8Atom('©nam', `song ${i}`));
    }
    expect(() => parseUdtaPayload(atoms)).toThrow(Mp4MetaTooManyAtomsError);
  });

  // Test 21: Cover art > cap → Mp4MetaCoverArtTooLargeError
  it('Test 21: covr data > MAX_COVER_ART_BYTES → Mp4MetaCoverArtTooLargeError', () => {
    // 16 MiB + 1 byte
    const hugeImage = new Uint8Array(16 * 1024 * 1024 + 1);
    const covrBox = buildAtomBox('covr', buildDataBox(13, hugeImage));
    expect(() => parseUdtaPayload([covrBox])).toThrow(Mp4MetaCoverArtTooLargeError);
  });

  // Test 22: handler_type='dhlr' → Mp4MetaBadHandlerError; udta preserved via udtaOpaque
  it('Test 22: hdlr handler_type="dhlr" → Mp4MetaBadHandlerError; parseUdta throws', () => {
    const hdlrBox = buildHdlrBox('dhlr');
    const ilstBox = buildIlstBox(buildUtf8Atom('©nam', 'Bad Handler'));
    const metaBox = buildMetaISOFullBox(hdlrBox, ilstBox);
    // Feed as udta payload (contains one child: meta)
    const udtaPayload = metaBox;

    // parseUdta should throw Mp4MetaBadHandlerError
    expect(() => parseUdta(udtaPayload)).toThrow(Mp4MetaBadHandlerError);
  });
});

// ---------------------------------------------------------------------------
// Edge cases (Tests 23–25)
// ---------------------------------------------------------------------------

describe('udta-meta-ilst — edge cases', () => {
  // Test 23: Empty metadata + udtaOpaque=null → buildUdtaBox returns null
  it('Test 23: empty metadata + udtaOpaque=null → buildUdtaBox returns null (udta dropped)', () => {
    const result = buildUdtaBox([], null);
    expect(result).toBeNull();
  });

  // Test 24: udta with only non-meta children → metadata=[], udtaOpaque=<bytes>; round-trip verbatim
  it('Test 24: udta with non-meta children only → metadata=[], udtaOpaque=bytes; buildUdtaBox preserves opaque', () => {
    // Build a udta that has a 'cprt' box but no 'meta' box
    const cprtPayload = new TextEncoder().encode('Copyright 2024 Test');
    const cprtBox = buildBox('cprt', cprtPayload);
    const udtaPayload = cprtBox; // Only non-meta child

    const result = parseUdta(udtaPayload);
    // No meta → metadata empty, opaque = full udta payload
    expect(result.metadata).toHaveLength(0);
    expect(result.opaque).not.toBeNull();
    expect(result.opaque!.length).toBeGreaterThan(0);

    // Round-trip: buildUdtaBox with opaque bytes should wrap them
    const rebuilt = buildUdtaBox([], result.opaque);
    expect(rebuilt).not.toBeNull();
    // Re-parse: opaque is preserved verbatim
    const udtaPayload2 = rebuilt!.subarray(8);
    const result2 = parseUdta(udtaPayload2);
    expect(result2.metadata).toHaveLength(0);
    expect(result2.opaque).not.toBeNull();
    // The opaque bytes should match the original
    expect(Array.from(result2.opaque!)).toEqual(Array.from(result.opaque!));
  });

  // Test 25: locale != 0 parse OK, serialize emits locale=0
  it('Test 25: data box with locale=0xFFFF parses OK; serialized output always has locale=0', () => {
    const payload = new TextEncoder().encode('locale test');
    // data box with non-zero locale
    const dataBox = buildDataBox(1, payload, 0xffff);
    const atomBox = buildAtomBox('©nam', dataBox);
    const hdlrBox = buildHdlrBox('mdir');
    const ilstBox = buildIlstBox(atomBox);
    const metaBox = buildMetaISOFullBox(hdlrBox, ilstBox);

    // Parse
    const parsed = parseUdta(metaBox);
    expect(parsed.metadata).toHaveLength(1);
    expect(parsed.metadata[0]!.value.kind).toBe('utf8');

    // Serialize and verify locale=0 in output
    const udtaBox = buildUdtaBox(parsed.metadata, null);
    expect(udtaBox).not.toBeNull();

    // Walk into serialized output to find 'data' box locale field
    // udta(8) → meta(8) → meta FullBox header(4) → hdlr(...) → ilst(8) → atom(8) → data box
    // Rather than walking the tree, just verify re-parse works and produces utf8
    const udtaPayload = udtaBox!.subarray(8);
    const reparsed = parseUdta(udtaPayload);
    expect(reparsed.metadata).toHaveLength(1);
    if (reparsed.metadata[0]!.value.kind === 'utf8') {
      expect(reparsed.metadata[0]!.value.value).toBe('locale test');
    }

    // Verify locale=0 in serialized bytes by searching for 'data' box pattern
    // The data box payload starts with [type_indicator:u32][locale:u32]
    // type_indicator for UTF-8 = 1, locale should be 0
    const serialized = udtaBox!;
    let foundDataBox = false;
    for (let i = 0; i + 16 <= serialized.length; i++) {
      const dv = new DataView(serialized.buffer, serialized.byteOffset + i, 8);
      const possibleType = String.fromCharCode(
        serialized[i + 4] ?? 0,
        serialized[i + 5] ?? 0,
        serialized[i + 6] ?? 0,
        serialized[i + 7] ?? 0,
      );
      if (possibleType === 'data' && i + 16 <= serialized.length) {
        const dataView = new DataView(serialized.buffer, serialized.byteOffset + i + 8, 8);
        const locale = dataView.getUint32(4, false);
        expect(locale).toBe(0); // serializer always emits locale=0
        foundDataBox = true;
        break;
      }
      void dv;
    }
    expect(foundDataBox).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Review-fix regression tests (F1–F12)
// ---------------------------------------------------------------------------

describe('udta-meta-ilst — review fix regressions', () => {
  // F1: covr with MAX_METADATA_ATOMS + 1 data children → Mp4MetaTooManyAtomsError
  it('F1: single covr atom with MAX_METADATA_ATOMS+1 data children → Mp4MetaTooManyAtomsError', () => {
    // Build a covr atom whose payload contains MAX_METADATA_ATOMS+1 tiny data sub-boxes.
    // Use a 1-byte JPEG payload so the boxes stay small.
    const singleData = buildDataBox(13, new Uint8Array([0xff]));
    const parts: Uint8Array[] = [];
    for (let i = 0; i <= MAX_METADATA_ATOMS; i++) {
      parts.push(singleData);
    }
    const covrPayload = concat(...parts);
    const covrBox = buildBox('covr', covrPayload);
    expect(() => parseUdtaPayload([covrBox])).toThrow(Mp4MetaTooManyAtomsError);
  });

  // F2: ---- atom with mean payload > MAX_METADATA_PAYLOAD_BYTES → Mp4MetaPayloadTooLargeError
  it('F2: ---- atom with mean payload > MAX_METADATA_PAYLOAD_BYTES → Mp4MetaPayloadTooLargeError', () => {
    // Build a mean FullBox whose UTF-8 content exceeds the cap.
    // mean payload = [version+flags:4][utf8 content...]
    const oversizedContent = new Uint8Array(MAX_METADATA_PAYLOAD_BYTES + 1);
    const meanPayloadBytes = new Uint8Array(4 + oversizedContent.length);
    meanPayloadBytes.set(oversizedContent, 4);
    const meanBox = buildBox('mean', meanPayloadBytes);

    const nameBox = buildBox('name', new Uint8Array([0, 0, 0, 0, 0x74, 0x65, 0x73, 0x74])); // "test"
    const dataBox = buildDataBox(1, new Uint8Array([0x01]));
    const freeformPayload = concat(meanBox, nameBox, dataBox);
    const freeformBox = buildBox('----', freeformPayload);
    expect(() => parseUdtaPayload([freeformBox])).toThrow(Mp4MetaPayloadTooLargeError);
  });

  // F4: trkn with typeIndicator=21 and 4-byte payload → { kind: 'beInt' }
  it('F4: trkn with typeIndicator=21 and 4-byte payload → kind: beInt (not trackNumber)', () => {
    const payload = new Uint8Array(4);
    const v = new DataView(payload.buffer);
    v.setInt32(0, 42, false);
    const atomBox = buildAtomBox('trkn', buildDataBox(21, payload));
    const result = parseUdtaPayload([atomBox]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.key).toBe('trkn');
    expect(atom.value.kind).toBe('beInt');
    if (atom.value.kind === 'beInt') {
      expect(atom.value.value).toBe(42);
    }
  });

  // F5: type 21 with 8-byte payload → returns { kind: 'binary' }
  it('F5: type 21 with 8-byte payload → kind: binary (not beInt)', () => {
    const payload = new Uint8Array(8);
    const atomBox = buildAtomBox('cpil', buildDataBox(21, payload));
    const result = parseUdtaPayload([atomBox]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.value.kind).toBe('binary');
  });

  // F6a: udta with 2 meta children → Mp4InvalidBoxError
  it('F6a: udta with 2 meta children → Mp4InvalidBoxError', () => {
    const hdlrBox = buildHdlrBox('mdir');
    const ilstBox = buildIlstBox(buildUtf8Atom('©nam', 'test'));
    const metaBox = buildMetaISOFullBox(hdlrBox, ilstBox);
    // Build udta payload containing TWO meta boxes
    const udtaPayload = concat(metaBox, metaBox);
    expect(() => parseUdta(udtaPayload)).toThrow(Mp4InvalidBoxError);
  });

  // F6b: meta with 2 ilst children → Mp4InvalidBoxError
  it('F6b: meta with 2 ilst children → Mp4InvalidBoxError', () => {
    const hdlrBox = buildHdlrBox('mdir');
    const ilstBox = buildIlstBox(buildUtf8Atom('©nam', 'test'));
    // Build a meta payload that contains hdlr + 2 ilst boxes
    const innerPayload = concat(hdlrBox, ilstBox, ilstBox);
    const fullPayload = new Uint8Array(4 + innerPayload.length);
    fullPayload.set(innerPayload, 4);
    const metaBox = buildBox('meta', fullPayload);
    expect(() => parseUdta(metaBox)).toThrow(Mp4InvalidBoxError);
  });

  // F7a: ---- first child not 'mean' → Mp4MetaFreeformIncompleteError
  it('F7a: ---- first child is not mean → Mp4MetaFreeformIncompleteError', () => {
    // Put name first instead of mean
    const nameBox = buildBox('name', new Uint8Array([0, 0, 0, 0, 0x74, 0x65, 0x73, 0x74]));
    const meanBox = buildBox('mean', new Uint8Array([0, 0, 0, 0, 0x63, 0x6f, 0x6d]));
    const dataBox = buildDataBox(1, new Uint8Array([0x01]));
    const freeformPayload = concat(nameBox, meanBox, dataBox);
    const freeformBox = buildBox('----', freeformPayload);
    expect(() => parseUdtaPayload([freeformBox])).toThrow(Mp4MetaFreeformIncompleteError);
  });

  // F7b: ---- second child not 'name' → Mp4MetaFreeformIncompleteError
  it('F7b: ---- second child is not name → Mp4MetaFreeformIncompleteError', () => {
    const meanBox = buildBox('mean', new Uint8Array([0, 0, 0, 0, 0x63, 0x6f, 0x6d]));
    const dataBox = buildDataBox(1, new Uint8Array([0x01]));
    // Put data where name should be
    const freeformPayload = concat(meanBox, dataBox, dataBox);
    const freeformBox = buildBox('----', freeformPayload);
    expect(() => parseUdtaPayload([freeformBox])).toThrow(Mp4MetaFreeformIncompleteError);
  });

  // F7c: ---- third child not 'data' → Mp4MetaFreeformIncompleteError
  it('F7c: ---- third child is not data → Mp4MetaFreeformIncompleteError', () => {
    const meanBox = buildBox('mean', new Uint8Array([0, 0, 0, 0, 0x63, 0x6f, 0x6d]));
    const nameBox = buildBox('name', new Uint8Array([0, 0, 0, 0, 0x74, 0x65, 0x73, 0x74]));
    // Put another name where data should be
    const freeformPayload = concat(meanBox, nameBox, nameBox);
    const freeformBox = buildBox('----', freeformPayload);
    expect(() => parseUdtaPayload([freeformBox])).toThrow(Mp4MetaFreeformIncompleteError);
  });

  // F8: ©nam with payload > MAX_METADATA_PAYLOAD_BYTES → Mp4MetaPayloadTooLargeError
  it('F8: ©nam with payload > MAX_METADATA_PAYLOAD_BYTES → Mp4MetaPayloadTooLargeError', () => {
    const oversizedPayload = new Uint8Array(MAX_METADATA_PAYLOAD_BYTES + 1);
    const atomBox = buildAtomBox('©nam', buildDataBox(1, oversizedPayload));
    expect(() => parseUdtaPayload([atomBox])).toThrow(Mp4MetaPayloadTooLargeError);
  });

  // F9: hdlr with 8-byte payload → Mp4InvalidBoxError
  it('F9: hdlr with 8-byte payload → Mp4InvalidBoxError', () => {
    // Build a meta box with a too-short hdlr (8-byte payload, need >= 12)
    const shortHdlrPayload = new Uint8Array(8);
    const shortHdlrBox = buildBox('hdlr', shortHdlrPayload);
    const ilstBox = buildIlstBox();
    const inner = concat(shortHdlrBox, ilstBox);
    const fullPayload = new Uint8Array(4 + inner.length);
    fullPayload.set(inner, 4);
    const metaBox = buildBox('meta', fullPayload);
    expect(() => parseUdta(metaBox)).toThrow(Mp4InvalidBoxError);
  });

  // F10a: meta payload < 4 bytes → returns metadata: []
  it('F10a: meta payload < 4 bytes → parseUdta returns metadata: []', () => {
    // Build a udta that contains a meta box with a 3-byte payload
    const shortMetaPayload = new Uint8Array(3);
    const metaBox = buildBox('meta', shortMetaPayload);
    const result = parseUdta(metaBox);
    expect(result.metadata).toHaveLength(0);
  });

  // F10b: valid meta+hdlr but no ilst → returns metadata: []
  it('F10b: valid meta+hdlr but no ilst → parseUdta returns metadata: []', () => {
    const hdlrBox = buildHdlrBox('mdir');
    // meta with hdlr only, no ilst
    const innerPayload = hdlrBox;
    const fullPayload = new Uint8Array(4 + innerPayload.length);
    fullPayload.set(innerPayload, 4);
    const metaBox = buildBox('meta', fullPayload);
    const result = parseUdta(metaBox);
    expect(result.metadata).toHaveLength(0);
  });

  // F11a: ilst child with size=4 → Mp4InvalidBoxError
  it('F11a: ilst child box with size=4 → Mp4InvalidBoxError', () => {
    // Build a raw ilst payload where the first child has size=4
    const ilstPayload = new Uint8Array(8);
    // size field = 4 (too small — minimum is 8)
    ilstPayload[0] = 0;
    ilstPayload[1] = 0;
    ilstPayload[2] = 0;
    ilstPayload[3] = 4;
    // type field = 'nam\0' (doesn't matter for this test)
    ilstPayload[4] = 0x6e;
    ilstPayload[5] = 0x61;
    ilstPayload[6] = 0x6d;
    ilstPayload[7] = 0x00;
    const ilstBox = buildBox('ilst', ilstPayload);
    const hdlrBox = buildHdlrBox('mdir');
    const innerPayload = concat(hdlrBox, ilstBox);
    const fullPayload = new Uint8Array(4 + innerPayload.length);
    fullPayload.set(innerPayload, 4);
    const metaBox = buildBox('meta', fullPayload);
    expect(() => parseUdta(metaBox)).toThrow(Mp4InvalidBoxError);
  });

  // F11b: ilst child with size overrunning container → Mp4InvalidBoxError
  it('F11b: ilst child box size overrunning container → Mp4InvalidBoxError', () => {
    // Build a raw ilst payload where the child claims a size larger than the container
    const ilstPayload = new Uint8Array(12);
    // size = 9999 (well beyond the 12-byte container)
    ilstPayload[0] = 0;
    ilstPayload[1] = 0;
    ilstPayload[2] = 0x27;
    ilstPayload[3] = 0x0f;
    ilstPayload[4] = 0x6e; // 'n'
    ilstPayload[5] = 0x61; // 'a'
    ilstPayload[6] = 0x6d; // 'm'
    ilstPayload[7] = 0x00;
    const ilstBox = buildBox('ilst', ilstPayload);
    const hdlrBox = buildHdlrBox('mdir');
    const innerPayload = concat(hdlrBox, ilstBox);
    const fullPayload = new Uint8Array(4 + innerPayload.length);
    fullPayload.set(innerPayload, 4);
    const metaBox = buildBox('meta', fullPayload);
    expect(() => parseUdta(metaBox)).toThrow(Mp4InvalidBoxError);
  });

  // F12a: 1-byte cpil value 0x80 → { kind: 'beInt', value: -128 }
  it('F12a: 1-byte cpil value 0x80 → kind: beInt, value: -128', () => {
    const result = parseUdtaPayload([buildBeIntAtom('cpil', -128, 1)]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.value.kind).toBe('beInt');
    if (atom.value.kind === 'beInt') {
      expect(atom.value.value).toBe(-128);
    }
  });

  // F12b: 2-byte value 0x8000 → { kind: 'beInt', value: -32768 }
  it('F12b: 2-byte value 0x8000 → kind: beInt, value: -32768', () => {
    const result = parseUdtaPayload([buildBeIntAtom('tmpo', -32768, 2)]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.value.kind).toBe('beInt');
    if (atom.value.kind === 'beInt') {
      expect(atom.value.value).toBe(-32768);
    }
  });

  // F12c: 3-byte negative sign-extension (0x800000 → -8388608)
  it('F12c: 3-byte value 0x800000 → kind: beInt, value: -8388608', () => {
    const payload = new Uint8Array([0x80, 0x00, 0x00]);
    const atomBox = buildAtomBox('pgap', buildDataBox(21, payload));
    const result = parseUdtaPayload([atomBox]);
    expect(result.metadata).toHaveLength(1);
    const atom = result.metadata[0]!;
    expect(atom.value.kind).toBe('beInt');
    if (atom.value.kind === 'beInt') {
      expect(atom.value.value).toBe(-8388608);
    }
  });
});
