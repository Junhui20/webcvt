/**
 * Hono application factory for the webcvt HTTP convert API.
 *
 * `createApiServer()` returns a framework-agnostic {@link Hono} instance that
 * runs unchanged on Node (via @hono/node-server), Bun, Deno, and Cloudflare
 * Workers. It is a *library*: consumers mount or serve the returned app — this
 * package never opens a socket itself.
 *
 * IMPORTANT: no backends are registered by default. The app converts using
 * whatever backends live in the provided `registry` (defaults to core's
 * process-wide `defaultRegistry`). Callers must register the backend packages
 * they want (e.g. `@catlabtech/webcvt-subtitle`) before serving traffic,
 * otherwise every conversion fails with HTTP 415 (no backend).
 */

import {
  type BackendRegistry,
  type FormatDescriptor,
  convert,
  defaultRegistry,
  detectFormatWithHint,
  findByMime,
  knownFormats,
} from '@catlabtech/webcvt-core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { DEFAULT_DOWNLOAD_BASENAME, MAX_INPUT_BYTES } from './constants.ts';
import {
  ApiBadRequestError,
  ApiInputTooLargeError,
  httpStatusForError,
  toApiErrorBody,
} from './errors.ts';

/** Options for {@link createApiServer}. */
export interface CreateApiServerOptions {
  /**
   * Backend registry the `/convert` endpoint searches for a matching backend.
   * Defaults to core's process-wide `defaultRegistry`. Pass a fresh
   * `new BackendRegistry()` to isolate which backends this server exposes.
   */
  readonly registry?: BackendRegistry;
  /**
   * Maximum accepted request-body size in bytes. Defaults to
   * {@link MAX_INPUT_BYTES} (256 MiB). Enforced while streaming the body.
   */
  readonly maxInputBytes?: number;
  /**
   * Mount prefix for the routes, e.g. `'/api'` exposes `/api/health`.
   * Defaults to the root (`''`).
   */
  readonly basePath?: string;
}

/** Normalized result of reading a `/convert` request, regardless of shape. */
interface ConvertRequest {
  readonly inputBytes: Uint8Array<ArrayBuffer>;
  readonly filename: string | undefined;
  readonly to: string;
  readonly contentType: string | undefined;
}

/**
 * Normalize an optional base path to either `''` (root) or `'/segment...'`
 * with a leading slash and no trailing slash.
 */
function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === '/') return '';
  const withLeading = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
}

/**
 * Read an entire request body into memory while enforcing a hard byte cap.
 *
 * A `Content-Length` over the limit is rejected immediately (fast path); the
 * streamed chunks are then counted so a missing or lying `Content-Length`
 * cannot smuggle an oversized payload past the cap.
 *
 * @throws {ApiInputTooLargeError} when the body exceeds `limit`.
 */
async function readBodyWithLimit(req: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = req.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > limit) {
      throw new ApiInputTooLargeError(n, limit);
    }
  }

  const body = req.body;
  if (!body) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new ApiInputTooLargeError(undefined, limit);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Strip parameters (e.g. `; charset=utf-8`) from a Content-Type header. */
function bareMime(contentType: string | undefined): string | undefined {
  if (!contentType) return undefined;
  const semi = contentType.indexOf(';');
  const mime = (semi >= 0 ? contentType.slice(0, semi) : contentType).trim();
  return mime.length > 0 ? mime : undefined;
}

/**
 * Parse a `/convert` request in either supported shape:
 *  1. `multipart/form-data` with `file` and `to` fields.
 *  2. Raw request body as the input + `?to=<ext>` query + `Content-Type` mime.
 *
 * The body cap is enforced for both shapes before any parsing happens.
 */
