/**
 * Programmatic fMP4 byte-stream builder for tests.
 *
 * Produces minimal but spec-compliant fragmented MP4 byte arrays in memory,
 * without any binary fixtures on disk. The builder follows the same box layout
 * as real encoders so all parser paths are exercised.
 *
 * Usage:
 *   const bytes = buildMinimalFmp4({ sampleCount: 10, sampleSize: 4 });
 *   const file = parseMp4(bytes);
 *   expect(file.isFragmented).toBe(true);
 *
 * Box layout produced:
 *   ftyp (major_brand='iso5')
 *   moov
 *     mvhd
 *     trak
 *       tkhd
 *       mdia
 *         mdhd
 *         hdlr (soun)
 *         minf
 *           smhd
 *           dinf/dref
 *           stbl (empty — zero-sample)
 *             stsd/mp4a/esds
 *             stts (entry_count=0)
 *             stsc (entry_count=0)
 *             stsz (sample_count=0)
 *             stco (entry_count=0)
 *     mvex
 *       trex
 *   [moof mdat]+
 */

// ---------------------------------------------------------------------------
// Low-level write helpers
// ---------------------------------------------------------------------------

function writeU8(buf: Uint8Array, offset: number, v: number): void {
  buf[offset] = v & 0xff;
}

function writeU32BE(buf: Uint8Array, offset: number, v: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, v >>> 0, false);
}

function writeI32BE(buf: Uint8Array, offset: number, v: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setInt32(offset, v, false);
}

function writeFourCC(buf: Uint8Array, offset: number, s: string): void {
  for (let i = 0; i < 4; i++) {
    buf[offset + i] = (s.charCodeAt(i) ?? 0x20) & 0xff;
  }
}

function boxHeader(size: number, type: string): Uint8Array {
  const h = new Uint8Array(8);
  writeU32BE(h, 0, size);
  writeFourCC(h, 4, type);
  return h;
}

