/**
 * Synthetic TIFF builder for @webcvt/image-legacy tests.
 *
 * Constructs minimal but spec-valid TIFF byte sequences in memory.
 * NO binary fixtures are committed to disk — every test fixture is built here.
 *
 * Supports: Compression 1 (NONE), 5 (LZW), 32773 (PackBits).
 * Byte orders: 'little' (II) and 'big' (MM).
 *
 * Multi-strip: when rowsPerStrip < height, each strip is compressed individually.
 */

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BuildTiffPage {
  width: number;
  height: number;
  photometric: 0 | 1 | 2 | 3;
  samplesPerPixel: number;
  bitsPerSample: number;
  compression: 1 | 5 | 32773;
  predictor?: 1 | 2;
  pixelData: Uint8Array;
  palette?: Uint16Array; // 3 * 2^bitsPerSample uint16 values
  /** Extra raw tags to inject verbatim. */
  extraTags?: Array<{ tag: number; type: number; values: number[] | string }>;
  rowsPerStrip?: number; // defaults to height (single strip)
}

export interface BuildTiffOptions {
  byteOrder: 'little' | 'big';
  pages: BuildTiffPage[];
}

/**
 * Build a synthetic TIFF file from the given options.
 * Returns the raw bytes as a Uint8Array.
 */
export function buildTiff(opts: BuildTiffOptions): Uint8Array {
  const writer = new TiffWriter(opts.byteOrder === 'little');
  writer.buildPages(opts.pages);
  return writer.assemble();
}

// ---------------------------------------------------------------------------
// Internal writer
// ---------------------------------------------------------------------------

const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  [TYPE_ASCII]: 1,
  [TYPE_SHORT]: 2,
  [TYPE_LONG]: 4,
  [TYPE_RATIONAL]: 8,
};

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  /** Raw byte representation of the value(s). */
  valueBytes: Uint8Array;
}

interface PageLayout {
  strips: Uint8Array[]; // per-strip compressed data
  rowsPerStrip: number;
  ifdEntries: IfdEntry[];
}

class TiffWriter {
  private readonly le: boolean;

  constructor(le: boolean) {
    this.le = le;
  }

  private readonly pageLayouts: PageLayout[] = [];

  buildPages(pages: BuildTiffPage[]): void {
    for (const page of pages) {
      this.pageLayouts.push(this.buildPage(page));
    }
  }

  private buildPage(page: BuildTiffPage): PageLayout {
    const rowsPerStrip = page.rowsPerStrip ?? page.height;
    const stripsPerImage = Math.ceil(page.height / rowsPerStrip);
    const rowBytes = Math.ceil((page.width * page.samplesPerPixel * page.bitsPerSample) / 8);

    // Split pixel data into per-strip chunks and compress each
    const strips: Uint8Array[] = [];
    for (let s = 0; s < stripsPerImage; s++) {
      const startRow = s * rowsPerStrip;
      const endRow = Math.min(startRow + rowsPerStrip, page.height);
      const stripRows = endRow - startRow;
      const stripRawData = page.pixelData.slice(startRow * rowBytes, endRow * rowBytes);
      strips.push(this.compressStrip(stripRawData, page.compression));
    }

    const entries: IfdEntry[] = [];

    // Required tags
    entries.push(this.makeShortOrLong(256, page.width)); // ImageWidth
    entries.push(this.makeShortOrLong(257, page.height)); // ImageLength

    // BitsPerSample — one SHORT per sample
    const bpsValues = new Array<number>(page.samplesPerPixel).fill(page.bitsPerSample);
    entries.push(this.makeShortArray(258, bpsValues));

    entries.push(this.makeShort(259, page.compression)); // Compression
    entries.push(this.makeShort(262, page.photometric)); // PhotometricInterpretation

    // StripOffsets — placeholder LONGs (patched in assemble)
    entries.push(this.makePlaceholderLongArray(273, stripsPerImage));
    entries.push(this.makeShort(277, page.samplesPerPixel)); // SamplesPerPixel
    entries.push(this.makeShortOrLong(278, rowsPerStrip)); // RowsPerStrip
    // StripByteCounts — placeholder LONGs (patched in assemble)
    entries.push(this.makePlaceholderLongArray(279, stripsPerImage));
    entries.push(this.makeRational(282, 72, 1)); // XResolution
    entries.push(this.makeRational(283, 72, 1)); // YResolution
    entries.push(this.makeShort(284, 1)); // PlanarConfiguration
    entries.push(this.makeShort(296, 2)); // ResolutionUnit

    if (page.compression === 5 && (page.predictor ?? 1) === 2) {
      entries.push(this.makeShort(317, 2)); // Predictor
    }

    if (page.photometric === 3 && page.palette !== undefined) {
      entries.push(this.makeColorMap(page.palette));
    }

    if (page.extraTags !== undefined) {
      for (const et of page.extraTags) {
        if (typeof et.values === 'string') {
          entries.push(this.makeAscii(et.tag, et.values));
        } else if (et.type === TYPE_SHORT) {
          entries.push(this.makeShortArray(et.tag, et.values));
        } else if (et.type === TYPE_LONG) {
          entries.push(this.makeLongArray(et.tag, et.values));
        } else {
          entries.push(this.makeShortArray(et.tag, et.values));
        }
      }
    }

    // Sort by tag
    entries.sort((a, b) => a.tag - b.tag);

    return { strips, rowsPerStrip, ifdEntries: entries };
  }

