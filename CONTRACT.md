# CONTRACT — behavior the Worker must implement

This repo is the **hosted (Cloudflare Workers, TypeScript) rewrite** of the SUTS
jurisdiction MCP server. The working Python/stdio original lives in the sibling
`JurisdictionMCP` repo. Port the behavior below **exactly** — keep the tool return
shapes identical so the `suts-filing` skill needs no changes when it switches to
the hosted URL. `reference-python/` holds the source-of-truth implementation;
`samples/` holds real TTR responses to use as test fixtures.

## Backend API (Transaction Tax Resources — "TTR", SUTS-provided)

- **Endpoint:** `POST {SUTS_API_BASE_URL}/automation.rates.list`
  (default base `https://api.ttr.services/v1`)
- **Headers:** `Content-Type: application/json`, `Accept: application/json`,
  `Authorization: Bearer ${SUTS_API_KEY}`
- **Body:** `{"address": "<string>"}` — **do NOT send `productServiceId`**
  (omitting it makes `totalSalesTax` the full combined rate for a taxable sale).
- **Success (200):**
  `{ address, jurisdictionCode: "01-0006", totalSalesTax: 0.0915,
     salesTax: [ { jurisdiction, type, value, answer, taxType } ] }`
  — one code per address; `salesTax[]` entries have no code.

## Tool: `resolve_address(address: string)`

Return (identical to the Python server):
```
{ status: "resolved" | "no_match" | "unavailable",
  code_dashed:   string | null,     // "01-0006"
  code_dashless: string | null,     // "10006"
  total_rate:    number | null,     // 0.0915
  rate_breakdown:[ { jurisdiction, type, rate } ],
  reason:        string | null,
  raw:           object | null }    // full upstream response
```
Status mapping (retry once on transient 401/429/5xx after a short delay, then):
- 200 **with** `jurisdictionCode` → `resolved` (map `salesTax[].value` → `rate`).
- 200 **without** `jurisdictionCode` → `no_match`.
- persistent **5xx** → `no_match` (TTR is Colorado-only; out-of-state/garbage 500s).
- **401 / 403 / 429** → `unavailable` (**401 is TTR's throttle signal**, usually
  not bad auth).
- other 4xx / network error → `unavailable`.

**Code normalization** (dashed → dashless): remove `-`, strip leading zeros.
`01-0006→10006`, `44-0060→440060`, `07-0003→70003`, `12-0044→120044`.

## Tool: `check_cache_freshness(confirmed_date, as_of?)`

Pure date math. ISO `YYYY-MM-DD`; `as_of` defaults to today.
Fresh **iff both**: `(as_of - confirmed).days <= 90` **and**
`confirmed >= last_reset(as_of)`.
`last_reset(d)` = most recent Jan 1 / Jul 1 on/before `d` (before Jul 1 → Jan 1 of
that year; otherwise Jul 1 of that year). Boundaries are a constant `[(1,1),(7,1)]`.
`expires_on(confirmed)` = earlier of `confirmed + 90d` and the next reset strictly
after `confirmed`. Return `{ fresh, reason, expires_on }`.

**Test vectors** (confirmed → as_of ⇒ fresh):
- `2025-11-15 → 2025-12-20` ⇒ **true**
- `2025-11-15 → 2026-01-05` ⇒ **false** (Jan 1 boundary passed)
- `2026-01-02 → 2026-05-01` ⇒ **false** (119 d > 90)
- `2026-01-02 → 2026-03-15` ⇒ **true**
- `2026-06-20 → 2026-07-02` ⇒ **false** (Jul 1 boundary passed)
- `2026-07-01 → 2026-08-01` ⇒ **true** (confirmed on the boundary counts)
- `expires_on(2025-11-15)` ⇒ `2026-01-01`
- `expires_on(2026-01-02)` ⇒ `2026-04-02`

## Rate limiting (must handle)

TTR enforces a **tight burst limiter, returned as HTTP 401**, with **no
`Retry-After` / `X-RateLimit-*` headers**. A steady **~2 s interval sustains
(~30/min)**; bursts trip it. The Python server paced in-process, which **won't
work on Workers** (no shared state across isolates). Implement a **Durable Object
rate-limiter** (one global limiter) so the shared TTR key isn't over-driven — one
big refresh must not throttle everyone's monthly runs.

## Live-verified fixtures (`samples/`)

- Denver `1629 York St, Denver, CO 80206` → `01-0006` / `10006` / total `0.0915`
- Vail `107 Rockledge Rd, Vail, CO 81657` → `44-0060` / `440060` / total `0.094`

## Config

- `SUTS_API_KEY` — secret (`wrangler secret put SUTS_API_KEY`)
- `SUTS_API_BASE_URL` — optional, default `https://api.ttr.services/v1`

See `HOSTING.md` for the full deployment roadmap and the OAuth (firm-email) auth plan.
