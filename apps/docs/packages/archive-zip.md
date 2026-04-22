# @catlabtech/webcvt-archive-zip

> ZIP and TAR archive parsing and creation for webcvt. Pure TypeScript, no native addons.

## Installation

```bash
npm i @catlabtech/webcvt-archive-zip
```

## Supported formats

| Format | Parse | Create |
|---|---|---|
| ZIP (Deflate, Stored) | yes | yes |
| TAR (ustar) | yes | yes |
| TAR.GZ / TGZ | yes | yes |

BZ2 and XZ decompression are not supported (throws `ArchiveBz2NotSupportedError` / `ArchiveXzNotSupportedError`).

## API

Detailed API reference coming in v0.2. See the [source code](https://github.com/Junhui20/webcvt/tree/main/packages/archive-zip/src) for now.

## Size limits

| Limit | Value |
|---|---|
| Max archive input | 200 MiB |
| Max per-entry uncompressed | 256 MiB |
| Max total uncompressed | 512 MiB |

These limits protect against zip-bomb attacks.
