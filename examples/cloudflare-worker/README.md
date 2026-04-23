# webcvt — Cloudflare Worker example

A single-handler Cloudflare Worker that converts `.srt` subtitles to WebVTT on the edge using [`@catlabtech/webcvt-subtitle`](https://www.npmjs.com/package/@catlabtech/webcvt-subtitle).

```ts
import { parseSrt, serializeVtt } from '@catlabtech/webcvt-subtitle';

export default {
  async fetch(request) {
    const srt = await request.text();
    const vtt = serializeVtt(parseSrt(srt));
    return new Response(vtt, { headers: { 'content-type': 'text/vtt' } });
  },
};
```

That's the whole product — the rest of the file is request validation and CORS-friendly error responses.

## Run locally

From the monorepo root:

```bash
pnpm install
pnpm --filter @catlabtech/webcvt-example-cloudflare-worker dev
```

`wrangler dev` will print a local URL (usually `http://localhost:8787`).

Test it with `curl`:

```bash
# GET shows help
curl http://localhost:8787

# POST converts SRT → VTT
curl -X POST --data-binary @../node-subtitle/sample.srt \
  -H 'content-type: text/plain' \
  http://localhost:8787 > out.vtt

cat out.vtt
```

Response headers include `x-webcvt-cues: <N>` so callers can sanity-check parse count without reading the body.

## Deploy to Cloudflare

```bash
wrangler login                                                    # one-time
pnpm --filter @catlabtech/webcvt-example-cloudflare-worker deploy
```

Wrangler will print your live `*.workers.dev` URL.

## Why this matters

- **Zero cold-start cost** for the subtitle path — `webcvt-subtitle` is pure TypeScript with no wasm, so it loads in <1 ms on a Worker isolate.
- **No `node:` imports** required (the `nodejs_compat` flag in `wrangler.toml` is on as belt-and-braces, but isn't actually needed by `webcvt-subtitle`).
- **Small bundle** — Wrangler reports ~10 KB for the whole Worker, well under the 1 MiB free-tier limit.

For binary formats (MP4 → WebM etc.) you'd switch to `@catlabtech/webcvt-backend-wasm`, which is ~30 MB lazy-loaded and only suitable for paid Workers with longer CPU budgets — those examples live in [`apps/playground`](../../apps/playground).

## Limits

| Setting | Value | Why |
|---|---|---|
| Max body size | 1 MiB | Subtitle files are small; rejects abuse |
| Allowed methods | `GET`, `POST` | `GET` returns help; everything else 405 |
| Response type | `text/vtt` | Standard WebVTT MIME |

## Files

- `src/index.ts` — single fetch handler, ~70 LOC
- `wrangler.toml` — `compatibility_date: 2025-01-01`