  assemble(): Uint8Array {
    const le = this.le;

    // Pass 1: compute all offsets
    let cursor = 8; // header

    interface StripInfo {
      offset: number;
      byteCount: number;
    }

    interface PageOffsets {
      stripInfos: StripInfo[];
      externalBlobs: Array<{ entryIdx: number; offset: number; bytes: Uint8Array }>;
      ifdOffset: number;
    }

    const allPageOffsets: PageOffsets[] = [];

    for (const layout of this.pageLayouts) {
      // Place strips
      const stripInfos: StripInfo[] = layout.strips.map((s) => {
        const off = cursor;
        cursor += s.length;
        return { offset: off, byteCount: s.length };
      });

      // External blobs for entries
      const externalBlobs: Array<{ entryIdx: number; offset: number; bytes: Uint8Array }> = [];
      for (let i = 0; i < layout.ifdEntries.length; i++) {
        const entry = layout.ifdEntries[i];
        if (entry === undefined) continue;
        if (!isInline(entry)) {
          externalBlobs.push({ entryIdx: i, offset: cursor, bytes: entry.valueBytes });
          cursor += entry.valueBytes.length;
          if (cursor & 1) cursor++; // word-align
        }
      }

      const ifdOffset = cursor;
      cursor += 2 + layout.ifdEntries.length * 12 + 4;

      allPageOffsets.push({ stripInfos, externalBlobs, ifdOffset });
    }

    // Pass 2: write bytes
    const out = new Uint8Array(cursor);
    const dv = new DataView(out.buffer);

    // Header
    if (le) {
      out[0] = 0x49;
      out[1] = 0x49;
      dv.setUint16(2, 42, true);
    } else {
      out[0] = 0x4d;
      out[1] = 0x4d;
      dv.setUint16(2, 42, false);
    }
    const firstIfdOff = allPageOffsets[0]?.ifdOffset ?? 8;
    dv.setUint32(4, firstIfdOff, le);

    for (let pi = 0; pi < this.pageLayouts.length; pi++) {
      const layout = this.pageLayouts[pi];
      const po = allPageOffsets[pi];
      if (layout === undefined || po === undefined) continue;

      // Write strip data
      for (let si = 0; si < layout.strips.length; si++) {
        const strip = layout.strips[si];
        const info = po.stripInfos[si];
        if (strip !== undefined && info !== undefined) {
          out.set(strip, info.offset);
        }
      }

      // Patch StripOffsets and StripByteCounts with real values
      for (const entry of layout.ifdEntries) {
        if (entry.tag === 273) {
          // StripOffsets
          const vbDv = new DataView(entry.valueBytes.buffer, entry.valueBytes.byteOffset);
          for (let si = 0; si < po.stripInfos.length; si++) {
            const info = po.stripInfos[si];
            if (info !== undefined) vbDv.setUint32(si * 4, info.offset, le);
          }
        }
        if (entry.tag === 279) {
          // StripByteCounts
          const vbDv = new DataView(entry.valueBytes.buffer, entry.valueBytes.byteOffset);
          for (let si = 0; si < po.stripInfos.length; si++) {
            const info = po.stripInfos[si];
            if (info !== undefined) vbDv.setUint32(si * 4, info.byteCount, le);
          }
        }
      }

      // Write external blobs
      for (const blob of po.externalBlobs) {
        out.set(blob.bytes, blob.offset);
      }

      // Write IFD
      const ifdBase = po.ifdOffset;
      dv.setUint16(ifdBase, layout.ifdEntries.length, le);
      let entryOff = ifdBase + 2;

      for (let i = 0; i < layout.ifdEntries.length; i++) {
        const entry = layout.ifdEntries[i];
        if (entry === undefined) continue;
        dv.setUint16(entryOff, entry.tag, le);
        dv.setUint16(entryOff + 2, entry.type, le);
        dv.setUint32(entryOff + 4, entry.count, le);

        if (isInline(entry)) {
          out.set(entry.valueBytes, entryOff + 8);
        } else {
          const blob = po.externalBlobs.find((b) => b.entryIdx === i);
          dv.setUint32(entryOff + 8, blob?.offset ?? 0, le);
        }
        entryOff += 12;
      }

      // NextIFDOffset
      const nextPo = allPageOffsets[pi + 1];
      dv.setUint32(entryOff, nextPo?.ifdOffset ?? 0, le);
    }

    return out;
  }

