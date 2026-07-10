# Hosting plan — SUTS jurisdiction MCP server on Cloudflare Workers

Status: **planned, not started.** Goal: host the resolver once so firm users don't
each need Python + this repo + a key. Fits the Cloudflare **free tier**.

## Why / fit

- Free tier is ample: 100,000 requests/day, 10 ms CPU/request (CPU excludes time
  waiting on the TTR `fetch`), Durable Objects on the free plan (SQLite backend).
  Our volume is dozens/month + a few hundred at Jan 1 / Jul 1 refreshes.
- Cloudflare's first-class MCP path is the **Agents SDK `McpAgent`** (Streamable
  HTTP transport, one Durable Object per session) — **TypeScript**. Our server is
  Python (FastMCP + httpx), so this is a **rewrite to TS**. Logic is small (two
  tools), so it's a few hours. Python Workers (Pyodide beta) can't run the Python
  `mcp` SDK / httpx — don't go there.

## Decisions locked

- **Auth intent: restrict to firm email domain** (`@affinity.cpa`).
  **Mechanism (corrected): OAuth on the MCP server** via Cloudflare
  `workers-oauth-provider`, delegating to a firm IdP (Google Workspace / Microsoft
  Entra), because Claude's native connector authenticates via an **OAuth sign-in
  from Anthropic's cloud** — not from the user's device — so a network-level
  Cloudflare Access gate / IP allowlist does NOT fit. (Cloudflare Access can still
  serve as the OIDC identity source if preferred.) A custom domain is optional
  (nice for a stable URL), not required for auth.
- Keep the tool **return shapes identical** to the Python server so the skill and
  `refresh.py` need no changes to how they read results.

## Open items to resolve during build

1. **Access ↔ MCP-client auth handshake.** How a programmatic client authenticates
   through Access — service token (machine) vs. browser SSO. Validate against
   current docs before committing.
2. **Shared key ⇒ firm-wide rate limit.** One TTR key for everyone means TTR's
   per-key burst limit is now shared. The Python server's in-process 2 s pacing
   won't carry over (no persistent module state across isolates) — implement a
   **Durable Object rate-limiter** (or Cloudflare Rate Limiting) so one big
   `refresh.py` run can't throttle everyone's monthly runs.
3. **End-user connection — SOLVED, zero install.** Claude Desktop's **native
   custom connectors** for remote MCP are available on **all plans incl. Free**
   (beta): the user pastes the URL in Settings → Connectors and signs in. Claude
   connects from **Anthropic's cloud**, not the device — so end users need NO Node,
   no config file, no bridge. `mcp-remote` (which needs Node) is only the legacy
   fallback for stdio-only clients; not needed here. Only the developer needs Node
   (build/deploy).

## Roadmap

**Phase 0 — accounts & prereqs**
- Create a Cloudflare account (free).
- Install Node LTS locally; `npm i -g wrangler`; `wrangler login`.
- (Optional) a custom domain for a stable URL; not required for auth.

**Phase 1 — build (TS rewrite)**
- Scaffold with OAuth (matches Claude's native connector sign-in):
  `npm create cloudflare@latest -- suts-jurisdiction --template=cloudflare/ai/demos/remote-mcp-github-oauth`
  (or start authless and add `workers-oauth-provider` delegating to a firm IdP —
  Google Workspace / Microsoft Entra — to enforce `@affinity.cpa`).
- Port `check_cache_freshness` (pure date math from `freshness.py`).
- Port `resolve_address` (POST to TTR `automation.rates.list`, Bearer auth, no
  `productServiceId`; normalize dashed→dashless; retry once; same return shape).
- Add a Durable Object rate-limiter for the shared TTR key.
- `npx wrangler secret put SUTS_API_KEY` (+ OAuth/IdP secrets).

**Phase 2 — test locally**
- `npm start` (→ `http://localhost:8788/mcp`), drive with
  `npx @modelcontextprotocol/inspector@latest`. Verify Denver=`10006`/0.0915,
  Vail=`440060`/0.094, and the freshness cases.

**Phase 3 — deploy**
- `npx wrangler deploy` (→ `https://suts-jurisdiction.<account>.workers.dev/mcp`).
- Optionally map a custom domain for a nicer URL.

**Phase 4 — auth (OAuth, firm-email restricted)**
- Configure the OAuth provider to accept only `@affinity.cpa` identities (via the
  delegated IdP's domain restriction). Confirm the sign-in flow completes from
  Claude's connector setup.

**Phase 5 — connect Claude & migrate**
- Each user: Settings → Connectors → add the URL → sign in. Zero local install.
- Point `refresh.py` at the hosted URL (or keep its own key path).
- Retire per-machine local `server.py` + `.env` once the hosted server is trusted.

## Reference

Cloudflare guide: https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/
Workers pricing/limits: https://developers.cloudflare.com/workers/platform/pricing/ ,
https://developers.cloudflare.com/workers/platform/limits/
