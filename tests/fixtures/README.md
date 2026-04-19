# Test fixtures

Reference files used for byte-exact and round-trip testing of webcvt's
container packages.

## Regenerate

```bash
pnpm fixtures
```

This calls `scripts/generate-fixtures.mjs`, which uses the pinned
`ffmpeg-static` binary to produce all files under this directory. Commit
the result.

## Layout

- `audio/` — short sine-wave samples in various audio containers
- `video/` — (not yet — Phase 3)
- `image/` — (not yet — already covered by synthetic tests)

## Why files are committed

CI does not install ffmpeg. By shipping the fixtures in git, every test
run sees identical reference bytes regardless of environment.

## Licensing

These files are derived works of `ffmpeg`'s `lavfi` synthetic generator.
ffmpeg is LGPL-2.1; the resulting tiny audio files (1-second sine waves)
do not embed any copyrighted material. They are kept under `tests/` and
excluded from the published npm package via `.npmignore`.
