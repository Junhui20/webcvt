# vanilla-html

Minimal browser example — convert SRT subtitles to WebVTT directly in the
browser. **One HTML file, ~15 lines of JavaScript, no build tool, no bundler,
no `npm install`.**

## What this demonstrates

- Load `@webcvt/subtitle` straight from the [esm.sh](https://esm.sh) CDN via
  `<script type="module">` — no Vite, no webpack, no local node_modules.
- Parse an `.srt` file selected by the user, convert it to WebVTT, and
  trigger a download — all client-side.
- The entire conversion is three function calls: `parseSrt`, `serializeVtt`,
  and a `Blob` download.

## Usage

> **Important:** This page requires `@webcvt/subtitle` to be published on npm
> (v0.1.0 release pending). The esm.sh CDN import will 404 until the package
> is live. For local testing today, use [`apps/playground`](../../apps/playground)
> which runs against the workspace-linked packages.

Once v0.1.0 is published, open `index.html` in any modern browser — no server
needed:

```bash
# macOS / Linux
open examples/vanilla-html/index.html

# Windows
start examples/vanilla-html/index.html
```

Or serve it over HTTP to avoid any browser file:// restrictions:

```bash
npx serve examples/vanilla-html
# → http://localhost:3000
```

## The code

```js
import { parseSrt, serializeVtt } from 'https://esm.sh/@webcvt/subtitle@0.1.0';

const srt = await selectedFile.text();
const track = parseSrt(srt);
const vtt = serializeVtt(track);
```

That's it. The esm.sh CDN re-exports any published npm package as an ES
module, so this pattern works for every `@webcvt/*` package with zero
local setup.

## How esm.sh CDN imports work

[esm.sh](https://esm.sh) converts npm packages to browser-native ES modules
on the fly. The URL pattern is:

```
https://esm.sh/<package>@<version>
https://esm.sh/<package>@<version>/<subpath>
```

Any package published to npm is instantly available. Pin to an exact version
(`@0.1.0`) for reproducibility in production.

## Supported formats

`@webcvt/subtitle` handles: **SRT, WebVTT, ASS, SSA, MicroDVD** — any pair.
Swap the parse/serialize functions to convert between any two:

```js
// SRT → ASS
import { parseSrt, serializeAss } from 'https://esm.sh/@webcvt/subtitle@0.1.0';
const ass = serializeAss(parseSrt(srt));
```

## Related

- [`examples/node-subtitle`](../node-subtitle) — same API, Node.js version
- [`apps/playground`](../../apps/playground) — full drag-and-drop demo with
  workspace-linked packages (works today without npm publish)
