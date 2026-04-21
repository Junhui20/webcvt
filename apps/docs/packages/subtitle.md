# @webcvt/subtitle

Browser-first subtitle conversion for the webcvt ecosystem. Converts between SRT, WebVTT, ASS/SSA, MicroDVD (.sub), and MPL2 formats — pure TypeScript, no WASM, no third-party parsers.

## Installation

```bash
npm i @webcvt/subtitle
```

## Supported formats

| Format   | Ext   | Parse | Serialize | Notes                          |
|----------|-------|-------|-----------|--------------------------------|
| SubRip   | .srt  | yes   | yes       | Full round-trip, HTML tags     |
| WebVTT   | .vtt  | yes   | yes       | Cue settings preserved         |
| ASS      | .ass  | yes   | yes       | Style fields parsed; text only |
| SSA      | .ssa  | yes   | yes       | V4 styles (delegates to ASS)   |
| MicroDVD | .sub  | yes   | yes       | Frame-based, default 23.976fps |
| MPL2     | .mpl  | yes   | yes       | Decisecond timestamps          |

VobSub binary `.sub` files are out of scope — the parser throws a clear error when binary magic is detected.

## Usage via registry

```ts
import { SubtitleBackend } from '@webcvt/subtitle';
import { defaultRegistry, convert } from '@webcvt/core';

defaultRegistry.register(new SubtitleBackend());

const result = await convert(srtBlob, { format: 'vtt' });
```

## Direct parser / serializer usage

```ts
import { parseSrt, serializeVtt, parseAss, serializeSrt } from '@webcvt/subtitle';

// SRT → VTT
const track = parseSrt(srtText);
const vttText = serializeVtt(track);

// ASS → SRT
const track2 = parseAss(assText);
const srtText2 = serializeSrt(track2);
```

## Source

[packages/subtitle/src](https://github.com/Junhui20/webcvt/tree/main/packages/subtitle/src)
