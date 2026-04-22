/**
 * Global constants for @catlabtech/webcvt-backend-wasm.
 *
 * All timing, size, and format limits live here to avoid magic numbers
 * scattered across the implementation.
 */

/** Maximum allowed input size: 1 GiB (MEMFS addressable limit). */
export const MAX_INPUT_BYTES = 1 * 1024 * 1024 * 1024; // 1 GiB

/** Idle timeout before the FFmpeg worker is terminated: 60 seconds. */
export const IDLE_TIMEOUT_MS = 60_000;

/** Minimum interval between progress emissions: 100 ms. */
export const PROGRESS_THROTTLE_MS = 100;

/** Maximum stderr bytes kept in WasmExecutionError to avoid OOM. */
export const MAX_STDERR_BYTES = 64 * 1024; // 64 KiB

/** Sentinel percent value emitted when input duration is unknown. */
export const UNKNOWN_DURATION_SENTINEL = -1;
