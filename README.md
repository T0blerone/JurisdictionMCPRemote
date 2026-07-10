# JurisdictionMCPRemote

Hosted (Cloudflare Workers, TypeScript) rewrite of the SUTS jurisdiction MCP
server — so firm users connect over a URL with **zero local install** (Claude
Desktop native custom connector) instead of running Python locally.

**Status:** Phase A complete — Worker built and validated locally. 12/12 unit
tests pass, `tsc --noEmit` clean, and it serves MCP over HTTP via `wrangler dev`
(`resolve_address` returned Denver `10006` / `0.0915`; `check_cache_freshness`
correct). **Next: Phase B** — Microsoft Entra OAuth + deploy (see `HOSTING.md`).
The working local original is the sibling `JurisdictionMCP` repo — leave it
running until this is deployed and trusted.

Run locally: `npm install` → `npm test` → put `SUTS_API_KEY=...` in `.dev.vars`
→ `npm run dev` → drive with `node scripts/check.mjs` or the MCP Inspector.

## What's here now (seed / reference)

| Path | Purpose |
|------|---------|
| `CONTRACT.md` | **The spec to implement** — tool return shapes, TTR API, freshness rule + test vectors, rate-limit behavior. Build against this. |
| `HOSTING.md` | Full deployment roadmap + OAuth (firm-email) auth plan. |
| `samples/` | Real TTR responses — use as TS test fixtures. |
| `reference-python/` | The source-of-truth Python implementation being ported (`freshness.py`, `ttr_client.py`, tests). Not part of the Worker; reference only. |

## Next steps

See `HOSTING.md`. In short: install Node + wrangler, scaffold the McpAgent
(OAuth template), port the two tools per `CONTRACT.md`, add a Durable Object
rate-limiter, test with MCP Inspector, deploy, restrict auth to `@affinity.cpa`,
connect via Claude's native connector.
