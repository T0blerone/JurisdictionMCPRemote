"""Resolve a Colorado address to its SUTS jurisdiction code and tax rates.

Thin client over the SUTS/TTR Rate Automation API
(POST {base}/automation.rates.list, Bearer auth). The connector's only job is to
answer "what code and rate for this address" and degrade gracefully; address
quality judgment lives in the skill, not here.

Observed live behavior (see samples/):
  - 200 with a single top-level `jurisdictionCode` (dashed, e.g. "01-0006") plus
    a `salesTax[]` breakdown of component rates. `totalSalesTax` is the full
    combined rate when no productServiceId is sent.
  - 401 is BURST-THROTTLING, not (usually) bad auth — recovers on a spaced retry.
  - Unresolvable / out-of-state addresses return HTTP 500 (Colorado-only API).

status is a control signal for the skill:
  resolved    -> use code + rates
  no_match    -> address didn't resolve to a CO jurisdiction (persistent 500)
  unavailable -> auth/throttle/network/config problem; skill falls back to manual
"""

from __future__ import annotations

import os
import time

import httpx

BASE_URL_DEFAULT = "https://api.ttr.services/v1"
TIMEOUT_DEFAULT = 20.0
RETRY_DELAY_DEFAULT = 3.0  # seconds; a spaced retry clears TTR's burst throttle

# TTR enforces a tight burst limiter (returned as 401, no Retry-After header).
# Calibration showed a steady 2s interval sustains indefinitely (~30/min). The
# server process is long-lived, so we pace requests in-process: never fire two
# calls closer together than this. Override with SUTS_MIN_INTERVAL (seconds).
MIN_INTERVAL_DEFAULT = float(os.environ.get("SUTS_MIN_INTERVAL", "2.0"))
_last_request = [0.0]  # monotonic timestamp of the last outbound call


def _pace(min_interval: float) -> None:
    if min_interval <= 0:
        return
    wait = min_interval - (time.monotonic() - _last_request[0])
    if wait > 0:
        time.sleep(wait)
    _last_request[0] = time.monotonic()


def normalize_code(dashed: str) -> str:
    """Dashed SUTS code -> the dashless, leading-zeros-stripped form the skill
    matches on. '01-0006' -> '010006' -> '10006'; '44-0060' -> '440060'."""
    return dashed.replace("-", "").lstrip("0")


def _result(status, *, reason=None, code=None, total=None, breakdown=None, raw=None):
    return {
        "status": status,
        "code_dashed": code,
        "code_dashless": normalize_code(code) if code else None,
        "total_rate": total,
        "rate_breakdown": breakdown or [],
        "reason": reason,
        "raw": raw,
    }


def _parse_success(body: dict) -> dict:
    """Turn a 200 body into the normalized result. No code -> no_match."""
    code = body.get("jurisdictionCode")
    if not code:
        return _result("no_match", reason="200 but no jurisdictionCode", raw=body)
    breakdown = [
        {
            "jurisdiction": e.get("jurisdiction"),
            "type": e.get("type"),
            "rate": e.get("value"),
        }
        for e in body.get("salesTax", [])
    ]
    return _result(
        "resolved",
        code=code,
        total=body.get("totalSalesTax"),
        breakdown=breakdown,
        raw=body,
    )


def _body_of(r: httpx.Response):
    try:
        return r.json()
    except ValueError:
        return {"text": r.text[:500]}


def _classify_error(r: httpx.Response) -> dict:
    """Map a non-200 response to a result. 5xx -> no_match (unresolvable, per
    design); auth/throttle/other -> unavailable."""
    code = r.status_code
    body = _body_of(r)
    if code >= 500:
        return _result(
            "no_match",
            reason=f"upstream HTTP {code} - unresolvable address (or outage)",
            raw=body,
        )
    if code in (401, 403, 429):
        return _result("unavailable", reason=f"auth/throttle (HTTP {code})", raw=body)
    return _result("unavailable", reason=f"HTTP {code}", raw=body)


def _is_transient(status_code: int) -> bool:
    # 401 is TTR's throttle signal; 429 and 5xx are the usual transients.
    return status_code in (401, 429) or status_code >= 500


def resolve(
    address: str,
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    timeout: float | None = None,
    retry_delay: float = RETRY_DELAY_DEFAULT,
    min_interval: float = MIN_INTERVAL_DEFAULT,
    transport: httpx.BaseTransport | None = None,
) -> dict:
    """Resolve one address. One retry on transient failure, then degrade to a
    clear status the skill can act on. Never raises for network/HTTP problems."""
    api_key = api_key or os.environ.get("SUTS_API_KEY")
    if not api_key:
        return _result("unavailable", reason="SUTS_API_KEY not set")
    base = (base_url or os.environ.get("SUTS_API_BASE_URL") or BASE_URL_DEFAULT).rstrip("/")

    url = f"{base}/automation.rates.list"
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    payload = {"address": address}  # productServiceId omitted -> full combined rate

    last: dict | None = None
    with httpx.Client(timeout=timeout or TIMEOUT_DEFAULT, transport=transport) as client:
        for attempt in range(2):
            if attempt:
                time.sleep(retry_delay)
            _pace(min_interval)
            try:
                r = client.post(url, headers=headers, json=payload)
            except httpx.RequestError as e:
                last = _result("unavailable", reason=f"request error: {type(e).__name__}")
                continue
            if r.status_code == 200:
                return _parse_success(_body_of(r))
            last = _classify_error(r)
            if not _is_transient(r.status_code):
                return last  # non-transient (e.g. 400) — don't retry
    return last
