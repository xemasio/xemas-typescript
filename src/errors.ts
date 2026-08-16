import type { RateLimit } from "./types.js";

/**
 * Typed errors for the XemaS API.
 *
 * Every error carries the response's `X-Request-Id` when the API sent one - the fastest route to a
 * specific request in XemaS's logs, which turns "it failed sometimes" into one identifier.
 */
export class XemasError extends Error {
  readonly requestId?: string;
  constructor(message: string, requestId?: string) {
    super(requestId ? `${message} (requestId=${requestId})` : message);
    this.name = "XemasError";
    this.requestId = requestId;
  }
}

/**
 * The request never produced an HTTP response - DNS, TLS, connection, abort or timeout.
 *
 * Deliberately distinct from `ApiStatusError`: nothing was evaluated, so a caller must not treat
 * this as evidence about the address it asked for.
 */
export class TransportError extends XemasError {
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

/** The API returned a non-2xx response. */
export class ApiStatusError extends XemasError {
  readonly status: number;
  readonly detail?: unknown;
  readonly rateLimit?: RateLimit;
  constructor(message: string, status: number, detail?: unknown, requestId?: string, rateLimit?: RateLimit) {
    super(message, requestId);
    this.name = "ApiStatusError";
    this.status = status;
    this.detail = detail;
    this.rateLimit = rateLimit;
  }
}

/** 401 - key missing, malformed, revoked or unknown. Keys look like `sk-xemas-...`. */
export class AuthenticationError extends ApiStatusError {
  constructor(...a: ConstructorParameters<typeof ApiStatusError>) {
    super(...a);
    this.name = "AuthenticationError";
  }
}

/** 403 - the key is valid but the plan does not include this product. */
export class PermissionError extends ApiStatusError {
  constructor(...a: ConstructorParameters<typeof ApiStatusError>) {
    super(...a);
    this.name = "PermissionError";
  }
}

/** 404 - no such endpoint. A valid address with no data returns 200 with empty `data`. */
export class NotFoundError extends ApiStatusError {
  constructor(...a: ConstructorParameters<typeof ApiStatusError>) {
    super(...a);
    this.name = "NotFoundError";
  }
}

/**
 * 429 - the per-key window is exhausted.
 *
 * `retryAfter` is the API's own `Retry-After` in seconds when sent. The SDK does NOT retry on your
 * behalf: that spends your quota and latency budget, so the decision stays yours.
 */
export class RateLimitError extends ApiStatusError {
  readonly retryAfter?: number;
  constructor(message: string, status: number, detail: unknown, requestId?: string, rateLimit?: RateLimit, retryAfter?: number) {
    super(message, status, detail, requestId, rateLimit);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/** 5xx - the failure is on the XemaS side. Safe to retry with backoff. */
export class ServerError extends ApiStatusError {
  constructor(...a: ConstructorParameters<typeof ApiStatusError>) {
    super(...a);
    this.name = "ServerError";
  }
}

/** Map an HTTP status onto the narrowest error type available. */
export function errorForStatus(
  status: number,
  detail: unknown,
  requestId?: string,
  rateLimit?: RateLimit,
  retryAfter?: number,
): ApiStatusError {
  if (status === 401) return new AuthenticationError("Invalid or missing API key", status, detail, requestId, rateLimit);
  if (status === 403) return new PermissionError("This API key's plan does not permit that request", status, detail, requestId, rateLimit);
  if (status === 404) return new NotFoundError("No such endpoint", status, detail, requestId, rateLimit);
  if (status === 429) return new RateLimitError("Rate limit exceeded for this API key", status, detail, requestId, rateLimit, retryAfter);
  if (status >= 500) return new ServerError(`XemaS API error (HTTP ${status})`, status, detail, requestId, rateLimit);
  return new ApiStatusError(`Unexpected response (HTTP ${status})`, status, detail, requestId, rateLimit);
}
