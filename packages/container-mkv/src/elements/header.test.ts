/**
 * Tests for EBML header decode/encode (header.ts).
 */

import {
  concatBytes,
  readChildren,
  readElementHeader,
  writeString,
  writeUint,
  writeVintId,
  writeVintSize,
} from '@webcvt/ebml';
import { describe, expect, it } from 'vitest';
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
import {
  decodeEbmlHeader,
  encodeBinaryElement,
  encodeEbmlHeader,
  encodeMasterElement,
  encodeStringElement,
  encodeUintElement,
  encodeUtf8Element,
} from './header.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUintElem(id: number, value: bigint): Uint8Array {
  return encodeUintElement(id, value);
}

function makeStringElem(id: number, value: string): Uint8Array {
  const idBytes = writeVintId(id);
  const payload = writeString(value);
  const sizeBytes = writeVintSize(BigInt(payload.length));
  return concatBytes([idBytes, sizeBytes, payload]);
}

function buildHeaderBytes(doctType = 'matroska'): {
  bytes: Uint8Array;
  children: ReturnType<typeof readChildren>;
} {
  const childrenPayload = concatBytes([
    makeUintElem(ID_EBML_VERSION, 1n),
    makeUintElem(ID_EBML_READ_VERSION, 1n),
    makeUintElem(ID_EBML_MAX_ID_LENGTH, 4n),
    makeUintElem(ID_EBML_MAX_SIZE_LENGTH, 8n),
    makeStringElem(ID_DOCTYPE, doctType),
    makeUintElem(ID_DOCTYPE_VERSION, 4n),
    makeUintElem(ID_DOCTYPE_READ_VERSION, 2n),
  ]);
  // encodeMasterElement: 4-byte ID + variable size VINT + payload
  const bytes = encodeMasterElement(ID_EBML, childrenPayload);
  // Payload starts after ID (4 bytes) + size VINT width
  const sizeByte = bytes[4] as number;
  let sizeWidth = 1;
  if ((sizeByte & 0x80) === 0) {
    if ((sizeByte & 0x40) !== 0) sizeWidth = 2;
    else if ((sizeByte & 0x20) !== 0) sizeWidth = 3;
    else sizeWidth = 4;
  }
  const payloadStart = 4 + sizeWidth;
  const children = readChildren(
    bytes,
    payloadStart,
    bytes.length,
    1,
    { value: 0 },
    100,
    64 * 1024 * 1024,
    ID_EBML,
    0x18538067,
  );
  return { bytes, children };
}

// ---------------------------------------------------------------------------
// decodeEbmlHeader tests
// ---------------------------------------------------------------------------

