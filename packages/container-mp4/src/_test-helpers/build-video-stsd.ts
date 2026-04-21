/**
 * Programmatic video stsd / codec-config byte builders for tests.
 *
 * No committed binary fixtures — all test data generated in-memory.
 */

// ---------------------------------------------------------------------------
// Low-level write helpers
// ---------------------------------------------------------------------------

function writeU8(buf: Uint8Array, offset: number, v: number): void {
  buf[offset] = v & 0xff;
}

function writeU16BE(buf: Uint8Array, offset: number, v: number): void {
  buf[offset] = (v >> 8) & 0xff;
  buf[offset + 1] = v & 0xff;
}

function writeU32BE(buf: Uint8Array, offset: number, v: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, v >>> 0, false);
}

function writeFourCC(buf: Uint8Array, offset: number, s: string): void {
  for (let i = 0; i < 4; i++) {
    buf[offset + i] = (s.charCodeAt(i) ?? 0x20) & 0xff;
  }
}

function wrapBox(type: string, payload: Uint8Array): Uint8Array {
  const size = 8 + payload.length;
  const out = new Uint8Array(size);
  writeU32BE(out, 0, size);
  writeFourCC(out, 4, type);
  out.set(payload, 8);
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
// VisualSampleEntry 78-byte common header
// ---------------------------------------------------------------------------

/**
 * Build the 78-byte VisualSampleEntry payload prefix.
 * codec-config child and extraBoxes are appended by each builder.
 */
export function buildVisualSampleEntryHeader(
  width: number,
  height: number,
  compressorName = '',
): Uint8Array {
  const out = new Uint8Array(78);
  // offset 0-5: reserved (zero)
  // offset 6: data_reference_index = 1
  writeU16BE(out, 6, 1);
  // offset 8-23: pre_defined/reserved (zero)
  // offset 24: width
  writeU16BE(out, 24, width);
  // offset 26: height
  writeU16BE(out, 26, height);
  // offset 28: horizresolution = 0x00480000 (72 dpi Q16.16)
  writeU32BE(out, 28, 0x00480000);
  // offset 32: vertresolution = 0x00480000
  writeU32BE(out, 32, 0x00480000);
  // offset 36: reserved (zero)
  // offset 40: frame_count = 1
  writeU16BE(out, 40, 1);
  // offset 42: compressorname Pascal string (length byte + 31 chars)
  const nameBytes = new TextEncoder().encode(compressorName);
  const nameLen = Math.min(nameBytes.length, 31);
  out[42] = nameLen;
  out.set(nameBytes.subarray(0, nameLen), 43);
  // offset 74: depth = 0x0018
  writeU16BE(out, 74, 0x0018);
  // offset 76: pre_defined = -1 (0xFFFF)
  out[76] = 0xff;
  out[77] = 0xff;
  return out;
}

/**
 * Wrap a visual sample entry header + codec-config box + extraBoxes
 * into a full sample entry box (size + 4cc).
 */
function wrapVisualEntry(
  fourCC: string,
  header: Uint8Array,
  configBoxType: string,
  configPayload: Uint8Array,
  ...extraBoxes: Uint8Array[]
): Uint8Array {
  const configBox = wrapBox(configBoxType, configPayload);
  const parts: Uint8Array[] = [header, configBox, ...extraBoxes];
  const payload = concat(...parts);
  return wrapBox(fourCC, payload);
}

// ---------------------------------------------------------------------------
// avcC payload builders
// ---------------------------------------------------------------------------

/**
 * Build a minimal avcC payload.
 *
 * @param profile           AVCProfileIndication (e.g. 0x42 = Baseline, 0x4d = Main, 0x64 = High)
 * @param profileCompat     profile_compatibility
 * @param level             AVCLevelIndication (e.g. 0x1e = 30, 0x28 = 40)
 * @param nalLenMinus1      lengthSizeMinusOne (0, 1, or 3)
 * @param spsNalus          SPS NAL unit byte arrays
 * @param ppsNalus          PPS NAL unit byte arrays
 * @param trailingExt       Optional High-profile trailing extension bytes
 */
export function buildAvcCPayload(
  profile: number,
  profileCompat: number,
  level: number,
  nalLenMinus1: 0 | 1 | 3 = 3,
  spsNalus: Uint8Array[] = [new Uint8Array([0x67, 0x42, 0xe0, 0x1e])],
  ppsNalus: Uint8Array[] = [new Uint8Array([0x68, 0xce, 0x38, 0x80])],
  trailingExt?: Uint8Array,
): Uint8Array {
  const parts: number[] = [];

  // configurationVersion = 1
  parts.push(1);
  // AVCProfileIndication
  parts.push(profile);
  // profile_compatibility
  parts.push(profileCompat);
  // AVCLevelIndication
  parts.push(level);
  // 0b111111xx | lengthSizeMinusOne
  parts.push(0xfc | nalLenMinus1);
  // 0b111xxxxx | numSPS
  parts.push(0xe0 | (spsNalus.length & 0x1f));

  for (const sps of spsNalus) {
    parts.push((sps.length >> 8) & 0xff, sps.length & 0xff);
    for (const b of sps) parts.push(b);
  }

  // numPPS
  parts.push(ppsNalus.length & 0xff);
  for (const pps of ppsNalus) {
    parts.push((pps.length >> 8) & 0xff, pps.length & 0xff);
    for (const b of pps) parts.push(b);
  }

  if (trailingExt) {
    for (const b of trailingExt) parts.push(b);
  }

  return new Uint8Array(parts);
}

/**
 * Build the High-profile trailing extension for avcC.
 */
export function buildAvcCHighExtension(
  chromaFormat = 1,
  bitDepthLumaMinus8 = 0,
  bitDepthChromaMinus8 = 0,
  spsExtNalus: Uint8Array[] = [],
): Uint8Array {
  const parts: number[] = [];
  parts.push(0xfc | (chromaFormat & 0x03));
  parts.push(0xf8 | (bitDepthLumaMinus8 & 0x07));
  parts.push(0xf8 | (bitDepthChromaMinus8 & 0x07));
  parts.push(spsExtNalus.length & 0xff);
  for (const ext of spsExtNalus) {
    parts.push((ext.length >> 8) & 0xff, ext.length & 0xff);
    for (const b of ext) parts.push(b);
  }
  return new Uint8Array(parts);
}

/**
 * Build a complete avc1 or avc3 sample entry box.
 */
export function buildAvcSampleEntry(
  fourCC: 'avc1' | 'avc3',
  width: number,
  height: number,
  avcCPayload: Uint8Array,
  extraBoxes: Uint8Array[] = [],
): Uint8Array {
  const header = buildVisualSampleEntryHeader(width, height);
  return wrapVisualEntry(fourCC, header, 'avcC', avcCPayload, ...extraBoxes);
}

// ---------------------------------------------------------------------------
// hvcC payload builders
// ---------------------------------------------------------------------------

/**
 * Build a minimal hvcC payload.
 */
export function buildHvcCPayload(
  profileSpace: 0 | 1 | 2 | 3 = 0,
  tierFlag: 0 | 1 = 0,
  profileIdc = 1,
  profileCompatFlags = 0x60000000,
  constraintFlags: Uint8Array = new Uint8Array(6),
  levelIdc = 93,
  arrays: Array<{ type: number; nalus: Uint8Array[] }> = [],
): Uint8Array {
  const parts: number[] = [];

  // [0] configurationVersion = 1
  parts.push(1);

  // [1] general_profile_space:2 | general_tier_flag:1 | general_profile_idc:5
  parts.push(((profileSpace & 0x03) << 6) | ((tierFlag & 0x01) << 5) | (profileIdc & 0x1f));

  // [2..5] general_profile_compatibility_flags:u32 (big-endian)
  parts.push(
    (profileCompatFlags >>> 24) & 0xff,
    (profileCompatFlags >>> 16) & 0xff,
    (profileCompatFlags >>> 8) & 0xff,
    profileCompatFlags & 0xff,
  );

  // [6..11] general_constraint_indicator_flags:u8[6]
  for (let i = 0; i < 6; i++) parts.push(constraintFlags[i] ?? 0);

  // [12] general_level_idc
  parts.push(levelIdc);

  // [13..14] 0b1111xxxxxxxxxxxx min_spatial_segmentation_idc=0
  parts.push(0xf0, 0x00);

  // [15] 0b111111xx parallelismType=0
  parts.push(0xfc);

  // [16] 0b111111xx chromaFormat=1 (4:2:0)
  parts.push(0xfc | 0x01);

  // [17] 0b11111xxx bitDepthLumaMinus8=0
  parts.push(0xf8);

  // [18] 0b11111xxx bitDepthChromaMinus8=0
  parts.push(0xf8);

  // [19..20] avgFrameRate=0
  parts.push(0x00, 0x00);

  // [21] constantFrameRate:2 | numTemporalLayers:3 | temporalIdNested:1 | lengthSizeMinusOne:2
  // 0b00 001 0 11 = 0x0b = one temporal layer, length=4
  parts.push(0x0b);

  // [22] numOfArrays
  parts.push(arrays.length & 0xff);

  for (const arr of arrays) {
    // array_completeness:1 | 0:1 | NAL_unit_type:6
    parts.push(0x80 | (arr.type & 0x3f)); // array_completeness=1
    // numNalus:u16
    parts.push((arr.nalus.length >> 8) & 0xff, arr.nalus.length & 0xff);
    for (const nalu of arr.nalus) {
      parts.push((nalu.length >> 8) & 0xff, nalu.length & 0xff);
      for (const b of nalu) parts.push(b);
    }
  }

  return new Uint8Array(parts);
}

/**
 * Build a complete hev1 or hvc1 sample entry box.
 */
export function buildHevcSampleEntry(
  fourCC: 'hev1' | 'hvc1',
  width: number,
  height: number,
  hvcCPayload: Uint8Array,
): Uint8Array {
  const header = buildVisualSampleEntryHeader(width, height);
  return wrapVisualEntry(fourCC, header, 'hvcC', hvcCPayload);
}

// ---------------------------------------------------------------------------
// vpcC payload builders
// ---------------------------------------------------------------------------

/**
 * Build a vpcC FullBox payload for VP9.
 */
export function buildVpcCPayload(
  profile = 0,
  level = 10,
  bitDepth = 8,
  chromaSubsampling = 1,
  videoFullRangeFlag: 0 | 1 = 0,
  colourPrimaries = 1,
  transferCharacteristics = 1,
  matrixCoefficients = 1,
  initData: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const out = new Uint8Array(12 + initData.length);
  // [0] version = 1 (FullBox)
  out[0] = 1;
  // [1..3] flags = 0
  // [4] profile
  out[4] = profile & 0xff;
  // [5] level
  out[5] = level & 0xff;
  // [6] bitDepth:4 | chromaSubsampling:3 | videoFullRangeFlag:1
  out[6] =
    ((bitDepth & 0x0f) << 4) | ((chromaSubsampling & 0x07) << 1) | (videoFullRangeFlag & 0x01);
  // [7] colourPrimaries
  out[7] = colourPrimaries & 0xff;
  // [8] transferCharacteristics
  out[8] = transferCharacteristics & 0xff;
  // [9] matrixCoefficients
  out[9] = matrixCoefficients & 0xff;
  // [10..11] codecInitializationDataSize
  writeU16BE(out, 10, initData.length);
  // [12..] codecInitializationData
  out.set(initData, 12);
  return out;
}

/**
 * Build a complete vp09 sample entry box.
 */
export function buildVp09SampleEntry(
  width: number,
  height: number,
  vpcCPayload: Uint8Array,
): Uint8Array {
  const header = buildVisualSampleEntryHeader(width, height);
  return wrapVisualEntry('vp09', header, 'vpcC', vpcCPayload);
}

// ---------------------------------------------------------------------------
// av1C payload builders
// ---------------------------------------------------------------------------

/**
 * Build an av1C payload.
 */
export function buildAv1CPayload(
  seqProfile = 0,
  seqLevelIdx0 = 4,
  seqTier0: 0 | 1 = 0,
  highBitdepth: 0 | 1 = 0,
  twelveBit: 0 | 1 = 0,
  monochrome: 0 | 1 = 0,
  chromaSubsamplingX: 0 | 1 = 1,
  chromaSubsamplingY: 0 | 1 = 1,
  chromaSamplePosition = 0,
  initialPresentationDelayPresent: 0 | 1 = 0,
  initialPresentationDelayMinusOne = 0,
  configObus: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const out = new Uint8Array(4 + configObus.length);
  // [0] marker:1(=1) | version:7(=1) = 0x81
  out[0] = 0x81;
  // [1] seq_profile:3 | seq_level_idx_0:5
  out[1] = ((seqProfile & 0x07) << 5) | (seqLevelIdx0 & 0x1f);
  // [2] seq_tier_0:1 | high_bitdepth:1 | twelve_bit:1 | monochrome:1 |
  //     chroma_subsampling_x:1 | chroma_subsampling_y:1 | chroma_sample_position:2
  out[2] =
    ((seqTier0 & 1) << 7) |
    ((highBitdepth & 1) << 6) |
    ((twelveBit & 1) << 5) |
    ((monochrome & 1) << 4) |
    ((chromaSubsamplingX & 1) << 3) |
    ((chromaSubsamplingY & 1) << 2) |
    (chromaSamplePosition & 0x03);
  // [3] 000:3 | initial_presentation_delay_present:1 | ...4 bits
  out[3] = ((initialPresentationDelayPresent & 1) << 4) | (initialPresentationDelayMinusOne & 0x0f);
  // [4..] configOBUs
  out.set(configObus, 4);
  return out;
}

/**
 * Build a complete av01 sample entry box.
 */
export function buildAv01SampleEntry(
  width: number,
  height: number,
  av1CPayload: Uint8Array,
): Uint8Array {
  const header = buildVisualSampleEntryHeader(width, height);
  return wrapVisualEntry('av01', header, 'av1C', av1CPayload);
}

// ---------------------------------------------------------------------------
// stsd wrapper helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a sample entry box in an stsd FullBox.
 */
export function wrapStsd(sampleEntryBox: Uint8Array): Uint8Array {
  // stsd FullBox: version(1)+flags(3)+entry_count(4) = 8 bytes
  const payloadSize = 8 + sampleEntryBox.length;
  const boxSize = 8 + payloadSize;
  const out = new Uint8Array(boxSize);
  writeU32BE(out, 0, boxSize);
  writeFourCC(out, 4, 'stsd');
  // version=0, flags=0 at 8-11
  writeU32BE(out, 12, 1); // entry_count = 1
  out.set(sampleEntryBox, 16);
  return out;
}

/**
 * Extract the sample entry payload from an stsd box.
 * Returns the bytes of the first sample entry box payload (after size+type).
 */
export function extractFirstSampleEntryPayload(stsdBox: Uint8Array): Uint8Array {
  const view = new DataView(stsdBox.buffer, stsdBox.byteOffset, stsdBox.byteLength);
  // Skip stsd box header (8) + FullBox prefix (8) = 16 bytes
  const entrySize = view.getUint32(16, false);
  // Entry payload starts at offset 16+8 = 24
  return stsdBox.subarray(24, 16 + entrySize);
}
