# data-text XML extension design

> XML 1.0 (Fifth Edition) alongside JSON/CSV/TSV/INI/ENV/JSONL/TOML/FWF.
>
> Spec-only: W3C XML 1.0 5th Ed (2008) + XML Information Set + DOM Parsing.
> NO porting from fast-xml-parser, xml2js, xmlbuilder, @xmldom/xmldom,
> sax-js, ltx, htmlparser2, parse5.
>
> Uses browser-native `DOMParser` AFTER heavy security pre-scan.
> Uses hand-rolled canonical serializer (NOT XMLSerializer).

## Scope

### In scope (~500-700 LOC source + ~350 tests)

- Parse via `DOMParser('application/xml')` after security gate
- Return `XmlFile { root, declaredEncoding, declaredStandalone, hadBom }`
  with simplified typed tree (name + attributes + children + text)
- Serialize via hand-rolled canonical emitter — alphabetical attribute
  order, self-closing `<foo/>` empty elements, consistent entity escaping,
  2-space indent, LF line endings
- UTF-8 encoding; BOM parsed + dropped on serialize

### Out of scope (deferred)

- Namespace resolution (QNames returned as raw strings like `"svg:circle"`)
- DTD validation (DTDs REJECTED outright)
- XSD, RELAX NG, Schematron, XSLT, XPath, XInclude
- Streaming / SAX events
- Mixed content positional preservation
- CDATA preservation (decoded to text; re-emitted as text with escapes)
- Comments (dropped on parse)
- PIs other than `<?xml?>` preamble (REJECTED)
- XML 1.1
- xml:space preservation

## Type definitions

```ts
export interface XmlAttribute {
  readonly name: string;   // QName as source, e.g. "id", "xml:lang"
  readonly value: string;  // decoded (entities expanded)
}

export interface XmlElement {
  readonly name: string;                       // QName opaque string
  readonly attributes: readonly XmlAttribute[]; // alphabetical on serialize
  readonly children: readonly XmlElement[];
  readonly text: string;                        // concatenated text (simplified model)
}

export interface XmlFile {
  readonly root: XmlElement;
  readonly declaredEncoding: 'UTF-8' | null;
  readonly declaredStandalone: 'yes' | 'no' | null;
  readonly hadBom: boolean;
}

export function parseXml(input: Uint8Array | string): XmlFile;
export function serializeXml(file: XmlFile): string;
```

## Typed errors (13)

| Class | Code |
|---|---|
| XmlInvalidUtf8Error | XML_INVALID_UTF8 |
| XmlDoctypeForbiddenError | XML_DOCTYPE_FORBIDDEN |
| XmlEntityForbiddenError | XML_ENTITY_FORBIDDEN |
| XmlExternalEntityForbiddenError | XML_EXTERNAL_ENTITY_FORBIDDEN |
| XmlForbiddenPiError | XML_FORBIDDEN_PI |
| XmlCdataPayloadError | XML_CDATA_PAYLOAD_FORBIDDEN |
| XmlParseError | XML_PARSE_ERROR |
| XmlDepthExceededError | XML_DEPTH_EXCEEDED |
| XmlTooManyElementsError | XML_TOO_MANY_ELEMENTS |
| XmlTooManyAttrsError | XML_TOO_MANY_ATTRS |
| XmlTextNodeTooLongError | XML_TEXT_NODE_TOO_LONG |
| XmlBadElementNameError | XML_BAD_ELEMENT_NAME |
| XmlSerializeError | XML_SERIALIZE_ERROR |

## Trap list

1. **DOCTYPE REJECT** — `<!DOCTYPE` is the XXE root cause. Pre-scan catches
   BEFORE DOMParser runs. Throw `XmlDoctypeForbiddenError`.

2. **`<!ENTITY` REJECT** — billion-laughs attack. Even pure-internal
   entities are dangerous. Defense in depth: separate scan for `<!ENTITY`
   in addition to the DOCTYPE catch.

3. **External entity refs (`SYSTEM`/`PUBLIC`) REJECT** — cannot appear
   outside DTD context. Catch patterns like `<!ENTITY ... SYSTEM`.

4. **CDATA payload scan** — scan CDATA contents for `<!DOCTYPE`/`<!ENTITY`
   substrings (defense in depth against downstream rewrite bugs).

