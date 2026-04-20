/**
 * Tracks element (ID 0x1654AE6B) and TrackEntry decode and encode for Matroska.
 *
 * Wider codec allowlist than WebM: H.264/HEVC/VP8/VP9 + AAC/MP3/FLAC/Vorbis/Opus.
 * Per-codec codec string derivation via codec-meta/*.ts.
 * Rejects encryption (ContentEncodings) with MkvEncryptionNotSupportedError.
 * Rejects multi-video or multi-audio tracks (first-pass scope).
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
} from '@webcvt/ebml';
import type { EbmlElement } from '@webcvt/ebml';
import { parseAacAsc } from '../codec-meta/aac-asc.ts';
import { parseAvcDecoderConfig } from '../codec-meta/avc.ts';
import { normaliseFlacCodecPrivate } from '../codec-meta/flac-streaminfo.ts';
import { parseHevcDecoderConfig } from '../codec-meta/hevc.ts';
import {
  ALLOWED_AUDIO_CODEC_IDS,
  ALLOWED_VIDEO_CODEC_IDS,
  ID_AUDIO,
  ID_BIT_DEPTH,
  ID_CHANNELS,
  ID_CODEC_DELAY,
  ID_CODEC_ID,
  ID_CODEC_PRIVATE,
  ID_CONTENT_ENCODINGS,
  ID_DEFAULT_DURATION,
  ID_DISPLAY_HEIGHT,
  ID_DISPLAY_WIDTH,
  ID_FLAG_DEFAULT,
  ID_FLAG_ENABLED,
  ID_FLAG_LACING,
  ID_LANGUAGE,
  ID_OUTPUT_SAMPLING_FREQUENCY,
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
  MkvCodecPrivateTooLargeError,
  MkvCorruptStreamError,
  MkvEncryptionNotSupportedError,
  MkvMissingElementError,
  MkvMultiTrackNotSupportedError,
  MkvUnsupportedCodecError,
  MkvUnsupportedTrackTypeError,
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

export type MkvVideoCodecId = 'V_MPEG4/ISO/AVC' | 'V_MPEGH/ISO/HEVC' | 'V_VP8' | 'V_VP9';
export type MkvAudioCodecId = 'A_AAC' | 'A_MPEG/L3' | 'A_FLAC' | 'A_VORBIS' | 'A_OPUS';

export interface MkvVideoTrack {
  trackNumber: number;
  trackUid: bigint;
  trackType: 1;
  codecId: MkvVideoCodecId;
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
  /** Derived WebCodecs codec string, e.g. 'avc1.640028'. */
  webcodecsCodecString: string;
}

export interface MkvAudioTrack {
  trackNumber: number;
  trackUid: bigint;
  trackType: 2;
  codecId: MkvAudioCodecId;
  codecPrivate: Uint8Array;
  samplingFrequency: number;
  outputSamplingFrequency?: number;
  channels: number;
  bitDepth?: number;
  codecDelay?: number;
  seekPreRoll?: number;
  defaultDuration?: number;
  flagEnabled?: number;
  flagDefault?: number;
  flagLacing?: number;
  language?: string;
  /** Derived WebCodecs codec string, e.g. 'mp4a.40.2'. */
  webcodecsCodecString: string;
}

export type MkvTrack = MkvVideoTrack | MkvAudioTrack;

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

export function decodeTracks(
  bytes: Uint8Array,
  children: EbmlElement[],
  elementCount: { value: number } = { value: 0 },
): MkvTrack[] {
  const trackEntries = findChildren(children, ID_TRACK_ENTRY);
  const tracks: MkvTrack[] = [];
  let videoCount = 0;
  let audioCount = 0;

  for (const entry of trackEntries) {
    const track = decodeTrackEntry(bytes, entry, elementCount);
    if (track.trackType === 1) {
      videoCount++;
      if (videoCount > 1) throw new MkvMultiTrackNotSupportedError('video', videoCount);
    } else {
      audioCount++;
      if (audioCount > 1) throw new MkvMultiTrackNotSupportedError('audio', audioCount);
    }
    tracks.push(track);
  }

  return tracks;
}

