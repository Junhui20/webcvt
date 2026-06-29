# @catlabtech/webcvt-email

Self-written **EML (RFC 5322 + MIME)** parser for [webcvt](https://github.com/Junhui20/webcvt) — turn `.eml` messages into structured data, plain text, or JSON, entirely client-side with **zero runtime dependencies**.

## What it does

- **RFC 5322** header parsing: folding/unfolding, case-insensitive field names, repeated headers preserved.
- **RFC 2047** encoded-words (`=?utf-8?B?…?=` / `?Q?`) decoded in header values.
- **MIME (RFC 2045/2046)**: `Content-Type` + `boundary`, `Content-Transfer-Encoding` (7bit / 8bit / binary / base64 / quoted-printable), recursive `multipart/*` (depth-capped), `text/plain` + `text/html` parts and attachments.
- Address-list parsing for `From` / `To` / `Cc`.
- HTML → text (ReDoS-safe) for the `eml → txt` path.

## Install

```bash
npm install @catlabtech/webcvt-core @catlabtech/webcvt-email
```

## Usage

```typescript
import { parseEml } from '@catlabtech/webcvt-email';

const msg = parseEml(emlStringOrBytes);
msg.subject;          // decoded subject
msg.from;             // { name?, address }
msg.to;               // EmailAddress[]
msg.textBody;         // string | undefined
msg.htmlBody;         // string | undefined
msg.attachments;      // { filename?, contentType, bytes, size, contentId? }[]
```

Convert via the backend (opt-in registration — the backend never auto-registers):

```typescript
import { convert, defaultRegistry } from '@catlabtech/webcvt-core';
import { EmailBackend } from '@catlabtech/webcvt-email';

defaultRegistry.register(new EmailBackend());
const txt = await convert(emlBlob, { format: 'txt' });   // plain-text body
const json = await convert(emlBlob, { format: 'json' });  // lossless structured JSON
```

> EML has no reliable magic-byte signature, so detection relies on the filename / MIME hint (`message/rfc822`).

## Security

Hardened against adversarial input: 64 MiB input cap, ≤1000 headers, MIME nesting depth ≤20, ≤1000 parts, bounded decoded-attachment bytes, prototype-pollution-safe header maps (`Object.create(null)`), and hand-written scanners instead of backtracking regex.

## Out of scope

RFC 2231 parameter continuations / extended `filename*=`, recursive `message/rfc822` sub-messages (kept as opaque attachments), and group-address labels.

## License

MIT