async function readConvertRequest(
  req: Request,
  query: URLSearchParams,
  limit: number,
): Promise<ConvertRequest> {
  const requestContentType = req.headers.get('content-type') ?? '';
  const bytes = await readBodyWithLimit(req, limit);

  if (requestContentType.toLowerCase().includes('multipart/form-data')) {
    // Re-parse the already-buffered bytes with the platform multipart parser.
    // Reconstructing a Response keeps this portable across every runtime that
    // implements the Fetch API (Node, Bun, Deno, Workers).
    const form = await new Response(bytes, {
      headers: { 'content-type': requestContentType },
    }).formData();

    const filePart = form.get('file');
    if (!(filePart instanceof Blob)) {
      throw new ApiBadRequestError('Missing "file" field in multipart/form-data body.');
    }
    const to = form.get('to');
    if (typeof to !== 'string' || to.length === 0) {
      throw new ApiBadRequestError('Missing "to" field (target format extension).');
    }

    const filename = filePart instanceof File ? filePart.name : undefined;
    return {
      inputBytes: new Uint8Array(await filePart.arrayBuffer()),
      filename,
      to,
      contentType: bareMime(filePart.type),
    };
  }

  // Raw-body shape.
  const to = query.get('to');
  if (!to) {
    throw new ApiBadRequestError('Missing "to" query parameter (target format extension).');
  }
  if (bytes.byteLength === 0) {
    throw new ApiBadRequestError('Missing request body (the input file).');
  }
  return {
    inputBytes: bytes,
    filename: undefined,
    to,
    contentType: bareMime(requestContentType),
  };
}

/**
 * Detect the input format: magic bytes first, then the filename hint, then the
 * declared content-type. Returns `undefined` when nothing matches.
 */
async function detectInputFormat(
  blob: Blob,
  filename: string | undefined,
  contentType: string | undefined,
): Promise<FormatDescriptor | undefined> {
  const byHint = await detectFormatWithHint(blob, filename);
  if (byHint) return byHint;
  if (contentType) return findByMime(contentType);
  return undefined;
}

/**
 * Build a safe download filename from the original name and the output ext.
 * The base is sanitized to `[A-Za-z0-9._-]` (a non-backtracking character
 * class) so it is safe to embed in a `Content-Disposition` header.
 */
function buildDownloadName(original: string | undefined, ext: string): string {
  let base = DEFAULT_DOWNLOAD_BASENAME;
  if (original) {
    const lastSlash = Math.max(original.lastIndexOf('/'), original.lastIndexOf('\\'));
    const name = lastSlash >= 0 ? original.slice(lastSlash + 1) : original;
    const dot = name.lastIndexOf('.');
    base = dot > 0 ? name.slice(0, dot) : name;
  }
  base = base.replace(/[^A-Za-z0-9._-]/g, '_');
  if (base.length === 0) base = DEFAULT_DOWNLOAD_BASENAME;
  return `${base}.${ext}`;
}

/**
 * Create the webcvt convert API as a Hono app.
 *
 * @example
 *   import { createApiServer } from '@catlabtech/webcvt-api-server';
 *   import { defaultRegistry } from '@catlabtech/webcvt-core';
 *   import '@catlabtech/webcvt-subtitle'; // registers backends into defaultRegistry
 *   const app = createApiServer();
 *   export default app; // Cloudflare Workers / Bun / Deno
 */
export function createApiServer(options: CreateApiServerOptions = {}): Hono {
  const registry = options.registry ?? defaultRegistry;
  const maxInputBytes = options.maxInputBytes ?? MAX_INPUT_BYTES;
  const prefix = normalizeBasePath(options.basePath);

  const app = new Hono();
  app.use('*', cors());

  app.get(`${prefix}/health`, (c) => c.json({ status: 'ok' as const }));

  app.get(`${prefix}/formats`, (c) =>
    c.json(
      knownFormats().map((f) => ({
        ext: f.ext,
        mime: f.mime,
        category: f.category,
        description: f.description,
      })),
    ),
  );

  app.post(`${prefix}/convert`, async (c) => {
    const { inputBytes, filename, to, contentType } = await readConvertRequest(
      c.req.raw,
      new URL(c.req.url).searchParams,
      maxInputBytes,
    );

    const blob = new Blob([inputBytes], contentType ? { type: contentType } : undefined);

    const inputFormat = await detectInputFormat(blob, filename, contentType);
    if (!inputFormat) {
      throw new ApiBadRequestError(
        'Could not detect the input format. Provide a recognizable file, a filename, or a Content-Type.',
      );
    }

    const result = await convert(blob, { format: to }, { registry });
    const outputFormat = result.format;
    const downloadName = buildDownloadName(filename, outputFormat.ext);
    const outBuffer = await result.blob.arrayBuffer();

    return c.body(outBuffer, 200, {
      'Content-Type': outputFormat.mime,
      'Content-Disposition': `attachment; filename="${downloadName}"`,
      'X-Webcvt-Backend': result.backend,
    });
  });

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `No route for ${c.req.method} ${c.req.path}.`,
        },
      },
      404,
    ),
  );

  app.onError((err, c) => c.json(toApiErrorBody(err), httpStatusForError(err)));

  return app;
}