function decodeTrackEntry(
  bytes: Uint8Array,
  entry: EbmlElement,
  elementCount: { value: number } = { value: 0 },
): MkvTrack {
  const children = parseFlatChildren(bytes, entry, elementCount);

  // Reject ContentEncodings (encryption is deferred).
  const contentEncodingsElem = findChild(children, ID_CONTENT_ENCODINGS);
  if (contentEncodingsElem) {
    throw new MkvEncryptionNotSupportedError();
  }

  const trackNumberElem = findChild(children, ID_TRACK_NUMBER);
  if (!trackNumberElem) throw new MkvMissingElementError('TrackNumber', 'TrackEntry');
  const trackNumber = readUintNumber(
    bytes.subarray(trackNumberElem.payloadOffset, trackNumberElem.nextOffset),
  );
  if (trackNumber === 0) throw new MkvMissingElementError('TrackNumber (non-zero)', 'TrackEntry');

  const trackUidElem = findChild(children, ID_TRACK_UID);
  if (!trackUidElem) throw new MkvMissingElementError('TrackUID', 'TrackEntry');
  const trackUid = readUint(bytes.subarray(trackUidElem.payloadOffset, trackUidElem.nextOffset));
  if (trackUid === 0n) throw new MkvMissingElementError('TrackUID (non-zero)', 'TrackEntry');

  const trackTypeElem = findChild(children, ID_TRACK_TYPE);
  if (!trackTypeElem) throw new MkvMissingElementError('TrackType', 'TrackEntry');
  const trackType = readUintNumber(
    bytes.subarray(trackTypeElem.payloadOffset, trackTypeElem.nextOffset),
  );
  if (trackType !== 1 && trackType !== 2) {
    throw new MkvUnsupportedTrackTypeError(trackType);
  }

  const codecIdElem = findChild(children, ID_CODEC_ID);
  if (!codecIdElem) throw new MkvMissingElementError('CodecID', 'TrackEntry');
  const codecId = readString(bytes.subarray(codecIdElem.payloadOffset, codecIdElem.nextOffset));

  // Validate against allowlist (Trap §7).
  if (
    (trackType === 1 && !ALLOWED_VIDEO_CODEC_IDS.has(codecId)) ||
    (trackType === 2 && !ALLOWED_AUDIO_CODEC_IDS.has(codecId)) ||
    (trackType !== 1 && trackType !== 2)
  ) {
    throw new MkvUnsupportedCodecError(codecId);
  }

  // CodecPrivate — optional binary, cap at 1 MiB (Trap §12/§13).
  const codecPrivateElem = findChild(children, ID_CODEC_PRIVATE);
  let codecPrivate: Uint8Array | undefined;
  if (codecPrivateElem) {
    if (codecPrivateElem.size > BigInt(MAX_CODEC_PRIVATE_BYTES)) {
      throw new MkvCodecPrivateTooLargeError(codecPrivateElem.size, MAX_CODEC_PRIVATE_BYTES);
    }
    codecPrivate = bytes.subarray(codecPrivateElem.payloadOffset, codecPrivateElem.nextOffset);
  }

  // Validate VP8/VP9/MP3 must have empty CodecPrivate (Sec-M-3 lesson extended).
  if (
    (codecId === 'V_VP8' || codecId === 'V_VP9' || codecId === 'A_MPEG/L3') &&
    codecPrivate !== undefined &&
    codecPrivate.length > 0
  ) {
    throw new MkvCorruptStreamError(
      `${codecId} must have empty or absent CodecPrivate; got ${codecPrivate.length} bytes.`,
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
    return decodeVideoTrack(
      bytes,
      children,
      elementCount,
      trackNumber,
      trackUid,
      codecId as MkvVideoCodecId,
      codecPrivate,
      defaultDuration,
      flagEnabled,
      flagDefault,
      flagLacing,
      language,
    );
  }

  return decodeAudioTrack(
    bytes,
    children,
    elementCount,
    trackNumber,
    trackUid,
    codecId as MkvAudioCodecId,
    codecPrivate,
    defaultDuration,
    flagEnabled,
    flagDefault,
    flagLacing,
    language,
  );
}

function decodeVideoTrack(
  bytes: Uint8Array,
  children: EbmlElement[],
  elementCount: { value: number },
  trackNumber: number,
  trackUid: bigint,
  codecId: MkvVideoCodecId,
  codecPrivate: Uint8Array | undefined,
  defaultDuration: number | undefined,
  flagEnabled: number | undefined,
  flagDefault: number | undefined,
  flagLacing: number | undefined,
  language: string | undefined,
): MkvVideoTrack {
  const videoElem = findChild(children, ID_VIDEO);
  if (!videoElem) throw new MkvMissingElementError('Video', 'TrackEntry');
  const videoChildren = parseFlatChildren(bytes, videoElem, elementCount);

  const pixelWidthElem = findChild(videoChildren, ID_PIXEL_WIDTH);
  if (!pixelWidthElem) throw new MkvMissingElementError('PixelWidth', 'Video');
  const pixelWidth = readUintNumber(
    bytes.subarray(pixelWidthElem.payloadOffset, pixelWidthElem.nextOffset),
  );

  const pixelHeightElem = findChild(videoChildren, ID_PIXEL_HEIGHT);
  if (!pixelHeightElem) throw new MkvMissingElementError('PixelHeight', 'Video');
  const pixelHeight = readUintNumber(
    bytes.subarray(pixelHeightElem.payloadOffset, pixelHeightElem.nextOffset),
  );

  const displayWidthElem = findChild(videoChildren, ID_DISPLAY_WIDTH);
  const displayWidth = displayWidthElem
    ? readUintNumber(bytes.subarray(displayWidthElem.payloadOffset, displayWidthElem.nextOffset))
    : undefined;

  const displayHeightElem = findChild(videoChildren, ID_DISPLAY_HEIGHT);
  const displayHeight = displayHeightElem
    ? readUintNumber(bytes.subarray(displayHeightElem.payloadOffset, displayHeightElem.nextOffset))
    : undefined;

  // Derive WebCodecs codec string.
  const webcodecsCodecString = deriveVideoCodecString(codecId, codecPrivate);

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
    webcodecsCodecString,
  } satisfies MkvVideoTrack;
}

