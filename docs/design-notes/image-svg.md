# image-svg design

> Implementation reference for `@webcvt/image-svg`. Write the code from
> this note plus the linked official specs. Do not consult competing
> implementations (svgo, fabric, d3, canvg, sharp) except for debugging
> spec-ambiguous edge cases.

## Format overview

SVG (Scalable Vector Graphics) is an XML-based 2D vector image format.
A native SVG document is a UTF-8 text file whose root element is
`<svg>` in the namespace `http://www.w3.org/2000/svg`. Geometry,
sizing, and viewport are described by attributes on the root element
(`viewBox`, `width`, `height`, `preserveAspectRatio`) plus a tree of
shape / path / text / image / use children. Because SVG is text, our
"demuxer" is just an XML parse, and our "muxer" is a string write —
the structural complexity lives entirely in the security validation
layer and the optional Canvas-based rasterizer.

## Scope statement

**First-pass (this package):** detect, validate, parse root-element
metadata (viewBox / width / height / xmlns), pass-through
serialization (output the source XML unchanged), and optional
rasterization to PNG / JPEG / WebP via the browser Canvas API.

**Out of scope (Phase 4.5+):** SVG editing or DOM manipulation,
embedded `@font-face` resolution, filter / animation / SMIL evaluation,
SVGZ (gzip-wrapped — compose with `@webcvt/archive-zip`),
rasterization of arbitrary user CSS, and svgo-style normalization.

## Official references

- W3C SVG 2 Recommendation (Candidate): https://www.w3.org/TR/SVG2/
- W3C SVG 1.1 (Second Edition): https://www.w3.org/TR/SVG11/
- W3C HTML Living Standard, `<img>` element + `Image` constructor: https://html.spec.whatwg.org/multipage/embedded-content.html#the-img-element
- W3C HTML Canvas 2D Context, `drawImage`: https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-drawimage
- HTML `OffscreenCanvas` and `convertToBlob` / `toBlob`: https://html.spec.whatwg.org/multipage/canvas.html#offscreencanvas
- W3C DOM Parsing and Serialization, `DOMParser`: https://w3c.github.io/DOM-Parsing/#the-domparser-interface
- XML 1.0 (Fifth Edition), entity declarations: https://www.w3.org/TR/xml/#sec-entity-decl
- Web App Sec, content security context for SVG-as-image: https://www.w3.org/TR/SVG2/conform.html#secure-static-mode

## SVG primer

Every conforming SVG document is an XML document whose root is
`<svg>` and whose default namespace is the SVG namespace. The two
sizing inputs are:

- **`viewBox="min-x min-y width height"`** — defines the user
  coordinate system that child geometry is drawn in. Four
  whitespace- or comma-separated numbers.
- **`width` / `height`** attributes (or CSS-style values) — define
  the rendered size of the image when used as a top-level resource.
  May be absent, in which case the user agent uses `viewBox`
  dimensions (or 300×150 fallback per HTML spec for `<img>` with no
  intrinsic size).

The sizing model when SVG is embedded as `<img>` (which is how we
rasterize) follows HTML's "intrinsic dimensions" algorithm: if both
`width` and `height` are present and unitless or in pixels, those
are intrinsic; otherwise the renderer picks a default. We treat the
viewBox as the authoritative intrinsic geometry and the width /
height as optional intrinsic raster dimensions.

## Required structures

```ts
interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

interface SvgFile {
  /** Original XML source, UTF-8. Never mutated. */
  source: string;
  /** Parsed viewBox if present and well-formed. */
  viewBox?: ViewBox;
  /** Pixel width attribute on root <svg>, if present and unitless / px. */
  width?: number;
  /** Pixel height attribute on root <svg>, if present and unitless / px. */
  height?: number;
  /** Always 'http://www.w3.org/2000/svg' if validation passed. */
  xmlns: string;
}

export function detectSvg(input: Uint8Array | string): boolean;
export function parseSvg(input: Uint8Array | string): SvgFile;
export function serializeSvg(file: SvgFile): string;

export interface RasterizeOptions {
  width?: number;            // output pixel width, defaults to intrinsic
  height?: number;           // output pixel height, defaults to intrinsic
  format: 'image/png' | 'image/jpeg' | 'image/webp';
  quality?: number;          // 0..1 for jpeg/webp
  background?: string;       // CSS color, default 'transparent' (PNG/WebP) / '#fff' (JPEG)
}

export function rasterizeSvg(
  file: SvgFile,
  opts: RasterizeOptions,
): Promise<Blob>;
```

