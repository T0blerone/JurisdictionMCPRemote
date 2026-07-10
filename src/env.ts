export interface Env {
  /** TTR / SUTS Rate Automation API key (Bearer). Set as a Worker secret. */
  SUTS_API_KEY: string;
  /** Optional override; defaults to https://api.ttr.services/v1 */
  SUTS_API_BASE_URL?: string;

  /** Durable Object namespace for the McpAgent (one instance per session). */
  MCP_OBJECT: DurableObjectNamespace;

  /** KV namespace used by workers-oauth-provider for grants/state/clients. */
  OAUTH_KV: KVNamespace;

  // --- Microsoft Entra (Azure AD) OAuth — set as Worker secrets ---
  AZURE_CLIENT_ID: string;
  AZURE_CLIENT_SECRET: string;
  AZURE_TENANT_ID: string;
  /** Secret used to sign the approved-clients cookie. */
  COOKIE_ENCRYPTION_KEY: string;
}