function decodeAudioTrack(
  bytes: Uint8Array,
  children: EbmlElement[],
  elementCount: { value: number },
  trackNumber: number,
  trackUid: bigint,
  codecId: MkvAudioCodecId,
  codecPrivate: Uint8Array | undefined,
  defaultDuration: number | undefined,
  flagEnabled: number | undefined,
  flagDefault: number | undefined,
  flagLacing: number | undefined,
  language: string | undefined,
): MkvAudioTrack {
  const audioElem = findChild(children, ID_AUDIO);
  if (!audioElem) throw new MkvMissingElementError('Audio', 'TrackEntry');
  const audioChildren = parseFlatChildren(bytes, audioElem, elementCount);

  const samplingFreqElem = findChild(audioChildren, ID_SAMPLING_FREQUENCY);
  const samplingFrequency = samplingFreqElem
    ? readFloat(bytes.subarray(samplingFreqElem.payloadOffset, samplingFreqElem.nextOffset))
    : 8000;

  const outputSamplingFreqElem = findChild(audioChildren, ID_OUTPUT_SAMPLING_FREQUENCY);
  const outputSamplingFrequency = outputSamplingFreqElem
    ? readFloat(
        bytes.subarray(outputSamplingFreqElem.payloadOffset, outputSamplingFreqElem.nextOffset),
      )
    : undefined;

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

  // CodecPrivate required for AAC/FLAC/Vorbis/Opus; empty/absent for MP3.
  const effectiveCodecPrivate = codecPrivate ?? new Uint8Array(0);

  if (
    (codecId === 'A_AAC' ||
      codecId === 'A_FLAC' ||
      codecId === 'A_VORBIS' ||
      codecId === 'A_OPUS') &&
    effectiveCodecPrivate.length === 0
  ) {
    throw new MkvMissingElementError('CodecPrivate', `TrackEntry (${codecId})`);
  }

  // Derive WebCodecs codec string and normalise CodecPrivate if needed.
  const { webcodecsCodecString, normalisedCodecPrivate } = deriveAudioCodecMeta(
    codecId,
    effectiveCodecPrivate,
  );

  return {
    trackNumber,
    trackUid,
    trackType: 2,
    codecId,
    codecPrivate: normalisedCodecPrivate,
    samplingFrequency,
    outputSamplingFrequency,
    channels,
    bitDepth,
    codecDelay,
    seekPreRoll,
    defaultDuration,
    flagEnabled,
    flagDefault,
    flagLacing,
    language,
    webcodecsCodecString,
  } satisfies MkvAudioTrack;
}

