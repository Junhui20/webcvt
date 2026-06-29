/**
 * End-to-end tests for read-only Common Encryption (CENC) signalling surfaced
 * on Mp4File.protection by parseMp4.
 *
 * All encrypted fixtures are built programmatically (self-contained, clean-room).
 * The unencrypted classic case uses the committed M4A fixture; the unencrypted
 * fragmented case uses the in-memory fMP4 builder.
 *
 * Spec: ISO/IEC 23001-7:2016 (Common Encryption) + ISO/IEC 14496-12.
 */

import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { buildMinimalFmp4 } from './_test-helpers/build-fmp4.ts';
import { buildAvcCPayload } from './_test-helpers/build-video-stsd.ts';
import { parseMp4 } from './parser.ts';

// ---------------------------------------------------------------------------
// Low-level raw-box helpers
// ---------------------------------------------------------------------------

function u32(buf: Uint8Array, offset: number, v: number): void {
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setUint32(offset, v >>> 0, false);
}

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

function box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const total = payloads.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(8 + total);
  u32(out, 0, out.length);
  fourCC(out, 4, type);
  let off = 8;
  for (const p of payloads) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const DEFAULT_KID = new Uint8Array([
  0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00,
]);
const DEFAULT_KID_HEX = '112233445566778899aabbccddeeff00';
const WIDEVINE_SYSTEM_ID = new Uint8Array([
  0xed, 0xef, 0x8b, 0xa9, 0x79, 0xd6, 0x4a, 0xce, 0xa3, 0xc8, 0x27, 0xdc, 0xd5, 0x1d, 0x21, 0xed,
]);

// ---------------------------------------------------------------------------
// CENC box builders
// ---------------------------------------------------------------------------

function buildTenc(ivSize = 8): Uint8Array {
  const payload = new Uint8Array(24);
  payload[6] = 1; // default_isProtected
  payload[7] = ivSize; // default_Per_Sample_IV_Size
  payload.set(DEFAULT_KID, 8);
  return box('tenc', payload);
}

function buildSchm(schemeType: string): Uint8Array {
  const payload = new Uint8Array(12);
  fourCC(payload, 4, schemeType);
  u32(payload, 8, 0x00010000);
  return box('schm', payload);
}

function buildSinf(originalFormat: string, schemeType: string): Uint8Array {
  const frma = box(
    'frma',
    (() => {
      const p = new Uint8Array(4);
      fourCC(p, 0, originalFormat);
      return p;
    })(),
  );
  return box('sinf', frma, buildSchm(schemeType), box('schi', buildTenc()));
}

function buildPssh(): Uint8Array {
  // version 1: SystemID(16) + KID_count(4) + 1 KID(16) + DataSize(4) + data.
  const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const payload = new Uint8Array(4 + 16 + 4 + 16 + 4 + data.length);
  payload[0] = 1; // version 1
  payload.set(WIDEVINE_SYSTEM_ID, 4);
  u32(payload, 20, 1); // KID_count
  payload.set(DEFAULT_KID, 24);
  u32(payload, 40, data.length);
  payload.set(data, 44);
  return box('pssh', payload);
}

// ---------------------------------------------------------------------------
// Original-format sample-entry payload builders (codec config child boxes)
// ---------------------------------------------------------------------------

function buildEsds(): Uint8Array {
  const asc = new Uint8Array([0x11, 0x90]);
  const dsi = new Uint8Array([0x05, asc.length, ...asc]);
  const dcd = new Uint8Array([
    0x04,
    13 + dsi.length,
    0x40,
    0x15,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    ...dsi,
  ]);
  const sl = new Uint8Array([0x06, 0x01, 0x02]);
  const es = new Uint8Array([0x03, 3 + dcd.length + sl.length, 0x00, 0x01, 0x00, ...dcd, ...sl]);
  const payload = new Uint8Array(4 + es.length);
  payload.set(es, 4);
  return box('esds', payload);
}

/** Build an `enca` (encrypted AAC) sample entry box wrapping mp4a via sinf. */
function buildEnca(schemeType: string): Uint8Array {
  const header = new Uint8Array(28);
  header[7] = 1; // data_reference_index
  u32(header, 16, (1 << 16) | 16); // channelcount=1 | samplesize=16
  u32(header, 24, 44100 << 16); // samplerate Q16.16
  return box('enca', concat(header, buildEsds(), buildSinf('mp4a', schemeType)));
}

