# @catlabtech/webcvt-data-text

> Structured text format conversion for webcvt: JSON, CSV/TSV, TOML, YAML, INI, ENV, JSONL, XML, FWF, and more.

## Installation

```bash
npm i @catlabtech/webcvt-data-text
```

## Supported formats

| Format | Parse | Serialize |
|---|---|---|
| JSON | yes | yes |
| JSONL | yes | yes |
| CSV | yes | yes |
| TSV | yes | yes |
| TOML | yes | yes |
| YAML | yes | yes |
| INI | yes | yes |
| ENV | yes | yes |
| XML | yes | yes |
| FWF (Fixed-Width) | yes | yes |

## API

Detailed API reference coming in v0.2. See the [source code](https://github.com/Junhui20/webcvt/tree/main/packages/data-text/src) for now.

## Notes

All parsers are pure TypeScript with no third-party dependencies. Each parser enforces input size limits and depth caps to prevent memory exhaustion on adversarial inputs.
