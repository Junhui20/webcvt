# @webcvt/core

> Public API, types, format detector, capability probe, and backend registry for webcvt.

## Status

Phase 1 scaffold. Do not use in production yet.

## What's here

- `convert(input, options)` — the public entry point
- `detectFormat(blob)` — magic-byte format detection
- `BackendRegistry` — pluggable backend selection
- Shared types: `FormatDescriptor`, `ConvertOptions`, `ConvertResult`, `Backend`, error classes
- `detectCapabilities()` — runtime browser capability probe

## Implementation references

This package is original work implemented from the WHATWG File API and W3C
WebCodecs specifications. Magic-byte signatures cross-checked against RFC 2083
(PNG), RFC 2046 (WebP via RIFF), and common open-source detection libraries
for the signatures themselves (bytes in a file are not copyrightable). No
code was copied — all implementation is MIT-licensed original work.

## LOC budget

Target ~1,600 LOC (see `plan.md` §5 Core).

| File | Est. | Actual |
|---|---|---|
| types.ts | 200 | TBD |
| formats.ts | 300 | TBD |
| detect.ts | 400 | TBD |
| registry.ts | 200 | TBD |
| convert.ts | 200 | TBD |
| capability.ts | 100 | TBD |
| worker-pool.ts | 200 | not yet |

## Testing

```bash
pnpm -C packages/core test
pnpm -C packages/core test:coverage
```

Coverage gate: 80%+ lines / functions / branches / statements.