  // ---------------------------------------------------------------------------
  // Compression
  // ---------------------------------------------------------------------------

  private compressStrip(data: Uint8Array, compression: 1 | 5 | 32773): Uint8Array {
    if (compression === 1) return data;
    if (compression === 32773) return packBitsEncode(data);
    if (compression === 5) return lzwEncodeSimple(data);
    return data;
  }

  // ---------------------------------------------------------------------------
  // Entry builders
  // ---------------------------------------------------------------------------

  private makeShort(tag: number, value: number): IfdEntry {
    const vb = new Uint8Array(2);
    new DataView(vb.buffer).setUint16(0, value, this.le);
    return { tag, type: TYPE_SHORT, count: 1, valueBytes: vb };
  }

  private makeShortOrLong(tag: number, value: number): IfdEntry {
    if (value <= 0xffff) return this.makeShort(tag, value);
    const vb = new Uint8Array(4);
    new DataView(vb.buffer).setUint32(0, value, this.le);
    return { tag, type: TYPE_LONG, count: 1, valueBytes: vb };
  }

  private makeShortArray(tag: number, values: number[]): IfdEntry {
    const vb = new Uint8Array(values.length * 2);
    const dv = new DataView(vb.buffer);
    for (let i = 0; i < values.length; i++) dv.setUint16(i * 2, values[i] ?? 0, this.le);
    return { tag, type: TYPE_SHORT, count: values.length, valueBytes: vb };
  }

  private makeLongArray(tag: number, values: number[]): IfdEntry {
    const vb = new Uint8Array(values.length * 4);
    const dv = new DataView(vb.buffer);
    for (let i = 0; i < values.length; i++) dv.setUint32(i * 4, values[i] ?? 0, this.le);
    return { tag, type: TYPE_LONG, count: values.length, valueBytes: vb };
  }

  private makePlaceholderLongArray(tag: number, count: number): IfdEntry {
    return { tag, type: TYPE_LONG, count, valueBytes: new Uint8Array(count * 4) };
  }

  private makeRational(tag: number, num: number, den: number): IfdEntry {
    const vb = new Uint8Array(8);
    const dv = new DataView(vb.buffer);
    dv.setUint32(0, num, this.le);
    dv.setUint32(4, den, this.le);
    return { tag, type: TYPE_RATIONAL, count: 1, valueBytes: vb };
  }