describe('decodeEbmlHeader', () => {
  it('decodes a canonical matroska header', () => {
    const { bytes, children } = buildHeaderBytes('matroska');
    const header = decodeEbmlHeader(bytes, children);
    expect(header.docType).toBe('matroska');
    expect(header.ebmlVersion).toBe(1);
    expect(header.ebmlReadVersion).toBe(1);
    expect(header.ebmlMaxIdLength).toBe(4);
    expect(header.ebmlMaxSizeLength).toBe(8);
    expect(header.docTypeVersion).toBe(4);
    expect(header.docTypeReadVersion).toBe(2);
  });

  it('throws MkvDocTypeNotSupportedError for "webm" doctype', () => {
    const { bytes, children } = buildHeaderBytes('webm');
    expect(() => decodeEbmlHeader(bytes, children)).toThrow(MkvDocTypeNotSupportedError);
  });

  it('throws MkvDocTypeNotSupportedError for unsupported doctype "mkv-3d"', () => {
    const { bytes, children } = buildHeaderBytes('mkv-3d');
    expect(() => decodeEbmlHeader(bytes, children)).toThrow(MkvDocTypeNotSupportedError);
  });

  it('throws MkvMissingElementError when DocType is absent', () => {
    const childrenPayload = concatBytes([
      makeUintElem(ID_EBML_VERSION, 1n),
      makeUintElem(ID_EBML_READ_VERSION, 1n),
    ]);
    const bytes = encodeMasterElement(ID_EBML, childrenPayload);
    const sizeByte = bytes[4] as number;
    const sizeWidth = (sizeByte & 0x80) !== 0 ? 1 : (sizeByte & 0x40) !== 0 ? 2 : 3;
    const payloadStart = 4 + sizeWidth;
    const parsedChildren = readChildren(
      bytes,
      payloadStart,
      bytes.length,
      1,
      { value: 0 },
      100,
      64 * 1024 * 1024,
      ID_EBML,
      0x18538067,
    );
    expect(() => decodeEbmlHeader(bytes, parsedChildren)).toThrow(MkvMissingElementError);
  });

  it('throws MkvEbmlVersionError when EBMLVersion != 1', () => {
    const childrenPayload = concatBytes([
      makeUintElem(ID_EBML_VERSION, 2n),
      makeUintElem(ID_EBML_READ_VERSION, 1n),
      makeStringElem(ID_DOCTYPE, 'matroska'),
    ]);
    const bytes = encodeMasterElement(ID_EBML, childrenPayload);
    const sizeByte = bytes[4] as number;
    const sizeWidth = (sizeByte & 0x80) !== 0 ? 1 : (sizeByte & 0x40) !== 0 ? 2 : 3;
    const payloadStart = 4 + sizeWidth;
    const parsedChildren = readChildren(
      bytes,
      payloadStart,
      bytes.length,
      1,
      { value: 0 },
      100,
      64 * 1024 * 1024,
      ID_EBML,
      0x18538067,
    );
    expect(() => decodeEbmlHeader(bytes, parsedChildren)).toThrow(MkvEbmlVersionError);
  });

  it('throws MkvEbmlVersionError when EBMLReadVersion != 1', () => {
    const childrenPayload = concatBytes([
      makeUintElem(ID_EBML_VERSION, 1n),
      makeUintElem(ID_EBML_READ_VERSION, 2n),
      makeStringElem(ID_DOCTYPE, 'matroska'),
    ]);
    const bytes = encodeMasterElement(ID_EBML, childrenPayload);
    const sizeByte = bytes[4] as number;
    const sizeWidth = (sizeByte & 0x80) !== 0 ? 1 : (sizeByte & 0x40) !== 0 ? 2 : 3;
    const payloadStart = 4 + sizeWidth;
    const parsedChildren = readChildren(
      bytes,
      payloadStart,
      bytes.length,
      1,
      { value: 0 },
      100,
      64 * 1024 * 1024,
      ID_EBML,
      0x18538067,
    );
    expect(() => decodeEbmlHeader(bytes, parsedChildren)).toThrow(MkvEbmlVersionError);
  });

  it('throws MkvEbmlLimitError when MaxIDLength > 4', () => {
    const childrenPayload = concatBytes([
      makeUintElem(ID_EBML_VERSION, 1n),
      makeUintElem(ID_EBML_READ_VERSION, 1n),
      makeUintElem(ID_EBML_MAX_ID_LENGTH, 5n),
      makeStringElem(ID_DOCTYPE, 'matroska'),
    ]);
    const bytes = encodeMasterElement(ID_EBML, childrenPayload);
    const sizeByte = bytes[4] as number;
    const sizeWidth = (sizeByte & 0x80) !== 0 ? 1 : (sizeByte & 0x40) !== 0 ? 2 : 3;
    const payloadStart = 4 + sizeWidth;
    const parsedChildren = readChildren(
      bytes,
      payloadStart,
      bytes.length,
      1,
      { value: 0 },
      100,
      64 * 1024 * 1024,
      ID_EBML,
      0x18538067,
    );
    expect(() => decodeEbmlHeader(bytes, parsedChildren)).toThrow(MkvEbmlLimitError);
  });

  it('throws MkvEbmlLimitError when MaxSizeLength > 8', () => {
    const childrenPayload = concatBytes([
      makeUintElem(ID_EBML_VERSION, 1n),
      makeUintElem(ID_EBML_READ_VERSION, 1n),
      makeUintElem(ID_EBML_MAX_SIZE_LENGTH, 9n),
      makeStringElem(ID_DOCTYPE, 'matroska'),
    ]);
    const bytes = encodeMasterElement(ID_EBML, childrenPayload);
    const sizeByte = bytes[4] as number;
    const sizeWidth = (sizeByte & 0x80) !== 0 ? 1 : (sizeByte & 0x40) !== 0 ? 2 : 3;
    const payloadStart = 4 + sizeWidth;
    const parsedChildren = readChildren(
      bytes,
      payloadStart,
      bytes.length,
      1,
      { value: 0 },
      100,
      64 * 1024 * 1024,
      ID_EBML,
      0x18538067,
    );
    expect(() => decodeEbmlHeader(bytes, parsedChildren)).toThrow(MkvEbmlLimitError);
  });
});

