/**
 * Generic error bases shared by the container packages.
 *
 * Every `container-*` package ships two near-identical error classes — an
 * "input too large" guard and an "encode not implemented" stub — that differ
 * only by a code prefix and a human-readable format label. Duplicating them per
 * package meant nine copies drifting apart. These parameterized bases let each
 * package keep exporting ITS OWN named subclass (so `instanceof` and the
 * package-specific `code`/`name` are unchanged) while the message/code shape is
 * single-sourced here.
 *
 * Subclasses set `this.name` back to their own class name after `super(...)`,
 * so the observable `name`/`code`/`message` are byte-identical to the previous
 * hand-written classes.
 */

import { WebcvtError } from './types.ts';

/**
 * Base for the per-container `*InputTooLargeError` classes.
 *
 * Produces code `${codePrefix}_INPUT_TOO_LARGE` and the exact message the
 * containers have always thrown. The `(200 MiB)` suffix is intentionally part
 * of the literal — every container caps input at 200 MiB, so the human-readable
 * unit is fixed even though `max` is passed numerically.
 *
 * @param codePrefix  SCREAMING_SNAKE prefix, e.g. `"FLAC"` → `FLAC_INPUT_TOO_LARGE`.
 * @param formatLabel Display label used in the message, e.g. `"FLAC"`, `"Ogg"`, `"WebM"`.
 * @param size        Actual input size in bytes.
 * @param max         Configured maximum in bytes.
 */
export class InputTooLargeError extends WebcvtError {
  constructor(codePrefix: string, formatLabel: string, size: number, max: number) {
    super(
      `${codePrefix}_INPUT_TOO_LARGE`,
      `${formatLabel} input is ${size} bytes; maximum supported is ${max} bytes (200 MiB).`,
    );
    this.name = 'InputTooLargeError';
  }
}

/**
 * Base for the per-container `*EncodeNotImplementedError` classes.
 *
 * Produces code `${codePrefix}_ENCODE_NOT_IMPLEMENTED`. Unlike the too-large
 * message, each container's encode-stub message is bespoke (some interpolate an
 * output MIME or a reason), so the full message is passed through verbatim by
 * the subclass rather than templated here.
 *
 * @param codePrefix SCREAMING_SNAKE prefix, e.g. `"TS"` → `TS_ENCODE_NOT_IMPLEMENTED`.
 * @param message    The complete, package-specific error message.
 */
export class EncodeNotImplementedError extends WebcvtError {
  constructor(codePrefix: string, message: string) {
    super(`${codePrefix}_ENCODE_NOT_IMPLEMENTED`, message);
    this.name = 'EncodeNotImplementedError';
  }
}
