# Security Policy

webcvt parses untrusted, potentially hostile binary and text input (media
containers, images, archives, subtitles, structured text). Input-handling
robustness is a core goal: parsers enforce per-format size/ratio/depth caps,
validate length fields against buffer bounds before slicing, and reject
adversarial constructs (zip-slip, decompression bombs, billion-laughs, XXE,
prototype pollution). We take security reports seriously.

## Supported versions

The project is pre-1.0. Security fixes land on the latest published minor
(`0.x`) and on `main`. Older `0.x` lines are not separately patched — please
upgrade to the latest release.

| Version | Supported |
| ------- | --------- |
| latest `0.x` | ✅ |
| older | ❌ (upgrade) |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via either:

1. **GitHub Security Advisories** (preferred) — open a private report at
   <https://github.com/Junhui20/webcvt/security/advisories/new>.
2. **Email** — <bryan@instamedia.my> with subject `webcvt security:`.

Please include:

- The affected package(s) and version (e.g. `@catlabtech/webcvt-container-mp4`).
- A description of the issue and its impact (DoS / OOM / RCE / data exposure).
- A minimal reproduction — ideally a small crafted input file and the code or
  CLI invocation that triggers it.

## What to expect

- **Acknowledgement** within 5 business days.
- An assessment and, for confirmed issues, a remediation plan with a target
  timeline based on severity.
- Coordinated disclosure: we will agree on a disclosure date and credit you in
  the advisory and `CHANGELOG.md` unless you prefer to remain anonymous.

## Scope

In scope: any of the published `@catlabtech/webcvt-*` packages, the CLI, and the
parsing/serialization logic. The hosted playground and docs sites are
demonstration deployments; report issues in them too, but note that all
conversion runs client-side and the sites store no user data.

Out of scope: vulnerabilities in third-party dependencies (report upstream;
we will update once a fix is available) and issues requiring a
already-compromised host or browser.
