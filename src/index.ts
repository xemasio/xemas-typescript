/**
 * XemaS - on-chain intelligence for developers.
 *
 * Seven products, one envelope: contract, entity, behaviour, counterparties, portfolio, fundFlow,
 * whale. Every response carries `evidence` describing what was actually assessed - read it before
 * drawing conclusions from `data`.
 *
 * Docs: https://xemas.io/api
 */
export { Xemas, DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, VERSION } from "./client.js";
export {
  XemasError, TransportError, ApiStatusError, AuthenticationError,
  PermissionError, NotFoundError, RateLimitError, ServerError,
} from "./errors.js";
export type { Envelope, Evidence, Meta, RateLimit, XemasOptions, RequestOptions } from "./types.js";
