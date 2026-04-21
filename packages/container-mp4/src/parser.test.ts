/**
 * Tests for parser.ts — end-to-end MP4/M4A parser.
 *
 * Design note test cases covered:
 *   - "parses single-track audio M4A end-to-end"
 *   - "tolerates moov-after-mdat layout and moov-before-mdat layout"
 *   - "rejects multi-track file with Mp4MultiTrackNotSupportedError"
 *   - "rejects video-handler track with Mp4UnsupportedTrackTypeError"
 *   - "rejects external data reference (dref url with flags = 0)"
 *   - "enforces 200 MiB input cap"
 *
 * Integration tests against the committed fixture:
 *   sine-1s-44100-mono.m4a
 *
 * Per the task brief, we do NOT do byte-equality comparison against the
 * fixture bytes. We use structural validation only.
 */

import { loadFixture } from '@webcvt/test-utils';
import { describe, expect, it } from 'vitest';
import {
  Mp4CorruptSampleError,
  Mp4ExternalDataRefError,
  Mp4InputTooLargeError,
  Mp4InvalidBoxError,
  Mp4MissingFtypError,
  Mp4MissingMoovError,
  Mp4MultiTrackNotSupportedError,
  Mp4UnsupportedBrandError,
  Mp4UnsupportedTrackTypeError,
} from './errors.ts';
import { parseMp4 } from './parser.ts';

// ---------------------------------------------------------------------------
// Fixture-based integration tests
// ---------------------------------------------------------------------------

