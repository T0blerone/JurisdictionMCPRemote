/**
 * Resolve a Colorado address to its SUTS jurisdiction code + rates via the
 * TTR Rate Automation API. Port of the Python `ttr_client.py`. See CONTRACT.md.
 *
 * status is a control signal for the skill:
 *   resolved    -> use code + rates
 *   no_match    -> address didn't resolve to a CO jurisdiction (persistent 5xx)
 *   unavailable -> auth/throttle/network/config problem; skill falls back to manual
 */

import type { Env } from "./env";

const BASE_URL_DEFAULT = "https://api.ttr.services/v1";
const RETRY_DELAY_MS = 3000;

export interface RateComponent {
  jurisdiction: string;
  type: string;
  rate: number;
}

export interface ResolveResult {
  status: "resolved" | "no_match" | "unavailable";
  code_dashed: string | null;
  code_dashless: string | null;
  total_rate: number | null;
  rate_breakdown: RateComponent[];
  reason: string | null;
  raw: unknown;
}

/** Dashed SUTS code -> dashless, leading-zeros-stripped. "01-0006" -> "10006". */
export function normalizeCode(dashed: string): string {
  return dashed.replace(/-/g, "").replace(/^0+/, "");
}

function make(
  status: ResolveResult["status"],
  opts: Partial<ResolveResult> = {},
): ResolveResult {
  return {
    status,
    code_dashed: opts.code_dashed ?? null,
    code_dashless: opts.code_dashless ?? null,
    total_rate: opts.total_rate ?? null,
    rate_breakdown: opts.rate_breakdown ?? [],
    reason: opts.reason ?? null,
    raw: opts.raw ?? null,
  };
}

/** Build the normalized result from a 200 body. No code -> no_match. */
export function parseSuccess(body: any): ResolveResult {
  const code: string | undefined = body?.jurisdictionCode;
  if (!code) return make("no_match", { reason: "200 but no jurisdictionCode", raw: body });
  const rate_breakdown: RateComponent[] = (body.salesTax ?? []).map((e: any) => ({
    jurisdiction: e.jurisdiction,
    type: e.type,
    rate: e.value,
  }));
  return make("resolved", {
    code_dashed: code,
    code_dashless: normalizeCode(code),
    total_rate: body.totalSalesTax ?? null,
    rate_breakdown,
    raw: body,
  });
}

function isTransient(status: number): boolean {
  // 401 is TTR's throttle signal; 429 and 5xx are the usual transients.
  return status === 401 || status === 429 || status >= 500;
}

function classifyError(status: number, body: unknown): ResolveResult {
  if (status >= 500) {
    return make("no_match", {
      reason: `upstream HTTP ${status} - unresolvable address (or outage)`,
      raw: body,
    });
  }
  if (status === 401 || status === 403 || status === 429) {
    return make("unavailable", { reason: `auth/throttle (HTTP ${status})`, raw: body });
  }
  return make("unavailable", { reason: `HTTP ${status}`, raw: body });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bodyOf(resp: Response): Promise<unknown> {
  const text = await resp.text().catch(() => "");
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 500) };
  }
}

/**
 * Resolve one address. One retry on transient failure, then degrade to a clear
 * status. Never throws for network/HTTP problems. Pacing is handled by the
 * caller (the McpAgent), since it needs cross-call state.
 */
export async function resolveAddress(address: string, env: Env): Promise<ResolveResult> {
  const key = env.SUTS_API_KEY;
  if (!key) return make("unavailable", { reason: "SUTS_API_KEY not set" });
  const base = (env.SUTS_API_BASE_URL || BASE_URL_DEFAULT).replace(/\/+$/, "");
  const url = `${base}/automation.rates.list`;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${key}`,
  };
  const payload = JSON.stringify({ address }); // productServiceId omitted -> full combined rate

  let last: ResolveResult | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(RETRY_DELAY_MS);
    let resp: Response;
    try {
      resp = await fetch(url, { method: "POST", headers, body: payload });
    } catch (e) {
      last = make("unavailable", { reason: `request error: ${(e as Error).name}` });
      continue;
    }
    if (resp.status === 200) return parseSuccess(await bodyOf(resp));
    last = classifyError(resp.status, await bodyOf(resp));
    if (!isTransient(resp.status)) return last;
  }
  return last!;
}
