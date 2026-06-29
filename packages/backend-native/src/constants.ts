/**
 * Global constants for @catlabtech/webcvt-backend-native.
 *
 * All size and timing limits live here to avoid magic numbers scattered
 * across the implementation.
 */

/** Maximum allowed input size: 1 GiB. Enforced before any temp write/spawn. */
export const MAX_INPUT_BYTES = 1 * 1024 * 1024 * 1024; // 1 GiB

/** Default wall-clock timeout for a single tool invocation: 120 seconds. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** Maximum stderr bytes captured/retained to avoid unbounded memory growth. */
export const MAX_STDERR_BYTES = 64 * 1024; // 64 KiB

/** Prefix for temp files created in os.tmpdir(). */
export const TEMP_PREFIX = 'webcvt-native-';