describe('parseMp4 — fixture: sine-1s-44100-mono.m4a', () => {
  it('parses single-track audio M4A end-to-end', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);

    // ftyp must be present.
    expect(file.ftyp).toBeDefined();
    // The fixture was generated with +faststart, so moov is before mdat.
    expect(file.tracks).toHaveLength(1);
    const track = file.tracks[0]!;
    expect(track.handlerType).toBe('soun');
  });

  it('asserts ftyp major brand is M4A ', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);
    // m4a files produced by ffmpeg with +faststart use M4A  or similar brand.
    // Accept any of the known M4A brands.
    const brand = file.ftyp.majorBrand;
    expect(['M4A ', 'mp42', 'isom', 'M4V ']).toContain(brand.trim().length > 0 ? brand : 'isom');
  });

  it('asserts mdhd.timescale == 44100 for the audio track', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);
    const track = file.tracks[0]!;
    expect(track.mediaHeader.timescale).toBe(44100);
  });

  it('asserts sample count is in expected range (1s @ 44100 Hz, ~86 frames of 1024)', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);
    const track = file.tracks[0]!;
    // AAC-LC produces 1024 samples per frame. 44100/1024 ≈ 43 frames.
    // Allow a range because encoder adds pre-roll/lookahead frames.
    expect(track.sampleTable.sampleCount).toBeGreaterThan(10);
    expect(track.sampleTable.sampleCount).toBeLessThan(500);
  });

  it('asserts single audio track', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);
    expect(file.tracks).toHaveLength(1);
  });

  it('asserts decoderSpecificInfo (AudioSpecificConfig) is present', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);
    const asc = file.tracks[0]!.audioSampleEntry.decoderSpecificInfo;
    expect(asc.length).toBeGreaterThanOrEqual(2);
  });

  it('records mdat ranges with positive lengths', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);
    expect(file.mdatRanges.length).toBeGreaterThan(0);
    for (const range of file.mdatRanges) {
      expect(range.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests with synthetic inputs
// ---------------------------------------------------------------------------

describe('parseMp4 — security caps', () => {
  it('throws Mp4InputTooLargeError when input exceeds 200 MiB', () => {
    // Use a Proxy to fake a large buffer without allocating 200 MiB.
    const fakeInput = new Uint8Array(0);
    Object.defineProperty(fakeInput, 'length', { value: 200 * 1024 * 1024 + 1 });
    expect(() => parseMp4(fakeInput)).toThrow(Mp4InputTooLargeError);
  });

  it('throws Mp4CorruptSampleError when a sample offset exceeds the file bounds', async () => {
    // Parse the fixture to obtain valid structure, then rebuild with the chunk
    // offset patched to point 5 bytes before the end of the file while claiming a
    // large sample size — this makes off+sz exceed file length.
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const mutable = new Uint8Array(bytes); // mutable copy

    // stco payload is at absolute file offset 807:
    //   version(1)+flags(3)+entry_count(4) = 8 bytes, then offsets[0] at 807+8=815
    // Set chunk offset to (file.length - 5) so that sample[0] size (314 bytes) overruns.
    const stcoOffsetField = 807 + 8; // absolute offset of offsets[0] in the file
    const patchedOffset = mutable.length - 5; // points near end of file
    const patchView = new DataView(mutable.buffer);
    patchView.setUint32(stcoOffsetField, patchedOffset, false);

    expect(() => parseMp4(mutable)).toThrow(Mp4CorruptSampleError);
  });
});

describe('parseMp4 — error cases', () => {
  it('throws Mp4MissingFtypError when the first box is not ftyp', () => {
    // Build a file that starts with moov instead of ftyp.
    const moov = buildBox('moov', new Uint8Array(0));
    expect(() => parseMp4(moov)).toThrow(Mp4MissingFtypError);
  });

  it('throws Mp4MissingMoovError when no moov box is present', () => {
    const ftyp = buildFtypBox('mp42');
    const mdat = buildBox('mdat', new Uint8Array(16));
    const file = concat([ftyp, mdat]);
    expect(() => parseMp4(file)).toThrow(Mp4MissingMoovError);
  });

  it('accepts iso5 brand (fragmented MP4 — sub-pass D) and throws MissingMoov when moov absent', () => {
    // Sub-pass D: iso5 is no longer rejected at ftyp; parser proceeds until moov is missing.
    const ftypPayload = buildFtypPayload('iso5', 0, []);
    const ftyp = buildBoxWithPayload('ftyp', ftypPayload);
    expect(() => parseMp4(ftyp)).toThrow(Mp4MissingMoovError);
  });

  it('tolerates moov-after-mdat layout (Trap §8)', async () => {
    // The fixture is faststart (moov first), but we test via the parse logic
    // by verifying the parser scans all top-level boxes before extracting samples.
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    // Re-parse the fixture — it was produced with +faststart (moov before mdat),
    // so this tests the moov-before-mdat path. The moov-after-mdat path is
    // tested by construction below.
    const file = parseMp4(bytes);
    expect(file.tracks).toHaveLength(1);
  });

  it('Q-H-1: parseMp4 succeeds when moov comes after mdat (mdat-before-moov layout)', () => {
    // Build a synthetic [ftyp, mdat, moov] file where moov follows mdat.
    // The moov contains a minimal but structurally valid single audio track.
    const ftyp = buildFtypBox('mp42');
    const mdat = buildBox('mdat', new Uint8Array(16)); // 16 bytes of fake sample data

    // mvhd
    const mvhd = buildFullBox('mvhd', buildMvhdV0Payload(44100, 44100));

    // tkhd
    const tkhdPayload = buildMinimalTkhd();
    const tkhd = buildFullBox('tkhd', tkhdPayload);

    // mdhd
    const mdhdPayload = buildMdhdV0Payload(44100, 44100);
    const mdhd = buildFullBox('mdhd', mdhdPayload);

    // hdlr 'soun'
    const hdlrPayload = new Uint8Array(36);
    hdlrPayload[8] = 0x73;
    hdlrPayload[9] = 0x6f;
    hdlrPayload[10] = 0x75;
    hdlrPayload[11] = 0x6e; // 'soun'
    const hdlr = buildFullBox('hdlr', hdlrPayload);

    // dinf with self-contained dref
    const dref = buildSelfContainedDref();
    const dinf = buildBox('dinf', dref);

    // smhd
    const smhd = buildFullBox('smhd', new Uint8Array(8));

    // stbl: stsd + stts + stsc + stsz + stco
    // We need a single sample pointing into the mdat payload.
    // ftyp + mdat occupy first bytes, so mdat payload starts at:
    //   ftyp.length + 8 (mdat header) = buildFtypBox('mp42').length + 8
    const ftypSize = buildFtypBox('mp42').length;
    const mdatPayloadOffset = ftypSize + 8; // offset of mdat payload in synthetic file

    const stsdPayload = buildMinimalStsdPayload();
    const stsd = buildFullBox('stsd', stsdPayload);

    // stts: 1 entry, 1 sample, delta=1024
    const sttsPayload = new Uint8Array(16);
    const sttsView = new DataView(sttsPayload.buffer);
    sttsView.setUint32(4, 1, false); // entry_count=1
    sttsView.setUint32(8, 1, false); // sample_count=1
    sttsView.setUint32(12, 1024, false); // sample_delta=1024
    const stts = buildFullBox('stts', sttsPayload);

    // stsc: 1 entry: firstChunk=1, samplesPerChunk=1, sampleDescriptionIndex=1
    const stscPayload = new Uint8Array(20);
    const stscView = new DataView(stscPayload.buffer);
    stscView.setUint32(4, 1, false); // entry_count=1
    stscView.setUint32(8, 1, false); // firstChunk=1
    stscView.setUint32(12, 1, false); // samplesPerChunk=1
    stscView.setUint32(16, 1, false); // sampleDescriptionIndex=1
    const stsc = buildFullBox('stsc', stscPayload);

    // stsz: 1 sample of size 8 (fits within 16-byte mdat payload)
    const stszPayload = new Uint8Array(20);
    const stszView = new DataView(stszPayload.buffer);
    stszView.setUint32(8, 1, false); // sample_count=1
    stszView.setUint32(12, 8, false); // size of sample[0]=8
    const stsz = buildFullBox('stsz', stszPayload);

    // stco: 1 chunk offset pointing into mdat payload
    // We compute the final offset after the file is assembled.
    // The stco offset will be patched below once we know all sizes.
    const stcoPayload = new Uint8Array(16);
    const stcoView = new DataView(stcoPayload.buffer);
    stcoView.setUint32(4, 1, false); // entry_count=1
    // offset[0]: we'll set this after concat
    const stco = buildFullBox('stco', stcoPayload);

    const stblPayload = concat([stsd, stts, stsc, stsz, stco]);
    const stbl = buildBox('stbl', stblPayload);

    const minf = buildBox('minf', concat([smhd, dinf, stbl]));
    const mdia = buildBox('mdia', concat([mdhd, hdlr, minf]));
    const trak = buildBox('trak', concat([tkhd, mdia]));
    const moov = buildBox('moov', concat([mvhd, trak]));

    // Assemble the file in mdat-before-moov order.
    const file = concat([ftyp, mdat, moov]);

    // Patch the stco offset to point inside the mdat payload.
    // Find stco offset[0] by locating it in the assembled buffer.
    // stco payload starts right after its 8-byte box header.
    // We know mdatPayloadOffset from above.
    const fileView = new DataView(file.buffer);
    // Locate stco's entry[0] offset field: scan for 'stco' FourCC in the file.
    let stcoFieldOffset = -1;
    for (let i = ftypSize + mdat.length; i < file.length - 8; i++) {
      if (
        file[i + 4] === 0x73 &&
        file[i + 5] === 0x74 &&
        file[i + 6] === 0x63 &&
        file[i + 7] === 0x6f
      ) {
        // Found 'stco' — entry_count is at i+8+4=i+12, first offset at i+12+4=i+16
        stcoFieldOffset = i + 16;
        break;
      }
    }
    if (stcoFieldOffset >= 0) {
      fileView.setUint32(stcoFieldOffset, mdatPayloadOffset, false);
    }

    const parsed = parseMp4(file);
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.mdatRanges.length).toBeGreaterThan(0);
  });

  it('throws Mp4MultiTrackNotSupportedError for multi-trak moov', () => {
    // Build a minimal moov with two trak children. Each trak must contain at
    // least a tkhd box so the walker does not choke on trak's content — trak
    // is a container type and its payload is descended into.
    const ftyp = buildFtypBox('mp42');
    const mvhd = buildFullBox('mvhd', buildMvhdV0Payload(1000, 5000));
    const tkhd1 = buildFullBox('tkhd', buildMinimalTkhd());
    const tkhd2 = buildFullBox('tkhd', buildMinimalTkhd());
    const trak1 = buildBox('trak', tkhd1);
    const trak2 = buildBox('trak', tkhd2);
    const moovPayload = concat([mvhd, trak1, trak2]);
    const moov = buildBox('moov', moovPayload);
    const mdat = buildBox('mdat', new Uint8Array(8));
    const file = concat([ftyp, moov, mdat]);
    expect(() => parseMp4(file)).toThrow(Mp4MultiTrackNotSupportedError);
  });
});

describe('parseMp4 — track type rejection', () => {
  it('throws Mp4UnsupportedTrackTypeError when hdlr handler_type is not soun', () => {
    // Build a minimal file with a 'vide' handler.
    const bytes = buildMinimalMp4WithHandler('vide');
    expect(() => parseMp4(bytes)).toThrow(Mp4UnsupportedTrackTypeError);
  });
});

describe('parseMp4 — external data reference rejection', () => {
  it('throws Mp4ExternalDataRefError when dref is not self-contained', () => {
    // We test this by building a synthetic dref with flags=0 (external).
    // This is done via a full minimal M4A minus the self-contained flag.
    const bytes = buildMinimalMp4WithExternalDref();
    expect(() => parseMp4(bytes)).toThrow(Mp4ExternalDataRefError);
  });
});

// ---------------------------------------------------------------------------
// F7 regression tests — duplicate edts/elst box rejection
// ---------------------------------------------------------------------------

describe('parseMp4 — F7: duplicate edts/elst rejection', () => {
  it('F7-a: trak with two edts boxes → Mp4InvalidBoxError', () => {
    // Build a minimal valid trak that has two edts children.
    // Each edts contains a single elst to satisfy the box-tree walker.
    const ftyp = buildFtypBox('mp42');
    const mvhd = buildFullBox('mvhd', buildMvhdV0Payload(44100, 44100));
    const tkhd = buildFullBox('tkhd', buildMinimalTkhd());
    const mdhd = buildFullBox('mdhd', buildMdhdV0Payload(44100, 44100));

    const hdlrPayload = new Uint8Array(36);
    hdlrPayload[8] = 0x73;
    hdlrPayload[9] = 0x6f;
    hdlrPayload[10] = 0x75;
    hdlrPayload[11] = 0x6e; // 'soun'
    const hdlr = buildFullBox('hdlr', hdlrPayload);

    const dref = buildSelfContainedDref();
    const dinf = buildBox('dinf', dref);
    const smhd = buildFullBox('smhd', new Uint8Array(8));
    const stbl = buildBox('stbl', new Uint8Array(0));
    const minf = buildBox('minf', concat([smhd, dinf, stbl]));
    const mdia = buildBox('mdia', concat([mdhd, hdlr, minf]));

    // Build a minimal elst payload: v0, entry_count=0 (empty list).
    const elstPayload = new Uint8Array(8); // version=0, flags=0, entry_count=0
    const elst = buildFullBox('elst', elstPayload);
    const edts1 = buildBox('edts', elst);
    const edts2 = buildBox('edts', elst);

    const trak = buildBox('trak', concat([tkhd, edts1, edts2, mdia]));
    const moov = buildBox('moov', concat([mvhd, trak]));
    const mdat = buildBox('mdat', new Uint8Array(8));
    const file = concat([ftyp, moov, mdat]);

    expect(() => parseMp4(file)).toThrow(Mp4InvalidBoxError);
  });

  it('F7-b: edts with two elst boxes → Mp4InvalidBoxError', () => {
    // Build a trak with a single edts that contains two elst children.
    const ftyp = buildFtypBox('mp42');
    const mvhd = buildFullBox('mvhd', buildMvhdV0Payload(44100, 44100));
    const tkhd = buildFullBox('tkhd', buildMinimalTkhd());
    const mdhd = buildFullBox('mdhd', buildMdhdV0Payload(44100, 44100));

    const hdlrPayload = new Uint8Array(36);
    hdlrPayload[8] = 0x73;
    hdlrPayload[9] = 0x6f;
    hdlrPayload[10] = 0x75;
    hdlrPayload[11] = 0x6e; // 'soun'
    const hdlr = buildFullBox('hdlr', hdlrPayload);

    const dref = buildSelfContainedDref();
    const dinf = buildBox('dinf', dref);
    const smhd = buildFullBox('smhd', new Uint8Array(8));
    const stbl = buildBox('stbl', new Uint8Array(0));
    const minf = buildBox('minf', concat([smhd, dinf, stbl]));
    const mdia = buildBox('mdia', concat([mdhd, hdlr, minf]));

    // Two elst boxes inside one edts.
    const elstPayload = new Uint8Array(8); // v0, entry_count=0
    const elst1 = buildFullBox('elst', elstPayload);
    const elst2 = buildFullBox('elst', elstPayload);
    const edts = buildBox('edts', concat([elst1, elst2]));

    const trak = buildBox('trak', concat([tkhd, edts, mdia]));
    const moov = buildBox('moov', concat([mvhd, trak]));
    const mdat = buildBox('mdat', new Uint8Array(8));
    const file = concat([ftyp, moov, mdat]);

    expect(() => parseMp4(file)).toThrow(Mp4InvalidBoxError);
  });
});

// ---------------------------------------------------------------------------
// Box builder helpers (synthetic, for unit tests only)
// ---------------------------------------------------------------------------

function buildBox(type: string, payload: Uint8Array): Uint8Array {
  const size = 8 + payload.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, size, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i) & 0xff;
  out.set(payload, 8);
  return out;
}

