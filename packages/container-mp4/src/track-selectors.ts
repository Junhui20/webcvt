/**
 * Track selection helpers for multi-track Mp4File instances.
 *
 * All selectors operate on `file.tracks` in FILE ORDER (the order trak boxes
 * appear inside moov). File order is intentionally preserved — do not sort by
 * trackId (QuickTime writes video first, iTunes M4A writes audio first; callers
 * that need alternate-group semantics must interpret tkhd.alternate_group
 * themselves).
 *
 * Selection is based on `track.handlerType` ('soun' | 'vide'), not on
 * `sampleEntry.kind`, because handlerType is the normative discriminator
 * defined in ISO/IEC 14496-12 §8.4.3.
 *
 * ISO/IEC 14496-12:2022 §8.3 (Track Box), §8.4.3 (Handler Reference Box).
 */

import type { Mp4File, Mp4Track } from './parser.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the first audio ('soun') track in file order, or null when none.
 *
 * @param file  Parsed Mp4File.
 */
export function findAudioTrack(file: Mp4File): Mp4Track | null {
  for (const track of file.tracks) {
    if (track.handlerType === 'soun') {
      return track;
    }
  }
  return null;
}

/**
 * Return the first video ('vide') track in file order, or null when none.
 *
 * @param file  Parsed Mp4File.
 */
export function findVideoTrack(file: Mp4File): Mp4Track | null {
  for (const track of file.tracks) {
    if (track.handlerType === 'vide') {
      return track;
    }
  }
  return null;
}

/**
 * Return the track whose trackId equals the given id, or null when not found.
 *
 * @param file     Parsed Mp4File.
 * @param trackId  Numeric track_ID from the tkhd box (1-based per spec).
 */
export function findTrackById(file: Mp4File, trackId: number): Mp4Track | null {
  for (const track of file.tracks) {
    if (track.trackId === trackId) {
      return track;
    }
  }
  return null;
}

/**
 * Return all tracks of the given handler kind in file order.
 *
 * Useful for alternate-language audio (multiple 'soun' tracks) or multi-angle
 * video (multiple 'vide' tracks).
 *
 * @param file  Parsed Mp4File.
 * @param kind  'audio' maps to handler 'soun'; 'video' maps to handler 'vide'.
 */
export function findTracksByKind(file: Mp4File, kind: 'audio' | 'video'): readonly Mp4Track[] {
  const handlerType = kind === 'audio' ? 'soun' : 'vide';
  return file.tracks.filter((t) => t.handlerType === handlerType);
}
