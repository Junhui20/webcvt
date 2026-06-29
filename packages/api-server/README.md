# @catlabtech/webcvt-api-server

An HTTP convert API for [webcvt](https://github.com/Junhui20/webcvt), built on [Hono](https://hono.dev) — so the same app runs on **Node, Bun, Deno, and Cloudflare Workers**.

It's a library that exports a Hono app factory; you mount/serve it and register the backends you want.

## Install

```bash
npm install @catlabtech/webcvt-core @catlabtech/webcvt-api-server hono
```

## Usage

```typescript
import { serve } from '@hono/node-server';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { CanvasBackend } from '@catlabtech/webcvt-image-canvas';
import { createApiServer } from '@catlabtech/webcvt-api-server';

defaultRegistry.register(new CanvasBackend()); // wire whatever backends you need
const app = createApiServer(); // uses defaultRegistry, 256 MiB cap

serve({ fetch: app.fetch, port: 8787 });
```

`createApiServer(options?)` — `options = { registry?, maxInputBytes?, basePath? }`.

## Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | `{ status: 'ok' }` |
| `GET` | `/formats` | Known formats (`ext`, `mime`, `category`, `description`) |
| `POST` | `/convert` | Convert a file — `multipart/form-data` with `file` + `to`, **or** a raw body with `?to=<ext>` and the input `Content-Type` |

```bash
curl -F file=@in.srt -F to=vtt http://localhost:8787/convert -o out.vtt
```

The response is the converted bytes with the output `Content-Type` and a `Content-Disposition` attachment header.

## Errors

A central mapping returns `{ error: { code, message } }` with the right status: **400** (missing `file`/`to`, undetectable input), **413** (input over `maxInputBytes` — enforced while streaming, so a lying `Content-Length` can't smuggle a large payload), **415** (no backend handles the pair), **500** (other).

> No backends are registered by default — every conversion returns 415 until you register backends into the registry you pass (or `defaultRegistry`).

## License

MIT