## Demuxer (read) algorithm

1. Coerce input to a UTF-8 string (TextDecoder in 'fatal' mode for
   `Uint8Array`). Reject if length > `MAX_SVG_INPUT_BYTES` (10 MiB).
2. Run the **string-based reject pass** (see Security caps): scan
   for `<!ENTITY`, `<!DOCTYPE`, `<script` (case-insensitive),
   `<foreignObject` (case-insensitive), and any `href=` /
   `xlink:href=` attribute whose value does not start with `#`.
   Reject the whole document on first hit.
3. Detect: scan the first 1 KiB for the substring `<svg` preceded
   only by whitespace, an XML declaration (`<?xml ... ?>`), or
   XML / HTML comments (`<!-- ... -->`). Reject otherwise.
4. Parse via `new DOMParser().parseFromString(source, 'image/svg+xml')`.
   If the resulting document has a `<parsererror>` element anywhere,
   throw `SvgParseError`.
5. Confirm `documentElement.localName === 'svg'` and
   `documentElement.namespaceURI === 'http://www.w3.org/2000/svg'`.
6. Extract attributes from the root element:
   - `viewBox`: split on `[\s,]+`, require 4 numeric tokens, parse
     each with `Number(...)` and reject `NaN` / non-finite.
   - `width` / `height`: accept bare numbers, integer + `px`, or
     decimal + `px`. Reject `%`, `em`, `rem`, `vw`, `vh` (unsuited
     for raster intrinsic size). Missing attribute = `undefined`.
7. Return `{ source, viewBox, width, height, xmlns }`.

## Rasterization algorithm

`rasterizeSvg` runs entirely in the browser via the standard
`<img>` → `<canvas>` → `Blob` pipeline, which is the only portable
SVG raster path on the web platform.

1. Resolve output dimensions:
   - `width = opts.width ?? file.width ?? file.viewBox?.width ?? 300`
   - `height = opts.height ?? file.height ?? file.viewBox?.height ?? 150`
   - Reject if either > `MAX_RASTERIZE_WIDTH` /
     `MAX_RASTERIZE_HEIGHT` (8192) or ≤ 0 or non-finite.
2. Wrap the (already-validated) source in a Blob with type
   `image/svg+xml;charset=utf-8` and create a one-shot URL via
   `URL.createObjectURL(blob)`.
3. Construct `const img = new Image()`. Set `img.decoding = 'sync'`
   (best-effort) and `img.src = objectUrl`. Race `img.decode()`
   against an `AbortController`-driven timeout of
   `MAX_SVG_PARSE_TIME_MS` (5000). On timeout or `decode()`
   rejection, throw `SvgRasterizeError`. Always
   `URL.revokeObjectURL(objectUrl)` in a `finally`.
4. Allocate `const canvas = new OffscreenCanvas(width, height)`.
   Get `ctx = canvas.getContext('2d', { alpha: format !== 'image/jpeg' })`.
   If `format === 'image/jpeg'`, fill with `opts.background ?? '#fff'`
   (JPEG has no alpha). Otherwise, if `opts.background` is set,
   fill with it.
5. `ctx.drawImage(img, 0, 0, width, height)`. This invokes the SVG
   secure static mode renderer in the user agent — no scripts, no
   network (since we already rejected external `href`s).
6. `return await canvas.convertToBlob({ type: opts.format, quality: opts.quality })`.

When `OffscreenCanvas` is unavailable (very old browsers), fall
back to a detached `HTMLCanvasElement` with `toBlob()`. Feature-
detect at module load.

## Browser integration

