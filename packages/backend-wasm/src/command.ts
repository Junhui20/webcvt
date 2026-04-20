/**
 * Command synthesis for @webcvt/backend-wasm.
 *
 * buildCommand() constructs the ffmpeg argv array from lookup tables ONLY.
 * No user-controlled strings ever reach ffmpeg directly (Trap #4).
 * The result is passed to ffmpeg.exec(argv) — never joined to a shell string.
 */

import type { ConvertOptions, FormatDescriptor } from '@webcvt/core';
import {
  CONTAINER_DEFAULT_AUDIO_CODEC,
  CONTAINER_DEFAULT_VIDEO_CODEC,
  mapQualityFlags,
  resolveCodecAlias,
} from './codec-map.ts';
import { WasmUnsupportedError } from './errors.ts';

// ---------------------------------------------------------------------------
// buildCommand
// ---------------------------------------------------------------------------

/**
 * Builds the ffmpeg argv for a single conversion job.
 *
 * Steps (all via lookup tables):
 * 1. Base flags: -hide_banner -nostdin -y -i inputPath
 * 2. Codec selection (video and/or audio)
 * 3. Audio-only: append -vn when output.category === 'audio'
 * 4. Quality flags dispatched by codec family
 * 5. Override via options.codec through CODEC_ALIAS_MAP
 * 6. Append outputPath
 *
 * @param inputPath  - MEMFS virtual path for the input file
 * @param outputPath - MEMFS virtual path for the output file
 * @param inputMime  - MIME type of the input (for context; currently unused in argv)
 * @param output     - Output format descriptor
 * @param options    - Caller-provided ConvertOptions
 * @returns Immutable argv string array for ffmpeg.exec()
 * @throws WasmUnsupportedError if options.codec is provided but unmapped
 */
export function buildCommand(
  inputPath: string,
  outputPath: string,
  inputMime: string,
  output: FormatDescriptor,
  options: ConvertOptions,
): readonly string[] {
  // Suppress unused-variable warning — inputMime is kept for signature parity
  // with the design spec and future codec-probing use.
  void inputMime;

  const argv: string[] = ['-hide_banner', '-nostdin', '-y', '-i', inputPath];

  const isAudioOnly = output.category === 'audio';

  if (isAudioOnly) {
    // Audio-only extraction: suppress video stream (Trap: step 4)
    argv.push('-vn');
  }

  // ---- Resolve video codec -------------------------------------------------
  if (!isAudioOnly) {
    let videoCodec = CONTAINER_DEFAULT_VIDEO_CODEC[output.mime] ?? 'libx264';

    if (options.codec !== undefined) {
      const resolved = resolveCodecAlias(options.codec);
      if (resolved === undefined) {
        throw new WasmUnsupportedError(`unknown-codec:${options.codec}`, output.mime);
      }
      if (isVideoCodec(resolved)) {
        videoCodec = resolved;
      } else {
        // User passed a non-video codec for a video output. Don't silently
        // ignore — fail loud so the mismatch surfaces to the caller.
        throw new WasmUnsupportedError(
          `codec-output-mismatch:${options.codec}→${resolved}:not-a-video-codec`,
          output.mime,
        );
      }
    }

    argv.push('-c:v', videoCodec);
    argv.push(...mapQualityFlags(videoCodec, options.quality));
  }

  // ---- Resolve audio codec -------------------------------------------------
  let audioCodec = CONTAINER_DEFAULT_AUDIO_CODEC[output.mime];

  if (audioCodec !== undefined) {
    if (options.codec !== undefined && isAudioOnly) {
      const resolved = resolveCodecAlias(options.codec);
      if (resolved === undefined) {
        throw new WasmUnsupportedError(`unknown-codec:${options.codec}`, output.mime);
      }
      audioCodec = resolved;
    }

    argv.push('-c:a', audioCodec);
    argv.push(...mapQualityFlags(audioCodec, options.quality));
  }

  argv.push(outputPath);

  return argv;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Known ffmpeg video encoder names. Used to discriminate codec override type.
 *
 * NOTE: 'copy' is deliberately NOT here. Stream-copy mode (`-c:v copy`) would
 * bypass transcoding and silently shadow the container/codec negotiation.
 * If stream-copy is ever wanted, it requires an explicit opt-in API surface,
 * not a side-door through the codec override path.
 */
const VIDEO_ENCODERS = new Set([
  'libx264',
  'libx265',
  'libaom-av1',
  'libvpx-vp9',
  'libvpx',
  'mpeg2video',
  'mpeg4',
]);

function isVideoCodec(codec: string): boolean {
  return VIDEO_ENCODERS.has(codec);
}
