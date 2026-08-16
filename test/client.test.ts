import { describe, expect, it } from "vitest";
import {
  AuthenticationError, RateLimitError, ServerError, TransportError, Xemas, XemasError,
} from "../src/index.js";

const ADDR = "0x1f9840a85d5aF5bf1D1762F925BdADdC4201F984";

const ENVELOPE = {
  data: { identity_state: "attributed", name: "Uniswap" },
  evidence: {
    coverage: { sources_checked: 3 },
    confidence: { attribution: "high" },
    provenance: [{ provider: "on-chain", category: "identity" }],
    observed_at: "2026-08-16T00:00:00+00:00",
  },
  meta: { model: "EntityProfile", version: "v1", generated_at: "2026-08-16T00:00:01+00:00" },
};

function client(handler: (url: string, init: RequestInit) => Response, opts = {}) {
  const fetchImpl = (async (u: any, i: any) => handler(String(u), i)) as unknown as typeof fetch;
  return new Xemas({ apiKey: "sk-xemas-test", fetch: fetchImpl, ...opts });
}
const ok = (body: unknown = ENVELOPE, headers: Record<string, string> = {}) =>
  () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...headers } });
const status = (code: number, headers: Record<string, string> = {}, body: unknown = { detail: "nope" }) =>
  () => new Response(JSON.stringify(body), { status: code, headers: { "Content-Type": "application/json", ...headers } });

describe("construction", () => {
  it("requires a key", () => {
    const prev = process.env.XEMAS_API_KEY; delete process.env.XEMAS_API_KEY;
    expect(() => new Xemas()).toThrow(/No API key/);
    if (prev) process.env.XEMAS_API_KEY = prev;
  });
  it("rejects a key with the wrong prefix", () => {
    // Caught locally rather than sent: a wrong-service key would otherwise return a generic 401
    // and look like an account problem.
    expect(() => new Xemas({ apiKey: "sk-live-other" })).toThrow(/does not look like a XemaS key/);
  });
  it("allows overriding the base URL for testing", () => {
    expect(client(ok(), { baseUrl: "http://localhost:8000/v1" }).baseUrl).toBe("http://localhost:8000/v1");
  });
});

describe("the seven products", () => {
  const PRODUCTS = ["contract", "entity", "behaviour", "counterparties", "portfolio", "fundFlow", "whale"] as const;

  it.each(PRODUCTS)("%s calls its own path with auth and chain_id", async (product) => {
    let seenUrl = ""; let seenAuth = "";
    const c = client((url, init) => {
      seenUrl = url; seenAuth = (init.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify(ENVELOPE), { status: 200 });
    });
    await (c as any)[product](ADDR, { chainId: 137 });
    const expected = product === "fundFlow" ? "fund-flow" : product;
    expect(seenUrl).toContain(`/v1/${expected}/${ADDR}`);
    expect(seenUrl).toContain("chain_id=137");
    expect(seenAuth).toBe("Bearer sk-xemas-test");
  });

  it("exposes all seven", () => {
    const c = client(ok());
    for (const p of PRODUCTS) expect(typeof (c as any)[p]).toBe("function");
  });

  it("defaults chain_id to 1", async () => {
    let seen = "";
    await client((url) => { seen = url; return new Response(JSON.stringify(ENVELOPE), { status: 200 }); }).entity(ADDR);
    expect(seen).toContain("chain_id=1");
  });
});

describe("envelope semantics", () => {
  it("returns typed envelope fields", async () => {
    const r = await client(ok()).entity(ADDR);
    expect(r.data.identity_state).toBe("attributed");
    expect(r.evidence.coverage.sources_checked).toBe(3);
    expect(r.meta.model).toBe("EntityProfile");
  });

  it("keeps absent governance_metadata absent", async () => {
    // The API OMITS this key rather than sending null when there is nothing to report. Absent
    // means "not produced"; null would assert an empty value. The SDK must not invent one.
    const r = await client(ok()).entity(ADDR);
    expect("governance_metadata" in r).toBe(false);
    expect(r.governance_metadata).toBeUndefined();
  });

  it("preserves governance_metadata when present", async () => {
    const r = await client(ok({ ...ENVELOPE, governance_metadata: { reviewed: true } })).entity(ADDR);
    expect(r.governance_metadata).toEqual({ reviewed: true });
  });

  it("does not discard unknown future keys", async () => {
    const body = { ...ENVELOPE, data: { ...ENVELOPE.data, brand_new_field: 42 } };
    const r = await client(ok(body)).entity(ADDR);
    expect((r.data as any).brand_new_field).toBe(42);
  });

  it("preserves a null observed_at", async () => {
    const body = { ...ENVELOPE, evidence: { ...ENVELOPE.evidence, observed_at: null } };
    expect((await client(ok(body)).entity(ADDR)).evidence.observed_at).toBeNull();
  });
});

describe("errors", () => {
  it("401 raises AuthenticationError carrying the request id", async () => {
    await expect(client(status(401, { "X-Request-Id": "req-1" })).entity(ADDR))
      .rejects.toMatchObject({ name: "AuthenticationError", status: 401, requestId: "req-1" });
  });

  it("429 carries retryAfter and rate limit", async () => {
    await expect(
      client(status(429, { "Retry-After": "60", "X-RateLimit-Limit": "80", "X-RateLimit-Remaining": "0" })).entity(ADDR),
    ).rejects.toMatchObject({ name: "RateLimitError", retryAfter: 60 });
  });

  it("5xx raises ServerError", async () => {
    await expect(client(status(503)).entity(ADDR)).rejects.toBeInstanceOf(ServerError);
  });

  it("transport failure is distinct from an API error", async () => {
    // Nothing was evaluated, so this must not be mistaken for a finding about the address.
    const c = client(() => { throw new Error("no route to host"); });
    await expect(c.entity(ADDR)).rejects.toBeInstanceOf(TransportError);
  });

  it("does not retry silently", async () => {
    // A retry spends the caller's quota and latency budget, so it stays their decision.
    let calls = 0;
    const c = client(() => { calls++; return new Response(JSON.stringify({ detail: "boom" }), { status: 500 }); });
    await expect(c.entity(ADDR)).rejects.toBeInstanceOf(ServerError);
    expect(calls).toBe(1);
  });
});

describe("rate-limit metadata", () => {
  it("exposes headers after a call", async () => {
    const c = client(ok(ENVELOPE, { "X-RateLimit-Limit": "80", "X-RateLimit-Remaining": "78" }));
    await c.entity(ADDR);
    expect(c.rateLimit).toMatchObject({ limit: 80, remaining: 78 });
  });

  it("leaves missing headers undefined rather than zero", async () => {
    // An unsent header is not a measurement of zero remaining quota.
    const c = client(ok());
    await c.entity(ADDR);
    expect(c.rateLimit?.limit).toBeUndefined();
    expect(c.rateLimit?.remaining).toBeUndefined();
  });
});
