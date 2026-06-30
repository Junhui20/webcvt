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
- `video/` — 1-second `testsrc` clips (H.264/AAC + VP8/Vorbis) for the container demuxers
- `image/` — tiny 64×64 `testsrc` JPEG + PNG (real encoder output) for `doc-pdf` / `comic`
- `font/` — a real TrueType font for the `font` sfnt↔WOFF round-trip tests

## Why files are committed

CI does not install ffmpeg. By shipping the fixtures in git, every test
run sees identical reference bytes regardless of environment. These are the
only real-world inputs the suite uses — every other test builds synthetic
fixtures inline.

## Licensing

- `audio/`, `video/`, `image/` — derived works of `ffmpeg`'s `lavfi` synthetic
  generator (ffmpeg is LGPL-2.1). The clips embed no copyrighted material.
- `font/UbuntuMono-R.ttf` — **Ubuntu Mono**, © Canonical Ltd., licensed under the
  [Ubuntu Font Licence 1.0](https://ubuntu.com/legal/font-licence), which permits
  redistribution. Used here only as a test input.

All fixtures live under `tests/` and are excluded from the published npm
packages via `.npmignore`.
