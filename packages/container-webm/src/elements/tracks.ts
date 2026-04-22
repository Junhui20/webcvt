/**
 * Tracks element (ID 0x1654AE6B) and TrackEntry decode and encode.
 *
 * Validates codec IDs against allowlist {V_VP8, V_VP9, A_VORBIS, A_OPUS}.
 * Rejects multi-video or multi-audio tracks (first-pass scope).
 * Captures CodecPrivate verbatim (Trap §12/§13).
 */

import {
  concatBytes,
  findChild,
  findChildren,
  parseFlatChildren,
  readFloat,
  readString,
  readUint,
  readUintNumber,
  writeFloat32,
  writeUint,
  writeVintId,
  writeVintSize,
} from '@catlabtech/webcvt-ebml';
import type { EbmlElement } from '@catlabtech/webcvt-ebml';
import {
  ALLOWED_CODEC_IDS,
  ID_AUDIO,
  ID_BIT_DEPTH,
  ID_CHANNELS,
  ID_CODEC_DELAY,
  ID_CODEC_ID,
  ID_CODEC_PRIVATE,
  ID_DEFAULT_DURATION,
  ID_DISPLAY_HEIGHT,
  ID_DISPLAY_WIDTH,
  ID_FLAG_DEFAULT,
  ID_FLAG_ENABLED,
  ID_FLAG_LACING,
  ID_LANGUAGE,
  ID_PIXEL_HEIGHT,
  ID_PIXEL_WIDTH,
  ID_SAMPLING_FREQUENCY,
  ID_SEEK_PRE_ROLL,
  ID_TRACKS,
  ID_TRACK_ENTRY,
  ID_TRACK_NUMBER,
  ID_TRACK_TYPE,
  ID_TRACK_UID,
  ID_VIDEO,
  MAX_CODEC_PRIVATE_BYTES,
} from '../constants.ts';
import {
  WebmCodecPrivateTooLargeError,
  WebmCorruptStreamError,
  WebmMissingElementError,
  WebmMultiTrackNotSupportedError,
  WebmUnsupportedCodecError,
  WebmUnsupportedTrackTypeError,
} from '../errors.ts';
import {
  encodeBinaryElement,
  encodeMasterElement,
  encodeStringElement,
  encodeUintElement,
} from './header.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebmCodecId = 'V_VP8' | 'V_VP9' | 'A_VORBIS' | 'A_OPUS';

export interface WebmVideoTrack {
  trackNumber: number;
  trackUid: bigint;
  trackType: 1;
  codecId: 'V_VP8' | 'V_VP9';
  codecPrivate?: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  displayWidth?: number;
  displayHeight?: number;
  defaultDuration?: number;
  flagEnabled?: number;
  flagDefault?: number;
  flagLacing?: number;
  language?: string;
}

export interface WebmAudioTrack {
  trackNumber: number;
  trackUid: bigint;
  trackType: 2;
  codecId: 'A_VORBIS' | 'A_OPUS';
  codecPrivate: Uint8Array;
  samplingFrequency: number;
  channels: number;
  bitDepth?: number;
  codecDelay?: number;
  seekPreRoll?: number;
  defaultDuration?: number;
  flagEnabled?: number;
  flagDefault?: number;
  flagLacing?: number;
  language?: string;
}

export type WebmTrack = WebmVideoTrack | WebmAudioTrack;

// Note: parseFlatChildren is imported from '@catlabtech/webcvt-ebml' (Q-H-2 shared helper).

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

/**
 * Decode the Tracks element from its children.
 *
 * @param bytes          Full file buffer.
 * @param children       Direct children of the Tracks master element.
 * @param elementCount   Mutable global element counter for cap enforcement (Q-H-2 / Sec-M-1).
 */
export function decodeTracks(
  bytes: Uint8Array,
  children: EbmlElement[],
  elementCount: { value: number } = { value: 0 },
): WebmTrack[] {
  const trackEntries = findChildren(children, ID_TRACK_ENTRY);
  const tracks: WebmTrack[] = [];
  let videoCount = 0;
  let audioCount = 0;

  for (const entry of trackEntries) {
    const track = decodeTrackEntry(bytes, entry, elementCount);
    if (track.trackType === 1) {
      videoCount++;
      if (videoCount > 1) throw new WebmMultiTrackNotSupportedError('video', videoCount);
    } else {
      audioCount++;
      if (audioCount > 1) throw new WebmMultiTrackNotSupportedError('audio', audioCount);
    }
    tracks.push(track);
  }

  return tracks;
}

