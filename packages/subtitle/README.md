# @webcvt/subtitle

Browser-first subtitle conversion for the webcvt ecosystem. Converts between SRT, WebVTT, ASS/SSA, MicroDVD (.sub), and MPL2 formats — pure TypeScript, no WASM, no third-party parsers.

## Supported Formats

| Format   | Ext   | Parse | Serialize | Notes                          |
|----------|-------|-------|-----------|--------------------------------|
| SubRip   | .srt  | yes   | yes       | Full round-trip, HTML tags     |
| WebVTT   | .vtt  | yes   | yes       | Cue settings preserved         |
| ASS      | .ass  | yes   | yes       | Style fields parsed; text only |
| SSA      | .ssa  | yes   | yes       | V4 styles (delegates to ASS)   |
| MicroDVD | .sub  | yes   | yes       | Frame-based, default 23.976fps |
| MPL2     | .mpl  | yes   | yes       | Decisecond timestamps          |

VobSub binary `.sub` files are **out of scope** — the parser throws a clear error when binary magic is detected.

## Usage

```ts
import { SubtitleBackend } from '@webcvt/subtitle';
import { defaultRegistry } from '@webcvt/core';

const backend = new SubtitleBackend();
defaultRegistry.register(backend);
```

Or use the parsers directly:

```ts
import { parseSrt, serializeVtt } from '@webcvt/subtitle';

const track = parseSrt(srtText);
const vttText = serializeVtt(track);
```

## License

MIT
