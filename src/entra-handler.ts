/**
 * Microsoft Entra ID OAuth handler for the MCP server.
 * Adapted from the Cloudflare github-oauth template's github-handler.ts:
 * serves /authorize (consent), redirects to Entra, and handles /callback —
 * exchanging the code, reading identity from the id_token, enforcing the tenant,
 * and issuing our own MCP token via the OAuth provider.
 */

import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";

import type { Env } from "./env";
import {
  decodeIdToken,
  entraAuthorizeUrl,
  exchangeEntraCode,
  getUpstreamAuthorizeUrl,
  OIDC_SCOPE,
} from "./oauth-upstream";
import {
  addApprovedClient,
  bindStateToSession,
  createOAuthState,
  generateCSRFProtection,
  isClientApproved,
  OAuthError,
  renderApprovalDialog,
  validateCSRFToken,
  validateOAuthState,
} from "./workers-oauth-utils";

/** Identity captured during auth, encrypted into the MCP token and exposed as `this.props`. */
export type Props = {
  email: string;
  name: string;
  tid: string;
  sub: string;
};

type Bindings = Env & { OAUTH_PROVIDER: OAuthHelpers };

const app = new Hono<{ Bindings: Bindings }>();

function redirectToEntra(
  request: Request,
  env: Env,
  stateToken: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        client_id: env.AZURE_CLIENT_ID,
        redirect_uri: new URL("/callback", request.url).href,
        scope: OIDC_SCOPE,
        state: stateToken,
        upstream_url: entraAuthorizeUrl(env.AZURE_TENANT_ID),
      }),
    },
  });
}

app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const { clientId } = oauthReqInfo;
  if (!clientId) return c.text("Invalid request", 400);

  if (await isClientApproved(c.req.raw, clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
    const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie } = await bindStateToSession(stateToken);
    return redirectToEntra(c.req.raw, c.env, stateToken, { "Set-Cookie": setCookie });
  }

  const { token: csrfToken, setCookie } = generateCSRFProtection();
  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    csrfToken,
    server: {
      description: "Affinity CPA — Colorado SUTS jurisdiction lookup. Sign in with your Affinity Microsoft account.",
      name: "Affinity SUTS Jurisdiction",
    },
    setCookie,
    state: { oauthReqInfo },
  });
});

app.post("/authorize", async (c) => {
  try {
    const formData = await c.req.raw.formData();
    validateCSRFToken(formData, c.req.raw);

    const encodedState = formData.get("state");
    if (!encodedState || typeof encodedState !== "string") {
      return c.text("Missing state in form data", 400);
    }
    let state: { oauthReqInfo?: AuthRequest };
    try {
      state = JSON.parse(atob(encodedState));
    } catch {
      return c.text("Invalid state data", 400);
    }
    if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
      return c.text("Invalid request", 400);
    }

    const approvedClientCookie = await addApprovedClient(
      c.req.raw,
      state.oauthReqInfo.clientId,
      c.env.COOKIE_ENCRYPTION_KEY,
    );
    const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

    const headers = new Headers();
    headers.append("Set-Cookie", approvedClientCookie);
    headers.append("Set-Cookie", sessionBindingCookie);
    return redirectToEntra(c.req.raw, c.env, stateToken, Object.fromEntries(headers));
  } catch (error: any) {
    console.error("POST /authorize error:", error);
    if (error instanceof OAuthError) return error.toResponse();
    return c.text(`Internal server error: ${error.message}`, 500);
  }
});

app.get("/callback", async (c) => {
  let oauthReqInfo: AuthRequest;
  let clearSessionCookie: string;
  try {
    const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
    oauthReqInfo = result.oauthReqInfo;
    clearSessionCookie = result.clearCookie;
  } catch (error: any) {
    if (error instanceof OAuthError) return error.toResponse();
    return c.text("Internal server error", 500);
  }
  if (!oauthReqInfo.clientId) return c.text("Invalid OAuth request data", 400);

  const [tokens, errResponse] = await exchangeEntraCode({
    clientId: c.env.AZURE_CLIENT_ID,
    clientSecret: c.env.AZURE_CLIENT_SECRET,
    code: c.req.query("code"),
    redirectUri: new URL("/callback", c.req.url).href,
    tenantId: c.env.AZURE_TENANT_ID,
  });
  if (errResponse) return errResponse;

  const claims = decodeIdToken(tokens.idToken);

  // Belt-and-suspenders: we already use the tenant-specific endpoint, but confirm
  // the token really came from our tenant before issuing access.
  if (claims.tid !== c.env.AZURE_TENANT_ID) {
    return c.text("Sign-in must use an Affinity (@affinity.cpa) account.", 403);
  }

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    metadata: { label: claims.name || claims.email },
    props: {
      email: claims.email,
      name: claims.name,
      sub: claims.sub,
      tid: claims.tid,
    } as Props,
    request: oauthReqInfo,
    scope: oauthReqInfo.scope,
    userId: claims.sub || claims.email,
  });

  const headers = new Headers({ Location: redirectTo });
  if (clearSessionCookie) headers.set("Set-Cookie", clearSessionCookie);
  return new Response(null, { status: 302, headers });
});

export { app as EntraHandler };
