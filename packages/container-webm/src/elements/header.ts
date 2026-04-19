/**
 * EBML header element (ID 0x1A45DFA3) decode and encode.
 *
 * Validates DocType == "webm" and version constraints.
 * Throws WebmDocTypeNotSupportedError for "matroska" (routes to container-mkv).
 * Throws WebmEbmlVersionError for version != 1.
 * Throws WebmEbmlLimitError for MaxIDLength > 4 or MaxSizeLength > 8.
 */

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
import { findChild } from '../ebml-element.ts';
import type { EbmlElement } from '../ebml-element.ts';
import {
  concatBytes,
  readString,
  readUintNumber,
  writeString,
  writeUint,
  writeUtf8,
} from '../ebml-types.ts';
import { writeVintId, writeVintSize } from '../ebml-vint.ts';
import {
  WebmDocTypeNotSupportedError,
  WebmEbmlLimitError,
  WebmEbmlVersionError,
  WebmMissingElementError,
} from '../errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebmEbmlHeader {
  ebmlVersion: 1;
  ebmlReadVersion: 1;
  ebmlMaxIdLength: number;
  ebmlMaxSizeLength: number;
  docType: 'webm';
  docTypeVersion: number;
  docTypeReadVersion: number;
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

/**
 * Decode an EBML header from its children array.
 *
 * @param bytes        Full file buffer (for payload subarray).
 * @param children     Direct children of the EBML master element.
 */
export function decodeEbmlHeader(bytes: Uint8Array, children: EbmlElement[]): WebmEbmlHeader {
  // EBMLVersion — default 1, reject != 1.
  const versionElem = findChild(children, ID_EBML_VERSION);
  const ebmlVersion = versionElem
    ? readUintNumber(bytes.subarray(versionElem.payloadOffset, versionElem.nextOffset))
    : 1;
  if (ebmlVersion !== 1) {
    throw new WebmEbmlVersionError('EBMLVersion', ebmlVersion);
  }

  // EBMLReadVersion — default 1, reject != 1.
  const readVersionElem = findChild(children, ID_EBML_READ_VERSION);
  const ebmlReadVersion = readVersionElem
    ? readUintNumber(bytes.subarray(readVersionElem.payloadOffset, readVersionElem.nextOffset))
    : 1;
  if (ebmlReadVersion !== 1) {
    throw new WebmEbmlVersionError('EBMLReadVersion', ebmlReadVersion);
  }

  // EBMLMaxIDLength — default 4, reject > 4.
  const maxIdLenElem = findChild(children, ID_EBML_MAX_ID_LENGTH);
  const ebmlMaxIdLength = maxIdLenElem
    ? readUintNumber(bytes.subarray(maxIdLenElem.payloadOffset, maxIdLenElem.nextOffset))
    : 4;
  if (ebmlMaxIdLength > 4) {
    throw new WebmEbmlLimitError('EBMLMaxIDLength', ebmlMaxIdLength, 4);
  }

  // EBMLMaxSizeLength — default 8, reject > 8.
  const maxSizeLenElem = findChild(children, ID_EBML_MAX_SIZE_LENGTH);
  const ebmlMaxSizeLength = maxSizeLenElem
    ? readUintNumber(bytes.subarray(maxSizeLenElem.payloadOffset, maxSizeLenElem.nextOffset))
    : 8;
  if (ebmlMaxSizeLength > 8) {
    throw new WebmEbmlLimitError('EBMLMaxSizeLength', ebmlMaxSizeLength, 8);
  }

  // DocType — required, must be "webm".
  const docTypeElem = findChild(children, ID_DOCTYPE);
  if (!docTypeElem) {
    throw new WebmMissingElementError('DocType', 'EBML');
  }
  const docType = readString(bytes.subarray(docTypeElem.payloadOffset, docTypeElem.nextOffset));
  if (docType !== 'webm') {
    throw new WebmDocTypeNotSupportedError(docType);
  }

  // DocTypeVersion — default 1, accept 2..4.
  const docTypeVersionElem = findChild(children, ID_DOCTYPE_VERSION);
  const docTypeVersion = docTypeVersionElem
    ? readUintNumber(
        bytes.subarray(docTypeVersionElem.payloadOffset, docTypeVersionElem.nextOffset),
      )
    : 1;

  // DocTypeReadVersion — default 1, accept 2.
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
    docType: 'webm',
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
 * DocType="webm", DocTypeVersion=4, DocTypeReadVersion=2.
 */
export function encodeEbmlHeader(header: WebmEbmlHeader): Uint8Array {
  const children = concatBytes([
    encodeUintElement(ID_EBML_VERSION, 1n),
    encodeUintElement(ID_EBML_READ_VERSION, 1n),
    encodeUintElement(ID_EBML_MAX_ID_LENGTH, BigInt(header.ebmlMaxIdLength)),
    encodeUintElement(ID_EBML_MAX_SIZE_LENGTH, BigInt(header.ebmlMaxSizeLength)),
    encodeStringElement(ID_DOCTYPE, header.docType),
    encodeUintElement(ID_DOCTYPE_VERSION, BigInt(header.docTypeVersion)),
    encodeUintElement(ID_DOCTYPE_READ_VERSION, BigInt(header.docTypeReadVersion)),
  ]);

  return encodeMasterElement(ID_EBML, children);
}

// ---------------------------------------------------------------------------
// Internal helpers — low-level element construction
// (exported for use by other element modules)
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
  const payload = writeUtf8(value);
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

export function encodeMasterElementFixedSize(
  id: number,
  children: Uint8Array,
  fixedSize: number,
): Uint8Array {
  const idBytes = writeVintId(id);
  const sizeBytes = writeVintSize(BigInt(fixedSize));
  return concatBytes([idBytes, sizeBytes, children]);
}
