// Node.js example: SRT → VTT subtitle conversion using @catlabtech/webcvt-subtitle.
//
// Usage:
//   node index.js input.srt output.vtt
//
// For text-based formats (SRT, VTT, CSV, JSON...) the cleanest pattern is the
// per-package parse/serialize API — no backend registration, no format
// detection, works in Node with zero setup. The high-level convert() API is
// also available and is demoed in apps/playground for the binary-format case.

import { readFile, writeFile } from 'node:fs/promises';
import { parseSrt, serializeVtt } from '@catlabtech/webcvt-subtitle';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node index.js <input.srt> <output.vtt>');
  process.exit(1);
}

const srt = await readFile(inputPath, 'utf8');
const track = parseSrt(srt);
const vtt = serializeVtt(track);
await writeFile(outputPath, vtt);

console.log(
  `Converted ${inputPath} → ${outputPath} ` + `(${track.cues.length} cues, ${vtt.length} bytes)`,
);
