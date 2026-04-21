# CLI Usage

`@webcvt/cli` provides a command-line interface for one-off file conversions without writing any code.

## Installation

```bash
# Run directly without installing (recommended for scripts)
npx @webcvt/cli [options] <input> <output>

# Or install globally
npm i -g @webcvt/cli
webcvt [options] <input> <output>
```

## Basic usage

```bash
# Convert an image
npx @webcvt/cli photo.jpg photo.webp

# Convert a subtitle file
npx @webcvt/cli subtitles.srt subtitles.vtt

# Convert audio
npx @webcvt/cli song.wav song.mp3
```

The output format is inferred from the output file extension.

## Piped usage

Use `-` as the input path to read from stdin, and specify `--from` to declare the input format:

```bash
# Read from stdin, write to file
cat photo.png | npx @webcvt/cli --from png - photo.webp

# Pipe between tools
curl -s https://example.com/video.mp4 | npx @webcvt/cli --from mp4 - out.webm
```

## Options

| Option | Description |
|---|---|
| `--from <ext>` | Force input format (overrides auto-detection) |
| `--quality <0-1>` | Quality hint, 0.0–1.0 (default: 0.85) |
| `--help` | Show help |
| `--version` | Print version |

## Supported format pairs

The CLI delegates to registered backends. The available conversions depend on which backend packages are installed. Common pairs:

| Input | Output |
|---|---|
| `jpg`, `png`, `webp`, `bmp`, `ico` | `jpg`, `png`, `webp`, `bmp`, `ico` |
| `gif`, `apng` | `gif`, `apng`, `webp` (animation) |
| `svg` | `png`, `jpg`, `webp` |
| `srt`, `ass`, `ssa` | `vtt`, `srt`, `ass` |
| `wav`, `mp3`, `flac`, `ogg` | `wav`, `mp3`, `flac`, `ogg` (via WASM backend) |
| `mp4`, `webm`, `mkv` | `mp4`, `webm`, `mkv` (via WASM backend) |

## Error handling

The CLI exits with code `1` on conversion failure and prints a human-readable message to stderr:

```bash
npx @webcvt/cli bad.xyz out.png
# stderr: Error: Unsupported input format: "xyz"
# exit code: 1
```

For scripting, check `$?` after each invocation.