function wrapBox(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const total = payloads.reduce((s, p) => s + p.length, 0);
  const size = 8 + total;
  const out = new Uint8Array(size);
  writeU32BE(out, 0, size);
  writeFourCC(out, 4, type);
  let off = 8;
  for (const p of payloads) {
    out.set(p, off);
    off += p.length;
  }
  return out;
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

// ---------------------------------------------------------------------------
// ftyp box
// ---------------------------------------------------------------------------

function buildFtyp(brand = 'iso5'): Uint8Array {
  // ftyp payload: major_brand(4) + minor_version(4) + compatible_brands(n*4)
  const compatible = ['iso5', 'iso6', 'isom'];
  const payload = new Uint8Array(8 + compatible.length * 4);
  writeFourCC(payload, 0, brand);
  writeU32BE(payload, 4, 0); // minor_version
  for (let i = 0; i < compatible.length; i++) {
    writeFourCC(payload, 8 + i * 4, compatible[i] ?? 'isom');
  }
  return wrapBox('ftyp', payload);
}

// ---------------------------------------------------------------------------
// moov/mvhd
// ---------------------------------------------------------------------------

function buildMvhd(timescale = 1000, duration = 0): Uint8Array {
  // mvhd v0 payload layout (100 bytes):
  //   0:  version(1)+flags(3)
  //   4:  creation_time(4)
  //   8:  modification_time(4)
  //  12:  timescale(4)
  //  16:  duration(4)
  //  20:  rate(4)  = 0x00010000
  //  24:  volume(2) = 0x0100
  //  26:  reserved(10)
  //  36:  matrix(36) — unity
  //  72:  pre_defined(24)
  //  96:  next_track_ID(4)
  // Total: 100 bytes
  const payload = new Uint8Array(100);
  writeU8(payload, 0, 0); // version 0
  // flags = 0
  writeU32BE(payload, 12, timescale);
  writeU32BE(payload, 16, duration);
  writeU32BE(payload, 20, 0x00010000); // rate = 1.0 (16.16 fixed-point)
  payload[24] = 0x01;
  payload[25] = 0x00; // volume = 1.0 (8.8 fixed-point)
  // Unity matrix at offset 36: a=1 b=0 c=0 d=1 tx=0 ty=0
  writeU32BE(payload, 36, 0x00010000); // a
  writeU32BE(payload, 52, 0x00010000); // d
  writeU32BE(payload, 68, 0x40000000); // w (denominator)
  writeU32BE(payload, 96, 1); // next_track_ID = 1
  return wrapBox('mvhd', payload);
}

// ---------------------------------------------------------------------------
// moov/trak
// ---------------------------------------------------------------------------

function buildTkhd(trackId = 1, duration = 0): Uint8Array {
  // tkhd v0 payload layout per ISO/IEC 14496-12 §8.3.2 (84 bytes total):
  //   0:  version(1)+flags(3)
  //   4:  creation_time(u32)
  //   8:  modification_time(u32)
  //  12:  track_ID(u32)
  //  16:  reserved(u32)
  //  20:  duration(u32)
  //  24:  reserved(u64)   — 8 bytes
  //  32:  layer(i16)
  //  34:  alternate_group(i16)
  //  36:  volume(16.16)   — 2 bytes
  //  38:  reserved(u16)
  //  40:  matrix(u32[9])  — 36 bytes
  //  76:  width(u32)
  //  80:  height(u32)
  // Total: 84 bytes
  const payload = new Uint8Array(84);
  const view = new DataView(payload.buffer);
  payload[0] = 0; // version = 0
  payload[3] = 0x03; // flags = track_enabled | track_in_movie
  // creation_time=0 at 4, modification_time=0 at 8
  view.setUint32(12, trackId, false);
  // reserved=0 at 16
  view.setUint32(20, duration, false);
  // reserved 8 bytes at 24
  // layer=0 at 32, alternate_group=0 at 34
  // volume=0 at 36, reserved=0 at 38
  // identity matrix at 40: [a=1,b=0,u=0, c=0,d=1,v=0, tx=0,ty=0,w=0x40000000]
  view.setUint32(40, 0x00010000, false); // a
  view.setUint32(44, 0, false);
  view.setUint32(48, 0, false);
  view.setUint32(52, 0, false);
  view.setUint32(56, 0x00010000, false); // d
  view.setUint32(60, 0, false);
  view.setUint32(64, 0, false);
  view.setUint32(68, 0, false);
  view.setUint32(72, 0x40000000, false); // w
  // width=0 at 76, height=0 at 80
  return wrapBox('tkhd', payload);
}

function buildMdhd(timescale = 44100, duration = 0): Uint8Array {
  // mdhd v0: version(1)+flags(3)+creation(4)+mod(4)+timescale(4)+duration(4)+
  //          language(2)+pre_defined(2) = 24 bytes
  const payload = new Uint8Array(24);
  writeU8(payload, 0, 0); // version
  writeU32BE(payload, 12, timescale);
  writeU32BE(payload, 16, duration);
  payload[20] = 0x55;
  payload[21] = 0xc4; // language 'und'
  return wrapBox('mdhd', payload);
}

function buildHdlr(): Uint8Array {
  // hdlr FullBox: version(1)+flags(3)+pre_defined(4)+handler_type(4)+reserved(12)+name(?)
  const name = new TextEncoder().encode('SoundHandler\0');
  const payload = new Uint8Array(4 + 4 + 4 + 12 + name.length);
  writeU8(payload, 0, 0); // version
  writeFourCC(payload, 8, 'soun'); // handler_type
  payload.set(name, 24);
  return wrapBox('hdlr', payload);
}

function buildSmhd(): Uint8Array {
  // smhd FullBox: version(1)+flags(3)+balance(2)+reserved(2) = 8 bytes
  return wrapBox('smhd', new Uint8Array(8));
}

function buildDref(): Uint8Array {
  // dref FullBox: version(1)+flags(3)+entry_count(4) + url  entry
  const urlEntry = new Uint8Array(12);
  writeU32BE(urlEntry, 0, 12);
  writeFourCC(urlEntry, 4, 'url ');
  urlEntry[11] = 0x01; // self-contained
  const payload = new Uint8Array(8 + 12);
  writeU32BE(payload, 4, 1); // entry_count
  payload.set(urlEntry, 8);
  return wrapBox('dref', payload);
}

function buildEsds(objectTypeIndication = 0x40): Uint8Array {
  // Minimal esds FullBox wrapping a simple descriptor chain.
  // We emit the smallest valid AAC AudioSpecificConfig (2 bytes: 0x11 0x90 = AAC-LC 44100 mono).
  const asc = new Uint8Array([0x11, 0x90]);
  // ES_Descriptor tag=0x03, len variable.
  // DecoderConfigDescriptor tag=0x04.
  // DecoderSpecificInfo tag=0x05.
  // SLConfigDescriptor tag=0x06.
  const decoderSpecificInfo = new Uint8Array([
    0x05, // tag
    asc.length,
    ...asc,
  ]);
  const decoderConfig = new Uint8Array([
    0x04, // tag
    13 + decoderSpecificInfo.length,
    objectTypeIndication,
    0x15, // streamType=audio(0x5)<<2 | upstream=0 | reserved=1
    0x00,
    0x00,
    0x00, // bufferSizeDB (24-bit)
    0x00,
    0x00,
    0x00,
    0x00, // maxBitrate (32-bit)
    0x00,
    0x00,
    0x00,
    0x00, // avgBitrate (32-bit)
    ...decoderSpecificInfo,
  ]);
  const slConfig = new Uint8Array([0x06, 0x01, 0x02]); // predefined=2
  const esDescriptor = new Uint8Array([
    0x03, // tag
    3 + decoderConfig.length + slConfig.length,
    0x00,
    0x01, // ES_ID
    0x00, // flags
    ...decoderConfig,
    ...slConfig,
  ]);
  // esds FullBox payload: version(1)+flags(3)+descriptor
  const payload = new Uint8Array(4 + esDescriptor.length);
  payload.set(esDescriptor, 4);
  return wrapBox('esds', payload);
}

function buildMp4a(channelCount = 1, sampleRate = 44100, objectTypeIndication = 0x40): Uint8Array {
  // mp4a SampleEntry: reserved(6)+data_ref_index(2)+reserved2(8)+
  //                   channelcount(2)+samplesize(2)+pre_defined(2)+reserved3(2)+
  //                   samplerate(4)+esds_box
  const esdsBox = buildEsds(objectTypeIndication);
  const payload = new Uint8Array(28 + esdsBox.length);
  // data_reference_index = 1
  payload[7] = 0x01;
  // channelcount
  writeU32BE(payload, 16, (channelCount << 16) | 16); // channelcount | samplesize=16
  // samplerate (16.16 fixed-point)
  writeU32BE(payload, 24, sampleRate << 16);
  payload.set(esdsBox, 28);
  return wrapBox('mp4a', payload);
}

function buildStsd(channelCount = 1, sampleRate = 44100): Uint8Array {
  const mp4aBox = buildMp4a(channelCount, sampleRate);
  // stsd FullBox: version(1)+flags(3)+entry_count(4) + entries
  const payload = new Uint8Array(8 + mp4aBox.length);
  writeU32BE(payload, 4, 1); // entry_count = 1
  payload.set(mp4aBox, 8);
  return wrapBox('stsd', payload);
}

/** Build an empty FullBox table (stts/stsc/stsz/stco with entry_count=0). */
function buildEmptyTable(type: string): Uint8Array {
  // For stsz: version(1)+flags(3)+sample_size(4)+sample_count(4) = 12 bytes
  // For others: version(1)+flags(3)+entry_count(4) = 8 bytes
  if (type === 'stsz') {
    return wrapBox('stsz', new Uint8Array(12));
  }
  return wrapBox(type, new Uint8Array(8));
}

function buildStbl(channelCount = 1, sampleRate = 44100): Uint8Array {
  return wrapBox(
    'stbl',
    buildStsd(channelCount, sampleRate),
    buildEmptyTable('stts'),
    buildEmptyTable('stsc'),
    buildEmptyTable('stsz'),
    buildEmptyTable('stco'),
  );
}

function buildMinf(channelCount = 1, sampleRate = 44100): Uint8Array {
  return wrapBox(
    'minf',
    buildSmhd(),
    wrapBox('dinf', buildDref()),
    buildStbl(channelCount, sampleRate),
  );
}

function buildMdia(
  timescale = 44100,
  duration = 0,
  channelCount = 1,
  sampleRate = 44100,
): Uint8Array {
  return wrapBox(
    'mdia',
    buildMdhd(timescale, duration),
    buildHdlr(),
    buildMinf(channelCount, sampleRate),
  );
}

function buildTrak(trackId = 1, timescale = 44100): Uint8Array {
  return wrapBox('trak', buildTkhd(trackId, 0), buildMdia(timescale, 0));
}

// ---------------------------------------------------------------------------
// mvex / trex
// ---------------------------------------------------------------------------

function buildTrex(
  trackId = 1,
  defaultDuration = 1024,
  defaultSize = 0,
  defaultFlags = 0,
): Uint8Array {
  // trex FullBox: version(1)+flags(3)+track_ID(4)+desc_index(4)+duration(4)+size(4)+flags(4)
  const payload = new Uint8Array(24);
  writeU32BE(payload, 4, trackId);
  writeU32BE(payload, 8, 1); // default_sample_description_index = 1
  writeU32BE(payload, 12, defaultDuration);
  writeU32BE(payload, 16, defaultSize);
  writeU32BE(payload, 20, defaultFlags);
  return wrapBox('trex', payload);
}

export interface MehdOptions {
  fragmentDuration: number;
  version?: 0 | 1;
}

function buildMehd(opts: MehdOptions): Uint8Array {
  const version = opts.version ?? 0;
  if (version === 1) {
    // v1: version(1)+flags(3)+fragment_duration_u64(8) = 12 bytes payload
    const payload = new Uint8Array(12);
    writeU8(payload, 0, 1);
    const v = opts.fragmentDuration;
    const hi = Math.floor(v / 0x100000000);
    writeU32BE(payload, 4, hi);
    writeU32BE(payload, 8, v >>> 0);
    return wrapBox('mehd', payload);
  }
  // v0: version(1)+flags(3)+fragment_duration_u32(4) = 8 bytes payload
  const payload = new Uint8Array(8);
  writeU32BE(payload, 4, opts.fragmentDuration);
  return wrapBox('mehd', payload);
}

function buildMvex(
  trackId = 1,
  defaultDuration = 1024,
  defaultSize = 0,
  defaultFlags = 0,
  mehd?: MehdOptions,
): Uint8Array {
  const trexBox = buildTrex(trackId, defaultDuration, defaultSize, defaultFlags);
  if (mehd) {
    return wrapBox('mvex', buildMehd(mehd), trexBox);
  }
  return wrapBox('mvex', trexBox);
}

// ---------------------------------------------------------------------------
// moof / mdat
// ---------------------------------------------------------------------------

function buildMfhd(sequenceNumber: number): Uint8Array {
  // mfhd FullBox: version(1)+flags(3)+sequence_number(4)
  const payload = new Uint8Array(8);
  writeU32BE(payload, 4, sequenceNumber);
  return wrapBox('mfhd', payload);
}

export interface TfhdOptions {
  trackId?: number;
  /** When set, includes base-data-offset-present flag (0x000001). */
  baseDataOffset?: number;
  /** When true, sets default-base-is-moof flag (0x020000). Ignored if baseDataOffset set. */
  defaultBaseIsMoof?: boolean;
  defaultSampleDuration?: number;
  defaultSampleSize?: number;
  defaultSampleFlags?: number;
  durationIsEmpty?: boolean;
}

function buildTfhd(opts: TfhdOptions): Uint8Array {
  const trackId = opts.trackId ?? 1;
  let flags = 0;

  if (opts.baseDataOffset !== undefined) {
    flags |= 0x000001;
  }
  if (opts.defaultSampleDuration !== undefined) {
    flags |= 0x000008;
  }
  if (opts.defaultSampleSize !== undefined) {
    flags |= 0x000010;
  }
  if (opts.defaultSampleFlags !== undefined) {
    flags |= 0x000020;
  }
  if (opts.durationIsEmpty) {
    flags |= 0x010000;
  }
  if (opts.defaultBaseIsMoof && opts.baseDataOffset === undefined) {
    flags |= 0x020000;
  }

  // Payload layout: version(1)+flags(3)+track_ID(4)+optional_fields...
  // Compute size.
  let payloadSize = 4 + 4; // prefix + track_ID
  if (flags & 0x000001) payloadSize += 8; // base_data_offset u64
  if (flags & 0x000002) payloadSize += 4;
  if (flags & 0x000008) payloadSize += 4;
  if (flags & 0x000010) payloadSize += 4;
  if (flags & 0x000020) payloadSize += 4;

  const payload = new Uint8Array(payloadSize);
  // version=0, flags=...
  payload[1] = (flags >> 16) & 0xff;
  payload[2] = (flags >> 8) & 0xff;
  payload[3] = flags & 0xff;
  writeU32BE(payload, 4, trackId);

  let cursor = 8;

  if (flags & 0x000001 && opts.baseDataOffset !== undefined) {
    const v = opts.baseDataOffset;
    const hi = Math.floor(v / 0x100000000);
    writeU32BE(payload, cursor, hi);
    writeU32BE(payload, cursor + 4, v >>> 0);
    cursor += 8;
  }
  if (flags & 0x000008 && opts.defaultSampleDuration !== undefined) {
    writeU32BE(payload, cursor, opts.defaultSampleDuration);
    cursor += 4;
  }
  if (flags & 0x000010 && opts.defaultSampleSize !== undefined) {
    writeU32BE(payload, cursor, opts.defaultSampleSize);
    cursor += 4;
  }
  if (flags & 0x000020 && opts.defaultSampleFlags !== undefined) {
    writeU32BE(payload, cursor, opts.defaultSampleFlags);
    cursor += 4;
  }

  return wrapBox('tfhd', payload);
}

export interface TfdtOptions {
  baseMediaDecodeTime: number;
  version?: 0 | 1;
}

function buildTfdt(opts: TfdtOptions): Uint8Array {
  const version = opts.version ?? 0;
  if (version === 1) {
    const payload = new Uint8Array(12);
    writeU8(payload, 0, 1);
    const v = opts.baseMediaDecodeTime;
    const hi = Math.floor(v / 0x100000000);
    writeU32BE(payload, 4, hi);
    writeU32BE(payload, 8, v >>> 0);
    return wrapBox('tfdt', payload);
  }
  const payload = new Uint8Array(8);
  writeU32BE(payload, 4, opts.baseMediaDecodeTime);
  return wrapBox('tfdt', payload);
}

export interface TrunSample {
  duration?: number;
  size?: number;
  flags?: number;
  compositionTimeOffset?: number;
}

export interface TrunOptions {
  dataOffset?: number;
  firstSampleFlags?: number;
  version?: 0 | 1;
  samples: TrunSample[];
}

function buildTrun(opts: TrunOptions): Uint8Array {
  const version = opts.version ?? 0;
  const samples = opts.samples;
  const sampleCount = samples.length;

  // Determine which per-sample fields are present.
  const hasDuration = samples.some((s) => s.duration !== undefined);
  const hasSize = samples.some((s) => s.size !== undefined);
  const hasSampleFlags = samples.some((s) => s.flags !== undefined);
  const hasCto = samples.some((s) => s.compositionTimeOffset !== undefined);

  let flags = 0;
  if (opts.dataOffset !== undefined) flags |= 0x000001;
  if (opts.firstSampleFlags !== undefined) flags |= 0x000004;
  if (hasDuration) flags |= 0x000100;
  if (hasSize) flags |= 0x000200;
  if (hasSampleFlags) flags |= 0x000400;
  if (hasCto) flags |= 0x000800;

  // Compute payload size.
  let payloadSize = 8; // version+flags+sample_count
  if (flags & 0x000001) payloadSize += 4;
  if (flags & 0x000004) payloadSize += 4;

  // Per-sample size (accounting for trap 16).
  let perSample = 0;
  if (hasDuration) perSample += 4;
  if (hasSize) perSample += 4;
  if (hasSampleFlags) perSample += 4;
  if (hasCto) perSample += 4;
  payloadSize += perSample * sampleCount;

  // Trap 16: if first_sample_flags AND sample_flags both set, sample 0 omits sample_flags field.
  const trap16 = flags & 0x000004 && flags & 0x000400 && sampleCount > 0;
  if (trap16) payloadSize -= 4;

  const payload = new Uint8Array(payloadSize);
  payload[0] = version;
  payload[1] = (flags >> 16) & 0xff;
  payload[2] = (flags >> 8) & 0xff;
  payload[3] = flags & 0xff;
  writeU32BE(payload, 4, sampleCount);

  let cursor = 8;

  if (flags & 0x000001 && opts.dataOffset !== undefined) {
    writeI32BE(payload, cursor, opts.dataOffset);
    cursor += 4;
  }
  if (flags & 0x000004 && opts.firstSampleFlags !== undefined) {
    writeU32BE(payload, cursor, opts.firstSampleFlags);
    cursor += 4;
  }

  for (let i = 0; i < sampleCount; i++) {
    const s = samples[i] ?? {};

    if (hasDuration) {
      writeU32BE(payload, cursor, s.duration ?? 0);
      cursor += 4;
    }
    if (hasSize) {
      writeU32BE(payload, cursor, s.size ?? 0);
      cursor += 4;
    }
    if (hasSampleFlags) {
      // Trap 16: omit for sample 0 when first_sample_flags present.
      if (!(i === 0 && trap16)) {
        writeU32BE(payload, cursor, s.flags ?? 0);
        cursor += 4;
      }
    }
    if (hasCto) {
      if (version === 1) {
        writeI32BE(payload, cursor, s.compositionTimeOffset ?? 0);
      } else {
        writeU32BE(payload, cursor, s.compositionTimeOffset ?? 0);
      }
      cursor += 4;
    }
  }

  return wrapBox('trun', payload);
}

// ---------------------------------------------------------------------------
// Fragment configuration types
// ---------------------------------------------------------------------------

export interface FragmentSpec {
  sequenceNumber: number;
  tfhdOpts?: TfhdOptions;
  tfdt?: TfdtOptions;
  trun: TrunOptions;
  /** Sample payload bytes — one entry per sample. Defaults to zeros of trun sample sizes. */
  sampleData?: Uint8Array[];
}

export interface BuildFmp4Options {
  /** Major ftyp brand. Default 'iso5'. */
  brand?: string;
  /** Movie timescale (mvhd). Default 1000. */
  movieTimescale?: number;
  /** Media timescale (mdhd). Default 44100. */
  mediaTimescale?: number;
  /** Audio channel count. Default 1. */
  channelCount?: number;
  /** Track ID. Default 1. */
  trackId?: number;
  /** Default sample duration in trex. Default 1024. */
  trexDefaultDuration?: number;
  /** Default sample size in trex. Default 0 (unset). */
  trexDefaultSize?: number;
  /** Optional mehd (Movie Extends Header) inside mvex. */
  mehd?: MehdOptions;
  /** Fragment specs (one per moof+mdat pair). */
  fragments: FragmentSpec[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a minimal but valid fragmented MP4 byte stream from configuration.
 *
 * The returned buffer is suitable for direct use with parseMp4.
 *
 * Offset strategy: uses default-base-is-moof (tfhd flag 0x020000) unless the
 * caller provides explicit tfhdOpts. data_offset in trun is calculated as
 * (moof_size + 8) so it points to the mdat payload start.
 */
export function buildFmp4(opts: BuildFmp4Options): Uint8Array {
  const trackId = opts.trackId ?? 1;
  const trexDuration = opts.trexDefaultDuration ?? 1024;
  const trexSize = opts.trexDefaultSize ?? 0;

  const ftypBox = buildFtyp(opts.brand ?? 'iso5');

  const moovBox = wrapBox(
    'moov',
    buildMvhd(opts.movieTimescale ?? 1000),
    buildTrak(trackId, opts.mediaTimescale ?? 44100),
    buildMvex(trackId, trexDuration, trexSize, 0, opts.mehd),
  );

  // Build moof+mdat pairs; we need to know each moof's byte offset to compute
  // data_offset correctly, so we build them in two phases.
  const parts: Uint8Array[] = [ftypBox, moovBox];

  let currentOffset = ftypBox.length + moovBox.length;

  for (const frag of opts.fragments) {
    const { moofBox, mdatBox } = buildFragment(
      frag,
      trackId,
      currentOffset,
      trexDuration,
      trexSize,
    );
    parts.push(moofBox, mdatBox);
    currentOffset += moofBox.length + mdatBox.length;
  }

  return concat(...parts);
}

function buildFragment(
  frag: FragmentSpec,
  trackId: number,
  moofFileOffset: number,
  trexDefaultDuration?: number,
  trexDefaultSize?: number,
): { moofBox: Uint8Array; mdatBox: Uint8Array } {
  const tfhdOpts: TfhdOptions = frag.tfhdOpts ?? {
    trackId,
    defaultBaseIsMoof: true,
  };
  if (!tfhdOpts.trackId) {
    tfhdOpts.trackId = trackId;
  }

  // Collect sample bytes. Use cascade: per-sample size > tfhd default > trex default.
  const samples = frag.trun.samples;
  const samplePayloads: Uint8Array[] = samples.map((s, i) => {
    const provided = frag.sampleData?.[i];
    if (provided) {
      return provided;
    }
    const sz = s.size ?? tfhdOpts.defaultSampleSize ?? trexDefaultSize ?? 0;
    return new Uint8Array(sz);
  });

  const tfhdBox = buildTfhd(tfhdOpts);
  const tfdtBox = frag.tfdt ? buildTfdt(frag.tfdt) : null;

  // For the trun, if no dataOffset is set by caller and defaultBaseIsMoof is used,
  // we need to patch it. We'll compute: moof_size + 8 (mdat header).
  // To find moof_size we must build without a correct dataOffset first.
  const trunOptsNoOffset: TrunOptions = {
    ...frag.trun,
    dataOffset: frag.trun.dataOffset !== undefined ? frag.trun.dataOffset : undefined,
  };

  // Build a trial trun to measure moof size.
  // If no data offset given, compute it from measured moof size.
  let trunBox: Uint8Array;
  if (frag.trun.dataOffset === undefined && !tfhdOpts.baseDataOffset) {
    // Provisional trun with dataOffset=0 to measure.
    const trialTrun = buildTrun({ ...trunOptsNoOffset, dataOffset: 0 });
    const trafParts = tfdtBox ? [tfhdBox, tfdtBox, trialTrun] : [tfhdBox, trialTrun];
    const trafBox = wrapBox('traf', ...trafParts);
    const trialMoof = wrapBox('moof', buildMfhd(frag.sequenceNumber), trafBox);
    // data_offset = moof_size + 8 (mdat header size)
    const dataOffset = trialMoof.length + 8;
    trunBox = buildTrun({ ...frag.trun, dataOffset });
  } else {
    trunBox = buildTrun(frag.trun);
  }

  const trafParts = tfdtBox ? [tfhdBox, tfdtBox, trunBox] : [tfhdBox, trunBox];
  const trafBox = wrapBox('traf', ...trafParts);
  const moofBox = wrapBox('moof', buildMfhd(frag.sequenceNumber), trafBox);

  // Build mdat.
  const mdatPayload = concat(...samplePayloads);
  const mdatBox = wrapBox('mdat', mdatPayload);

  return { moofBox, mdatBox };
}

// ---------------------------------------------------------------------------
// Convenience builders
// ---------------------------------------------------------------------------

/**
 * Build a minimal fMP4 with a single fragment.
 *
 * @param sampleCount  Number of samples in the single fragment.
 * @param sampleSize   Bytes per sample (uniform size).
 * @param brand        ftyp major brand. Default 'iso5'.
 */
export function buildMinimalFmp4(opts: {
  sampleCount: number;
  sampleSize: number;
  brand?: string;
  sampleDuration?: number;
  mediaTimescale?: number;
}): Uint8Array {
  const sampleDuration = opts.sampleDuration ?? 1024;
  const samples: TrunSample[] = Array.from({ length: opts.sampleCount }, () => ({
    duration: sampleDuration,
    size: opts.sampleSize,
  }));

  return buildFmp4({
    brand: opts.brand,
    mediaTimescale: opts.mediaTimescale,
    fragments: [
      {
        sequenceNumber: 1,
        tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
        tfdt: { baseMediaDecodeTime: 0 },
        trun: { samples },
      },
    ],
  });
}

/**
 * Build an fMP4 with multiple fragments, each containing `samplesPerFragment` samples.
 *
 * Sequence numbers are 1-based; baseMediaDecodeTime increments by
 * sampleDuration * samplesPerFragment per fragment.
 */
export function buildMultiFragmentFmp4(opts: {
  fragmentCount: number;
  samplesPerFragment: number;
  sampleSize: number;
  sampleDuration?: number;
  brand?: string;
}): Uint8Array {
  const sampleDuration = opts.sampleDuration ?? 1024;
  const fragments: FragmentSpec[] = [];

  for (let f = 0; f < opts.fragmentCount; f++) {
    const baseTime = f * opts.samplesPerFragment * sampleDuration;
    const samples: TrunSample[] = Array.from({ length: opts.samplesPerFragment }, () => ({
      duration: sampleDuration,
      size: opts.sampleSize,
    }));

    fragments.push({
      sequenceNumber: f + 1,
      tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
      tfdt: { baseMediaDecodeTime: baseTime },
      trun: { samples },
    });
  }

  return buildFmp4({
    brand: opts.brand,
    fragments,
  });
}
