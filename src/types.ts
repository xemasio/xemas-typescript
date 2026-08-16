/**
 * The XemaS v1 response envelope.
 *
 * Hand-written on purpose, not generated. The exported `/v1` OpenAPI document (`openapi/v1.json`)
 * is authoritative for paths, methods and parameters - but it declares no response schemas,
 * because the API's routes carry no FastAPI `response_model`. Generating types from it would
 * produce `unknown` for every response.
 *
 * Attaching `response_model` server-side would make the spec self-sufficient, but in FastAPI that
 * is not a documentation change: it becomes a runtime serialization contract that FILTERS the
 * response, silently dropping undeclared fields. That is a production-behaviour change and is
 * deliberately out of scope here.
 */

/** Why the platform believes what it returned. Present on every v1 response. */
export interface Evidence {
  /** What was actually assessed. */
  coverage: Record<string, unknown>;
  /** How strongly, per dimension. */
  confidence: Record<string, unknown>;
  /** Which sources contributed, and when they observed. */
  provenance: unknown[];
  /**
   * When the underlying observation was made.
   *
   * `null` means no source reported an observation time - which is NOT "observed now". The SDK
   * never substitutes a timestamp.
   */
  observed_at: string | null;
  [key: string]: unknown;
}

/** Which semantic model produced `data`, and when this response was generated. */
export interface Meta {
  model: string;
  version: string;
  generated_at: string;
  [key: string]: unknown;
}

/**
 * `{ data, evidence, meta }` - the shape every v1 product returns.
 *
 * Note what is deliberately OPTIONAL rather than nullable: `governance_metadata`. The API omits
 * that key entirely rather than sending `null` when there is nothing to report, and those mean
 * different things - absent is "not produced", `null` would assert an empty value. Typing it as
 * `?:` rather than `| null` keeps that distinction checkable with `in`.
 *
 * The index signature is equally deliberate: the API may add keys before this SDK knows about
 * them, and a client that dropped them would reproduce, on the consumer side, the field-loss
 * hazard that keeps `response_model` off the server routes.
 */
export interface Envelope<T = Record<string, unknown>> {
  data: T;
  evidence: Evidence;
  meta: Meta;
  governance_metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Per-key rate-limit state, parsed from `X-RateLimit-*`.
 *
 * Every field is optional: these come from headers, and a header that was not sent must not become
 * a number the caller could mistake for a measurement of remaining quota.
 */
export interface RateLimit {
  limit?: number;
  remaining?: number;
  reset?: number;
}

export interface XemasOptions {
  /** `sk-xemas-...`. Falls back to `process.env.XEMAS_API_KEY`. */
  apiKey?: string;
  /** Defaults to `https://api.xemas.io/v1`. Override for testing. */
  baseUrl?: string;
  /** Milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** Injectable for tests. Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /** EVM chain id. Defaults to 1. */
  chainId?: number;
  /** Abort the request from the caller's side. */
  signal?: AbortSignal;
}
