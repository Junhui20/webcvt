/**
 * EBML header element (ID 0x1A45DFA3) decode and encode for Matroska.
 *
 * Validates DocType == "matroska" (Trap §19).
 * Rejects DocType "webm" with MkvDocTypeNotSupportedError so the registry
 * routes WebM files to @webcvt/container-webm.
 * Rejects EBMLVersion != 1, EBMLReadVersion != 1, MaxIDLength > 4, MaxSizeLength > 8.
 */

import {
  concatBytes,
  findChild,
  readString,
  readUintNumber,
  writeString,
  writeUint,
  writeVintId,
  writeVintSize,
} from '@webcvt/ebml';
import type { EbmlElement } from '@webcvt/ebml';
import {
  ID_DOCTYPE,
  ID_DOCTYPE_READ_VERSION,
  ID_DOCTYPE_VERSION,
  ID_EBML,
  ID_EBML_MAX_ID_LENGTH,
  ID_EBML_MAX_SIZE_LENGTH,
  ID_EBML_READ_VERSION,
  ID_EBML_VERSION,
} from '../constants.ts';
import {
  MkvDocTypeNotSupportedError,
  MkvEbmlLimitError,
  MkvEbmlVersionError,
  MkvMissingElementError,
} from '../errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MkvEbmlHeader {
  ebmlVersion: 1;
  ebmlReadVersion: 1;
  ebmlMaxIdLength: number;
  ebmlMaxSizeLength: number;
  docType: 'matroska';
  docTypeVersion: number;
  docTypeReadVersion: number;
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

/**
 * Decode an EBML header from its children array.
 * Validates DocType == "matroska" (Trap §19).
 */
export function decodeEbmlHeader(bytes: Uint8Array, children: EbmlElement[]): MkvEbmlHeader {
  const versionElem = findChild(children, ID_EBML_VERSION);
  const ebmlVersion = versionElem
    ? readUintNumber(bytes.subarray(versionElem.payloadOffset, versionElem.nextOffset))
    : 1;
  if (ebmlVersion !== 1) {
    throw new MkvEbmlVersionError('EBMLVersion', ebmlVersion);
  }

  const readVersionElem = findChild(children, ID_EBML_READ_VERSION);
  const ebmlReadVersion = readVersionElem
    ? readUintNumber(bytes.subarray(readVersionElem.payloadOffset, readVersionElem.nextOffset))
    : 1;
  if (ebmlReadVersion !== 1) {
    throw new MkvEbmlVersionError('EBMLReadVersion', ebmlReadVersion);
  }

  const maxIdLenElem = findChild(children, ID_EBML_MAX_ID_LENGTH);
  const ebmlMaxIdLength = maxIdLenElem
    ? readUintNumber(bytes.subarray(maxIdLenElem.payloadOffset, maxIdLenElem.nextOffset))
    : 4;
  if (ebmlMaxIdLength > 4) {
    throw new MkvEbmlLimitError('EBMLMaxIDLength', ebmlMaxIdLength, 4);
  }

  const maxSizeLenElem = findChild(children, ID_EBML_MAX_SIZE_LENGTH);
  const ebmlMaxSizeLength = maxSizeLenElem
    ? readUintNumber(bytes.subarray(maxSizeLenElem.payloadOffset, maxSizeLenElem.nextOffset))
    : 8;
  if (ebmlMaxSizeLength > 8) {
    throw new MkvEbmlLimitError('EBMLMaxSizeLength', ebmlMaxSizeLength, 8);
  }

  const docTypeElem = findChild(children, ID_DOCTYPE);
  if (!docTypeElem) {
    throw new MkvMissingElementError('DocType', 'EBML');
  }
  const docType = readString(bytes.subarray(docTypeElem.payloadOffset, docTypeElem.nextOffset));

  // Trap §19: strict DocType validation — only "matroska".
  if (docType !== 'matroska') {
    throw new MkvDocTypeNotSupportedError(docType);
  }

  const docTypeVersionElem = findChild(children, ID_DOCTYPE_VERSION);
  const docTypeVersion = docTypeVersionElem
    ? readUintNumber(
        bytes.subarray(docTypeVersionElem.payloadOffset, docTypeVersionElem.nextOffset),
      )
    : 1;

  const docTypeReadVersionElem = findChild(children, ID_DOCTYPE_READ_VERSION);
  const docTypeReadVersion = docTypeReadVersionElem
    ? readUintNumber(
        bytes.subarray(docTypeReadVersionElem.payloadOffset, docTypeReadVersionElem.nextOffset),
      )
    : 1;

  return {
    ebmlVersion: 1,
    ebmlReadVersion: 1,
    ebmlMaxIdLength,
    ebmlMaxSizeLength,
    docType: 'matroska',
    docTypeVersion,
    docTypeReadVersion,
  };
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/**
 * Encode an EBML header element to bytes.
 * Always emits canonical values: version=1, MaxIDLength=4, MaxSizeLength=8,
 * DocType="matroska", DocTypeVersion=4, DocTypeReadVersion=2.
 */
export function encodeEbmlHeader(_header: MkvEbmlHeader): Uint8Array {
  const children = concatBytes([
    encodeUintElement(ID_EBML_VERSION, 1n),
    encodeUintElement(ID_EBML_READ_VERSION, 1n),
    encodeUintElement(ID_EBML_MAX_ID_LENGTH, 4n),
    encodeUintElement(ID_EBML_MAX_SIZE_LENGTH, 8n),
    encodeStringElement(ID_DOCTYPE, 'matroska'),
    encodeUintElement(ID_DOCTYPE_VERSION, 4n),
    encodeUintElement(ID_DOCTYPE_READ_VERSION, 2n),
  ]);

  return encodeMasterElement(ID_EBML, children);
}

// ---------------------------------------------------------------------------
// Internal helpers — low-level element construction (exported for other modules)
// ---------------------------------------------------------------------------

export function encodeUintElement(id: number, value: bigint): Uint8Array {
  const idBytes = writeVintId(id);
  const payload = writeUint(value);
  const sizeBytes = writeVintSize(BigInt(payload.length));
  return concatBytes([idBytes, sizeBytes, payload]);
}

export function encodeStringElement(id: number, value: string): Uint8Array {
  const idBytes = writeVintId(id);
  const payload = writeString(value);
  const sizeBytes = writeVintSize(BigInt(payload.length));
  return concatBytes([idBytes, sizeBytes, payload]);
}

export function encodeUtf8Element(id: number, value: string): Uint8Array {
  const idBytes = writeVintId(id);
  const enc = new TextEncoder();
  const payload = enc.encode(value);
  const sizeBytes = writeVintSize(BigInt(payload.length));
  return concatBytes([idBytes, sizeBytes, payload]);
}

export function encodeBinaryElement(id: number, payload: Uint8Array): Uint8Array {
  const idBytes = writeVintId(id);
  const sizeBytes = writeVintSize(BigInt(payload.length));
  return concatBytes([idBytes, sizeBytes, payload]);
}

export function encodeMasterElement(id: number, children: Uint8Array): Uint8Array {
  const idBytes = writeVintId(id);
  const sizeBytes = writeVintSize(BigInt(children.length));
  return concatBytes([idBytes, sizeBytes, children]);
}
