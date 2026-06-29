import {
  type Backend,
  BackendRegistry,
  type ConvertOptions,
  type ConvertResult,
  type FormatDescriptor,
  WebcvtError,
} from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import { createApiServer } from './server.ts';

/** Deterministic output the fake backend emits, so tests can byte-compare. */
const FAKE_OUTPUT = new Uint8Array([0xca, 0x7c, 0xa7, 0x10, 0x42]);

/** A tiny deterministic backend: only handles bmp -> png. */
class FakeBackend implements Backend {
  readonly name = 'fake-test-backend';
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    return input.ext === 'bmp' && output.ext === 'png';
  }
  async convert(
    _input: Blob,
    output: FormatDescriptor,
    _options: ConvertOptions,
  ): Promise<ConvertResult> {
    return {
      blob: new Blob([FAKE_OUTPUT], { type: output.mime }),
      format: output,
      durationMs: 0,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }
}

/** Backend that accepts anything but throws — used to exercise 500 mapping. */
class ThrowingBackend implements Backend {
  constructor(
    readonly name: string,
    private readonly error: unknown,
  ) {}
  async canHandle(): Promise<boolean> {
    return true;
  }
  async convert(): Promise<ConvertResult> {
    throw this.error;
  }
}

/** Bytes whose magic identifies them as a BMP image ("BM"). */
function bmpBytes(): Uint8Array {
  return new Uint8Array([0x42, 0x4d, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

function makeApp(backend: Backend = new FakeBackend(), maxInputBytes?: number) {
  const registry = new BackendRegistry();
  registry.register(backend);
  return createApiServer({ registry, maxInputBytes });
}

function bmpFormData(to: string, filename = 'test.bmp'): FormData {
  const fd = new FormData();
  fd.append('file', new Blob([bmpBytes()], { type: 'image/bmp' }), filename);
  fd.append('to', to);
  return fd;
}

function toBytes(buf: ArrayBuffer): number[] {
  return Array.from(new Uint8Array(buf));
}

describe('GET /health', () => {
  it('returns 200 with an ok status and a permissive CORS header', async () => {
    const res = await makeApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('GET /formats', () => {
  it('returns an array of known formats with ext/mime/category', async () => {
    const res = await makeApp().request('/formats');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ ext: string; mime: string; category: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    const png = body.find((f) => f.ext === 'png');
    expect(png).toMatchObject({ ext: 'png', mime: 'image/png', category: 'image' });
  });
});

describe('POST /convert (multipart)', () => {
  it('converts bmp -> png and returns the bytes with the right headers', async () => {
    const res = await makeApp().request('/convert', { method: 'POST', body: bmpFormData('png') });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="test.png"');
    expect(res.headers.get('x-webcvt-backend')).toBe('fake-test-backend');
    expect(toBytes(await res.arrayBuffer())).toEqual(Array.from(FAKE_OUTPUT));
  });

  it('derives the download name from a filename without an extension', async () => {
    const res = await makeApp().request('/convert', {
      method: 'POST',
      body: bmpFormData('png', 'noext'),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="noext.png"');
  });

  it('returns 400 when the file field is missing', async () => {
    const fd = new FormData();
    fd.append('to', 'png');
    const res = await makeApp().request('/convert', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  it('returns 400 when the to field is missing', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([bmpBytes()], { type: 'image/bmp' }), 'test.bmp');
    const res = await makeApp().request('/convert', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  it('returns 415 when no backend handles the pair', async () => {
    const res = await makeApp().request('/convert', { method: 'POST', body: bmpFormData('gif') });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: { code: 'NO_BACKEND' } });
  });

  it('returns 415 when the target format is unknown', async () => {
    const res = await makeApp().request('/convert', { method: 'POST', body: bmpFormData('zzz') });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: { code: 'UNSUPPORTED_FORMAT' } });
  });
});

describe('POST /convert (raw body)', () => {
  it('converts a raw body with ?to= and Content-Type', async () => {
    const res = await makeApp().request('/convert?to=png', {
      method: 'POST',
      body: bmpBytes(),
      headers: { 'content-type': 'image/bmp' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="output.png"');
    expect(toBytes(await res.arrayBuffer())).toEqual(Array.from(FAKE_OUTPUT));
  });

  it('returns 400 when ?to= is missing', async () => {
    const res = await makeApp().request('/convert', {
      method: 'POST',
      body: bmpBytes(),
      headers: { 'content-type': 'image/bmp' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  it('returns 400 when the raw body is empty', async () => {
    const res = await makeApp().request('/convert?to=png', {
      method: 'POST',
      body: new Uint8Array(0),
      headers: { 'content-type': 'image/bmp' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  it('returns 400 when the input format cannot be detected', async () => {
    const res = await makeApp().request('/convert?to=png', {
      method: 'POST',
      body: new Uint8Array([0x00, 0x11, 0x22, 0x33]),
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  it('falls back to the Content-Type when magic detection fails (then core rejects)', async () => {
    // Non-magic bytes, but a known image/png Content-Type lets the server pass
    // its own detection; core then re-detects from bytes and reports 415.
    const res = await makeApp().request('/convert?to=png', {
      method: 'POST',
      body: new Uint8Array([0x00, 0x11, 0x22, 0x33]),
      headers: { 'content-type': 'image/png' },
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: { code: 'UNSUPPORTED_FORMAT' } });
  });

  it('returns 400 when there is no usable Content-Type and no magic match', async () => {
    // A parameter-only Content-Type carries no mime, so detection has nothing
    // to fall back to and the request is rejected as undetectable.
    const res = await makeApp().request('/convert?to=png', {
      method: 'POST',
      body: new Uint8Array([0x00, 0x11, 0x22, 0x33]),
      headers: { 'content-type': ';charset=utf-8' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });
});

describe('POST /convert (input size cap)', () => {
  it('returns 413 when Content-Length exceeds the cap (fast path)', async () => {
    const res = await makeApp(new FakeBackend(), 8).request('/convert?to=png', {
      method: 'POST',
      body: new Uint8Array(64),
      headers: { 'content-type': 'image/bmp' },
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: 'INPUT_TOO_LARGE' } });
  });

  it('returns 413 when a streamed body (no Content-Length) exceeds the cap', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64));
        controller.close();
      },
    });
    const init = {
      method: 'POST',
      body: stream,
      headers: { 'content-type': 'application/octet-stream' },
      duplex: 'half',
    } as RequestInit & { duplex: 'half' };
    const res = await makeApp(new FakeBackend(), 8).request('/convert?to=png', init);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: 'INPUT_TOO_LARGE' } });
  });
});

describe('error mapping for backend failures', () => {
  it('maps a thrown WebcvtError to 500 with its code', async () => {
    const backend = new ThrowingBackend('webcvt-thrower', new WebcvtError('BOOM', 'kaboom'));
    const res = await makeApp(backend).request('/convert', {
      method: 'POST',
      body: bmpFormData('png'),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: 'BOOM', message: 'kaboom' } });
  });

  it('maps an unexpected Error to 500 with INTERNAL', async () => {
    const backend = new ThrowingBackend('plain-thrower', new Error('plain boom'));
    const res = await makeApp(backend).request('/convert', {
      method: 'POST',
      body: bmpFormData('png'),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: 'INTERNAL', message: 'plain boom' } });
  });
});

describe('routing', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await makeApp().request('/does-not-exist');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('honors a custom basePath', async () => {
    const registry = new BackendRegistry();
    registry.register(new FakeBackend());
    const app = createApiServer({ registry, basePath: '/api' });

    const ok = await app.request('/api/health');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: 'ok' });

    const missing = await app.request('/health');
    expect(missing.status).toBe(404);
  });

  it('mounts at the root when basePath is "/"', async () => {
    const registry = new BackendRegistry();
    registry.register(new FakeBackend());
    const app = createApiServer({ registry, basePath: '/' });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });
});