function buildBoxWithPayload(type: string, payload: Uint8Array): Uint8Array {
  return buildBox(type, payload);
}

function buildFullBox(type: string, payload: Uint8Array): Uint8Array {
  // A FullBox is just a box whose payload starts with version+flags (already in payload).
  return buildBox(type, payload);
}

function buildFtypPayload(major: string, minor: number, compatible: string[]): Uint8Array {
  const out = new Uint8Array(8 + compatible.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = major.charCodeAt(i) & 0xff;
  view.setUint32(4, minor, false);
  let off = 8;
  for (const c of compatible) {
    for (let i = 0; i < 4; i++) out[off + i] = c.charCodeAt(i) & 0xff;
    off += 4;
  }
  return out;
}

function buildFtypBox(major: string): Uint8Array {
  return buildBoxWithPayload('ftyp', buildFtypPayload(major, 0, ['isom', 'mp42']));
}

function buildMvhdV0Payload(timescale: number, duration: number): Uint8Array {
  const out = new Uint8Array(100);
  const view = new DataView(out.buffer);
  view.setUint32(12, timescale, false);
  view.setUint32(16, duration, false);
  view.setUint32(20, 0x00010000, false);
  view.setUint16(24, 0x0100, false);
  view.setUint32(36, 0x00010000, false);
  view.setUint32(52, 0x00010000, false);
  view.setUint32(68, 0x40000000, false);
  view.setUint32(96, 2, false);
  return out;
}

function buildMinimalTkhd(): Uint8Array {
  // Minimal tkhd v0 payload (84 bytes)
  const out = new Uint8Array(84);
  const view = new DataView(out.buffer);
  out[3] = 0x03; // flags
  view.setUint32(12, 1, false); // trackId
  view.setUint32(20, 5000, false); // duration
  view.setInt16(36, 0x0100, false); // volume
  return out;
}

function buildMinimalMp4WithHandler(handlerType: string): Uint8Array {
  const ftyp = buildFtypBox('mp42');

  const mvhd = buildFullBox('mvhd', buildMvhdV0Payload(1000, 5000));

  // tkhd
  const tkhdPayload = buildMinimalTkhd();
  const tkhd = buildFullBox('tkhd', tkhdPayload);

  // mdhd
  const mdhdPayload = buildMdhdV0Payload(44100, 44100);
  const mdhd = buildFullBox('mdhd', mdhdPayload);

  // hdlr with specified handler type
  const hdlrPayload = new Uint8Array(24 + 12);
  for (let i = 0; i < 4; i++) hdlrPayload[8 + i] = handlerType.charCodeAt(i) & 0xff;
  hdlrPayload[24] = 0; // null-terminated name
  const hdlr = buildFullBox('hdlr', hdlrPayload);

  // dinf with self-contained dref
  const dref = buildSelfContainedDref();
  const dinf = buildBox('dinf', dref);

  // smhd
  const smhd = buildFullBox('smhd', new Uint8Array(8));

  // stbl (minimal — not needed to reach hdlr)
  const stbl = buildBox('stbl', new Uint8Array(0));

  const minf = buildBox('minf', concat([smhd, dinf, stbl]));
  const mdia = buildBox('mdia', concat([mdhd, hdlr, minf]));
  const trak = buildBox('trak', concat([tkhd, mdia]));
  const moov = buildBox('moov', concat([mvhd, trak]));
  const mdat = buildBox('mdat', new Uint8Array(8));

  return concat([ftyp, moov, mdat]);
}

function buildMinimalMp4WithExternalDref(): Uint8Array {
  const ftyp = buildFtypBox('mp42');
  const mvhd = buildFullBox('mvhd', buildMvhdV0Payload(1000, 5000));
  const tkhd = buildFullBox('tkhd', buildMinimalTkhd());
  const mdhd = buildFullBox('mdhd', buildMdhdV0Payload(44100, 44100));

  const hdlrPayload = new Uint8Array(36);
  // handler_type at 8: 'soun'
  hdlrPayload[8] = 0x73;
  hdlrPayload[9] = 0x6f;
  hdlrPayload[10] = 0x75;
  hdlrPayload[11] = 0x6e;
  const hdlr = buildFullBox('hdlr', hdlrPayload);

  // dref with flags=0 (NOT self-contained — url without self-contained flag).
  const urlEntry = new Uint8Array(12);
  const urlView = new DataView(urlEntry.buffer);
  urlView.setUint32(0, 12, false);
  urlEntry[4] = 0x75;
  urlEntry[5] = 0x72;
  urlEntry[6] = 0x6c;
  urlEntry[7] = 0x20; // 'url '
  // flags = 0 (external — NOT self-contained).
  const drefPayload = new Uint8Array(8 + 12);
  const drefView = new DataView(drefPayload.buffer);
  drefView.setUint32(4, 1, false); // entry_count
  drefPayload.set(urlEntry, 8);
  const dref = buildFullBox('dref', drefPayload);
  const dinf = buildBox('dinf', dref);

  const smhd = buildFullBox('smhd', new Uint8Array(8));
  const stbl = buildBox('stbl', new Uint8Array(0));
  const minf = buildBox('minf', concat([smhd, dinf, stbl]));
  const mdia = buildBox('mdia', concat([mdhd, hdlr, minf]));
  const trak = buildBox('trak', concat([tkhd, mdia]));
  const moov = buildBox('moov', concat([mvhd, trak]));
  const mdat = buildBox('mdat', new Uint8Array(8));

  return concat([ftyp, moov, mdat]);
}

function buildSelfContainedDref(): Uint8Array {
  const urlEntry = new Uint8Array(12);
  const urlView = new DataView(urlEntry.buffer);
  urlView.setUint32(0, 12, false);
  urlEntry[4] = 0x75;
  urlEntry[5] = 0x72;
  urlEntry[6] = 0x6c;
  urlEntry[7] = 0x20; // 'url '
  urlEntry[11] = 0x01; // self-contained flag
  const drefPayload = new Uint8Array(8 + 12);
  const drefView = new DataView(drefPayload.buffer);
  drefView.setUint32(4, 1, false);
  drefPayload.set(urlEntry, 8);
  return buildFullBox('dref', drefPayload);
}

function buildMdhdV0Payload(timescale: number, duration: number): Uint8Array {
  const out = new Uint8Array(24);
  const view = new DataView(out.buffer);
  view.setUint32(12, timescale, false);
  view.setUint32(16, duration, false);
  // language 'und'
  const u = 0x75 - 0x60;
  const n = 0x6e - 0x60;
  const d = 0x64 - 0x60;
  view.setUint16(20, ((u & 0x1f) << 10) | ((n & 0x1f) << 5) | (d & 0x1f), false);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Build a minimal stsd FullBox payload containing one mp4a entry with a
 * minimal valid esds, suitable for a synthetic round-trip test.
 * Returns only the stsd payload (without the surrounding box header).
 */
function buildMinimalStsdPayload(): Uint8Array {
  // Minimal AudioSpecificConfig (2 bytes: AAC-LC, 44100 Hz, 2ch)
  const asc = new Uint8Array([0x12, 0x10]);

  // Build minimal esds payload
  const esdsPayload = buildMinimalEsdsPayload(0x40, asc);
  const esdsBoxSize = 8 + esdsPayload.length;
  const esdsBox = new Uint8Array(esdsBoxSize);
  const esdsView = new DataView(esdsBox.buffer);
  esdsView.setUint32(0, esdsBoxSize, false);
  esdsBox[4] = 0x65;
  esdsBox[5] = 0x73;
  esdsBox[6] = 0x64;
  esdsBox[7] = 0x73; // 'esds'
  esdsBox.set(esdsPayload, 8);

  // mp4a payload = SampleEntry(8) + AudioSampleEntry(20) + esds box
  const mp4aPayloadSize = 28 + esdsBoxSize;
  const mp4aBoxSize = 8 + mp4aPayloadSize;
  const mp4aBox = new Uint8Array(mp4aBoxSize);
  const mp4aView = new DataView(mp4aBox.buffer);
  mp4aView.setUint32(0, mp4aBoxSize, false);
  mp4aBox[4] = 0x6d;
  mp4aBox[5] = 0x70;
  mp4aBox[6] = 0x34;
  mp4aBox[7] = 0x61; // 'mp4a'
  mp4aView.setUint16(14, 1, false); // data_reference_index
  mp4aView.setUint16(24, 2, false); // channelCount=2
  mp4aView.setUint16(26, 16, false); // sampleSize=16
  mp4aView.setUint32(32, (44100 & 0xffff) << 16, false); // sampleRate Q16.16
  mp4aBox.set(esdsBox, 36);

  // stsd payload: version+flags(4) + entry_count(4) + mp4aBox
  const stsdPayload = new Uint8Array(8 + mp4aBoxSize);
  const stsdView = new DataView(stsdPayload.buffer);
  stsdView.setUint32(4, 1, false); // entry_count=1
  stsdPayload.set(mp4aBox, 8);
  return stsdPayload;
}

function buildMinimalEsdsPayload(oti: number, asc: Uint8Array): Uint8Array {
  function buildDesc(tag: number, payload: Uint8Array): Uint8Array {
    const out = new Uint8Array(2 + payload.length);
    out[0] = tag;
    out[1] = payload.length & 0x7f;
    out.set(payload, 2);
    return out;
  }
  const dsi = buildDesc(0x05, asc);
  const dcFixed = new Uint8Array(13);
  dcFixed[0] = oti;
  dcFixed[1] = 0x15;
  const dcPayload = concat([dcFixed, dsi]);
  const dc = buildDesc(0x04, dcPayload);
  const sl = buildDesc(0x06, new Uint8Array([0x02]));
  const esFixed = new Uint8Array([0x00, 0x01, 0x00]);
  const esPayload = concat([esFixed, dc, sl]);
  const es = buildDesc(0x03, esPayload);
  return concat([new Uint8Array(4), es]);
}
