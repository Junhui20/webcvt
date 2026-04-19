/**
 * Focused unit tests for serializeFlac (serializer.ts).
 *
 * The round-trip invariant (parse → serialize → identical bytes) is tested in
 * parser.test.ts.  This file tests the serializer in isolation, covering
 * invariants that cannot be exercised through the parser alone.
 */

import { describe, expect, it } from 'vitest';
import { FlacInvalidMetadataError } from './errors.ts';
import {
  BLOCK_TYPE_PADDING,
  BLOCK_TYPE_STREAMINFO,
  BLOCK_TYPE_VORBIS_COMMENT,
  parseBlockHeader,
} from './metadata.ts';
import type { FlacFile } from './parser.ts';
import { serializeFlac } from './serializer.ts';
import type { FlacStreamInfo } from './streaminfo.ts';
import { decodeStreamInfo, encodeStreamInfo } from './streaminfo.ts';

// ---------------------------------------------------------------------------
// Minimal helpers
// ---------------------------------------------------------------------------

function makeStreamInfo(overrides?: Partial<FlacStreamInfo>): FlacStreamInfo {
  return {
    minBlockSize: 4096,
    maxBlockSize: 4096,
    minFrameSize: 0,
    maxFrameSize: 0,
    sampleRate: 44100,
    channels: 2,
    bitsPerSample: 16,
    totalSamples: 0,
    md5: new Uint8Array(16),
    ...overrides,
  };
}

function makeMinimalFlacFile(overrides?: Partial<FlacFile>): FlacFile {
  const streamInfo = makeStreamInfo();
  const siBody = encodeStreamInfo(streamInfo);
  return {
    streamInfo,
    blocks: [{ type: BLOCK_TYPE_STREAMINFO, data: siBody }],
    frames: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('serializeFlac', () => {
  it('throws FlacInvalidMetadataError when STREAMINFO block is missing from blocks', () => {
    const file = makeMinimalFlacFile({
      blocks: [], // no blocks at all
    });
    expect(() => serializeFlac(file)).toThrow(FlacInvalidMetadataError);
  });

  it('throws FlacInvalidMetadataError when STREAMINFO is not the first block', () => {
    const streamInfo = makeStreamInfo();
    const siBody = encodeStreamInfo(streamInfo);
    const paddingBody = new Uint8Array(8);

    const file: FlacFile = {
      streamInfo,
      blocks: [
        { type: BLOCK_TYPE_PADDING, data: paddingBody }, // PADDING first — wrong
        { type: BLOCK_TYPE_STREAMINFO, data: siBody },
      ],
      frames: [],
    };
    expect(() => serializeFlac(file)).toThrow(FlacInvalidMetadataError);
  });

  it('recomputes totalSamples from frames when STREAMINFO.totalSamples is 0', () => {
    const streamInfo = makeStreamInfo({ totalSamples: 0 });
    const siBody = encodeStreamInfo(streamInfo);

    // Two fake frames with blockSize 4096 each
    const fakeFrameData = new Uint8Array(10); // minimal stub
    const file: FlacFile = {
      streamInfo,
      blocks: [{ type: BLOCK_TYPE_STREAMINFO, data: siBody }],
      frames: [
        {
          sampleNumber: 0,
          blockSize: 4096,
          sampleRate: 44100,
          channels: 2,
          bitsPerSample: 16,
          channelAssignment: 'raw',
          data: fakeFrameData,
        },
        {
          sampleNumber: 4096,
          blockSize: 4096,
          sampleRate: 44100,
          channels: 2,
          bitsPerSample: 16,
          channelAssignment: 'raw',
          data: fakeFrameData,
        },
      ],
    };

    const output = serializeFlac(file);

    // Parse the STREAMINFO back out of the serialized bytes to check totalSamples.
    // fLaC magic (4) + block header (4) + STREAMINFO body (34)
    const siOffset = 4 + 4; // after magic + block header
    const siBodyOut = output.subarray(siOffset, siOffset + 34);
    const parsedSi = decodeStreamInfo(siBodyOut, 0);
    expect(parsedSi.totalSamples).toBe(8192);
  });

  it('preserves the exact byte order of metadata blocks', () => {
    const streamInfo = makeStreamInfo();
    const siBody = encodeStreamInfo(streamInfo);
    const vcBody = new Uint8Array([
      // vendor_length = 2 (LE), vendor = "OK", comment_count = 0
      0x02, 0x00, 0x00, 0x00, 0x4f, 0x4b, 0x00, 0x00, 0x00, 0x00,
    ]);
    const paddingBody = new Uint8Array(4);

    const file: FlacFile = {
      streamInfo,
      blocks: [
        { type: BLOCK_TYPE_STREAMINFO, data: siBody },
        { type: BLOCK_TYPE_VORBIS_COMMENT, data: vcBody },
        { type: BLOCK_TYPE_PADDING, data: paddingBody },
      ],
      frames: [],
    };

    const output = serializeFlac(file);

    // Verify the magic
    expect(output[0]).toBe(0x66); // f
    expect(output[1]).toBe(0x4c); // L
    expect(output[2]).toBe(0x61); // a
    expect(output[3]).toBe(0x43); // C

    // First block header after magic
    const hdr0 = parseBlockHeader(output, 4);
    expect(hdr0.type).toBe(BLOCK_TYPE_STREAMINFO);
    expect(hdr0.lastBlock).toBe(false);

    // Second block header
    const hdr1 = parseBlockHeader(output, 4 + 4 + 34);
    expect(hdr1.type).toBe(BLOCK_TYPE_VORBIS_COMMENT);
    expect(hdr1.lastBlock).toBe(false);

    // Third (last) block header
    const hdr2 = parseBlockHeader(output, 4 + 4 + 34 + 4 + vcBody.length);
    expect(hdr2.type).toBe(BLOCK_TYPE_PADDING);
    expect(hdr2.lastBlock).toBe(true);
  });

  it('sets the lastBlock flag on the final metadata block and clears it on others', () => {
    const streamInfo = makeStreamInfo();
    const siBody = encodeStreamInfo(streamInfo);
    const paddingBody = new Uint8Array(8);

    const file: FlacFile = {
      streamInfo,
      blocks: [
        { type: BLOCK_TYPE_STREAMINFO, data: siBody },
        { type: BLOCK_TYPE_PADDING, data: paddingBody },
      ],
      frames: [],
    };

    const output = serializeFlac(file);

    const hdr0 = parseBlockHeader(output, 4);
    const hdr1 = parseBlockHeader(output, 4 + 4 + siBody.length);

    expect(hdr0.lastBlock).toBe(false); // first block — NOT last
    expect(hdr1.lastBlock).toBe(true); // second (final) block — IS last
  });

  it('emits fLaC magic at offset 0', () => {
    const file = makeMinimalFlacFile();
    const output = serializeFlac(file);

    expect(output[0]).toBe(0x66); // 'f'
    expect(output[1]).toBe(0x4c); // 'L'
    expect(output[2]).toBe(0x61); // 'a'
    expect(output[3]).toBe(0x43); // 'C'
  });
});
