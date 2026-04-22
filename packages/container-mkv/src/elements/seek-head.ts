/**
 * SeekHead element (ID 0x114D9B74) decode and encode for Matroska.
 *
 * SeekHead is optional but recommended (Trap §10).
 * Writer uses it to point to Info, Tracks, and Cues.
 * Reader uses it optionally for position hints.
 *
 * Void element (0xEC) is used for padding inside SeekHead (Trap §16).
 */

import {
  concatBytes,
  findChildren,
  parseFlatChildren,
  readUintNumber,
  writeVintId,
  writeVintSize,
} from '@catlabtech/webcvt-ebml';
import type { EbmlElement } from '@catlabtech/webcvt-ebml';
import {
  ID_SEEK,
  ID_SEEK_HEAD,
  ID_SEEK_ID,
  ID_SEEK_POSITION,
  ID_VOID,
  SEEK_HEAD_RESERVED_BYTES,
} from '../constants.ts';
import { MkvCorruptStreamError } from '../errors.ts';
import { encodeBinaryElement, encodeMasterElement, encodeUintElement } from './header.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MkvSeekEntry {
  seekId: Uint8Array;
  seekPosition: number;
}

export interface MkvSeekHead {
  entries: MkvSeekEntry[];
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

export function decodeSeekHead(
  bytes: Uint8Array,
  children: EbmlElement[],
  elementCount: { value: number } = { value: 0 },
  segmentPayloadOffset = 0,
): MkvSeekHead {
  const seekElems = findChildren(children, ID_SEEK);
  const entries: MkvSeekEntry[] = [];

  for (const seekElem of seekElems) {
    const seekChildren = parseFlatChildren(bytes, seekElem, elementCount);

    const seekIdElem = seekChildren.find((c) => c.id === ID_SEEK_ID);
    const seekPosElem = seekChildren.find((c) => c.id === ID_SEEK_POSITION);

    if (!seekIdElem || !seekPosElem) continue; // tolerate malformed Seek entries

    const seekId = bytes.subarray(seekIdElem.payloadOffset, seekIdElem.nextOffset).slice();
    const seekPosition = readUintNumber(
      bytes.subarray(seekPosElem.payloadOffset, seekPosElem.nextOffset),
    );

    // Sec-M-2: validate absolute file offset against file bounds.
    const absoluteOffset = segmentPayloadOffset + seekPosition;
    if (absoluteOffset >= bytes.length) {
      throw new MkvCorruptStreamError(
        `SeekPosition ${seekPosition} + segmentPayloadOffset ${segmentPayloadOffset} = ${absoluteOffset} exceeds file length ${bytes.length}`,
      );
    }

    entries.push({ seekId, seekPosition });
  }

  return { entries };
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/**
 * Encode a SeekHead element padded to SEEK_HEAD_RESERVED_BYTES total.
 */
export function encodeSeekHead(entries: MkvSeekEntry[]): Uint8Array {
  const seekParts = entries.map(encodeSeekEntry);
  const body = concatBytes(seekParts);

  const idBytes = writeVintId(ID_SEEK_HEAD);
  const sizeBytes = writeVintSize(BigInt(body.length));
  const seekHeadBytes = concatBytes([idBytes, sizeBytes, body]);

  if (seekHeadBytes.length > SEEK_HEAD_RESERVED_BYTES) {
    return seekHeadBytes;
  }

  const remaining = SEEK_HEAD_RESERVED_BYTES - seekHeadBytes.length;
  if (remaining < 2) {
    const padded = new Uint8Array(SEEK_HEAD_RESERVED_BYTES);
    padded.set(seekHeadBytes);
    return padded;
  }

  const voidPayloadSize = remaining - 2; // 1 byte ID (0xEC) + 1 byte size VINT
  const voidElem = buildVoid(voidPayloadSize);
  const out = concatBytes([seekHeadBytes, voidElem]);

  if (out.length < SEEK_HEAD_RESERVED_BYTES) {
    const padded = new Uint8Array(SEEK_HEAD_RESERVED_BYTES);
    padded.set(out);
    return padded;
  }

  return out.subarray(0, SEEK_HEAD_RESERVED_BYTES);
}

function encodeSeekEntry(entry: MkvSeekEntry): Uint8Array {
  const children = concatBytes([
    encodeBinaryElement(ID_SEEK_ID, entry.seekId),
    encodeUintElement(ID_SEEK_POSITION, BigInt(entry.seekPosition)),
  ]);
  return encodeMasterElement(ID_SEEK, children);
}

function buildVoid(payloadSize: number): Uint8Array {
  if (payloadSize < 0) return new Uint8Array(0);
  const idByte = new Uint8Array([ID_VOID]);
  const sizeBytes = writeVintSize(BigInt(payloadSize));
  const voidPayload = new Uint8Array(payloadSize);
  return concatBytes([idByte, sizeBytes, voidPayload]);
}

export function idToBytes(id: number): Uint8Array {
  return writeVintId(id);
}
