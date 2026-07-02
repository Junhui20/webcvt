/**
 * Shared fixtures + helpers for the cross-package integration suite.
 *
 * Fixture strategy: everything here is constructed in-memory from tiny inputs
 * (a 48-byte WAV, a zip built by archive-zip's own serializer, a short EML /
 * SRT / JSON string). The single exception is the font suite, which reuses the
 * committed `tests/fixtures/font/UbuntuMono-R.ttf` (a real sfnt cannot be
 * meaningfully hand-forged). No new binary fixtures are committed.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type ZipEntry, serializeZip } from '@catlabtech/webcvt-archive-zip';
import { ArchiveBackend } from '@catlabtech/webcvt-archive-zip';
import { WavBackend } from '@catlabtech/webcvt-container-wav';
import {
  type Backend,
  BackendRegistry,
  type ConvertOptions,
  type ConvertResult,
  type FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { DataTextBackend } from '@catlabtech/webcvt-data-text';
import { EmailBackend } from '@catlabtech/webcvt-email';
import { FontBackend } from '@catlabtech/webcvt-font';
import { SubtitleBackend } from '@catlabtech/webcvt-subtitle';

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const ENCODER = new TextEncoder();

/** Read a Blob back to bytes. */
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Wrap exact-size bytes in a typed Blob. The `.buffer as ArrayBuffer` cast
 * matches this repo's backends: `Uint8Array` now carries an `ArrayBufferLike`
 * generic that the DOM `BlobPart` type rejects, and every array here owns a
 * fresh, exact-length buffer.
 */
export function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes.buffer as ArrayBuffer], { type });
}

// ---------------------------------------------------------------------------
// WAV fixture — a canonical 44-byte-header PCM/mono/16-bit file + a few samples.
// ---------------------------------------------------------------------------

/** Build a minimal, valid PCM WAV byte array (parseWav-accepted). */
export function makeWavBytes(
  dataBytes = new Uint8Array([0, 0, 1, 0, 0xff, 0x7f, 0, 0x80]),
): Uint8Array {
  const dataSize = dataBytes.length; // keep even for RIFF alignment
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const writeAscii = (text: string, offset: number): void => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };

  const channels = 1;
  const sampleRate = 8000;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  writeAscii('RIFF', 0);
  view.setUint32(4, 36 + dataSize, true);
  writeAscii('WAVE', 8);
  writeAscii('fmt ', 12);
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audioFormat = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii('data', 36);
  view.setUint32(40, dataSize, true);
  bytes.set(dataBytes, 44);
  return bytes;
}

/** WAV as a Blob typed audio/wav. */
export function makeWavBlob(): Blob {
  return bytesToBlob(makeWavBytes(), 'audio/wav');
}

// ---------------------------------------------------------------------------
// ZIP fixture — built with archive-zip's own serializer (no committed binary).
// ---------------------------------------------------------------------------

/** A stored ZipEntry from a name + string content (serializeZip recomputes crc/sizes). */
export function zipEntry(name: string, content: string): ZipEntry {
  const bytes = ENCODER.encode(content);
  return {
    name,
    method: 0,
    crc32: 0,
    compressedSize: bytes.length,
    uncompressedSize: bytes.length,
    modified: new Date('2026-07-02T00:00:00Z'),
    isDirectory: false,
    localHeaderOffset: 0,
    data: async () => bytes,
    stream: () => new ReadableStream<Uint8Array>(),
  };
}

/** Serialize entries into a real ZIP and wrap as an application/zip Blob. */
export async function makeZipBlob(
  entries: ReadonlyArray<readonly [string, string]> = [['hello.txt', 'hello world']],
): Promise<Blob> {
  const bytes = await serializeZip({
    entries: entries.map(([name, content]) => zipEntry(name, content)),
    comment: '',
  });
  return bytesToBlob(bytes, 'application/zip');
}

// ---------------------------------------------------------------------------
// EML fixture — a minimal RFC 5322 text/plain message.
// ---------------------------------------------------------------------------

export const SAMPLE_EML = [
  'From: Alice <alice@example.com>',
  'To: Bob <bob@example.com>',
  'Subject: Integration test',
  'Date: Wed, 02 Jul 2026 10:00:00 +0000',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hello from the webcvt integration suite.',
  '',
].join('\r\n');

/** EML as a Blob typed message/rfc822. */
export function makeEmlBlob(): Blob {
  return new Blob([SAMPLE_EML], { type: 'message/rfc822' });
}

// ---------------------------------------------------------------------------
// Subtitle fixture — a two-cue SRT.
// ---------------------------------------------------------------------------

export const SAMPLE_SRT = [
  '1',
  '00:00:01,000 --> 00:00:02,000',
  'Hello world',
  '',
  '2',
  '00:00:03,000 --> 00:00:04,500',
  'Second line',
  '',
].join('\n');

/** SRT as a Blob typed application/x-subrip. */
export function makeSrtBlob(): Blob {
  return new Blob([SAMPLE_SRT], { type: 'application/x-subrip' });
}

// ---------------------------------------------------------------------------
// Font fixture — the one committed binary reused (a real sfnt).
// ---------------------------------------------------------------------------

/** Read the committed TrueType fixture as bytes. */
export function readTtfFixture(): Uint8Array {
  const url = new URL('../../../tests/fixtures/font/UbuntuMono-R.ttf', import.meta.url);
  return new Uint8Array(readFileSync(fileURLToPath(url)));
}

/** TTF as a Blob typed font/ttf. */
export function makeTtfBlob(): Blob {
  return bytesToBlob(readTtfFixture(), 'font/ttf');
}

// ---------------------------------------------------------------------------
// Registry wiring — a fresh registry with every Node-safe backend registered.
// ---------------------------------------------------------------------------

/** Build a fresh BackendRegistry holding all backends this suite exercises. */
export function makeRegistry(): BackendRegistry {
  const registry = new BackendRegistry();
  registry.register(new WavBackend());
  registry.register(new SubtitleBackend());
  registry.register(new DataTextBackend());
  registry.register(new ArchiveBackend());
  registry.register(new EmailBackend());
  registry.register(new FontBackend());
  return registry;
}

// ---------------------------------------------------------------------------
// Recording wrapper — a Backend that delegates to a real one while capturing
// the input Blob's resolved MIME (used to prove convert()'s MIME alignment).
// ---------------------------------------------------------------------------

export class RecordingBackend implements Backend {
  readonly name: string;
  /** MIME (Blob.type) seen by convert(), in call order. */
  readonly seenInputTypes: string[] = [];

  constructor(
    private readonly delegate: Backend,
    name?: string,
    readonly priority = delegate.priority,
  ) {
    this.name = name ?? `recording:${delegate.name}`;
  }

  canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    return this.delegate.canHandle(input, output);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    this.seenInputTypes.push(input.type);
    return this.delegate.convert(input, output, options);
  }
}

// ---------------------------------------------------------------------------
// Minimal fake backend — a canHandle/convert pair over an arbitrary pair, used
// by the priority tests where the *identity* of the winning backend matters
// more than any real conversion work.
// ---------------------------------------------------------------------------

/** A backend that claims a fixed (input→output) pair and stamps its name on output. */
export class StubBackend implements Backend {
  constructor(
    readonly name: string,
    private readonly inMime: string,
    private readonly outMime: string,
    readonly priority = 0,
  ) {}

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    return input.mime === this.inMime && output.mime === this.outMime;
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    _options: ConvertOptions,
  ): Promise<ConvertResult> {
    return {
      blob: new Blob([`handled by ${this.name}`], { type: output.mime }),
      format: output,
      durationMs: 0,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }
}
