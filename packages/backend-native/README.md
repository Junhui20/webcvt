# @catlabtech/webcvt-backend-native

> **Node-only.** This package imports `node:child_process`/`node:fs`/`node:os` and is **not** browser-safe.

The server-side escape hatch for [webcvt](https://github.com/Junhui20/webcvt): a `Backend` that converts files webcvt can't handle in-browser (Office, markup documents, PDF/A) by **spawning native CLI tools** — `ffmpeg`, `pandoc`, `libreoffice`, `ghostscript` — when they're installed on the host.

It does **not** reimplement those tools; it routes a conversion to the right binary, runs it safely, and returns the result.

## Install

```bash
npm install @catlabtech/webcvt-core @catlabtech/webcvt-backend-native
```

## Usage

```typescript
import { convert, defaultRegistry } from '@catlabtech/webcvt-core';
import { registerNativeBackend } from '@catlabtech/webcvt-backend-native';

registerNativeBackend(defaultRegistry); // opt-in; never auto-registers
const pdf = await convert(docxBlob, { format: 'pdf' }); // → libreoffice --headless --convert-to pdf
```

`canHandle` returns `true` only when both (a) the input→output pair is in the routing table **and** (b) the required tool is found on `PATH`. Tool locations can be overridden with `WEBCVT_FFMPEG` / `WEBCVT_PANDOC` / `WEBCVT_LIBREOFFICE` / `WEBCVT_GHOSTSCRIPT`.

## Routing table (representative)

| Tool | Conversions |
|---|---|
| **pandoc** | `md`→`html`/`docx`, `rst`→`html`, `html`→`md`, `docx`→`md`, `latex`→`pdf` |
| **libreoffice** | `docx`/`odt`/`xlsx`/`pptx` → `pdf`, `docx`→`odt` |
| **ghostscript** | `pdf`→`pdf` (re-distill), `pdf`→`pdf/A` |
| **ffmpeg** | `avi`/`flv` → `mp4` |

The table (`ROUTE_TABLE`) is extensible — each entry supplies a `buildArgs(inPath, outPath, opts)` that returns the argv array.

## Security

- **No shell, ever.** Conversions run via `spawn(binPath, argvArray)` — `shell: true` is never passed and no command string is constructed, so there is nothing to inject into. Argv comes only from the routing table; the only path-like values are our own `crypto.randomUUID()`-prefixed temp paths under `os.tmpdir()`, with extensions sanitised to `[a-z0-9]`.
- **Always cleans up.** A `finally` removes every temp file on success, non-zero exit, spawn error, and timeout.
- **Bounded.** 1 GiB input cap, a kill-on-timeout (SIGKILL), and a capped stderr capture.

## License

MIT
