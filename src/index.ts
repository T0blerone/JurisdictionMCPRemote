/**
 * SUTS jurisdiction MCP server — Cloudflare Workers (Agents SDK / McpAgent),
 * protected by Microsoft Entra OAuth via @cloudflare/workers-oauth-provider.
 *
 * Two tools, identical return shapes to the Python stdio server:
 *   - resolve_address        — address -> SUTS code + tax rates (live TTR lookup)
 *   - check_cache_freshness  — deterministic cache-expiry check (pure date math)
 *
 * The OAuthProvider wraps the MCP route (/mcp): unauthenticated calls are rejected;
 * the Entra sign-in flow lives in EntraHandler. Tool logic doesn't use the user's
 * identity — auth is purely a gate restricting access to the Affinity tenant.
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

import type { Env } from "./env";
import { EntraHandler, type Props } from "./entra-handler";
import { checkFreshness } from "./freshness";
import { resolveAddress } from "./ttr";

// TTR enforces a tight burst limiter (~30/min sustained at a 2s spacing). The
// McpAgent is a Durable Object, so this instance field paces a session's calls.
// NOTE: per-session only; a global cross-session limiter (a dedicated rate-limiter
// DO) is a pre-production hardening item — see CONTRACT.md.
const MIN_INTERVAL_MS = 2000;

export class SutsMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({ name: "suts-jurisdiction", version: "1.0.0" });
  private lastRequest = 0;

  private async pace(): Promise<void> {
    const wait = MIN_INTERVAL_MS - (Date.now() - this.lastRequest);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequest = Date.now();
  }

  async init(): Promise<void> {
    this.server.tool(
      "check_cache_freshness",
      {
        confirmed_date: z.string().describe("ISO date YYYY-MM-DD the code was confirmed"),
        as_of: z.string().optional().describe("ISO date to check against; defaults to today"),
      },
      async ({ confirmed_date, as_of }) => ({
        content: [{ type: "text", text: JSON.stringify(checkFreshness(confirmed_date, as_of)) }],
      }),
    );

    this.server.tool(
      "resolve_address",
      { address: z.string().describe("A Colorado ship-to street address") },
      async ({ address }) => {
        await this.pace();
        const result = await resolveAddress(address, this.env);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );
  }
}

export default new OAuthProvider({
  apiHandler: SutsMCP.serve("/mcp") as any,
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: EntraHandler as any,
  tokenEndpoint: "/token",
});
