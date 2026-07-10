# Maintenance — SUTS jurisdiction MCP server

Routine upkeep for the hosted Worker. Deployment facts + architecture are in
`HOSTING.md`.

## ⚠️ Golden rule: set/rotate secrets from Git Bash, never a PowerShell pipe

Windows PowerShell 5.1 re-encodes bytes when piping between native commands and
can inject an invisible **BOM (U+FEFF)** into the value. That happened once and
broke Entra sign-in (`AADSTS900023: … tenant identifier … is neither a valid DNS
name …` — the tenant id had a hidden leading character). Always set secrets from
**Git Bash** with `printf '%s'` (no trailing newline, no BOM, raw-byte pipe):

```bash
export PATH="/c/Program Files/nodejs:$PATH"
cd "/c/Users/Affinity Work/Documents/JurisdictionMCPRemote"
printf '%s' "THE_VALUE" | node node_modules/wrangler/bin/wrangler.js secret put SECRET_NAME
```

## Client secret renewal (expires ~2028-07-10 — 2-year term)

The Entra client secret expires. Before it does:

1. [Entra portal](https://entra.microsoft.com) → **App registrations → "Affinity
   SUTS Jurisdiction MCP" → Certificates & secrets → New client secret** → set an
   expiry → **copy the Value** (shown only once).
2. Update the Worker secret (bash `printf` method above):
   ```bash
   printf '%s' "NEW_SECRET_VALUE" | node node_modules/wrangler/bin/wrangler.js secret put AZURE_CLIENT_SECRET
   ```
3. Confirm sign-in still works, then **delete the old secret** in Entra.

No code redeploy needed — secret changes take effect immediately.

## Rotating other secrets

- **`SUTS_API_KEY`** (TTR): get a new key from TTR, then
  `printf '%s' "NEW_KEY" | node node_modules/wrangler/bin/wrangler.js secret put SUTS_API_KEY`.
  ⚠️ This key is **shared** with the local `refresh.py` (in the `JurisdictionMCP`
  repo `.env`) — update it there too if you still use the bulk-refresh script.
- **`COOKIE_ENCRYPTION_KEY`**: regenerate any time (only invalidates the
  "remember this client" approval cookie; users just re-approve once):
  ```bash
  printf '%s' "$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")" \
    | node node_modules/wrangler/bin/wrangler.js secret put COOKIE_ENCRYPTION_KEY
  ```

> Note: during setup the client secret and TTR key were pasted in a chat
> transcript. Not critical, but if you want to be tidy, rotate both using the
> steps above.

## Key facts (non-secret identifiers)

- Cloudflare: account `erin@affinity.cpa`, id `2a7fe78bef273c4c6c767f93722ec468`; `wrangler login` is this account.
- Worker `suts-jurisdiction` → `https://suts-jurisdiction.erin-2a7.workers.dev`
- KV `OAUTH_KV` id `a0650b36be51481380d0b59f35cb8763`
- Entra: client id `2c22b4c5-952c-44d8-859f-31ba7577f2b1`, tenant `04961937-1561-4a7c-b05e-9764e0357190`

## Deploy / dev / test

```bash
npx wrangler deploy          # deploy
npm run dev                  # local dev (needs secrets in .dev.vars, gitignored)
node scripts/check.mjs       # smoke-test both tools against local dev
npm test                     # unit tests (freshness, normalization, parsing)
npm run type-check           # tsc --noEmit
npx wrangler tail            # stream live production logs (best OAuth-flow debug tool)
```

## Access management

- **Grant:** anyone with an `@affinity.cpa` Entra account can sign in — no per-user
  setup. New hires work automatically; offboarding a Microsoft account revokes it.
- **Restrict to specific people:** add an allowlist check on `claims.email` in
  `src/entra-handler.ts` (in `/callback`, before `completeAuthorization`) and redeploy.

## Rate limiting

TTR burst-limits per key (returns HTTP 401, no `Retry-After`). A steady ~2 s
interval sustains (~30/min). Current mitigation is per-session pacing in
`src/index.ts`. If multiple people run large refreshes at once, add a global
Durable Object rate-limiter (see `CONTRACT.md`).
