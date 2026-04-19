/**
 * Shared constants for the @webcvt/container-flac package.
 *
 * Centralising limits here ensures backend.ts and parser.ts cannot drift.
 */

/** Maximum input buffer size accepted by parseFlac and FlacBackend.convert (200 MiB). */
export const MAX_INPUT_BYTES = 200 * 1024 * 1024;

/** Maximum allowed ID3v2 tag body size before the fLaC magic (64 MiB). */
export const MAX_ID3_BODY = 64 * 1024 * 1024;