/** Build the 78-byte VisualSampleEntry common header. */
function buildVisualHeader(width: number, height: number): Uint8Array {
  const out = new Uint8Array(78);
  out[7] = 0x01; // data_reference_index=1 (bytes 6-7)
  out[24] = (width >> 8) & 0xff;
  out[25] = width & 0xff;
  out[26] = (height >> 8) & 0xff;
  out[27] = height & 0xff;
  u32(out, 28, 0x00480000); // horizresolution
  u32(out, 32, 0x00480000); // vertresolution
  out[40] = 0x00;
  out[41] = 0x01; // frame_count=1
  out[74] = 0x00;
  out[75] = 0x18; // depth=24
  out[76] = 0xff;
  out[77] = 0xff; // pre_defined=-1
  return out;
}

/** Build an `encv` (encrypted AVC) sample entry box wrapping avc1 via sinf. */
function buildEncv(schemeType: string): Uint8Array {
  const avcC = box('avcC', buildAvcCPayload(0x42, 0xe0, 0x1e));
  return box('encv', concat(buildVisualHeader(320, 240), avcC, buildSinf('avc1', schemeType)));
}

// ---------------------------------------------------------------------------
// Classic single-track MP4 assembly
// ---------------------------------------------------------------------------

function buildEmptyTable(type: string): Uint8Array {
  if (type === 'stsz') return box('stsz', new Uint8Array(12));
  return box(type, new Uint8Array(8));
}

function buildMvhd(): Uint8Array {
  const payload = new Uint8Array(100);
  u32(payload, 12, 1000); // timescale
  u32(payload, 20, 0x00010000); // rate
  payload[24] = 0x01; // volume
  u32(payload, 36, 0x00010000); // matrix a
  u32(payload, 52, 0x00010000); // matrix d
  u32(payload, 68, 0x40000000); // matrix w
  u32(payload, 96, 2); // next_track_ID
  return box('mvhd', payload);
}

function buildTkhd(trackId: number): Uint8Array {
  const payload = new Uint8Array(84);
  payload[3] = 0x03; // flags
  u32(payload, 12, trackId);
  u32(payload, 40, 0x00010000); // matrix a
  u32(payload, 56, 0x00010000); // matrix d
  u32(payload, 72, 0x40000000); // matrix w
  return box('tkhd', payload);
}

function buildMdhd(): Uint8Array {
  const payload = new Uint8Array(24);
  u32(payload, 12, 44100); // timescale
  payload[20] = 0x55;
  payload[21] = 0xc4; // 'und'
  return box('mdhd', payload);
}

function buildHdlr(handlerType: string): Uint8Array {
  const name = new TextEncoder().encode('Handler\0');
  const payload = new Uint8Array(4 + 4 + 4 + 12 + name.length);
  fourCC(payload, 8, handlerType);
  payload.set(name, 24);
  return box('hdlr', payload);
}

function buildDref(): Uint8Array {
  const urlEntry = new Uint8Array(12);
  u32(urlEntry, 0, 12);
  fourCC(urlEntry, 4, 'url ');
  urlEntry[11] = 0x01; // self-contained
  const payload = new Uint8Array(8 + 12);
  u32(payload, 4, 1); // entry_count
  payload.set(urlEntry, 8);
  return box('dref', payload);
}

function buildStbl(stsdBox: Uint8Array): Uint8Array {
  return box(
    'stbl',
    stsdBox,
    buildEmptyTable('stts'),
    buildEmptyTable('stsc'),
    buildEmptyTable('stsz'),
    buildEmptyTable('stco'),
  );
}

function buildStsd(sampleEntryBox: Uint8Array): Uint8Array {
  const payload = new Uint8Array(8 + sampleEntryBox.length);
  u32(payload, 4, 1); // entry_count
  payload.set(sampleEntryBox, 8);
  return box('stsd', payload);
}

function buildFtyp(): Uint8Array {
  const payload = new Uint8Array(16);
  fourCC(payload, 0, 'isom');
  fourCC(payload, 8, 'isom');
  fourCC(payload, 12, 'mp42');
  return box('ftyp', payload);
}

interface ClassicOpts {
  handlerType: 'soun' | 'vide';
  mediaHeader: Uint8Array;
  sampleEntryBox: Uint8Array;
  pssh?: { inMoov?: boolean; topLevel?: boolean };
}

