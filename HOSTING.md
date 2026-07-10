# Hosting — SUTS jurisdiction MCP server (Cloudflare Workers)

**Status: DEPLOYED and live.** This repo is the hosted rewrite of the SUTS
jurisdiction MCP server. Claude Desktop connects to it as a native remote
connector (zero local install); Microsoft Entra SSO restricts access to
`@affinity.cpa`. It replaces the local Python stdio server in the sibling
`JurisdictionMCP` repo (now legacy/reference).

For routine upkeep (secret renewal, rotation, the Windows gotcha), see
`MAINTENANCE.md`. For the exact tool behavior/spec, see `CONTRACT.md`.

## Live deployment

| | |
|---|---|
| Worker URL | `https://suts-jurisdiction.erin-2a7.workers.dev` |
| MCP endpoint (connector URL) | `https://suts-jurisdiction.erin-2a7.workers.dev/mcp` |
| OAuth callback | `https://suts-jurisdiction.erin-2a7.workers.dev/callback` |
| Cloudflare account | erin@affinity.cpa · account id `2a7fe78bef273c4c6c767f93722ec468` · Workers **free** plan |
| KV namespace | `OAUTH_KV` · id `a0650b36be51481380d0b59f35cb8763` (used by the OAuth provider) |

## Auth — Microsoft Entra, direct OAuth

`@cloudflare/workers-oauth-provider` makes the Worker an OAuth 2.1 server to
Claude, and federates upstream to Microsoft Entra (single-tenant), so only
Affinity accounts can sign in.

- **Entra app registration:** "Affinity SUTS Jurisdiction MCP"
  - client id `2c22b4c5-952c-44d8-859f-31ba7577f2b1`
  - tenant id `04961937-1561-4a7c-b05e-9764e0357190` (single-tenant = `@affinity.cpa` only)
  - redirect URI `https://suts-jurisdiction.erin-2a7.workers.dev/callback`
- **Tenant enforcement:** tenant-specific Entra endpoint **and** a `tid`-claim check in `src/entra-handler.ts`.
- **Secrets (Cloudflare, encrypted — not in this repo):** `AZURE_CLIENT_ID`,
  `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`, `SUTS_API_KEY`.

## Code map

| File | Role |
|---|---|
| `src/index.ts` | `OAuthProvider` wrapping the `McpAgent` (`SutsMCP`) at `/mcp`; registers the two tools + per-session pacing |
| `src/entra-handler.ts` | `/authorize` consent → redirect to Entra → `/callback` (code exchange, tenant check, issue token) |
| `src/oauth-upstream.ts` | Entra authorize/token URLs + `id_token` decode |
| `src/workers-oauth-utils.ts` | Cloudflare's consent/CSRF/state helpers (verbatim) |
| `src/freshness.ts`, `src/ttr.ts` | The two tools' logic (ported from Python; pinned by `CONTRACT.md` + `src/*.test.ts`) |

## Free tier

Fits comfortably: 100k requests/day, 10 ms CPU/request (CPU excludes the TTR
`fetch` wait), Durable Objects on the free plan. Our volume is dozens/month plus
a few hundred at the Jan 1 / Jul 1 refreshes.

## Redeploy

```
npm install
npx wrangler deploy
```
(If `node`/`wrangler` aren't on PATH, prepend `C:\Program Files\nodejs`. See
`MAINTENANCE.md` for the secret-setting gotcha — always set secrets from bash.)

## Connect a user (Claude Desktop)

Settings → **Connectors → Add custom connector** → URL
`https://suts-jurisdiction.erin-2a7.workers.dev/mcp` → **Approve** → sign in with
the `@affinity.cpa` Microsoft account. No Node, no config file, no local server.

## Known follow-ups

- **Rate limiting:** currently per-session 2 s pacing in the McpAgent. The TTR key
  is shared across all users (and the local `refresh.py`), so if concurrent usage
  grows, add a global Durable Object rate-limiter — see `CONTRACT.md`.
- The Entra-upstream Claude bug ([#122](https://github.com/anthropics/claude-ai-mcp/issues/122))
  did **not** materialize here; the flow works.
