# webcvt

> Browser-first, hardware-accelerated file conversion library. Convert anything in the browser, no upload required.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![Status](https://img.shields.io/badge/status-pre--alpha-red)

## Status

🚧 **Pre-alpha** — under active construction. Not ready for use.

See [`plan.md`](./plan.md) for the full project plan and
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for how to contribute or resume work.

## What is it

A modular TypeScript library that converts files **in the browser**, using
WebCodecs for hardware acceleration and `ffmpeg.wasm` only as a legacy
fallback. Same code runs in Node.js and Cloudflare Workers.

Target: match Transmute.sh's 200+ formats and 2,000+ conversion pairs, but
as a tree-shakable browser library instead of a Docker server.

## Competitive positioning

| | ffmpeg.wasm | Transmute | Mediabunny | **webcvt** |
|---|---|---|---|---|
| Mode | browser | server (Docker) | browser | **browser-first** |
| Bundle | 30 MB | N/A | ~50 KB | **5–500 KB (modular)** |
| HW accel | ❌ | ✅ native | ✅ | **✅** |
| TS-native | ⚠️ | ❌ | ✅ | **✅** |
| Modular | ❌ | ❌ | ⚠️ | **✅** |
| Scope | AV only | 200+ formats | AV only | **200+ formats** |

## Packages

Live list grows as Phases complete. See [plan.md §3](./plan.md) for the full roadmap.

### Currently implemented (Phase 1)

- `@webcvt/core` — public API, types, format detector, capability probe
- `@webcvt/codec-webcodecs` — hardware-accelerated encode/decode adapter
- `@webcvt/image-canvas` — PNG/JPG/WebP/BMP/ICO via Canvas API
- `@webcvt/subtitle` — SRT/VTT/ASS/SSA/SUB/MPL

### Planned

See [plan.md §6 Roadmap](./plan.md) — 9 Phases over ~9 months.

## Quickstart (once v0.1 is published)

```typescript
import { convert } from 'webcvt';

const output = await convert(file, { format: 'webp' });
```

## Development

```bash
pnpm install
pnpm build        # build all packages
pnpm test         # run all tests
pnpm typecheck
pnpm lint
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Every package follows the same
TDD + code-review + security-review pipeline.

## License

MIT © 2026 webcvt contributors.