// ---------------------------------------------------------------------------
// encodeEbmlHeader tests
// ---------------------------------------------------------------------------

describe('encodeEbmlHeader', () => {
  it('encodes a canonical matroska header with correct bytes', () => {
    const header = {
      ebmlVersion: 1 as const,
      ebmlReadVersion: 1 as const,
      ebmlMaxIdLength: 4,
      ebmlMaxSizeLength: 8,
      docType: 'matroska' as const,
      docTypeVersion: 4,
      docTypeReadVersion: 2,
    };
    const encoded = encodeEbmlHeader(header);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);
    // First 4 bytes = EBML element ID 0x1A45DFA3
    expect(encoded[0]).toBe(0x1a);
    expect(encoded[1]).toBe(0x45);
    expect(encoded[2]).toBe(0xdf);
    expect(encoded[3]).toBe(0xa3);
  });

  it('round-trip: encode → decode gives same header', () => {
    const header = {
      ebmlVersion: 1 as const,
      ebmlReadVersion: 1 as const,
      ebmlMaxIdLength: 4,
      ebmlMaxSizeLength: 8,
      docType: 'matroska' as const,
      docTypeVersion: 4,
      docTypeReadVersion: 2,
    };
    const encoded = encodeEbmlHeader(header);
    // Payload starts after 4-byte EBML ID + size VINT
    const sizeByte = encoded[4] as number;
    const sizeWidth = (sizeByte & 0x80) !== 0 ? 1 : (sizeByte & 0x40) !== 0 ? 2 : 3;
    const payloadStart = 4 + sizeWidth;
    const parsedChildren = readChildren(
      encoded,
      payloadStart,
      encoded.length,
      1,
      { value: 0 },
      100,
      64 * 1024 * 1024,
      ID_EBML,
      0x18538067,
    );
    const decoded = decodeEbmlHeader(encoded, parsedChildren);
    expect(decoded.docType).toBe('matroska');
    expect(decoded.ebmlVersion).toBe(1);
    expect(decoded.docTypeVersion).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Element builder helpers tests
// ---------------------------------------------------------------------------

describe('element builder helpers', () => {
  it('encodeUintElement produces correct structure', () => {
    const elem = encodeUintElement(0x86, 42n);
    // First byte = ID 0x86 (1-byte VINT ID)
    expect(elem[0]).toBe(0x86);
    // Second byte = size VINT for 1-byte payload (0x81 = 0x80 | 1)
    expect(elem[1]).toBe(0x81);
    // Third byte = value 42
    expect(elem[2]).toBe(42);
  });

  it('encodeStringElement produces correct structure', () => {
    const elem = encodeStringElement(0x86, 'abc');
    expect(elem[0]).toBe(0x86);
    expect(elem[1]).toBe(0x83); // size = 3
    expect(elem[2]).toBe(0x61); // 'a'
    expect(elem[3]).toBe(0x62); // 'b'
    expect(elem[4]).toBe(0x63); // 'c'
  });

  it('encodeBinaryElement wraps binary payload', () => {
    const payload = new Uint8Array([0xde, 0xad]);
    const elem = encodeBinaryElement(0x86, payload);
    expect(elem[0]).toBe(0x86);
    expect(elem[1]).toBe(0x82); // size = 2
    expect(elem[2]).toBe(0xde);
    expect(elem[3]).toBe(0xad);
  });

  it('encodeMasterElement wraps children', () => {
    const children = new Uint8Array([0xaa, 0xbb]);
    const elem = encodeMasterElement(0x86, children);
    expect(elem[0]).toBe(0x86);
    expect(elem[1]).toBe(0x82); // size = 2
    expect(elem[2]).toBe(0xaa);
    expect(elem[3]).toBe(0xbb);
  });

  it('encodeUtf8Element encodes UTF-8 string', () => {
    const elem = encodeUtf8Element(0x86, 'hello');
    expect(elem[0]).toBe(0x86);
    // size = 5, encoded as 0x85
    expect(elem[1]).toBe(0x85);
    expect(elem[2]).toBe(0x68); // 'h'
  });
});
