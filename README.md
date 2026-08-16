# xemas-typescript

Official TypeScript/JavaScript SDK for the [XemaS](https://xemas.io) on-chain intelligence API.

```bash
npm install @xemas-security/sdk
```

```ts
import { Xemas } from "@xemas-security/sdk";

const client = new Xemas({ apiKey: "sk-xemas-..." });   // or set XEMAS_API_KEY

const result = await client.entity("0x1f9840a85d5aF5bf1D1762F925BdADdC4201F984", { chainId: 1 });

result.data;                 // the product payload
result.evidence.coverage;    // what was actually assessed
result.evidence.confidence;  // how strongly
result.meta.model;           // which semantic model produced it
```

## Seven products, one shape

| Method | Question it answers |
|---|---|
| `client.contract(address)` | What is this code, and what can it do? |
| `client.entity(address)` | Who is this on-chain actor? |
| `client.behaviour(address)` | How does it act over time? |
| `client.counterparties(address)` | Who does it transact with? |
| `client.portfolio(address)` | What does it hold? |
| `client.fundFlow(address)` | Where did value come from and go? |
| `client.whale(address)` | Size, concentration, market impact |

All take `{ chainId }` (default `1`) and return the same `Envelope<T>`.

## Read the evidence, not just the data

Every response carries `evidence` describing **what the platform could and could not establish**:

```ts
const r = await client.contract(address);

if (r.evidence.observed_at === null) {
  // nothing reported an observation time - not "observed now"
}
```

This is the point of the API. `data` tells you what was found; `evidence` tells you what that
finding is worth. Two properties the SDK preserves rather than smooths over:

- **Absent is not null.** When the API omits a key (`governance_metadata`, for instance) it means
  *not produced* - it does not assert an empty value. It is typed `?:`, not `| null`, so presence
  stays checkable with `in`.
- **An unsent header is not a zero.** `client.rateLimit` fields stay `undefined` when the API did
  not send them, rather than reading as "0 remaining".

## Errors

```ts
import { AuthenticationError, RateLimitError, ServerError, TransportError } from "@xemas-security/sdk";

try {
  await client.entity(address);
} catch (e) {
  if (e instanceof RateLimitError) e.retryAfter;      // seconds, when sent
  if (e instanceof AuthenticationError) e.requestId;  // quote to support
  if (e instanceof TransportError) { /* never reached the API - NOT a finding */ }
}
```

`TransportError` is deliberately separate: nothing was evaluated, so it must not be read as
evidence about the address you asked about.

**The SDK does not retry.** A retry spends your quota and latency budget, so that stays your call.

## Configuration

```ts
new Xemas({
  apiKey: "sk-xemas-...",              // or XEMAS_API_KEY
  baseUrl: "https://api.xemas.io/v1",  // override for testing
  timeoutMs: 30_000,
  fetch: customFetch,                  // injectable
});
```

Requires Node 18+ (or any runtime with global `fetch`).

## How this SDK stays in step with the API

`openapi/v1.json` is exported from the API's **mounted routes** - not transcribed from
documentation - and pins the request surface this release was built against. Paths, methods and
parameters come from there; the response envelope is hand-written, because the API currently
declares no response schemas and generating from an empty schema would produce untyped results.

- Docs: <https://xemas.io/api>
- Keys: <https://xemas.io/developer/api-keys>

## Licence

[Apache License 2.0](LICENSE). Permissive and business-friendly, with an explicit patent grant, so
this client can be embedded in proprietary products without constraining them. The XemaS platform
itself is licensed separately - a client library and a platform warrant different terms.
