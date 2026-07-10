"""Deterministic cache-freshness logic for confirmed SUTS jurisdiction codes.

Pure date math, no I/O. The skill caches a confirmed code with the date it was
confirmed; this module decides whether that cache entry is still trustworthy.

A cached code is fresh as of `as_of` iff BOTH:
  1. it is within the 90-day TTL: (as_of - confirmed).days <= TTL_DAYS, and
  2. it was confirmed on or after the most recent rate-reset boundary that is
     on or before `as_of` (Colorado local rates change Jan 1 / Jul 1).

`expires_on(confirmed)` is the earlier of confirmed+TTL and the next reset
boundary strictly after confirmed.
"""

from __future__ import annotations

from datetime import date, timedelta

TTL_DAYS = 90

# Colorado local sales-tax rate changes take effect Jan 1 and Jul 1 by statute.
# (month, day) pairs — change these if the statutory boundaries ever move.
RESET_BOUNDARIES = ((1, 1), (7, 1))


def _boundaries_near(year: int) -> list[date]:
    """All reset boundary dates for the year before/of/after `year`, sorted."""
    return sorted(
        date(y, m, d)
        for y in (year - 1, year, year + 1)
        for (m, d) in RESET_BOUNDARIES
    )


def last_reset(d: date) -> date:
    """Most recent reset boundary on or before `d`."""
    return max(b for b in _boundaries_near(d.year) if b <= d)


def next_reset(d: date) -> date:
    """Earliest reset boundary strictly after `d`."""
    return min(b for b in _boundaries_near(d.year) if b > d)


def is_fresh(confirmed: date, as_of: date) -> bool:
    """True iff a code confirmed on `confirmed` is still fresh as of `as_of`."""
    return (as_of - confirmed).days <= TTL_DAYS and confirmed >= last_reset(as_of)


def expires_on(confirmed: date) -> date:
    """The date a code confirmed on `confirmed` stops being fresh: the earlier
    of confirmed+TTL and the next reset boundary strictly after confirmed."""
    return min(confirmed + timedelta(days=TTL_DAYS), next_reset(confirmed))


def check_freshness(confirmed_date: str, as_of: str | None = None) -> dict:
    """String-in/string-out wrapper for the MCP tool. Dates are ISO (YYYY-MM-DD);
    `as_of` defaults to today. Returns {fresh, reason, expires_on}."""
    confirmed = date.fromisoformat(confirmed_date)
    ref = date.fromisoformat(as_of) if as_of else date.today()

    age = (ref - confirmed).days
    reset = last_reset(ref)
    exp = expires_on(confirmed)

    if age > TTL_DAYS:
        fresh, reason = False, (
            f"stale - confirmed {confirmed} is {age} days old, "
            f"exceeds the {TTL_DAYS}-day TTL"
        )
    elif confirmed < reset:
        fresh, reason = False, (
            f"stale - a rate reset on {reset} occurred after the code was "
            f"confirmed ({confirmed})"
        )
    else:
        fresh, reason = True, (
            f"fresh - confirmed {confirmed} is {age} days old, within the "
            f"{TTL_DAYS}-day TTL and on/after the {reset} reset"
        )

    return {"fresh": fresh, "reason": reason, "expires_on": exp.isoformat()}
