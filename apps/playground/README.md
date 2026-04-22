# @catlabtech/webcvt-playground

Cloudflare Pages demo site for webcvt. Converts files locally in the browser — no uploads, no servers.

## Development

```bash
pnpm --filter @catlabtech/webcvt-playground dev
```

## Build

```bash
pnpm --filter @catlabtech/webcvt-playground build
```

Output is written to `apps/playground/dist/`.

## Typecheck

```bash
pnpm --filter @catlabtech/webcvt-playground typecheck
```

## E2E tests (Playwright, Chrome-only)

Install browsers once:

```bash
pnpm --filter @catlabtech/webcvt-playground exec playwright install chromium
```

Run tests against the preview server:

```bash
pnpm --filter @catlabtech/webcvt-playground build
pnpm --filter @catlabtech/webcvt-playground test:e2e
```

## Deploy to Cloudflare Pages

### One-time setup

```bash
npx wrangler login
pnpm --filter @catlabtech/webcvt-playground build
npx wrangler pages deploy apps/playground/dist --project-name=webcvt --branch=main
```

### Subsequent deploys

```bash
pnpm --filter @catlabtech/webcvt-playground build && \
  npx wrangler pages deploy apps/playground/dist --project-name=webcvt
```

## Notes

- COEP / COOP headers are enforced via `public/_headers` on Cloudflare Pages and via
  Vite's `server.headers` / `preview.headers` in local dev.
- The `test` script is a no-op so `pnpm -r test` (turbo) does not attempt to launch
  Playwright without a browser. Use `test:e2e` explicitly.
- Domain placeholder: `https://github.com/Junhui20/webcvt` — update when a real domain
  is assigned.