| Capability | API | Spec link |
|---|---|---|
| XML parsing | `DOMParser` | https://w3c.github.io/DOM-Parsing/ |
| Image decode | `Image` / `HTMLImageElement.decode()` | https://html.spec.whatwg.org/multipage/embedded-content.html#dom-img-decode |
| Off-thread canvas | `OffscreenCanvas` + `convertToBlob` | https://html.spec.whatwg.org/multipage/canvas.html#offscreencanvas |
| Main-thread fallback | `HTMLCanvasElement.toBlob` | https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-toblob |
| Blob URL | `URL.createObjectURL` / `revokeObjectURL` | https://w3c.github.io/FileAPI/#creating-revoking |
| Timeout | `AbortController` | https://dom.spec.whatwg.org/#aborting-ongoing-activities |

The encoder side (PNG / JPEG / WebP byte production) is delegated
to `@webcvt/image-canvas`'s codec layer when callers want raw
encoded bytes plus metadata; the simple `rasterizeSvg` returns a
`Blob` so it remains independent and self-contained.

## Test plan

- `detects svg by root element with xml declaration prefix`
- `detects svg by root element with utf-8 BOM`
- `parses viewBox with comma separators`
- `parses viewBox with whitespace separators`
- `parses width and height in px and as bare numbers`
- `rejects width / height with em / % / vw units`
- `rejects document containing <!ENTITY xxe SYSTEM ...>`
- `rejects document containing <!DOCTYPE svg [...]> internal subset`
- `rejects document containing <script> tag (case-insensitive)`
- `rejects document containing <foreignObject>`
- `rejects external href on <image> / <use> (http, https, data, file)`
- `accepts intra-document fragment href starting with #`
- `rejects document over 10 MiB`
- `rejects rasterize request over 8192×8192`
- `round-trips: parseSvg → serializeSvg returns byte-identical source`
- `rasterizes 100×100 fixture to PNG and verifies header magic 0x89 0x50 0x4E 0x47`
- `rasterizes to JPEG with white background fill (no alpha)`
- `rasterize timeout fires within 5 s on a deliberately slow / hung Image()`

## Known traps

1. **XXE (XML External Entity) attacks.** A malicious
   `<!ENTITY xxe SYSTEM "file:///etc/passwd">` followed by `&xxe;`
   inside the document body. `DOMParser` in `image/svg+xml` mode
   may resolve external entities depending on user agent. We do
   NOT rely on the parser — we string-match `<!ENTITY` BEFORE
   parsing and reject the whole document. Same logic catches
   internal entities used for billion-laughs.
2. **Billion laughs / quadratic blowup.** Nested entity
   declarations like `<!ENTITY lol "lol"> <!ENTITY lol2 "&lol;&lol;..."> ...`
   cause exponential expansion when the document text is
   serialized. Even purely-internal entities are dangerous.
   The same `<!ENTITY` reject covers this.
3. **External resource references.** `<image href="http://attacker/">`
   or `<use href="data:..."/>` would trigger network fetches when
   the SVG is rasterized via `<img>`-as-source, exposing referer
   leakage and SSRF-adjacent behaviour. Reject any `href` /
   `xlink:href` attribute whose value does not start with `#`
   (intra-document fragment).
4. **Embedded `<script>` tags.** SVG natively supports `<script>`
   in the SVG namespace AND scripts can run when SVG is loaded
   as a standalone document. While `<img src=x.svg>` runs in
   "secure static mode" (scripts disabled), a user might still
   render the SVG inline (we cannot prevent that downstream).
   Zero tolerance: reject on first `<script` substring match.
5. **`<foreignObject>` embedding.** Hosts arbitrary HTML / XHTML
   inside SVG, including iframes, scripts, and CSS. Reject any
   document containing `<foreignObject` (case-insensitive) in the
   first pass. Phase 4.5+ may sanitize and allow.
6. **`xlink:href` (deprecated form).** SVG 1.1 used the XLink
   namespace; SVG 2 prefers bare `href`. Both are still seen in
   the wild. Reject both forms identically.
7. **Rasterization size DoS.** An SVG with
   `viewBox="0 0 100000 100000"` would, naively, allocate a
   100K×100K canvas (40 GB of RGBA). Cap output dimensions at
   `MAX_RASTERIZE_WIDTH` × `MAX_RASTERIZE_HEIGHT` (8192×8192)
   BEFORE allocating the canvas.
8. **Input size cap.** SVG is text. A 100 MiB SVG is almost
   certainly weaponised (or someone exported a CAD file as SVG —
   either way, refuse). Cap at `MAX_SVG_INPUT_BYTES` = 10 MiB.
