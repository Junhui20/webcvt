/**
 * mfra (Movie Fragment Random Access) parser — ISO/IEC 14496-12 §8.8.9–§8.8.11.
 *
 * Found at the end of a fragmented file, the mfra box is a random-access index:
 *   mfra (container)
 *     tfra*   — Track Fragment Random Access Box, one per indexed track
 *     mfro    — Movie Fragment Random Access Offset Box (declares mfra's size)
 *
 * webcvt parses mfra read-only (it exposes the random-access table; it does not
 * use it to seek). The tfra entries carry variable-length traf/trun/sample
 * numbers whose byte widths are encoded in the tfra header.
 *
 * Clean-room: ISO/IEC 14496-12:2022 §8.8.9–§8.8.11 only. No porting from
 * gpac/Bento4/mp4box.
 */

import { type Mp4Box, findChild, findChildren } from '../box-tree.ts';
import { MAX_MFRA_TFRA_BOXES, MAX_TFRA_ENTRIES } from '../constants.ts';
import { Mp4MfraOutOfBoundsError } from '../errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single random-access point within a track. */
export interface Mp4TrackFragmentRandomAccessEntry {
  /** Presentation time of the random-access sample, in the track's media timescale. */
  readonly time: number;
  /** Absolute file offset of the moof box containing the random-access sample. */
  readonly moofOffset: number;
  /** 1-based index of the traf within that moof. */
  readonly trafNumber: number;
  /** 1-based index of the trun within that traf. */
  readonly trunNumber: number;
  /** 1-based index of the sample within that trun. */
  readonly sampleNumber: number;
}

/** A parsed Track Fragment Random Access Box (one track's random-access table). */
export interface Mp4TrackFragmentRandomAccess {
  readonly trackId: number;
  readonly entries: readonly Mp4TrackFragmentRandomAccessEntry[];
}

/** A parsed Movie Fragment Random Access Box. */
export interface Mp4MovieFragmentRandomAccess {
  /** Per-track random-access tables, in file order. */
  readonly trackEntries: readonly Mp4TrackFragmentRandomAccess[];
  /** Declared total byte size of the mfra box from the mfro child; null when mfro is absent. */
  readonly declaredSize: number | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a walked mfra box. Its `tfra`/`mfro` children must already have been
 * populated by the box-tree walker (mfra is registered as a container type).
 *
 * @throws Mp4MfraOutOfBoundsError on too many tfra boxes, an unsupported tfra
 *   version, a truncated tfra/mfro payload, or a u64 field overflowing the JS
 *   safe-integer range.
 */
export function parseMfra(mfraBox: Mp4Box): Mp4MovieFragmentRandomAccess {
  const tfraBoxes = findChildren(mfraBox, 'tfra');
  if (tfraBoxes.length > MAX_MFRA_TFRA_BOXES) {
    throw new Mp4MfraOutOfBoundsError(
      `mfra contains ${tfraBoxes.length} tfra boxes; maximum is ${MAX_MFRA_TFRA_BOXES}.`,
    );
  }
  const trackEntries = tfraBoxes.map((b) => parseTfra(b.payload));

  const mfroBox = findChild(mfraBox, 'mfro');
  const declaredSize = mfroBox ? parseMfro(mfroBox.payload) : null;

  return { trackEntries, declaredSize };
}

// ---------------------------------------------------------------------------
// Private parsers
// ---------------------------------------------------------------------------

function parseTfra(payload: Uint8Array): Mp4TrackFragmentRandomAccess {
  // version+flags(4) + track_ID(4) + (reserved26|sizes6)(4) + number_of_entry(4) = 16.
  if (payload.length < 16) {
    throw new Mp4MfraOutOfBoundsError(
      `tfra payload too short (${payload.length} bytes); need at least 16.`,
    );
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const version = payload[0] ?? 0;
  if (version !== 0 && version !== 1) {
    throw new Mp4MfraOutOfBoundsError(
      `tfra version ${version} is not supported; only 0 and 1 are valid.`,
    );
  }

  const trackId = view.getUint32(4, false);

  // The low 6 bits of the u32 at offset 8 hold three 2-bit length codes.
  // Each field byte width is (code + 1), i.e. 1–4 bytes.
  const sizes = view.getUint32(8, false);
  const lenTraf = ((sizes >>> 4) & 0x3) + 1;
  const lenTrun = ((sizes >>> 2) & 0x3) + 1;
  const lenSample = (sizes & 0x3) + 1;

  const numberOfEntry = view.getUint32(12, false);
  if (numberOfEntry > MAX_TFRA_ENTRIES) {
    throw new Mp4MfraOutOfBoundsError(
      `tfra number_of_entry ${numberOfEntry} exceeds maximum ${MAX_TFRA_ENTRIES}.`,
    );
  }

  const timeBytes = version === 1 ? 8 : 4;
  const entryBytes = timeBytes * 2 + lenTraf + lenTrun + lenSample;
  let cursor = 16;
  if (payload.length < cursor + numberOfEntry * entryBytes) {
    throw new Mp4MfraOutOfBoundsError(
      `tfra payload too short for ${numberOfEntry} entries (need ${numberOfEntry * entryBytes} more bytes).`,
    );
  }

  const entries: Mp4TrackFragmentRandomAccessEntry[] = [];
  for (let i = 0; i < numberOfEntry; i++) {
    let time: number;
    let moofOffset: number;
    if (version === 1) {
      time = readU64(view, cursor, 'tfra time');
      moofOffset = readU64(view, cursor + 8, 'tfra moof_offset');
    } else {
      time = view.getUint32(cursor, false);
      moofOffset = view.getUint32(cursor + 4, false);
    }
    cursor += timeBytes * 2;

    const trafNumber = readUintBE(view, cursor, lenTraf);
    cursor += lenTraf;
    const trunNumber = readUintBE(view, cursor, lenTrun);
    cursor += lenTrun;
    const sampleNumber = readUintBE(view, cursor, lenSample);
    cursor += lenSample;

    entries.push({ time, moofOffset, trafNumber, trunNumber, sampleNumber });
  }

  return { trackId, entries };
}

function parseMfro(payload: Uint8Array): number {
  // version+flags(4) + size(4) = 8 bytes.
  if (payload.length < 8) {
    throw new Mp4MfraOutOfBoundsError(`mfro payload too short (${payload.length} bytes); need 8.`);
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return view.getUint32(4, false);
}

/** Read a big-endian unsigned integer of 1–4 bytes (max value 2^32-1; no overflow risk). */
function readUintBE(view: DataView, offset: number, byteLength: number): number {
  let value = 0;
  for (let i = 0; i < byteLength; i++) {
    value = value * 256 + view.getUint8(offset + i);
  }
  return value;
}

function readU64(view: DataView, offset: number, field: string): number {
  const hi = view.getUint32(offset, false);
  const lo = view.getUint32(offset + 4, false);
  const value = hi * 0x100000000 + lo;
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new Mp4MfraOutOfBoundsError(`${field} (${hi}:${lo}) exceeds the safe integer range.`);
  }
  return value;
}