function decodeTrackEntry(
  bytes: Uint8Array,
  entry: EbmlElement,
  elementCount: { value: number } = { value: 0 },
): WebmTrack {
  // Q-H-2 / Sec-M-1: use shared parseFlatChildren that threads elementCount + size caps.
  const children = parseFlatChildren(bytes, entry, elementCount);

  // TrackNumber — required, non-zero.
  const trackNumberElem = findChild(children, ID_TRACK_NUMBER);
  if (!trackNumberElem) throw new WebmMissingElementError('TrackNumber', 'TrackEntry');
  const trackNumber = readUintNumber(
    bytes.subarray(trackNumberElem.payloadOffset, trackNumberElem.nextOffset),
  );
  if (trackNumber === 0) throw new WebmMissingElementError('TrackNumber (non-zero)', 'TrackEntry');

  // TrackUID — required, non-zero.
  const trackUidElem = findChild(children, ID_TRACK_UID);
  if (!trackUidElem) throw new WebmMissingElementError('TrackUID', 'TrackEntry');
  const trackUid = readUint(bytes.subarray(trackUidElem.payloadOffset, trackUidElem.nextOffset));
  if (trackUid === 0n) throw new WebmMissingElementError('TrackUID (non-zero)', 'TrackEntry');

  // TrackType — required; reject != 1 and != 2.
  const trackTypeElem = findChild(children, ID_TRACK_TYPE);
  if (!trackTypeElem) throw new WebmMissingElementError('TrackType', 'TrackEntry');
  const trackType = readUintNumber(
    bytes.subarray(trackTypeElem.payloadOffset, trackTypeElem.nextOffset),
  );
  if (trackType !== 1 && trackType !== 2) {
    throw new WebmUnsupportedTrackTypeError(trackType);
  }

  // CodecID — required; validate against allowlist.
  const codecIdElem = findChild(children, ID_CODEC_ID);
  if (!codecIdElem) throw new WebmMissingElementError('CodecID', 'TrackEntry');
  const codecId = readString(bytes.subarray(codecIdElem.payloadOffset, codecIdElem.nextOffset));
  if (!ALLOWED_CODEC_IDS.has(codecId)) {
    throw new WebmUnsupportedCodecError(codecId);
  }

  // CodecPrivate — optional binary, cap at 1 MiB (Trap §12/§13).
  const codecPrivateElem = findChild(children, ID_CODEC_PRIVATE);
  let codecPrivate: Uint8Array | undefined;
  if (codecPrivateElem) {
    if (codecPrivateElem.size > BigInt(MAX_CODEC_PRIVATE_BYTES)) {
      throw new WebmCodecPrivateTooLargeError(codecPrivateElem.size, MAX_CODEC_PRIVATE_BYTES);
    }
    // Zero-copy subarray (Lesson #3).
    codecPrivate = bytes.subarray(codecPrivateElem.payloadOffset, codecPrivateElem.nextOffset);
  }

  // Sec-M-3: VP8/VP9 must have empty or absent CodecPrivate (design note Trap §13).
  if (
    (codecId === 'V_VP8' || codecId === 'V_VP9') &&
    codecPrivate !== undefined &&
    codecPrivate.length > 0
  ) {
    throw new WebmCorruptStreamError(
      `V_VP8/V_VP9 must have empty CodecPrivate per WebM spec; got ${codecPrivate.length} bytes.`,
    );
  }

  // Optional scalar fields.
  const defaultDurationElem = findChild(children, ID_DEFAULT_DURATION);
  const defaultDuration = defaultDurationElem
    ? readUintNumber(
        bytes.subarray(defaultDurationElem.payloadOffset, defaultDurationElem.nextOffset),
      )
    : undefined;

  const flagEnabledElem = findChild(children, ID_FLAG_ENABLED);
  const flagEnabled = flagEnabledElem
    ? readUintNumber(bytes.subarray(flagEnabledElem.payloadOffset, flagEnabledElem.nextOffset))
    : undefined;

  const flagDefaultElem = findChild(children, ID_FLAG_DEFAULT);
  const flagDefault = flagDefaultElem
    ? readUintNumber(bytes.subarray(flagDefaultElem.payloadOffset, flagDefaultElem.nextOffset))
    : undefined;

  const flagLacingElem = findChild(children, ID_FLAG_LACING);
  const flagLacing = flagLacingElem
    ? readUintNumber(bytes.subarray(flagLacingElem.payloadOffset, flagLacingElem.nextOffset))
    : undefined;

  const languageElem = findChild(children, ID_LANGUAGE);
  const language = languageElem
    ? readString(bytes.subarray(languageElem.payloadOffset, languageElem.nextOffset))
    : undefined;

  if (trackType === 1) {
    // Video track.
    if (codecId !== 'V_VP8' && codecId !== 'V_VP9') {
      throw new WebmUnsupportedCodecError(codecId);
    }
    const videoElem = findChild(children, ID_VIDEO);
    if (!videoElem) throw new WebmMissingElementError('Video', 'TrackEntry');
    const videoChildren = parseFlatChildren(bytes, videoElem, elementCount);

    const pixelWidthElem = findChild(videoChildren, ID_PIXEL_WIDTH);
    if (!pixelWidthElem) throw new WebmMissingElementError('PixelWidth', 'Video');
    const pixelWidth = readUintNumber(
      bytes.subarray(pixelWidthElem.payloadOffset, pixelWidthElem.nextOffset),
    );

    const pixelHeightElem = findChild(videoChildren, ID_PIXEL_HEIGHT);
    if (!pixelHeightElem) throw new WebmMissingElementError('PixelHeight', 'Video');
    const pixelHeight = readUintNumber(
      bytes.subarray(pixelHeightElem.payloadOffset, pixelHeightElem.nextOffset),
    );

    const displayWidthElem = findChild(videoChildren, ID_DISPLAY_WIDTH);
    const displayWidth = displayWidthElem
      ? readUintNumber(bytes.subarray(displayWidthElem.payloadOffset, displayWidthElem.nextOffset))
      : undefined;

    const displayHeightElem = findChild(videoChildren, ID_DISPLAY_HEIGHT);
    const displayHeight = displayHeightElem
      ? readUintNumber(
          bytes.subarray(displayHeightElem.payloadOffset, displayHeightElem.nextOffset),
        )
      : undefined;

    return {
      trackNumber,
      trackUid,
      trackType: 1,
      codecId,
      codecPrivate,
      pixelWidth,
      pixelHeight,
      displayWidth,
      displayHeight,
      defaultDuration,
      flagEnabled,
      flagDefault,
      flagLacing,
      language,
    } satisfies WebmVideoTrack;
  }

  // Audio track.
  if (codecId !== 'A_VORBIS' && codecId !== 'A_OPUS') {
    throw new WebmUnsupportedCodecError(codecId);
  }

  const audioElem = findChild(children, ID_AUDIO);
  if (!audioElem) throw new WebmMissingElementError('Audio', 'TrackEntry');
  const audioChildren = parseFlatChildren(bytes, audioElem, elementCount);

  const samplingFreqElem = findChild(audioChildren, ID_SAMPLING_FREQUENCY);
  const samplingFrequency = samplingFreqElem
    ? readFloat(bytes.subarray(samplingFreqElem.payloadOffset, samplingFreqElem.nextOffset))
    : 8000;

  const channelsElem = findChild(audioChildren, ID_CHANNELS);
  const channels = channelsElem
    ? readUintNumber(bytes.subarray(channelsElem.payloadOffset, channelsElem.nextOffset))
    : 1;

  const bitDepthElem = findChild(audioChildren, ID_BIT_DEPTH);
  const bitDepth = bitDepthElem
    ? readUintNumber(bytes.subarray(bitDepthElem.payloadOffset, bitDepthElem.nextOffset))
    : undefined;

  const codecDelayElem = findChild(children, ID_CODEC_DELAY);
  const codecDelay = codecDelayElem
    ? readUintNumber(bytes.subarray(codecDelayElem.payloadOffset, codecDelayElem.nextOffset))
    : undefined;

  const seekPreRollElem = findChild(children, ID_SEEK_PRE_ROLL);
  const seekPreRoll = seekPreRollElem
    ? readUintNumber(bytes.subarray(seekPreRollElem.payloadOffset, seekPreRollElem.nextOffset))
    : undefined;

  // CodecPrivate required for Vorbis/Opus.
  if (!codecPrivate || codecPrivate.length === 0) {
    throw new WebmMissingElementError('CodecPrivate', 'TrackEntry (audio)');
  }

  return {
    trackNumber,
    trackUid,
    trackType: 2,
    codecId,
    codecPrivate,
    samplingFrequency,
    channels,
    bitDepth,
    codecDelay,
    seekPreRoll,
    defaultDuration,
    flagEnabled,
    flagDefault,
    flagLacing,
    language,
  } satisfies WebmAudioTrack;
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

export function encodeTracks(tracks: WebmTrack[]): Uint8Array {
  const trackParts = tracks.map(encodeTrackEntry);
  return encodeMasterElement(ID_TRACKS, concatBytes(trackParts));
}

function encodeTrackEntry(track: WebmTrack): Uint8Array {
  const parts: Uint8Array[] = [
    encodeUintElement(ID_TRACK_NUMBER, BigInt(track.trackNumber)),
    encodeUintElement(ID_TRACK_UID, track.trackUid),
    encodeUintElement(ID_TRACK_TYPE, BigInt(track.trackType)),
    encodeStringElement(ID_CODEC_ID, track.codecId),
  ];

  if (track.flagEnabled !== undefined) {
    parts.push(encodeUintElement(ID_FLAG_ENABLED, BigInt(track.flagEnabled)));
  }
  if (track.flagDefault !== undefined) {
    parts.push(encodeUintElement(ID_FLAG_DEFAULT, BigInt(track.flagDefault)));
  }
  if (track.flagLacing !== undefined) {
    parts.push(encodeUintElement(ID_FLAG_LACING, BigInt(track.flagLacing)));
  }
  if (track.language) {
    parts.push(encodeStringElement(ID_LANGUAGE, track.language));
  }
  if (track.defaultDuration !== undefined) {
    parts.push(encodeUintElement(ID_DEFAULT_DURATION, BigInt(track.defaultDuration)));
  }

  if (track.trackType === 1) {
    if (track.codecPrivate && track.codecPrivate.length > 0) {
      parts.push(encodeBinaryElement(ID_CODEC_PRIVATE, track.codecPrivate));
    }
    parts.push(encodeVideoElement(track));
  } else {
    if (track.codecDelay !== undefined) {
      parts.push(encodeUintElement(ID_CODEC_DELAY, BigInt(track.codecDelay)));
    }
    if (track.seekPreRoll !== undefined) {
      parts.push(encodeUintElement(ID_SEEK_PRE_ROLL, BigInt(track.seekPreRoll)));
    }
    parts.push(encodeBinaryElement(ID_CODEC_PRIVATE, track.codecPrivate));
    parts.push(encodeAudioElement(track));
  }

  return encodeMasterElement(ID_TRACK_ENTRY, concatBytes(parts));
}

function encodeVideoElement(track: WebmVideoTrack): Uint8Array {
  const parts: Uint8Array[] = [
    encodeUintElement(ID_PIXEL_WIDTH, BigInt(track.pixelWidth)),
    encodeUintElement(ID_PIXEL_HEIGHT, BigInt(track.pixelHeight)),
  ];
  if (track.displayWidth !== undefined) {
    parts.push(encodeUintElement(ID_DISPLAY_WIDTH, BigInt(track.displayWidth)));
  }
  if (track.displayHeight !== undefined) {
    parts.push(encodeUintElement(ID_DISPLAY_HEIGHT, BigInt(track.displayHeight)));
  }
  return encodeMasterElement(ID_VIDEO, concatBytes(parts));
}

function encodeAudioElement(track: WebmAudioTrack): Uint8Array {
  const idBytes = writeVintId(ID_SAMPLING_FREQUENCY);
  const sfPayload = writeFloat32(track.samplingFrequency);
  const sfSizeBytes = writeVintSize(BigInt(sfPayload.length));
  const sfElem = concatBytes([idBytes, sfSizeBytes, sfPayload]);

  const parts: Uint8Array[] = [sfElem, encodeUintElement(ID_CHANNELS, BigInt(track.channels))];
  if (track.bitDepth !== undefined) {
    parts.push(encodeUintElement(ID_BIT_DEPTH, BigInt(track.bitDepth)));
  }
  return encodeMasterElement(ID_AUDIO, concatBytes(parts));
}
