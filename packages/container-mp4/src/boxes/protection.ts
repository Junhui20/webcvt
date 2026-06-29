/**
 * File-level Common Encryption (CENC / ISO/IEC 23001-7) signalling assembly.
 *
 * Aggregates the read-only `pssh` boxes (top level and/or `moov`) and the
 * per-track `encv`/`enca` protection info into the `Mp4Protection` summary
 * surfaced on `Mp4File.protection`. This is signalling only — webcvt never
 * decrypts. Both classic and fragmented files use the same assembly.
 */

import { type Mp4Box, findChild } from '../box-tree.ts';
import { MAX_PSSH_BOXES } from '../constants.ts';
import { Mp4PsshTooManyError } from '../errors.ts';
import { type Mp4Pssh, parsePssh } from './pssh.ts';
import { type Mp4TrackProtection, parseStsdTrackProtection } from './sinf.ts';

// ---------------------------------------------------------------------------
// Public type
// ---------------------------------------------------------------------------

/**
 * Read-only Common Encryption (CENC / ISO/IEC 23001-7) signalling for a file.
 * Present (non-null) only when the file carries DRM signalling — one or more
 * `pssh` boxes, or at least one `encv`/`enca` protected track.
 */
export interface Mp4Protection {
  /** Parsed `pssh` boxes from the top level and/or `moov`, in file order. */
  readonly psshList: readonly Mp4Pssh[];
  /** Per-track protection summaries for each `encv`/`enca` track, in track order. */
  readonly tracks: readonly Mp4TrackProtection[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect read-only CENC `pssh` (Protection System Specific Header) boxes. They
 * may appear at the top level and/or directly inside `moov`. Both locations are
 * scanned; the combined count is capped at MAX_PSSH_BOXES.
 */
export function collectPssh(topLevel: Mp4Box[], moovBox: Mp4Box): Mp4Pssh[] {
  const list: Mp4Pssh[] = [];
  const pushFrom = (boxes: Mp4Box[]): void => {
    for (const box of boxes) {
      if (box.type !== 'pssh') continue;
      if (list.length >= MAX_PSSH_BOXES) {
        throw new Mp4PsshTooManyError(MAX_PSSH_BOXES);
      }
      list.push(parsePssh(box.payload));
    }
  };
  pushFrom(topLevel);
  pushFrom(moovBox.children);
  return list;
}

/**
 * Extract the per-track CENC protection summary for a `trak`, or null when the
 * track is not encrypted (its sample entry is not `encv`/`enca`). Navigates
 * trak → mdia → minf → stbl → stsd and inspects the first sample entry.
 */
export function extractTrackProtection(
  trakBox: Mp4Box,
  trackId: number,
): Mp4TrackProtection | null {
  const mdiaBox = findChild(trakBox, 'mdia');
  const minfBox = mdiaBox && findChild(mdiaBox, 'minf');
  const stblBox = minfBox && findChild(minfBox, 'stbl');
  const stsdBox = stblBox && findChild(stblBox, 'stsd');
  if (!stsdBox) return null;
  return parseStsdTrackProtection(stsdBox.payload, trackId);
}

/**
 * Build the file-level `Mp4Protection` summary, or null when the file carries
 * no protection signalling at all (no pssh boxes and no encrypted tracks).
 */
export function assembleProtection(
  psshList: Mp4Pssh[],
  trackProtections: Mp4TrackProtection[],
): Mp4Protection | null {
  if (psshList.length === 0 && trackProtections.length === 0) {
    return null;
  }
  return { psshList, tracks: trackProtections };
}