/** Assemble a minimal classic single-track MP4 from a (possibly encrypted) stsd. */
function buildClassicMp4(opts: ClassicOpts): Uint8Array {
  const minf = box(
    'minf',
    opts.mediaHeader,
    box('dinf', buildDref()),
    buildStbl(buildStsd(opts.sampleEntryBox)),
  );
  const mdia = box('mdia', buildMdhd(), buildHdlr(opts.handlerType), minf);
  const trak = box('trak', buildTkhd(1), mdia);

  const moovParts: Uint8Array[] = [buildMvhd()];
  if (opts.pssh?.inMoov) moovParts.push(buildPssh());
  moovParts.push(trak);
  const moov = box('moov', ...moovParts);

  const parts: Uint8Array[] = [buildFtyp(), moov];
  if (opts.pssh?.topLevel) parts.push(buildPssh());
  return concat(...parts);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseMp4 — CENC protection signalling', () => {
  it('surfaces protection for an encrypted audio (enca) track + pssh in moov', () => {
    const bytes = buildClassicMp4({
      handlerType: 'soun',
      mediaHeader: box('smhd', new Uint8Array(8)),
      sampleEntryBox: buildEnca('cenc'),
      pssh: { inMoov: true },
    });
    const file = parseMp4(bytes);

    expect(file.protection).not.toBeNull();
    const prot = file.protection!;
    expect(prot.tracks).toHaveLength(1);
    expect(prot.tracks[0]?.trackId).toBe(1);
    expect(prot.tracks[0]?.schemeType).toBe('cenc');
    expect(prot.tracks[0]?.originalFormat).toBe('mp4a');
    expect(prot.tracks[0]?.isProtected).toBe(true);
    expect(prot.tracks[0]?.perSampleIvSize).toBe(8);
    expect(prot.tracks[0]?.defaultKid).toBe(DEFAULT_KID_HEX);

    // pssh surfaced.
    expect(prot.psshList).toHaveLength(1);
    expect(prot.psshList[0]?.systemId).toBe('edef8ba979d64acea3c827dcd51d21ed');
    expect(prot.psshList[0]?.kids).toEqual([DEFAULT_KID_HEX]);
    expect(prot.psshList[0]?.dataSize).toBe(4);

    // The track is still fully usable: the inner mp4a entry is unwrapped.
    expect(file.tracks[0]?.sampleEntry.kind).toBe('audio');
  });

  it('surfaces protection for an encrypted video (encv) track wrapping avc1', () => {
    const bytes = buildClassicMp4({
      handlerType: 'vide',
      mediaHeader: box('vmhd', new Uint8Array(12)),
      sampleEntryBox: buildEncv('cbcs'),
    });
    const file = parseMp4(bytes);

    expect(file.protection).not.toBeNull();
    expect(file.protection?.tracks[0]?.schemeType).toBe('cbcs');
    expect(file.protection?.tracks[0]?.originalFormat).toBe('avc1');
    expect(file.protection?.psshList).toEqual([]);

    // The inner avc1 entry is unwrapped, so the track parses as video.
    const entry = file.tracks[0]?.sampleEntry;
    expect(entry?.kind).toBe('video');
    if (entry?.kind === 'video') {
      expect(entry.entry.format).toBe('avc1');
      expect(entry.entry.width).toBe(320);
    }
  });

  it('collects a top-level pssh even without an encrypted track', () => {
    // Unencrypted mp4a track, but a stray top-level pssh box.
    const mp4a = box(
      'mp4a',
      (() => {
        const header = new Uint8Array(28);
        header[7] = 1;
        u32(header, 16, (1 << 16) | 16);
        u32(header, 24, 44100 << 16);
        return concat(header, buildEsds());
      })(),
    );
    const bytes = buildClassicMp4({
      handlerType: 'soun',
      mediaHeader: box('smhd', new Uint8Array(8)),
      sampleEntryBox: mp4a,
      pssh: { topLevel: true },
    });
    const file = parseMp4(bytes);

    expect(file.protection).not.toBeNull();
    expect(file.protection?.tracks).toEqual([]); // no encrypted tracks
    expect(file.protection?.psshList).toHaveLength(1);
  });

  it('returns protection: null for an unencrypted classic M4A file', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);
    expect(file.protection).toBeNull();
  });

  it('returns protection: null for an unencrypted fragmented MP4', () => {
    const bytes = buildMinimalFmp4({ sampleCount: 3, sampleSize: 4 });
    const file = parseMp4(bytes);
    expect(file.isFragmented).toBe(true);
    expect(file.protection).toBeNull();
  });
});
