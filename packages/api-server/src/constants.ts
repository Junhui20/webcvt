/**
 * Security caps for @catlabtech/webcvt-api-server.
 *
 * These values bound how much untrusted input the HTTP layer will buffer
 * before rejecting a request. The multipart parser and the raw-body reader
 * both enforce {@link MAX_INPUT_BYTES}.
 */

/**
 * Maximum accepted size, in bytes, of the request body fed into a conversion.
 * Default: 256 MiB. Override per-server via `createApiServer({ maxInputBytes })`.
 *
 * The cap is enforced while streaming the request body — a request that
 * exceeds it is aborted with HTTP 413 before the whole payload is buffered.
 */
export const MAX_INPUT_BYTES = 256 * 1024 * 1024;

/**
 * Fallback base name used for the `Content-Disposition` download filename when
 * the request carries no usable original filename (e.g. the raw-body shape).
 */
export const DEFAULT_DOWNLOAD_BASENAME = 'output';
