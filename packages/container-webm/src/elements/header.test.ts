/**
 * Tests for EBML header element decode/encode (elements/header.ts).
 */

import type { EbmlElement } from '@webcvt/ebml';
import { readVintId, readVintSize } from '@webcvt/ebml';
import { describe, expect, it } from 'vitest';
import {
  WebmDocTypeNotSupportedError,
  WebmEbmlLimitError,
  WebmEbmlVersionError,
  WebmMissingElementError,
} from '../errors.ts';
import { decodeEbmlHeader, encodeEbmlHeader } from './header.ts';

// Minimal helper: build a fake EbmlElement.
function fakeElem(
  id: number,
  payloadBytes: Uint8Array,
  fileBytes: Uint8Array,
  offset: number,
): EbmlElement {
  return {
    id,
    size: BigInt(payloadBytes.length),
    payloadOffset: offset,
    nextOffset: offset + payloadBytes.length,
    idWidth: 1,
    sizeWidth: 1,
  };
}

/**
 * Build a minimal EBML header children array for testing decodeEbmlHeader.
 * The returned object contains the file bytes and children array.
 */
function buildHeaderChildren(overrides: {
  ebmlVersion?: number;
  ebmlReadVersion?: number;
  maxIdLength?: number;
  maxSizeLength?: number;
  docType?: string;
  docTypeVersion?: number;
  docTypeReadVersion?: number;
}): { bytes: Uint8Array; children: EbmlElement[] } {
  const {
    ebmlVersion = 1,
    ebmlReadVersion = 1,
    maxIdLength = 4,
    maxSizeLength = 8,
    docType = 'webm',
    docTypeVersion = 4,
    docTypeReadVersion = 2,
  } = overrides;

  const enc = new TextEncoder();

  // Collect all element payloads with their IDs.
  const elems: Array<{ id: number; payload: Uint8Array }> = [
    { id: 0x4286, payload: new Uint8Array([ebmlVersion]) },
    { id: 0x42f7, payload: new Uint8Array([ebmlReadVersion]) },
    { id: 0x42f2, payload: new Uint8Array([maxIdLength]) },
    { id: 0x42f3, payload: new Uint8Array([maxSizeLength]) },
    { id: 0x4282, payload: enc.encode(docType) },
    { id: 0x4287, payload: new Uint8Array([docTypeVersion]) },
    { id: 0x4285, payload: new Uint8Array([docTypeReadVersion]) },
  ];

  // Compute total file buffer size.
  let totalSize = 0;
  for (const e of elems) {
    totalSize += 2 + 1 + e.payload.length; // id(2) + size(1) + payload
  }

  const bytes = new Uint8Array(totalSize);
  const children: EbmlElement[] = [];
  let offset = 0;

  for (const e of elems) {
    // Write 2-byte ID.
    bytes[offset] = (e.id >> 8) & 0xff;
    bytes[offset + 1] = e.id & 0xff;
    // Write 1-byte size VINT.
    bytes[offset + 2] = 0x80 | e.payload.length;
    // Write payload.
    bytes.set(e.payload, offset + 3);

    children.push({
      id: e.id,
      size: BigInt(e.payload.length),
      payloadOffset: offset + 3,
      nextOffset: offset + 3 + e.payload.length,
      idWidth: 2,
      sizeWidth: 1,
    });

    offset += 2 + 1 + e.payload.length;
  }

  return { bytes, children };
}

describe('decodeEbmlHeader', () => {
  it('decodes a valid webm header', () => {
    const { bytes, children } = buildHeaderChildren({});
    const header = decodeEbmlHeader(bytes, children);
    expect(header.docType).toBe('webm');
    expect(header.ebmlVersion).toBe(1);
    expect(header.ebmlReadVersion).toBe(1);
    expect(header.ebmlMaxIdLength).toBe(4);
    expect(header.ebmlMaxSizeLength).toBe(8);
    expect(header.docTypeVersion).toBe(4);
    expect(header.docTypeReadVersion).toBe(2);
  });

  it('rejects DocType "matroska"', () => {
    const { bytes, children } = buildHeaderChildren({ docType: 'matroska' });
    expect(() => decodeEbmlHeader(bytes, children)).toThrow(WebmDocTypeNotSupportedError);
  });

  it('rejects DocType "foo"', () => {
    const { bytes, children } = buildHeaderChildren({ docType: 'foo' });
    expect(() => decodeEbmlHeader(bytes, children)).toThrow(WebmDocTypeNotSupportedError);
  });

  it('rejects EBMLVersion != 1', () => {
    const { bytes, children } = buildHeaderChildren({ ebmlVersion: 2 });
    expect(() => decodeEbmlHeader(bytes, children)).toThrow(WebmEbmlVersionError);
  });

  it('rejects EBMLReadVersion != 1', () => {
    const { bytes, children } = buildHeaderChildren({ ebmlReadVersion: 2 });
    expect(() => decodeEbmlHeader(bytes, children)).toThrow(WebmEbmlVersionError);
  });

  it('rejects EBMLMaxIDLength > 4', () => {
    const { bytes, children } = buildHeaderChildren({ maxIdLength: 5 });
    expect(() => decodeEbmlHeader(bytes, children)).toThrow(WebmEbmlLimitError);
  });

  it('rejects EBMLMaxSizeLength > 8', () => {
    const { bytes, children } = buildHeaderChildren({ maxSizeLength: 9 });
    expect(() => decodeEbmlHeader(bytes, children)).toThrow(WebmEbmlLimitError);
  });

  it('throws when DocType element is absent', () => {
    const { bytes, children } = buildHeaderChildren({});
    // Remove DocType element (ID 0x4282).
    const filtered = children.filter((c) => c.id !== 0x4282);
    expect(() => decodeEbmlHeader(bytes, filtered)).toThrow(WebmMissingElementError);
  });
});

describe('encodeEbmlHeader', () => {
  it('encodes and the output starts with EBML master ID', () => {
    const header = {
      ebmlVersion: 1 as const,
      ebmlReadVersion: 1 as const,
      ebmlMaxIdLength: 4,
      ebmlMaxSizeLength: 8,
      docType: 'webm' as const,
      docTypeVersion: 4,
      docTypeReadVersion: 2,
    };
    const bytes = encodeEbmlHeader(header);
    // First 4 bytes should be EBML master ID 0x1A45DFA3.
    expect(bytes[0]).toBe(0x1a);
    expect(bytes[1]).toBe(0x45);
    expect(bytes[2]).toBe(0xdf);
    expect(bytes[3]).toBe(0xa3);
  });

  it('encodes DocType "webm" in the output', () => {
    const header = {
      ebmlVersion: 1 as const,
      ebmlReadVersion: 1 as const,
      ebmlMaxIdLength: 4,
      ebmlMaxSizeLength: 8,
      docType: 'webm' as const,
      docTypeVersion: 4,
      docTypeReadVersion: 2,
    };
    const bytes = encodeEbmlHeader(header);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('webm');
  });
});