// ---------------------------------------------------------------------------
// Codec string derivation
// ---------------------------------------------------------------------------

function deriveVideoCodecString(
  codecId: MkvVideoCodecId,
  codecPrivate: Uint8Array | undefined,
): string {
  switch (codecId) {
    case 'V_MPEG4/ISO/AVC':
      if (!codecPrivate || codecPrivate.length === 0) {
        throw new MkvMissingElementError('CodecPrivate', 'TrackEntry (V_MPEG4/ISO/AVC)');
      }
      return parseAvcDecoderConfig(codecPrivate);

    case 'V_MPEGH/ISO/HEVC':
      if (!codecPrivate || codecPrivate.length === 0) {
        throw new MkvMissingElementError('CodecPrivate', 'TrackEntry (V_MPEGH/ISO/HEVC)');
      }
      return parseHevcDecoderConfig(codecPrivate);

    case 'V_VP8':
      return 'vp8';

    case 'V_VP9':
      // Default VP9 codec string for first pass; probeVideoCodec confirms.
      return 'vp09.00.10.08';
  }
}

function deriveAudioCodecMeta(
  codecId: MkvAudioCodecId,
  codecPrivate: Uint8Array,
): { webcodecsCodecString: string; normalisedCodecPrivate: Uint8Array } {
  switch (codecId) {
    case 'A_AAC':
      return {
        webcodecsCodecString: parseAacAsc(codecPrivate),
        normalisedCodecPrivate: codecPrivate,
      };

    case 'A_MPEG/L3':
      return {
        webcodecsCodecString: 'mp3',
        normalisedCodecPrivate: new Uint8Array(0),
      };

    case 'A_FLAC': {
      const normalised = normaliseFlacCodecPrivate(codecPrivate);
      return {
        webcodecsCodecString: 'flac',
        normalisedCodecPrivate: normalised,
      };
    }

    case 'A_VORBIS':
      return {
        webcodecsCodecString: 'vorbis',
        normalisedCodecPrivate: codecPrivate,
      };

    case 'A_OPUS':
      return {
        webcodecsCodecString: 'opus',
        normalisedCodecPrivate: codecPrivate,
      };
  }
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

export function encodeTracks(tracks: MkvTrack[]): Uint8Array {
  const trackParts = tracks.map(encodeTrackEntry);
  return encodeMasterElement(ID_TRACKS, concatBytes(trackParts));
}

function encodeTrackEntry(track: MkvTrack): Uint8Array {
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
    if (track.codecPrivate.length > 0) {
      parts.push(encodeBinaryElement(ID_CODEC_PRIVATE, track.codecPrivate));
    }
    parts.push(encodeAudioElement(track));
  }

  return encodeMasterElement(ID_TRACK_ENTRY, concatBytes(parts));
}

function encodeVideoElement(track: MkvVideoTrack): Uint8Array {
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

function encodeAudioElement(track: MkvAudioTrack): Uint8Array {
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