5. **Processing instructions REJECT except `<?xml?>` preamble**.
   `<?xml-stylesheet?>`, `<?php?>`, etc. all rejected. Preamble must be
   at byte 0 (after BOM), target lowercase `xml`, close within 200 chars.

6. **DOMParser errors reported via `<parsererror>` child**, NOT via thrown
   exception. Detect via `doc.querySelector('parsererror')` and throw
   typed error. Same pattern as image-svg.

7. **Attribute value escape set**: `<`, `&`, `"`, `>` (belt-and-braces),
   plus `\t`/`\n`/`\r` as `&#x9;`/`&#xA;`/`&#xD;` to preserve through
   attribute-value normalisation.

8. **Text node escape set**: `<`, `&`, `>` (escape `>` to prevent
   accidental `]]>` formation outside CDATA). `\r` → `&#xD;` to preserve.

9. **Namespace-less names**: `xmlns`/`xmlns:x` treated as ordinary
   attributes; QNames like `svg:circle` are opaque strings.

10. **Empty elements emit self-closing `<foo/>`** — never `<foo></foo>`.
    Round-trip-lossy: both forms collapse to self-closing on output.

11. **Element name validity** — validate against XML 1.0 Name production
    on serialize. Reject invalid names with `XmlBadElementNameError`.

12. **Max DOM depth cap** — pre-parse scan counts tag depth; throw
    `XmlDepthExceededError` BEFORE DOMParser runs (Phase 1 defense).

13. **Element count cap** — pre-parse counts `<` characters outside
    quoted values/comments/CDATA. Approximate but safe.

14. **Attribute count cap per element** — post-parse walk.

15. **Text-node size cap** — concatenated text per element ≤ 1 MiB.

16. **Preamble encoding MUST be UTF-8 or absent** — explicit non-UTF-8
    declaration → `XmlParseError`.

17. **BOM parsed and dropped, NEVER re-emitted** on serialize.

## Security caps

```ts
export const MAX_XML_DEPTH = 64;
export const MAX_XML_ELEMENTS = 100_000;
export const MAX_XML_ATTRS_PER_ELEMENT = 1024;
export const MAX_XML_TEXT_NODE_CHARS = 1_048_576;
export const XML_MIME = 'application/xml';
```

Inherited: `MAX_INPUT_BYTES` (10 MiB), `MAX_INPUT_CHARS` (10M), UTF-8
fatal mode.

**NO regex on raw untrusted input** — pre-scan is hand-rolled character
walk with state machine (NORMAL / IN_TAG / IN_ATTR_VALUE_DQ/SQ /
IN_COMMENT / IN_CDATA / IN_PI). Regex used only for:
- Element/attribute name validation (caller-controlled strings on serialize)
- Preamble parse (first ≤200 chars after BOM)

## Parser architecture

Three phases:

### Phase 1: Pre-parse security scan

State machine over decoded source. On each `NORMAL`-state cursor:
- Test `startsWith('<!DOCTYPE', i)` → throw `XmlDoctypeForbiddenError`
- Test `startsWith('<!ENTITY', i)` → throw `XmlEntityForbiddenError`
- Test `startsWith('<?', i) && i !== 0 && !startsWith('<?xml', 0)` → throw
- Track elementCount (`<` opens), depth (+1 on open, -1 on close/self-close)
- On CDATA exit: scan payload for `<!DOCTYPE`/`<!ENTITY` → throw
- Cap checks: peakDepth > MAX_XML_DEPTH, elementCount > MAX_XML_ELEMENTS
- Preamble (if present at byte 0 after BOM): extract encoding + standalone;
  reject non-UTF-8 encoding

### Phase 2: DOMParser parse + error detection

```ts
const doc = new DOMParser().parseFromString(source, 'application/xml');
if (doc.querySelector('parsererror') !== null) throw XmlParseError;
if (doc.documentElement === null) throw XmlParseError('no root');
```

### Phase 3: DOM → XmlFile conversion

Recursive walk with depth guard + per-element caps:
- Validate `attributes.length <= MAX_XML_ATTRS_PER_ELEMENT`
- Sort attributes alphabetically (canonical)
- Concatenate text/CDATA child content → `text`; validate cap
- Recurse into element children; drop comments + PIs
- Preserve raw `nodeName` (QName with prefix)

