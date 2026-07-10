/**
 * Microsoft Entra ID (Azure AD) upstream OAuth helpers.
 * Adapted from the Cloudflare github-oauth template's utils.ts — the difference
 * is Entra returns JSON from its token endpoint (GitHub returns form-encoded) and
 * we read identity from the OIDC id_token rather than a userinfo API call.
 */

/** Build the upstream (Entra) authorize URL. */
export function getUpstreamAuthorizeUrl({
  upstream_url,
  client_id,
  scope,
  redirect_uri,
  state,
}: {
  upstream_url: string;
  client_id: string;
  scope: string;
  redirect_uri: string;
  state?: string;
}): string {
  const upstream = new URL(upstream_url);
  upstream.searchParams.set("client_id", client_id);
  upstream.searchParams.set("redirect_uri", redirect_uri);
  upstream.searchParams.set("scope", scope);
  if (state) upstream.searchParams.set("state", state);
  upstream.searchParams.set("response_type", "code");
  return upstream.href;
}

export interface EntraTokens {
  accessToken: string;
  idToken: string;
}

export interface EntraClaims {
  email: string;
  name: string;
  tid: string; // tenant id
  sub: string; // subject (stable per-user id)
}

const authority = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;

export const OIDC_SCOPE = "openid profile email offline_access";

export function entraAuthorizeUrl(tenantId: string): string {
  return `${authority(tenantId)}/authorize`;
}

/** Exchange the authorization code at Entra's token endpoint. Returns tokens or an error Response. */
export async function exchangeEntraCode({
  tenantId,
  clientId,
  clientSecret,
  code,
  redirectUri,
}: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  code: string | undefined;
  redirectUri: string;
}): Promise<[EntraTokens, null] | [null, Response]> {
  if (!code) return [null, new Response("Missing code", { status: 400 })];

  const resp = await fetch(`${authority(tenantId)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: OIDC_SCOPE,
    }).toString(),
  });

  if (!resp.ok) {
    console.log("Entra token exchange failed:", await resp.text());
    return [null, new Response("Failed to exchange code for token", { status: 500 })];
  }

  const json = (await resp.json()) as { access_token?: string; id_token?: string };
  if (!json.id_token) return [null, new Response("Missing id_token from Entra", { status: 400 })];
  return [{ accessToken: json.access_token ?? "", idToken: json.id_token }, null];
}

/** Decode (not verify — the token came straight from Entra over TLS) the id_token claims. */
export function decodeIdToken(idToken: string): EntraClaims {
  const part = idToken.split(".")[1] ?? "";
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  const claims = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  return {
    email: String(claims.email ?? claims.preferred_username ?? ""),
    name: String(claims.name ?? ""),
    tid: String(claims.tid ?? ""),
    sub: String(claims.sub ?? ""),
  };
}
