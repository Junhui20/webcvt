# Contributing to webcvt

Welcome. This document covers how to build on webcvt — whether you're the
original author resuming in a new session, an AI agent continuing the work,
or an external contributor.

## TL;DR

1. Every package follows the same TDD + review pipeline (below).
2. 80%+ test coverage is a hard CI gate.
3. Every phase has a checklist in [`plan.md`](./plan.md) §6. Tick boxes as you go.
4. No third-party dep lands without matching the gatekeeping rule in [`plan.md`](./plan.md) §5.
5. Containers (MP4, MKV, etc.) must have a design note in `docs/design-notes/`
   **before** any code is written — see §11 clean-room policy.

## Repository layout

```
webcvt/
├── packages/          # publishable npm packages (scoped @webcvt/*)
│   ├── core/          # ✅ Phase 1 complete
│   ├── codec-webcodecs/ # ✅ Phase 1 complete
│   ├── image-canvas/  # ✅ Phase 1 complete
│   └── subtitle/      # ✅ Phase 1 complete
├── apps/              # demo/docs sites (Phase 5)
├── examples/          # consumer examples (Phase 5)
├── docs/
│   ├── design-notes/  # clean-room design docs BEFORE code
│   └── specs/         # links to official format specs
└── plan.md            # source of truth for scope, timeline, roadmap
```

## Per-package TDD + review pipeline

Every new package MUST walk through this pipeline:

```
1. architect agent      → design types + interface + /docs/design-notes/<pkg>.md
2. tdd-guide agent      → write failing tests (RED)
3. typescript-pro agent → implement until tests pass (GREEN)
4. code-reviewer agent  → review for quality, API design, naming
5. security-reviewer    → input parsing, buffer bounds, DoS protection
6. build-error-resolver → fix build/type errors with minimal diffs
7. CI green ✅          → merge
```

### When using Claude agents

Invoke via the `Agent` tool with `subagent_type`:

```
architect          — design, no code
tdd-guide          — test-first enforcement
typescript-pro     — implementation
code-reviewer      — post-code quality review
security-reviewer  — after input-parsing code
build-error-resolver — minimal fixes for type errors
```

The typescript-pro agent handled core, codec-webcodecs, image-canvas, and
subtitle successfully in Phase 1. Expect each package to take one focused
agent run plus 1–2 review passes.

## Writing a new package (template)

1. **Create directory** `packages/<name>/` with:
   - `package.json` — name `@webcvt/<name>`, workspace dep `"@webcvt/core": "workspace:*"`
   - `tsconfig.json` — extend `../../tsconfig.base.json`
   - `tsup.config.ts` — **IMPORTANT:** include the `dts.compilerOptions` fix:
     ```ts
     dts: {
       resolve: true,
       compilerOptions: {
         allowImportingTsExtensions: true,
         declaration: true,
         declarationMap: true,
         emitDeclarationOnly: true,
         noEmit: false,
       },
     }
     ```
     This is required under `verbatimModuleSyntax` + `.ts` extension imports.
   - `vitest.config.ts` — 80% coverage thresholds
   - `README.md` — include the "Implementation references" template from [plan.md §11.5](./plan.md)

2. **Write design note** at `docs/design-notes/<name>.md` BEFORE code. This
   matters most for container packages (MP4, MKV, etc.) where clean-room
   separation from Mediabunny's MPL-2.0 code is legally critical.

3. **Write tests first**, covering:
   - Happy path (round-trip where applicable)
   - Edge cases (empty input, malformed, oversized)
   - Error paths (clear messages, typed errors from `@webcvt/core`)

4. **Implement** until tests pass + coverage ≥80%.

5. **Register with core** if this is a Backend:
   ```ts
   import { defaultRegistry } from '@webcvt/core';
   import { MyBackend } from './my-backend.ts';
   defaultRegistry.register(new MyBackend());
   ```
   Keep the side-effect registration in a separate `register.ts` so the main
   export stays tree-shakable.

6. **Run `pnpm -C packages/<name> build && pnpm -C packages/<name> test`** locally.

7. **Open PR**, let CI run, address review.

## Phase progress

See [`plan.md` §6 Roadmap](./plan.md) for the canonical checklist. Summary:

- [x] **Phase 1 — Foundation (Weeks 1–2)**
- [ ] Phase 2 — Audio containers (Weeks 3–5)
- [ ] Phase 3 — MP4/WebM/MKV/TS (Weeks 6–16) **hardest**
- [ ] Phase 4 — Images + archive + data-text (Weeks 17–19)
- [ ] Phase 5 — Launch prep, v0.1.0 (Week 20)
- [ ] Phase 6 — Modern image codecs (Weeks 21–22)
- [ ] Phase 7 — Font + EPUB + EML (Weeks 23–25)
- [ ] Phase 8 — PDF + ebooks + binary data (Months 7–8)
- [ ] Phase 9 — API server + Tier 3 (Months 9+)

## Quality gates

Enforced by CI. Cannot be bypassed without explicit justification in PR.

| Gate | Target | Where enforced |
|---|---|---|
| Lint | biome clean | `.github/workflows/ci.yml` |
| Typecheck | `tsc --noEmit` clean | CI |
| Unit tests | 100% pass | CI |
| Coverage | ≥80% lines/branches/functions/statements | vitest.config per package |
| Build | ESM + CJS + .d.ts emitted | CI |
| No `any` | zero `any` in public API | biome `noExplicitAny: error` |
| File size | <800 LOC per file | manual + review |

## Reference policy

See [`plan.md` §11](./plan.md) for the full clean-room policy. Key points:

- **Mediabunny (MPL-2.0)** — read architecture, write design notes, never copy code.
- **MIT/Apache/BSD libs** — may copy patterns with attribution, but we prefer spec-driven re-implementation.
- **Test fixtures** from FFmpeg (LGPL) are stored in `tests/fixtures/` and
  excluded from the published npm package via `.npmignore`.
- Every package README must include the "Implementation references" paragraph.

## Resuming work in a new session

For AI agents: the state of the repo IS the progress. Check:
1. Which packages exist under `packages/`
2. Which phase in `plan.md` §6 has unchecked boxes
3. What the CI status is

Then follow the per-package pipeline above. The agent flow is documented in
the PR template and in each package's README.

## Community

- Issues: https://github.com/bryanchng/webcvt/issues
- Discussions: (enable once repo is public)
- Security: see `SECURITY.md` (TODO)

## License

By contributing you agree your contributions are licensed MIT.
