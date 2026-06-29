/**
 * @catlabtech/webcvt-api-server
 *
 * A Hono-based HTTP convert API for webcvt. Exposes `createApiServer()` which
 * returns a `Hono` app (mount it / serve it on Node, Bun, Deno, or Workers).
 *
 * The server registers NO backends by default — register the backend packages
 * you need into the registry you pass (or core's `defaultRegistry`).
 */

export { MAX_INPUT_BYTES, DEFAULT_DOWNLOAD_BASENAME } from './constants.ts';
export {
  ApiBadRequestError,
  ApiInputTooLargeError,
  type ApiErrorBody,
  type ApiErrorStatus,
  httpStatusForError,
  toApiErrorBody,
} from './errors.ts';
export { createApiServer, type CreateApiServerOptions } from './server.ts';