9. **`Image()` onerror leakage.** A malformed SVG that nonetheless
   passed our validator could hang `img.decode()` indefinitely
   on some user agents. Race `decode()` against an
   `AbortController` timeout of `MAX_SVG_PARSE_TIME_MS` and
   throw `SvgRasterizeError` on timeout. Always revoke the
   object URL in `finally`.
10. **JPEG has no alpha channel.** When `format === 'image/jpeg'`,
    the canvas MUST be filled with an opaque background before
    drawing the SVG, or transparent regions render as black on
    most browsers. Default background to `#fff` for JPEG.

## Security caps

- **`MAX_SVG_INPUT_BYTES = 10 * 1024 * 1024`** (10 MiB) — checked
  on the raw input before any decoding or parsing.
- **`MAX_RASTERIZE_WIDTH = 8192`**, **`MAX_RASTERIZE_HEIGHT = 8192`**
  — checked on the resolved output dimensions BEFORE canvas
  allocation. Throws `SvgRasterizeTooLargeError`.
- **`MAX_SVG_PARSE_TIME_MS = 5000`** — bounds the
  `Image.decode()` race in `rasterizeSvg`. On timeout, abort
  and throw `SvgRasterizeError`.
- **String-based reject pass** runs on the raw source BEFORE any
  XML parser is invoked. Any of these substrings causes
  `SvgUnsafeContentError`:
  - `<!ENTITY` (XXE + billion laughs)
  - `<!DOCTYPE` (any DTD; even harmless ones slow the parser
    and provide an entity-injection vector)
  - `<script` (case-insensitive — covers `<SCRIPT`, `<Script`,
    `<script\n`, `<script\t`, `<script `)
  - `<foreignObject` (case-insensitive)
  - Regex `(?:xlink:)?href\s*=\s*["']([^"'#][^"']*)["']` with a
    non-`#` first character — matches any external reference.
- **Namespace validation**: `documentElement.namespaceURI` MUST
  equal `http://www.w3.org/2000/svg`. HTML-namespace `<svg>`
  parsed via `text/html` is rejected.
- **UTF-8 fatal decode**: `TextDecoder('utf-8', { fatal: true })`
  rejects malformed byte sequences before they reach the XML
  parser.
- **No network**: the SVG never reaches the network stack —
  raster goes through a same-origin Blob URL that is revoked
  after `decode()`.

## LOC budget breakdown

| File | LOC est. |
|---|---|
| `validator.ts` (string-based reject pass for XXE / script / external href) | 80 |
| `parser.ts` (`DOMParser` wrapper, viewBox + width + height extraction) | 80 |
| `rasterizer.ts` (`Image` + `OffscreenCanvas` + `convertToBlob` + timeout) | 100 |
| `backend.ts` (`SvgBackend`: identity SVG→SVG plus SVG→PNG/JPG/WebP) | 80 |
| `errors.ts` (typed `SvgParseError` / `SvgUnsafeContentError` / `SvgRasterizeError` / `SvgRasterizeTooLargeError`) | 40 |
| `constants.ts` (size + dimension + timeout caps, SVG namespace) | 30 |
| `index.ts` (public API surface) | 30 |
| **total** | **~440** |
| tests | ~300 |

The Phase-4 plan does not enumerate a per-file budget for
`image-svg`; this is the smallest Phase-4 package and the ~440
LOC overhead is dominated by the security validator + the
`Image` / Canvas plumbing rather than format complexity.

## Implementation references (for the published README)

This package is implemented from the W3C SVG 2 Recommendation, the
W3C HTML Living Standard (`<img>`, `<canvas>`, `OffscreenCanvas`,
`Blob`, `URL.createObjectURL`), and the W3C DOM Parsing and
Serialization specification (`DOMParser`). XML entity-attack
mitigations follow the OWASP XML External Entity Prevention Cheat
Sheet's "disable DTDs entirely" guidance. No code was copied from
svgo, fabric, d3, canvg, or sharp. SVG fixtures used for tests
are hand-crafted minimal documents committed under
`tests/fixtures/image/` and are not redistributed in npm.
