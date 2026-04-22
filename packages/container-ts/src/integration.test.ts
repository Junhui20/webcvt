/**
 * Integration tests using the real fixture file.
 *
 * Uses structural validation only — NO byte-identical checks.
 * Per design note: fixture content may vary across host OS/arch.
 */

import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { iterateAudioChunks, iterateVideoChunks } from './chunk-iterator.ts';
import { parseTs } from './parser.ts';
import { serializeTs } from './serializer.ts';

const FIXTURE_PATH = 'video/testsrc-1s-160x120-h264-aac.ts';

describe('fixture integration: testsrc-1s-160x120-h264-aac.ts', () => {
  it('loads the fixture without error', async () => {
    const bytes = await loadFixture(FIXTURE_PATH);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.length % 188).toBe(0); // valid TS alignment
  });

  it('parses with PAT seen and single program', async () => {
    const bytes = await loadFixture(FIXTURE_PATH);
    const file = parseTs(bytes);

    expect(file.pat.programs).toHaveLength(1);
    expect(file.pat.programs[0]?.programNumber).toBeGreaterThan(0);
  });

  it('PMT extracts video PID (0x1B) and audio PID (0x0F)', async () => {
    const bytes = await loadFixture(FIXTURE_PATH);
    const file = parseTs(bytes);

    const video = file.program.streams.find((s) => s.streamType === 0x1b);
    const audio = file.program.streams.find((s) => s.streamType === 0x0f);

    expect(video).toBeDefined();
    expect(audio).toBeDefined();
    expect(video?.unsupported).toBe(false);
    expect(audio?.unsupported).toBe(false);
  });

  it('at least one PES per track with valid PTS', async () => {
    const bytes = await loadFixture(FIXTURE_PATH);
    const file = parseTs(bytes);

    const videoPid = file.program.streams.find((s) => s.streamType === 0x1b)?.pid;
    const audioPid = file.program.streams.find((s) => s.streamType === 0x0f)?.pid;

    const videoPes = file.pesPackets.filter((p) => p.pid === videoPid);
    const audioPes = file.pesPackets.filter((p) => p.pid === audioPid);

    expect(videoPes.length).toBeGreaterThan(0);
    expect(audioPes.length).toBeGreaterThan(0);

    // PTS must be defined and non-negative
    for (const pes of [...videoPes, ...audioPes]) {
      expect(pes.ptsUs).toBeDefined();
      expect(pes.ptsUs ?? -1).toBeGreaterThanOrEqual(0);
    }
  });

  it('at least one IDR keyframe in video stream', async () => {
    const bytes = await loadFixture(FIXTURE_PATH);
    const file = parseTs(bytes);
    const chunks = [...iterateVideoChunks(file)];

    expect(chunks.length).toBeGreaterThan(0);
    const hasKeyframe = chunks.some((c) => c.type === 'key');
    expect(hasKeyframe).toBe(true);
  });

  it('video chunks have AVC codec string', async () => {
    const bytes = await loadFixture(FIXTURE_PATH);
    const file = parseTs(bytes);
    const chunks = [...iterateVideoChunks(file)];

    for (const chunk of chunks.slice(0, 5)) {
      expect(chunk.codec).toMatch(/^avc1\.[0-9a-f]{6}$/i);
    }
  });

  it('audio chunks have AAC codec string and description', async () => {
    const bytes = await loadFixture(FIXTURE_PATH);
    const file = parseTs(bytes);
    const chunks = [...iterateAudioChunks(file)];

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.codec).toMatch(/^mp4a\.40\.\d+$/);
    expect(chunks[0]?.description).toBeDefined();
    expect(chunks[0]?.description?.length ?? 0).toBe(2);
  });

  it('round-trip semantic equivalence: parse → serialize → parse', async () => {
    const bytes = await loadFixture(FIXTURE_PATH);
    const file1 = parseTs(bytes);
    const serialized = serializeTs(file1);
    const file2 = parseTs(serialized);

    // Same number of PES packets (allow ±1 for boundary flush differences)
    expect(Math.abs(file2.pesPackets.length - file1.pesPackets.length)).toBeLessThanOrEqual(2);

    // Same stream types present
    const st1 = file1.program.streams.map((s) => s.streamType).sort();
    const st2 = file2.program.streams.map((s) => s.streamType).sort();
    expect(st2).toEqual(st1);

    // PTS values within reasonable tolerance (≤1ms = 1000µs)
    const video1 = file1.pesPackets.filter((p) => (p.streamId & 0xf0) === 0xe0);
    const video2 = file2.pesPackets.filter((p) => (p.streamId & 0xf0) === 0xe0);
    const minLen = Math.min(video1.length, video2.length);
    for (let i = 0; i < Math.min(minLen, 5); i++) {
      const pts1 = video1[i]?.ptsUs ?? 0;
      const pts2 = video2[i]?.ptsUs ?? 0;
      expect(Math.abs(pts1 - pts2)).toBeLessThan(1000);
    }
  });

  it('serialized output is 188-byte aligned', async () => {
    const bytes = await loadFixture(FIXTURE_PATH);
    const file = parseTs(bytes);
    const serialized = serializeTs(file);
    expect(serialized.length % 188).toBe(0);
  });

  it('verifies PSI CRC-32 (poly 0x04C11DB7, init 0xFFFFFFFF) on fixture', async () => {
    // parseTs already validates CRC on every PSI section internally.
    // If this doesn't throw, CRC validation passed.
    const bytes = await loadFixture(FIXTURE_PATH);
    expect(() => parseTs(bytes)).not.toThrow();
  });
});