  private makeColorMap(palette: Uint16Array): IfdEntry {
    const vb = new Uint8Array(palette.length * 2);
    const dv = new DataView(vb.buffer);
    for (let i = 0; i < palette.length; i++) dv.setUint16(i * 2, palette[i] ?? 0, this.le);
    return { tag: 320, type: TYPE_SHORT, count: palette.length, valueBytes: vb };
  }

  private makeAscii(tag: number, str: string): IfdEntry {
    const enc = new TextEncoder();
    const bytes = enc.encode(str);
    const vb = new Uint8Array(bytes.length + 1); // NUL terminator
    vb.set(bytes, 0);
    return { tag, type: TYPE_ASCII, count: vb.length, valueBytes: vb };
  }
}

// ---------------------------------------------------------------------------
// Inline decision (Trap #3)
// ---------------------------------------------------------------------------

function isInline(entry: IfdEntry): boolean {
  const typeSize = TYPE_SIZES[entry.type] ?? 1;
  return typeSize * entry.count <= 4;
}

// ---------------------------------------------------------------------------
// PackBits encoder (for test fixture construction)
// ---------------------------------------------------------------------------

export function packBitsEncode(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    let runLen = 1;
    while (
      runLen < 128 &&
      i + runLen < input.length &&
      (input[i + runLen] ?? 0) === (input[i] ?? 0)
    ) {
      runLen++;
    }
    if (runLen >= 2) {
      out.push((1 - runLen + 256) & 0xff);
      out.push(input[i] ?? 0);
      i += runLen;
    } else {
      let litLen = 1;
      while (
        litLen < 128 &&
        i + litLen < input.length &&
        (litLen < 2 ||
          (input[i + litLen] ?? 0) !== (input[i + litLen - 1] ?? 0) ||
          (input[i + litLen] ?? 0) !== (input[i + litLen - 2] ?? 0))
      ) {
        litLen++;
      }
      out.push(litLen - 1);
      for (let j = 0; j < litLen; j++) out.push(input[i + j] ?? 0);
      i += litLen;
    }
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// Simple LZW encoder for test fixtures (MSB-first, post-6.0)
// ---------------------------------------------------------------------------

function lzwEncodeSimple(input: Uint8Array): Uint8Array {
  const bits: number[] = [];
  let bitBuf = 0;
  let bitCount = 0;

  const emit = (code: number, width: number): void => {
    for (let i = width - 1; i >= 0; i--) {
      bitBuf = (bitBuf << 1) | ((code >> i) & 1);
      bitCount++;
      if (bitCount === 8) {
        bits.push(bitBuf & 0xff);
        bitBuf = 0;
        bitCount = 0;
      }
    }
  };

  const flush = (): void => {
    if (bitCount > 0) bits.push((bitBuf << (8 - bitCount)) & 0xff);
  };

  const dict = new Map<string, number>();
  for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);

  let nextCode = 258;
  let codeWidth = 9;

  // The encoder allocates entries 1 step ahead of the decoder.
  // Decoder widens when its nextCode > 510 (after allocating entry 510).
  // Encoder's nextCode is 1 higher at the same stream position, so widen at > 511.
  const updateWidth = (): void => {
    if (codeWidth === 9 && nextCode > 511) codeWidth = 10;
    else if (codeWidth === 10 && nextCode > 1023) codeWidth = 11;
    else if (codeWidth === 11 && nextCode > 2047) codeWidth = 12;
  };

  emit(256, codeWidth); // ClearCode

  let w = '';
  for (let i = 0; i < input.length; i++) {
    const c = String.fromCharCode(input[i] ?? 0);
    const wc = w + c;
    if (dict.has(wc)) {
      w = wc;
    } else {
      const code = dict.get(w);
      if (code !== undefined) emit(code, codeWidth);
      if (nextCode < 4096) {
        dict.set(wc, nextCode++);
        updateWidth();
      }
      w = c;
    }
  }
  if (w.length > 0) {
    const code = dict.get(w);
    if (code !== undefined) emit(code, codeWidth);
  }

  emit(257, codeWidth); // EOICode
  flush();

  return new Uint8Array(bits);
}