## Serializer

Hand-rolled canonical emitter over XmlFile POJO:

```
serialize(file):
  [if declaredEncoding/standalone → '<?xml version="1.0" ...?>\n']
  emitElement(root, indent=0)

emitElement(el, i):
  validateName(el.name)
  attrs = el.attributes.map(a => validateName(a.name) + '="' + escapeAttr(a.value) + '"').join(' ')
  opener = '<' + el.name + (attrs ? ' ' + attrs : '')
  if !children.length && !text.length: return indent(i) + opener + '/>\n'
  if !children.length: return indent(i) + opener + '>' + escapeText(text) + '</' + el.name + '>\n'
  // mixed: text (if any) + children, each on own line
  ...
```

Escape order matters: `&` FIRST, then others.

LF line endings, 2-space indent, NO BOM.

## Backend integration

`XML_MIME = 'application/xml'` added to MIME_TO_FORMAT. `XML_FORMAT`
descriptor exported. Convert path is identity-within-format: parse →
serialize yields canonical form regardless of input formatting.

Alias MIMEs NOT added in first pass: `text/xml`, `application/xhtml+xml`,
`image/svg+xml` (owned by image-svg).

## Test plan (28+ cases, minimum 20)

1. Parse minimal `<root/>`
2. Parse root with text
3. Parse attributes → alphabetical output
4. Parse nested 3 levels
5. Predefined entities expand (`&amp;&lt;&gt;&quot;&apos;`)
6. Numeric character reference `&#65;` → `A`
7. CDATA section → decoded text
8. UTF-8 BOM → `hadBom: true`
9. `<?xml?>` preamble recognised
10. **Reject `<!DOCTYPE html>`** → XmlDoctypeForbiddenError
11. **Reject `<!DOCTYPE r [<!ENTITY x "y">]>`** → XmlDoctypeForbiddenError
12. **Reject bare `<!ENTITY`** → XmlEntityForbiddenError
13. **Reject `<!DOCTYPE r SYSTEM "...">`**
14. **Billion-laughs input rejected before expansion**
15. **CDATA containing `<!DOCTYPE`** → XmlCdataPayloadError
16. **CDATA containing `<!ENTITY`** → same
17. **Reject `<?xml-stylesheet?>`** → XmlForbiddenPiError
18. **Reject `<?php?>`** → XmlForbiddenPiError
19. **Accept leading `<?xml?>` preamble**
20. **Malformed XML** → XmlParseError via <parsererror>
21. Invalid element name on serialize → XmlBadElementNameError
22. Depth 65 → XmlDepthExceededError
23. 100_001 siblings → XmlTooManyElementsError
24. 1025 attributes → XmlTooManyAttrsError
25. 1 MiB+1 char text → XmlTextNodeTooLongError
26. Non-UTF-8 encoding preamble → XmlParseError
27. Round-trip canonical → byte-identical
28. Empty element serialized as `<foo/>` not `<foo></foo>`
29. Attribute alphabetical order regardless of input order
30. Escape `"` as `&quot;` in attrs; `&` as `&amp;`; `<` as `&lt;`
31. parseDataText(input, 'xml') returns { kind: 'xml' }
32. canHandle application/xml identity
33. serializeDataText dispatches
34. BOM in `hadBom` but dropped on serialize
35. Malformed UTF-8 → XmlInvalidUtf8Error

## Dependencies

- Runtime: DOMParser (browser-native; happy-dom already devDep for Node tests)
- No new production deps
- Reuses `decodeInput` from utf8.ts
- Reuses WebcvtError, FormatDescriptor, Backend from core

## LOC budget

| File | LOC |
|---|---|
| xml.ts (pre-scan 180 + DOMParser adapter 80 + tree conversion 100 + serializer 150 + name validator 30) | 540 |
| errors.ts additions (13 classes) | 100 |
| constants.ts additions | 20 |
| parser/serializer/backend/index/core/formats additions | 60 |
| **Source total** | **~720** |
| xml.test.ts (35 cases) | 350 |
| **Grand total** | **~1070** |
