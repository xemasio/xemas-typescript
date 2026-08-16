import { errorForStatus, TransportError, XemasError } from "./errors.js";
import type { Envelope, RateLimit, RequestOptions, XemasOptions } from "./types.js";

export const DEFAULT_BASE_URL = "https://api.xemas.io/v1";
export const DEFAULT_TIMEOUT_MS = 30_000;
const KEY_PREFIX = "sk-xemas-";
export const VERSION = "0.1.0";

/**
 * Read access to XemaS on-chain intelligence.
 *
 * ```ts
 * import { Xemas } from "@xemas-security/sdk";
 *
 * const client = new Xemas({ apiKey: "sk-xemas-..." });
 * const result = await client.entity("0x1f98...", { chainId: 1 });
 *
 * result.data;                // the product payload
 * result.evidence.coverage;   // what was actually assessed
 * result.meta.model;          // which semantic model produced it
 * ```
 *
 * All seven products share this signature and return the same `{data, evidence, meta}` envelope.
 * `evidence` is not decoration: it states what the platform could and could not establish, and a
 * caller drawing conclusions from `data` alone is discarding that.
 */
export class Xemas {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Rate-limit state from the most recent response, or undefined before the first call. */
  rateLimit?: RateLimit;

  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: XemasOptions = {}) {
    const key = options.apiKey ?? (typeof process !== "undefined" ? process.env?.XEMAS_API_KEY : undefined);
    if (!key) {
      throw new XemasError(
        "No API key. Pass new Xemas({ apiKey: 'sk-xemas-...' }) or set XEMAS_API_KEY. " +
          "Create a key at https://xemas.io/developer/api-keys",
      );
    }
    if (!key.startsWith(KEY_PREFIX)) {
      // Fail here rather than sending it: a wrong-service key would otherwise come back as a
      // generic 401 and look like an account problem.
      throw new XemasError(`API key does not look like a XemaS key (expected a ${KEY_PREFIX}... prefix)`);
    }
    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new XemasError("No fetch implementation available. Pass one via options.fetch.");
    }
  }

  // ── the seven stable products ─────────────────────────────────────────────────────────────
  /** Contract intelligence: what is this code, and what can it do? */
  contract<T = Record<string, unknown>>(address: string, o?: RequestOptions) { return this.product<T>("contract", address, o); }
  /** Identity intelligence: who is this on-chain actor? */
  entity<T = Record<string, unknown>>(address: string, o?: RequestOptions) { return this.product<T>("entity", address, o); }
  /** Behavioural intelligence: how does this address act over time? */
  behaviour<T = Record<string, unknown>>(address: string, o?: RequestOptions) { return this.product<T>("behaviour", address, o); }
  /** Counterparty intelligence: who does it transact with? */
  counterparties<T = Record<string, unknown>>(address: string, o?: RequestOptions) { return this.product<T>("counterparties", address, o); }
  /** Portfolio intelligence: what does it hold? */
  portfolio<T = Record<string, unknown>>(address: string, o?: RequestOptions) { return this.product<T>("portfolio", address, o); }
  /** Fund-flow intelligence: where did value come from and go? */
  fundFlow<T = Record<string, unknown>>(address: string, o?: RequestOptions) { return this.product<T>("fund-flow", address, o); }
  /** Whale intelligence: size, concentration and market impact. */
  whale<T = Record<string, unknown>>(address: string, o?: RequestOptions) { return this.product<T>("whale", address, o); }

  // ── auxiliary ─────────────────────────────────────────────────────────────────────────────
  /** Liveness check. Requires a valid key, and is not enveloped. */
  async health(o?: RequestOptions): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/health", undefined, o);
  }

  /** Identity changes over time. Auxiliary - not one of the seven products. */
  async entityHistory<T = Record<string, unknown>>(address: string, o?: RequestOptions): Promise<Envelope<T>> {
    return this.request<Envelope<T>>(`/entity/${encodeURIComponent(address)}/history`, o?.chainId ?? 1, o);
  }

  // ── transport ─────────────────────────────────────────────────────────────────────────────
  private async product<T>(name: string, address: string, o?: RequestOptions): Promise<Envelope<T>> {
    if (!address || typeof address !== "string") throw new XemasError("address must be a non-empty string");
    return this.request<Envelope<T>>(`/${name}/${encodeURIComponent(address)}`, o?.chainId ?? 1, o);
  }

  private async request<T>(path: string, chainId?: number, o?: RequestOptions): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (chainId !== undefined) url.searchParams.set("chain_id", String(chainId));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    // Honour a caller-supplied signal without discarding our own timeout.
    o?.signal?.addEventListener("abort", () => controller.abort(), { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          "User-Agent": `xemas-typescript/${VERSION}`,
        },
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      throw new TransportError(
        aborted ? `Request to ${url} timed out after ${this.timeoutMs}ms` : `Could not reach ${url}: ${String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    // Recorded even on failure: remaining quota is exactly what a caller needs after a 429.
    this.rateLimit = parseRateLimit(response.headers);
    const requestId = response.headers.get("X-Request-Id") ?? undefined;

    if (response.ok) {
      try {
        return (await response.json()) as T;
      } catch {
        throw new XemasError(`API returned non-JSON on ${response.status}`, requestId);
      }
    }

    let detail: unknown;
    try {
      const body = await response.json();
      detail = body && typeof body === "object" && "detail" in body ? (body as Record<string, unknown>).detail : body;
    } catch {
      detail = undefined;
    }

    const retryAfterRaw = response.headers.get("Retry-After");
    const retryAfter = retryAfterRaw !== null && !Number.isNaN(Number(retryAfterRaw)) ? Number(retryAfterRaw) : undefined;

    throw errorForStatus(response.status, detail, requestId, this.rateLimit, retryAfter);
  }
}

function parseRateLimit(headers: Headers): RateLimit {
  const num = (name: string): number | undefined => {
    const raw = headers.get(name);
    if (raw === null) return undefined;          // unsent header is not a zero
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  };
  return { limit: num("X-RateLimit-Limit"), remaining: num("X-RateLimit-Remaining"), reset: num("X-RateLimit-Reset") };
}
